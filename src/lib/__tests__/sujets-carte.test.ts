/**
 * @module InfinityScheduler/Lib/SujetsCarte/Tests
 * @description 🗺 La station Manifestactions et la rubrique « pendant ce temps sur la carte » de
 *   Freeworld (décisions du Bâtisseur, 07/10/2026) : ce qui se dit, et surtout ce qui ne se dit JAMAIS
 *   (privé, retiré, échu, plus fin que la ville, compte jetable, sigle de l'administration).
 *
 *   Lancer :  npx tsx --test src/lib/__tests__/sujets-carte.test.ts
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import type { Event as NostrEvent } from 'nostr-tools'
import {
  KIND_MHE, KIND_AGORA, KIND_BIOGAME_COMPETITION, KIND_BIOGAME_DEFI, KIND_DECISION_BIOGAME, KIND_SUPPRESSION,
  KIND_MODERATION_IHL, CONFIANCE_VIDE, RAISONS_D_ETRE, SOURCE_RAISON_D_ETRE, STATION_MANIFESTACTIONS,
  lireManifestactionCarte, lireAgoraCarte, retenirSujetsCarte, sujetsLisibles, actualitesStationManifestactions,
  choisirRaisonsDEtre, ligneEditorialeManifestactions, placerRubriqueCarte, sansSigleAdministration,
  nettoyerTexteLibre, seuilsAnciennete, etablisDepuis, confianceDepuisModeration, sujetEnUneLigne,
  stationConcernee, type ConfianceCarte,
} from '../sujets-carte'
import { lieuParle } from '../villes'
import { consigneTour } from '../consignes-tour'
import { formatNewsForPrompt } from '../news'
import { SEED_STATIONS } from '../../data/seed-stations'

const MAINTENANT = Date.UTC(2026, 9, 7, 12)          // 7 octobre 2026
const J = 86_400_000
const PK = 'a'.repeat(64)
const PK2 = 'b'.repeat(64)
const ADMIN = 'c'.repeat(64)
const D = 'On plante une haie champêtre le long du chemin, outils fournis, venez comme vous êtes.'
const LYON: [number, number] = [4.8357, 45.764]     // [lng, lat]
let seq = 0
const id = () => (++seq).toString(16).padStart(64, '0')

function ev(kind: number, content: unknown, tags: string[][], o: { pubkey?: string; ageJours?: number; id?: string } = {}): NostrEvent {
  return {
    kind, id: o.id ?? id(), pubkey: o.pubkey ?? PK, sig: 's', tags,
    created_at: Math.floor((MAINTENANT - (o.ageJours ?? 1) * J) / 1000),
    content: typeof content === 'string' ? content : JSON.stringify(content),
  } as NostrEvent
}
const mhe = (c: Record<string, unknown> = {}, tags: string[][] = [['d', 'm1'], ['visibility', 'public']], o = {}) => ev(KIND_MHE, {
  title: 'Haie du chemin creux', description: D, status: 'preparation', location: '12 rue des Lilas, 69003 Lyon',
  coordinates: LYON, createdAt: MAINTENANT - 2 * J, expiresAt: null, startDate: MAINTENANT + 5 * J, ...c,
}, tags, o)
const conf = (p: Partial<ConfianceCarte> = {}): ConfianceCarte => ({ ...CONFIANCE_VIDE, etablis: new Set([PK, PK2]), arbitres: new Set([ADMIN]), ...p })

// ── Manifestactions ──────────────────────────────────────────────────────────────────────────

test('⭐ une Manifestaction publique se dit : titre, VILLE, date, quoi, comment rejoindre', () => {
  const s = lireManifestactionCarte(mhe(), MAINTENANT)
  assert.ok(s)
  assert.equal(s.titre, 'Haie du chemin creux')
  assert.equal(s.lieu, 'à Lyon')
  assert.match(s.quand, /^à partir du 12 octobre/)
  assert.match(s.quoi, /haie champêtre/)
  assert.match(s.rejoindre, /Infinity/)
})

test('⭐ jamais plus fin que la ville : ni l’adresse (location), ni les coordonnées, ni le tag g', () => {
  const e = mhe({ location: '48.8466°N, 2.3243°E' }, [['d', 'm1'], ['visibility', 'public'], ['g', '12 rue des Lilas']])
  const ligne = sujetEnUneLigne(lireManifestactionCarte(e, MAINTENANT)!)
  for (const interdit of ['Lilas', '69003', '48.8466', '2.3243', '45.76', '4.83']) assert.ok(!ligne.includes(interdit), `${interdit} dans « ${ligne} »`)
  // Un point loin de toute ville : on ne devine pas.
  assert.equal(lieuParle(45.0, -30.0), '')
  // Une banlieue se dit par sa grande ville ; un arrondissement n'existe pas (« Lyon 05 » écarté).
  assert.equal(lieuParle(45.80, 4.90), 'à Lyon', 'Rillieux-la-Pape → Lyon')
  assert.equal(lieuParle(45.757, 4.82), 'à Lyon', 'Lyon 5e')
  assert.equal(lieuParle(52.48, 13.43), 'à Berlin', 'Neukölln → Berlin')
  assert.equal(lieuParle(45.04, 2.44), "près d'Aurillac")
})

test('⭐ publiques SEULEMENT : contacts, privée ou sans tag de visibilité → jamais dite', () => {
  for (const v of ['contacts', 'private', undefined]) {
    const tags = v ? [['d', 'm1'], ['visibility', v]] : [['d', 'm1']]
    assert.equal(lireManifestactionCarte(mhe({}, tags), MAINTENANT), null, String(v))
  }
  assert.ok(lireManifestactionCarte(mhe(), MAINTENANT))
})

test('l’auteur qui refuse la diffusion hors de l’application n’est pas lu à l’antenne', () => {
  assert.equal(lireManifestactionCarte(mhe({}, [['d', 'm1'], ['visibility', 'public'], ['infinity-partage', 'non']]), MAINTENANT), null)
})

test('rien de fini : annulée, terminée, en pause, pré-enregistrée, statut inconnu, échue (expiresAt / NIP-40)', () => {
  for (const status of ['cancelled', 'completed', 'paused', 'preregistered', 'toString']) {
    assert.equal(lireManifestactionCarte(mhe({ status }), MAINTENANT), null, status)
  }
  assert.equal(lireManifestactionCarte(mhe({ expiresAt: MAINTENANT - J }), MAINTENANT), null, 'expiresAt passé')
  const nip40 = mhe({}, [['d', 'm1'], ['visibility', 'public'], ['expiration', String(Math.floor((MAINTENANT - 1000) / 1000))]])
  assert.equal(lireManifestactionCarte(nip40, MAINTENANT), null, 'NIP-40')
})

test('à venir OU récente : une ancienne sans date future n’est plus une nouvelle', () => {
  assert.equal(lireManifestactionCarte(mhe({ createdAt: MAINTENANT - 60 * J, startDate: undefined }), MAINTENANT), null)
  assert.ok(lireManifestactionCarte(mhe({ createdAt: MAINTENANT - 60 * J, startDate: MAINTENANT + 10 * J }), MAINTENANT))
  const enCours = lireManifestactionCarte(mhe({ startDate: MAINTENANT - J, expiresAt: MAINTENANT + 20 * J }), MAINTENANT)
  assert.match(enCours!.quand, /^en cours, jusqu'au 27 octobre/)
})

test('une description trop courte ne se raconte pas (même règle que la télévision)', () => {
  assert.equal(lireManifestactionCarte(mhe({ description: 'test' }), MAINTENANT), null)
})

test('⭐ retraits : pierre tombale plus récente, suppression NIP-09 de l’AUTEUR (pas d’un autre)', () => {
  const v1 = mhe({}, undefined, { ageJours: 2 })
  const tombe = ev(KIND_MHE, { deleted: true }, [['d', 'm1'], ['visibility', 'public']], { ageJours: 1 })
  assert.equal(sujetsLisibles([v1, tombe], MAINTENANT, new Set()).length, 0, 'pierre tombale')
  assert.equal(sujetsLisibles([v1], MAINTENANT, new Set()).length, 1)
  const parAuteur = ev(KIND_SUPPRESSION, '', [['a', `${KIND_MHE}:${PK}:m1`], ['k', '30500']])
  const parAutre = ev(KIND_SUPPRESSION, '', [['a', `${KIND_MHE}:${PK}:m1`], ['e', v1.id]], { pubkey: PK2 })
  assert.equal(sujetsLisibles([v1, parAuteur], MAINTENANT, new Set()).length, 0, 'NIP-09 de l’auteur')
  assert.equal(sujetsLisibles([v1, parAutre], MAINTENANT, new Set()).length, 1, 'NIP-09 d’un autre : sans effet')
  // À date égale, la pierre tombale l'emporte (dans le doute, on se tait).
  const memeDate = ev(KIND_MHE, { deleted: true }, [['d', 'm1'], ['visibility', 'public']], { ageJours: 2 })
  assert.equal(sujetsLisibles([v1, memeDate], MAINTENANT, new Set()).length, 0)
})

test('texte libre : ni lien, ni courriel, ni téléphone, ni sigle de l’administration', () => {
  const t = nettoyerTexteLibre("Écrivez à jean.dupont@exemple.fr ou au 06 12 34 56 78, infos sur https://exemple.fr/x — validé par l'IHL.")
  for (const interdit of ['@', 'exemple', '06 12', 'http', 'IHL']) assert.ok(!t.includes(interdit), `${interdit} dans « ${t} »`)
  assert.equal(nettoyerTexteLibre('Venez nombreux. Contact : 06 12 34 56 78, merci !'), 'Venez nombreux. merci !', 'étiquette orpheline retirée')
  assert.equal(sansSigleAdministration("Validée par l'IHL, puis par IHL."), "Validée par l'administration, puis par l'administration.")
})

// ── Agoras & Biogames ────────────────────────────────────────────────────────────────────────

const agora = (c: Record<string, unknown> = {}, tags: string[][] = [['d', 'ag1'], ['t', 'agora'], ['visibility', 'public']], o = {}) => ev(KIND_AGORA, {
  id: 'ag1', name: 'Marché des Pentes', type: 'marche', needs: ['alimentation', 'eau'], lat: LYON[1], lng: LYON[0],
  availability: 'recurrente', schedule: { days: ['sam'] }, contact: '06 00 00 00 00', precisionM: 150, createdAt: MAINTENANT - 3 * J, ...c,
}, tags, o)

test('Agora : le registre (t=agora) se lit, sans contact ; une autre application sur 30360 est ignorée', () => {
  const s = lireAgoraCarte(agora(), MAINTENANT)!
  assert.equal(s.lieu, 'à Lyon')
  assert.equal(s.quand, 'chaque samedi')
  assert.match(s.quoi, /marché permanent.*alimentation et eau/)
  assert.ok(!sujetEnUneLigne(s).includes('06 00'))
  assert.equal(lireAgoraCarte(agora({}, [['d', 'agent'], ['t', 'agent']]), MAINTENANT), null)
  assert.equal(lireAgoraCarte(agora({}, [['d', 'ag1'], ['t', 'agora'], ['retracted', '1'], ['visibility', 'public']]), MAINTENANT), null)
  assert.equal(lireAgoraCarte(agora({ precisionM: 30_000 }), MAINTENANT)!.lieu, '', 'floutée à 30 km : pas de ville')
})

const competition = (o: { id?: string } = {}) => ev(KIND_BIOGAME_COMPETITION, {
  id: 'c1', name: 'Plogging des quais', desc: 'On court et on ramasse.', sport: 'plogging', mode: 'presentiel',
  route: [LYON], date: '2026-10-20', createdAt: MAINTENANT - 2 * J,
}, [['d', 'c1'], ['t', 'biogame-defi']], { pubkey: PK, ...o })
const decision = (cible: NostrEvent, valide: boolean, o: { pubkey?: string; ageJours?: number; eventId?: string } = {}) => {
  const a = `${cible.kind}:${cible.pubkey}:${cible.tags.find(t => t[0] === 'd')![1]}`
  return ev(KIND_DECISION_BIOGAME, '', [['d', a], ['a', a], ['e', o.eventId ?? cible.id], ['decision', valide ? 'valide' : 'refuse']],
    { pubkey: o.pubkey ?? ADMIN, ageJours: o.ageJours ?? 0.5 })
}

test('⭐ Biogame : PUBLIC seulement validé par l’administration, dans CETTE version', () => {
  const c = competition()
  const arb = new Set([ADMIN])
  assert.equal(sujetsLisibles([c], MAINTENANT, arb).length, 0, 'sans avis : en attente, jamais dit')
  assert.equal(sujetsLisibles([c, decision(c, true)], MAINTENANT, arb).length, 1, 'validé')
  assert.equal(sujetsLisibles([c, decision(c, true, { pubkey: PK2 })], MAINTENANT, arb).length, 0, 'avis d’un non-arbitre')
  assert.equal(sujetsLisibles([c, decision(c, true, { eventId: 'f'.repeat(64) })], MAINTENANT, arb).length, 0, 'autre version')
  assert.equal(sujetsLisibles([c, decision(c, true, { ageJours: 0.5 }), decision(c, false, { ageJours: 0.5 })], MAINTENANT, arb).length, 0, 'à date égale, le refus')
  assert.equal(sujetsLisibles([c, decision(c, false, { ageJours: 1 }), decision(c, true, { ageJours: 0.2 })], MAINTENANT, arb).length, 1, 'le plus récent')
  const s = sujetsLisibles([c, decision(c, true)], MAINTENANT, arb)[0]
  assert.equal(s.lieu, 'à Lyon')
  assert.equal(s.quand, 'le 20 octobre')
})

test('Biogame Défi : jamais la « zone » (un quartier) ; le point arrondi ramené à la ville', () => {
  const q = ev(KIND_BIOGAME_DEFI, { id: 'q1', title: 'Maraude du jeudi', desc: 'Soupe et présence.', type: 'maraude', zone: 'Quartier de la Guillotière', lat: LYON[1], lng: LYON[0], createdAt: MAINTENANT - J },
    [['d', 'q1'], ['t', 'biogame-quete']])
  const s = sujetsLisibles([q, decision(q, true)], MAINTENANT, new Set([ADMIN]))[0]
  assert.ok(!sujetEnUneLigne(s).includes('Guillotière'))
  assert.equal(s.lieu, 'à Lyon')
})

// ── Confiance ────────────────────────────────────────────────────────────────────────────────

test('⭐ confiance : banni, masqué, compte NEUF → jamais ; établi, approuvé, administrateur → oui', () => {
  const e = mhe()
  const dits = (c: ConfianceCarte) => retenirSujetsCarte([e], c, MAINTENANT).length
  assert.equal(dits(conf()), 1)
  assert.equal(dits(conf({ bannis: new Set([PK]) })), 0, 'banni')
  assert.equal(dits(conf({ masques: new Set([e.id]) })), 0, 'masqué')
  assert.equal(dits(conf({ etablis: new Set() })), 0, 'compte neuf')
  assert.equal(dits(conf({ etablis: new Set(), approuves: new Set([e.id]) })), 1, 'publication approuvée')
  assert.equal(dits(conf({ etablis: new Set(), auteursApprouves: new Set([PK]) })), 1, 'auteur approuvé')
  assert.equal(dits(conf({ etablis: new Set(), arbitres: new Set([PK]) })), 1, 'administrateur')
})

test('⭐ l’ancienneté se juge au moment de la PUBLICATION (vague du 30/09 : clés jetables)', () => {
  const s = lireManifestactionCarte(mhe({ createdAt: MAINTENANT - 7 * J }), MAINTENANT)!
  const seuils = seuilsAnciennete([s], { arbitres: new Set(), bannis: new Set() })
  const seuil = seuils.get(PK)!
  // Le compte jetable : sa toute première trace date de quelques minutes avant la publication.
  assert.equal(etablisDepuis([{ pubkey: PK, created_at: Math.floor(s.publieLe / 1000) - 120 }], seuils).size, 0)
  assert.equal(etablisDepuis([{ pubkey: PK, created_at: seuil }], seuils).size, 1)
  // Un autre auteur qui « prouve » à sa place ne compte pas.
  assert.equal(etablisDepuis([{ pubkey: PK2, created_at: seuil - 999 }], seuils).size, 0)
})

test('modération : seuls les documents d’un ARBITRE comptent ; bans échus ignorés', () => {
  const bans = (pubkey: string) => ev(KIND_MODERATION_IHL, { bans: [{ pubkey: PK, reason: 'x', at: 1 }, { pubkey: PK2, reason: 'y', at: 1, until: MAINTENANT - 1 }] },
    [['d', 'ihl-account-bans']], { pubkey })
  assert.deepEqual([...confianceDepuisModeration([bans(PK2)], new Set([ADMIN]), MAINTENANT).bannis], [])
  assert.deepEqual([...confianceDepuisModeration([bans(ADMIN)], new Set([ADMIN]), MAINTENANT).bannis], [PK])
  const moder = ev(KIND_MODERATION_IHL, { bans: [PK2], hidden: [{ id: 'h1', scope: 'mhe' }] }, [['d', 'ihl-moderation']], { pubkey: ADMIN })
  const restr = ev(KIND_MODERATION_IHL, { reviews: [{ id: 'r1', pubkey: PK, verdict: 'approved', rule: 'newcomer' }, { id: 'r2', pubkey: PK, verdict: 'rejected' }] },
    [['d', 'ihl-account-restrictions']], { pubkey: ADMIN })
  const c = confianceDepuisModeration([moder, restr], new Set([ADMIN]), MAINTENANT)
  assert.ok(c.bannis.has(PK2) && c.masques.has('h1') && c.masques.has('r2') && c.approuves.has('r1') && c.auteursApprouves.has(PK))
})

test('un sujet par auteur, et un tour de table des familles', () => {
  const a1 = mhe({}, [['d', 'm1'], ['visibility', 'public']])
  const a2 = mhe({ title: 'Seconde du même' }, [['d', 'm2'], ['visibility', 'public']])
  const ag = agora({}, undefined, { pubkey: PK2 })
  const r = retenirSujetsCarte([a1, a2, ag], conf(), MAINTENANT)
  assert.equal(r.length, 2)
  assert.deepEqual(r.map(s => s.famille).sort(), ['agora', 'manifestaction'])
})

// ── La station Manifestactions et son repli ──────────────────────────────────────────────────

test('⭐ sans Manifestaction : la RAISON D’ÊTRE, variée d’un jour à l’autre, stable dans la journée', () => {
  const j1 = actualitesStationManifestactions([], '2026-10-08')
  assert.equal(j1.length, 3)
  assert.ok(j1.every(n => n.sourceTitle === SOURCE_RAISON_D_ETRE))
  assert.deepEqual(actualitesStationManifestactions([], '2026-10-08'), j1, 'rejouable')
  const j2 = actualitesStationManifestactions([], '2026-10-09')
  assert.equal(j2.filter(n => j1.includes(n)).length, 0, 'deux jours de suite : rien en commun')
  // Sur deux semaines, tous les sujets de fond passent.
  const vus = new Set<string>()
  for (let k = 0; k < 14; k++) for (const n of choisirRaisonsDEtre(3, new Date(MAINTENANT + k * J))) vus.add(n.title)
  assert.equal(vus.size, RAISONS_D_ETRE.length)
  for (const n of RAISONS_D_ETRE) {
    assert.ok((n.summary ?? '').length <= 180, `${n.title} : ${n.summary?.length} car.`)
    assert.ok(!/\bIHL\b/i.test(`${n.title} ${n.summary}`))
  }
  assert.match(ligneEditorialeManifestactions(false), /RAISON D'ÊTRE/)
  assert.match(ligneEditorialeManifestactions(true), /réelles/)
})

test('avec des Manifestactions : elles d’abord, la raison d’être complète jusqu’à trois sujets', () => {
  const s = lireManifestactionCarte(mhe(), MAINTENANT)!
  const une = actualitesStationManifestactions([s], '2026-10-08')
  assert.equal(une.length, 3)
  assert.equal(une[0].title, 'Haie du chemin creux')
  assert.equal(une.filter(n => n.sourceTitle === SOURCE_RAISON_D_ETRE).length, 2)
  const cinq = actualitesStationManifestactions([s, s, s, s, s], '2026-10-08')
  assert.equal(cinq.filter(n => n.sourceTitle === SOURCE_RAISON_D_ETRE).length, 1, 'toujours un sujet de fond')
  // Le prompt coupe le résumé à 180 caractères : les repères (date, ville, rejoindre) passent avant.
  const ligne = formatNewsForPrompt(une.slice(0, 1))
  assert.match(ligne, /12 octobre.*à Lyon.*Rejoindre/)
})

// ── La rubrique Freeworld ────────────────────────────────────────────────────────────────────

test('⭐ la rubrique se place au milieu : jamais à l’ouverture, à la clôture, ni sur un tour réservé', () => {
  const total = 45
  const exclus = new Set([0, total - 1, 12, 13, 20, 21, 22, 23, 24])
  for (const graine of ['freeworld-radio:2026-10-08:carte', 'a', 'b', 'c', 'd']) {
    const tours = placerRubriqueCarte(total, exclus, 2, graine)
    assert.equal(tours.length, 2)
    assert.equal(tours[1], tours[0] + 1, 'consécutifs')
    for (const k of tours) {
      assert.ok(!exclus.has(k) && k > 0 && k < total - 1, `tour ${k}`)
      assert.ok(k >= Math.floor(total * 0.4) && k <= Math.floor(total * 0.8), `tour ${k} hors du milieu`)
    }
    assert.deepEqual(placerRubriqueCarte(total, exclus, 2, graine), tours, 'déterministe')
  }
  assert.deepEqual(placerRubriqueCarte(total, exclus, 0, 'x'), [], 'rien à dire → pas de rubrique')
  assert.equal(placerRubriqueCarte(total, exclus, 1, 'x').length, 1)
  // Pas de place pour deux tours de suite : un seul.
  const serre = new Set(Array.from({ length: total }, (_, k) => k).filter(k => k % 2 === 0))
  assert.equal(placerRubriqueCarte(total, serre, 2, 'x').length, 1)
})

test('la consigne du tour « carte » nomme la rubrique et porte le sujet réel', () => {
  const sujet = sujetEnUneLigne(lireManifestactionCarte(mhe(), MAINTENANT)!)
  const c = consigneTour({ type: 'carte', sujet, ouvre: true, ferme: true }, 'fr')
  assert.match(c, /Pendant ce temps sur la carte/)
  assert.ok(c.includes(sujet))
  assert.match(c, /referme la rubrique/)
  assert.doesNotMatch(consigneTour({ type: 'carte', sujet, ouvre: true, ferme: false }, 'fr'), /referme/)
})

test('⭐ garde : generate-broadcast place la rubrique AVANT le plan humain et l’envoie au modèle', () => {
  const brut = readFileSync(new URL('../../scripts/generate-broadcast.ts', import.meta.url), 'utf8')
  const src = brut.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
  const lecture = src.indexOf('await sujetsCartePourStation(station, opts.date)')
  const placement = src.indexOf('placerRubriqueCarte(numTurns, exclus')
  const ajout = src.indexOf('for (const k of toursCarte) exclus.add(k)')
  const humain = src.indexOf('planHumain(numTurns, exclus')
  const boucle = src.search(/for \(let i = 0; i < [^;]*numTurns[^;]*;/)
  assert.ok(lecture > 0 && lecture < placement && placement < ajout && ajout < humain && humain < boucle, 'lecture → placement → exclus → plan humain → écriture')
  assert.match(src, /news\.unshift\(\.\.\.carte\.actualites\)/, 'les sujets de la carte rejoignent l’actualité du prompt')
  assert.match(src, /toursCarte\.includes\(i\) \? \{\s*type: 'carte'/)
  assert.match(src, /consigneCarte:\s+carte\.ligneEditoriale/)
  assert.match(src, /if \(carte\.concernee\) turnText = sansSigleAdministration\(turnText\)/)
})

test('les deux stations de la carte, et elles seules', () => {
  assert.equal(stationConcernee({ id: STATION_MANIFESTACTIONS, kind: 'manifestactions' }), 'manifestactions')
  assert.equal(stationConcernee({ id: 'freeworld-radio', kind: 'freeworld' }), 'rubrique')
  for (const s of SEED_STATIONS.filter(x => x.id !== STATION_MANIFESTACTIONS && x.id !== 'freeworld-radio')) {
    assert.equal(stationConcernee(s), null, s.id)
  }
})

// ── Les deux seeds ───────────────────────────────────────────────────────────────────────────

test('⭐ la station Manifestactions existe : français, fréquence libre, deux animateurs, raison d’être', () => {
  const st = SEED_STATIONS.find(s => s.id === STATION_MANIFESTACTIONS)
  assert.ok(st)
  assert.equal(st.kind, 'manifestactions')
  assert.equal(st.language, 'fr')
  assert.equal(st.hosts.length, 2)
  assert.match(st.description ?? '', /vivant.*besoins vitaux.*émancipation/)
  const autres = SEED_STATIONS.filter(s => s.id !== st.id)
  // 108.5 : Big Balls / Biogame, toujours présente côté application.
  for (const f of [...autres.map(s => s.frequency), 108.5]) assert.ok(Math.abs(f - st.frequency) > 0.1, `chevauche ${f}`)
})

/** Les stations d'un fichier seed : id → { fréquence, langue, animateurs }. Lecture par motif (pas d'import croisé de dépôt). */
function lireSeed(src: string): Map<string, { frequency: number; language: string; hosts: string[] }> {
  const out = new Map<string, { frequency: number; language: string; hosts: string[] }>()
  const blocs = src.split(/\n {2}\{\s*\n/).slice(1)
  for (const b of blocs) {
    const idm = /^\s*id: '([^']+)'/m.exec(b)
    const f = /frequency: ([\d.]+)/.exec(b)
    const l = /language: '([a-z]{2})'/.exec(b)
    if (!idm || !f || !l) continue
    out.set(idm[1], { frequency: Number(f[1]), language: l[1], hosts: [...b.matchAll(/\{ id: '([^']+)',\s*name:/g)].map(m => m[1]) })
  }
  return out
}

test('⭐ les seeds des deux dépôts sont synchrones (id, fréquence, langue, animateurs)', (t) => {
  const depot = process.env.INFINITY_DEPOT
    ? new URL(`file://${process.env.INFINITY_DEPOT.replace(/\/?$/, '/')}`)
    : new URL('../../../../infinity/', import.meta.url)
  const appli = new URL('src/modules/radio/stations/seed-stations.ts', depot)
  if (!existsSync(appli)) {
    t.skip('dépôt infinity absent de cette machine — synchronisation NON vérifiée (sautée, pas réussie)')
    return
  }
  const ici = lireSeed(readFileSync(new URL('../../data/seed-stations.ts', import.meta.url), 'utf8'))
  const la = lireSeed(readFileSync(appli, 'utf8'))
  // Le dépôt voisin par défaut peut être sur une branche ANTÉRIEURE aux stations du 07/10/2026
  // (Manifestactions, Abondance, OBF, Biogame refondue) : on le DIT, sans prétendre avoir vérifié.
  // `INFINITY_DEPOT=<worktree à jour>` force la comparaison complète.
  const neuves = [STATION_MANIFESTACTIONS, 'abondance-radio', 'obf-radio']
  if (!process.env.INFINITY_DEPOT && neuves.some(id => !la.has(id))) {
    t.skip(`${appli.pathname} antérieur aux stations du 07/10/2026 — synchronisation NON vérifiée (sautée, pas réussie)`)
    return
  }
  assert.equal(ici.size, SEED_STATIONS.length, 'le lecteur par motif voit toutes les stations du générateur')
  for (const [sid, g] of ici) {
    const a = la.get(sid)
    if (!a) {
      assert.fail(`${sid} absente de l'application`)
    }
    assert.equal(a.frequency, g.frequency, `${sid} : fréquence`)
    assert.equal(a.language, g.language, `${sid} : langue`)
    assert.deepEqual(a.hosts, g.hosts, `${sid} : animateurs`)
  }
})
