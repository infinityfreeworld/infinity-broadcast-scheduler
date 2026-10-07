/**
 * @module InfinityScheduler/Lib/StationsThema/Tests
 * @description 📻 Les stations Abondance, OBF et Biogame (décisions du Bâtisseur, 07/10/2026) : ce qui se
 *   dit (projets validés, nouveau projet raconté en détail, rotation, bilan OBF, Biogames validés), ce
 *   qui ne se dit JAMAIS (non public, non validé, retiré, plus fin que la ville, alerte en cours), et
 *   leurs replis « raison d'être ».
 *
 *   Lancer :  npx tsx --test src/lib/__tests__/stations-thema.test.ts
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import type { Event as NostrEvent } from 'nostr-tools'
import {
  KIND_PROJET_ABONDANCE, STATION_ABONDANCE, NOUVEAUX_MAX, NOUVEAUTE_REPLI_HEURES, NOUVEAUTE_PREMIERE_FOIS_JOURS,
  NOUVEAUTE_MAX_JOURS, RAISONS_D_ETRE_ABONDANCE, SOURCE_RAISON_D_ETRE_ABONDANCE, SOURCE_NOUVEAU, SOURCE_PROJET, SOURCE_CAMPAGNE,
  lireProjetAbondance, projetsAbondance, lireDecisionsProjets, etatProjet, derniereEmission, referenceNouveaute,
  estNouveau, tourner, antenneAbondance, projetEnDetail, campagneDuJour, type ProjetAbondance,
} from '../sujets-abondance'
import {
  KIND_OBF_ALERTE, STATION_OBF, FOND_OBF, lireAlerteObf, alertesLisibles, alerteDeConfiance, bilanAlertes, bilanEnPhrase,
  actualitesStationObf, ligneEditorialeObf, choisirFondObf,
} from '../sujets-obf'
import { FOND_BIOGAME, STATION_BIOGAME, actualitesStationBiogame, ligneEditorialeBiogame, choisirFondBiogame } from '../sujets-biogame'
import { stationThema } from '../stations-thema'
import { dTagsEmissionsPrecedentes } from '../stations-thema-relais'
import { KIND_DECISION_BIOGAME, KIND_SUPPRESSION, CONFIANCE_VIDE, stationConcernee, type ConfianceCarte, type SujetCarte } from '../sujets-carte'
import { CAMPAGNES_ABONDANCE } from '../../data/campagnes-abondance'
import { SEED_STATIONS } from '../../data/seed-stations'
import { SEED_HOST_KBS } from '../../data/seed-host-kbs'
import { ANIMATEURS_SANS_VOIX_INVENTEE, VOIX_INVENTEES } from '../../data/voix-inventees'
import { formatNewsForPrompt } from '../news'

const MAINTENANT = Date.UTC(2026, 9, 7, 12)          // 7 octobre 2026
const J = 86_400_000
const PK = 'a'.repeat(64)
const PK2 = 'b'.repeat(64)
const ADMIN = 'c'.repeat(64)
const INTRUS = 'd'.repeat(64)
const LYON = { lat: 45.76, lng: 4.84 }
const DESC = 'Un verger partagé de vingt arbres fruitiers anciens, planté et entretenu par les habitants du quartier.'
let seq = 0
const nid = () => (++seq).toString(16).padStart(64, '0')

function ev(kind: number, content: unknown, tags: string[][], o: { pubkey?: string; ageJours?: number; id?: string; createdMs?: number } = {}): NostrEvent {
  return {
    kind, id: o.id ?? nid(), pubkey: o.pubkey ?? PK, sig: 's', tags,
    created_at: Math.floor((o.createdMs ?? MAINTENANT - (o.ageJours ?? 1) * J) / 1000),
    content: typeof content === 'string' ? content : JSON.stringify(content),
  } as NostrEvent
}
const TAGS_PROJET = (d = 'p1') => [['d', d], ['title', 'Verger'], ['g', '12 rue des Lilas, Lyon'], ['category', 'ecological'], ['visibility', 'public'], ['lang', 'fr']]
const projet = (c: Record<string, unknown> = {}, tags: string[][] = TAGS_PROJET(), o = {}) => ev(KIND_PROJET_ABONDANCE, {
  title: 'Le verger des Pentes', description: DESC, status: 'active', goal: 5000, collected: 1200, author: 'Collectif des Pentes',
  location: '12 rue des Lilas, 69001 Lyon', themes: ['alimentation', 'environnement'], besoins: ['benevolat', 'materiel'],
  dureeJours: null, coords: LYON, ...c,
}, tags, o)
const coord = (e: NostrEvent) => `${KIND_PROJET_ABONDANCE}:${e.pubkey}:${e.tags.find(t => t[0] === 'd')![1]}`
const avis = (cible: NostrEvent, decision: 'valide' | 'refuse', o: { pubkey?: string; ageJours?: number; createdMs?: number; eventId?: string } = {}) =>
  ev(KIND_DECISION_BIOGAME, '', [['d', coord(cible)], ['t', 'abondance-validation'], ['a', coord(cible)], ['e', o.eventId ?? cible.id],
    ['p', cible.pubkey], ['nature', 'projet-abondance'], ['decision', decision], ['visibility', 'public']], { pubkey: ADMIN, ...o })
const conf = (p: Partial<ConfianceCarte> = {}): ConfianceCarte => ({ ...CONFIANCE_VIDE, arbitres: new Set([ADMIN]), etablis: new Set([PK, PK2]), ...p })

// ── Abondance : ce qui se dit ────────────────────────────────────────────────────────────────

test('⭐ un projet public VALIDÉ se dit : titre, VILLE, thèmes, besoins, objectif, porteur', () => {
  const p = projet()
  const [lu] = projetsAbondance([p, avis(p, 'valide')], conf(), MAINTENANT)
  assert.ok(lu)
  assert.equal(lu.titre, 'Le verger des Pentes')
  assert.equal(lu.lieu, 'à Lyon')
  assert.deepEqual(lu.themes, ['alimentation et eau', 'environnement'])
  assert.deepEqual(lu.besoins, ['des bénévoles', 'du matériel'])
  assert.equal(lu.objectif, '5 000 euros')
  assert.equal(lu.porteur, 'Collectif des Pentes')
  const detail = projetEnDetail(lu)
  for (const attendu of ['Le verger des Pentes', 'à Lyon', 'vingt arbres', 'des bénévoles', '5 000 euros', 'Abondance']) assert.ok(detail.includes(attendu), attendu)
})

test('⭐ jamais plus fin que la ville, jamais un lien, un courriel, un montant collecté', () => {
  const p = projet({ description: `${DESC} Infos : https://exemple.org/verger, contact@exemple.org, 06 12 34 56 78.`, author: '6f290e57b8a0…' })
  const lu = lireProjetAbondance(p, MAINTENANT)!
  const texte = `${projetEnDetail({ ...lu, apparuLe: MAINTENANT })} ${[lu.titre, lu.description, lu.lieu, lu.porteur, lu.objectif, ...lu.themes, ...lu.besoins].join(' ')}`
  for (const interdit of ['Lilas', '69001', '45.76', '4.84', 'https://', 'exemple.org', '@', '06 12', '1200', '1 200', '6f290e57']) {
    assert.ok(!texte.includes(interdit), `${interdit} dans « ${texte} »`)
  }
  assert.equal(lu.porteur, '', 'un porteur qui ressemble à une clé ne se prononce pas')
})

test('⭐ publics SEULEMENT : contacts, privé ou sans tag de visibilité → jamais dit (même validé)', () => {
  for (const v of ['contacts', 'private', undefined]) {
    const tags = TAGS_PROJET().filter(t => t[0] !== 'visibility')
    if (v) tags.push(['visibility', v])
    const p = projet({}, tags)
    assert.equal(lireProjetAbondance(p, MAINTENANT), null, String(v))
    assert.deepEqual(projetsAbondance([p, avis(p, 'valide')], conf(), MAINTENANT), [], String(v))
  }
  const p = projet()
  assert.equal(projetsAbondance([p, avis(p, 'valide')], conf(), MAINTENANT).length, 1)
})

test('⭐ VALIDÉ dans CETTE version, par un arbitre : sinon rien', () => {
  const p = projet()
  assert.deepEqual(projetsAbondance([p], conf(), MAINTENANT), [], 'en attente')
  assert.deepEqual(projetsAbondance([p, avis(p, 'refuse')], conf(), MAINTENANT), [], 'refusé')
  assert.deepEqual(projetsAbondance([p, avis(p, 'valide', { pubkey: INTRUS })], conf(), MAINTENANT), [], 'avis d’un non-arbitre')
  assert.deepEqual(projetsAbondance([p, avis(p, 'valide', { eventId: 'f'.repeat(64) })], conf(), MAINTENANT), [], 'autre version')
  // Validé puis refusé plus tard → refusé ; même seconde → le refus l'emporte.
  assert.deepEqual(projetsAbondance([p, avis(p, 'valide', { ageJours: 3 }), avis(p, 'refuse', { ageJours: 1 })], conf(), MAINTENANT), [])
  assert.deepEqual(projetsAbondance([p, avis(p, 'valide', { ageJours: 1 }), avis(p, 'refuse', { ageJours: 1 })], conf(), MAINTENANT), [])
  // Un avis BIOGAME (coordonnée 30375) n'est pas un avis projet.
  const avisBiogame = ev(KIND_DECISION_BIOGAME, '', [['d', `30375:${PK}:p1`], ['a', `30375:${PK}:p1`], ['e', p.id], ['decision', 'valide']], { pubkey: ADMIN })
  assert.deepEqual(lireDecisionsProjets([avisBiogame]), [])
  // Une version MODIFIÉE (nouvel événement) rouvre l'examen.
  const v2 = projet({ title: 'Le verger des Pentes, saison 2' }, TAGS_PROJET(), { ageJours: 0.5 })
  assert.deepEqual(projetsAbondance([p, v2, avis(p, 'valide')], conf(), MAINTENANT), [], 'l’aval de v1 ne couvre pas v2')
})

test('⭐ rien de retiré, de fermé, d’échu, de refusé au partage, de banni ou de masqué', () => {
  const ok = (e: NostrEvent, extra: NostrEvent[] = [], c = conf()) => projetsAbondance([e, avis(e, 'valide'), ...extra], c, MAINTENANT).length === 1
  assert.ok(ok(projet()))
  assert.ok(!ok(projet({}, TAGS_PROJET(), {}), [ev(KIND_PROJET_ABONDANCE, { deleted: true }, TAGS_PROJET(), { ageJours: 0.1 })]), 'pierre tombale plus récente')
  const p = projet()
  assert.ok(!ok(p, [ev(KIND_SUPPRESSION, '', [['a', coord(p)], ['k', String(KIND_PROJET_ABONDANCE)]], { ageJours: 0.1 })]), 'NIP-09 par l’auteur')
  assert.ok(ok(p, [ev(KIND_SUPPRESSION, '', [['a', `${KIND_PROJET_ABONDANCE}:${PK}:p1`]], { pubkey: INTRUS, ageJours: 0.1 })]), 'NIP-09 d’un tiers : ignoré')
  assert.ok(!ok(projet({}, [...TAGS_PROJET(), ['expiration', String(Math.floor((MAINTENANT - 1000) / 1000))]])), 'NIP-40')
  for (const status of ['draft', 'closed', 'expired', 'inconnu']) assert.ok(!ok(projet({ status })), status)
  assert.ok(ok(projet({ status: 'funded' })), 'financé : encore dit')
  assert.ok(!ok(projet({ dureeJours: 30 }, TAGS_PROJET(), { ageJours: 31 })), 'collecte échue')
  assert.ok(ok(projet({ dureeJours: 30 }, TAGS_PROJET(), { ageJours: 29 })), 'collecte en cours')
  assert.ok(!ok(projet({}, [...TAGS_PROJET(), ['infinity-partage', 'non']])), 'partage extérieur refusé')
  assert.ok(!ok(projet({ description: 'Trop court.' })), 'rien à raconter')
  assert.ok(!ok(projet(), [], conf({ bannis: new Set([PK]) })), 'auteur banni')
  const m = projet()
  assert.ok(!ok(m, [], conf({ masques: new Set([m.id]) })), 'publication masquée')
})

// ── Abondance : « nouveau » ──────────────────────────────────────────────────────────────────

test('⭐ apparu = PREMIER aval : une version modifiée puis revalidée n’est pas un projet nouveau', () => {
  const v1 = projet({}, TAGS_PROJET(), { ageJours: 10 })
  const v2 = projet({ title: 'Le verger des Pentes, saison 2' }, TAGS_PROJET(), { ageJours: 1 })
  const decisions = lireDecisionsProjets([avis(v1, 'valide', { ageJours: 9 }), avis(v2, 'valide', { ageJours: 0.5 })])
  const etat = etatProjet(v2, decisions, new Set([ADMIN]))
  assert.equal(etat.valide, true)
  assert.equal(etat.apparuLe, Math.floor((MAINTENANT - 9 * J) / 1000) * 1000)
  assert.equal(estNouveau({ apparuLe: etat.apparuLe! }, MAINTENANT - 2 * J), false)
  // Publié il y a dix jours mais validé hier seulement : il APPARAÎT hier, il est nouveau.
  const tardif = projet({}, TAGS_PROJET('p2'), { ageJours: 10 })
  const [lu] = projetsAbondance([tardif, avis(tardif, 'valide', { ageJours: 0.5 })], conf(), MAINTENANT)
  assert.ok(estNouveau(lu, MAINTENANT - J))
})

test('⭐ la dernière émission : NOTRE clé, CETTE station, une date ANTÉRIEURE', () => {
  const NOUS = 'e'.repeat(64)
  const em = (pubkey: string, d: string, ms: number) => ({ pubkey, created_at: Math.floor(ms / 1000), tags: [['d', d]] })
  const emissions = [
    em(NOUS, `${STATION_ABONDANCE}:2026-10-05`, MAINTENANT - 2 * J),
    em(NOUS, `${STATION_ABONDANCE}:2026-10-06`, MAINTENANT - J),
    em(NOUS, `${STATION_ABONDANCE}:2026-10-07`, MAINTENANT),          // même date : on la refait, elle ne compte pas
    em(INTRUS, `${STATION_ABONDANCE}:2026-10-06`, MAINTENANT - 0.5 * J), // autre clé
    em(NOUS, 'obf-radio:2026-10-06', MAINTENANT - 0.2 * J),              // autre station
  ]
  assert.equal(derniereEmission(emissions, STATION_ABONDANCE, '2026-10-07', NOUS), Math.floor((MAINTENANT - J) / 1000) * 1000)
  assert.equal(derniereEmission([], STATION_ABONDANCE, '2026-10-07', NOUS), null)
  assert.deepEqual(dTagsEmissionsPrecedentes(STATION_ABONDANCE, '2026-10-07', 2), [`${STATION_ABONDANCE}:2026-10-06`, `${STATION_ABONDANCE}:2026-10-05`])
})

test('⭐ référence « nouveau » : dernière émission, sinon première fois (7 j), sinon repli (36 h), jamais plus de 14 j', () => {
  assert.equal(referenceNouveaute({ ok: true, derniere: MAINTENANT - J }, MAINTENANT), MAINTENANT - J)
  assert.equal(referenceNouveaute({ ok: true, derniere: null }, MAINTENANT), MAINTENANT - NOUVEAUTE_PREMIERE_FOIS_JOURS * J)
  assert.equal(referenceNouveaute({ ok: false, derniere: null }, MAINTENANT), MAINTENANT - NOUVEAUTE_REPLI_HEURES * 3_600_000)
  assert.equal(referenceNouveaute({ ok: true, derniere: MAINTENANT - 60 * J }, MAINTENANT), MAINTENANT - NOUVEAUTE_MAX_JOURS * J)
})

const projetLu = (cle: string, apparuJours: number, titre = cle): ProjetAbondance => ({
  cle, auteur: PK, eventId: cle, titre, description: `${DESC} Projet ${titre}`, lieu: 'à Lyon', themes: ['semences'], besoins: ['des bénévoles'],
  porteur: '', objectif: '', finance: false, publieLe: MAINTENANT - apparuJours * J, apparuLe: MAINTENANT - apparuJours * J,
})

test('⭐ un NOUVEAU projet est raconté EN DÉTAIL ; les anciens tournent sans détail', () => {
  const neuf = projetLu('31200:a:neuf', 0.3, 'La grainothèque du lavoir')
  const anciens = [projetLu('31200:a:v1', 20), projetLu('31200:a:v2', 30), projetLu('31200:a:v3', 40)]
  const a = antenneAbondance([neuf, ...anciens], MAINTENANT - J, '2026-10-07')
  assert.deepEqual(a.nouveaux.map(p => p.cle), ['31200:a:neuf'])
  assert.match(a.ligneEditoriale, /NOUVEAU dans Abondance/)
  assert.ok(a.ligneEditoriale.includes(projetEnDetail(neuf)), 'le détail COMPLET (non coupé) du nouveau projet est dans la consigne')
  for (const p of anciens) assert.ok(!a.ligneEditoriale.includes(p.description), 'un ancien n’est pas raconté en détail')
  assert.equal(a.actualites[0].sourceTitle, SOURCE_NOUVEAU)
  assert.ok(a.rotation.every(p => p.cle !== neuf.cle), 'le nouveau n’est pas compté deux fois')
  assert.ok(a.actualites.some(n => n.sourceTitle === SOURCE_PROJET))
  assert.ok(a.actualites.some(n => n.sourceTitle === SOURCE_CAMPAGNE))
  // Sans nouveauté : aucun « NOUVEAU ».
  const b = antenneAbondance(anciens, MAINTENANT - J, '2026-10-07')
  assert.deepEqual(b.nouveaux, [])
  assert.doesNotMatch(b.ligneEditoriale, /NOUVEAU/)
  // Au plus NOUVEAUX_MAX racontés en détail, les plus récents.
  const beaucoup = Array.from({ length: NOUVEAUX_MAX + 2 }, (_, i) => projetLu(`31200:a:n${i}`, 0.1 * (i + 1)))
  assert.equal(antenneAbondance(beaucoup, MAINTENANT - J, '2026-10-07').nouveaux.length, NOUVEAUX_MAX)
})

test('⭐ rotation : déterministe, et JAMAIS le même projet deux jours de suite quand il y en a plusieurs', () => {
  for (let n = 1; n <= 9; n++) {
    const liste = Array.from({ length: n }, (_, i) => `p${i}`)
    const vus = new Set<string>()
    for (let j = 0; j < 40; j++) {
      const jour = new Date(Date.UTC(2026, 9, 1) + j * J)
      const auj = tourner(liste, jour, 2)
      const demain = tourner(liste, new Date(jour.getTime() + J), 2)
      assert.deepEqual(auj, tourner(liste, jour, 2), 'même jour, même choix')
      auj.forEach(x => vus.add(x))
      if (n >= 2) assert.deepEqual(auj.filter(x => demain.includes(x)), [], `n=${n}, jour ${j}`)
    }
    assert.equal(vus.size, n, `n=${n} : tous passent à l’antenne`)
  }
  assert.notEqual(campagneDuJour('2026-10-07')?.id, campagneDuJour('2026-10-08')?.id)
})

test('⭐ sans projet : la raison d’être d’Abondance (et la campagne du jour)', () => {
  const a = antenneAbondance([], MAINTENANT - J, '2026-10-07')
  const fond = a.actualites.filter(n => n.sourceTitle === SOURCE_RAISON_D_ETRE_ABONDANCE)
  assert.equal(fond.length, 3)
  assert.match(a.ligneEditoriale, /aucun projet de Bâtisseur.*RAISON D'ÊTRE/s)
  assert.match(a.ligneEditoriale, /n'invente aucun nom/)
  assert.ok(RAISONS_D_ETRE_ABONDANCE.length >= 10)
  assert.ok(a.campagne)
})

test('les campagnes copiées de l’application : uniques, sans lien ni montant', () => {
  assert.ok(CAMPAGNES_ABONDANCE.length >= 70)
  assert.equal(new Set(CAMPAGNES_ABONDANCE.map(c => c.id)).size, CAMPAGNES_ABONDANCE.length)
  for (const c of CAMPAGNES_ABONDANCE) {
    assert.ok(c.titre && c.resume, c.id)
    assert.doesNotMatch(`${c.titre} ${c.resume} ${c.description}`, /https?:\/\/|www\./, c.id)
  }
})

test('⭐ les campagnes sont celles de l’application (mêmes identifiants)', (t) => {
  const depot = process.env.INFINITY_DEPOT
    ? new URL(`file://${process.env.INFINITY_DEPOT.replace(/\/?$/, '/')}`)
    : new URL('../../../../infinity/', import.meta.url)
  const ts = new URL('src/modules/abondance/campagnes-soutien.ts', depot)
  const json = new URL('src/modules/abondance/donnees/initiatives-kifaitkoi.json', depot)
  if (!existsSync(ts) || !existsSync(json)) { t.skip('dépôt infinity absent — synchronisation NON vérifiée'); return }
  const src = readFileSync(ts, 'utf8')
  const ecrites = [...src.slice(src.indexOf('const TOUTES'), src.indexOf('...(INITIATIVES_KIFAITKOI')).matchAll(/\n {4}id: '([^']+)'/g)].map(m => m[1])
  const kifaitkoi = (JSON.parse(readFileSync(json, 'utf8')) as { id: string }[]).map(i => i.id)
  assert.deepEqual(CAMPAGNES_ABONDANCE.map(c => c.id).sort(), [...ecrites, ...kifaitkoi].sort())
})

// ── OBF ──────────────────────────────────────────────────────────────────────────────────────

const MARSEILLE: [number, number] = [5.3778, 43.2964]   // [lng, lat]
const alerte = (c: Record<string, unknown> = {}, tags: string[][] = [['d', 'obf-1'], ['visibility', 'public'], ['t', 'critical']], o: { pubkey?: string; ageJours?: number } = {}) =>
  ev(KIND_OBF_ALERTE, {
    type: 'critical', title: 'Monsieur Dupont blessé', description: 'Il est au 3 rue Paradis, appelez Jean au 06 11 22 33 44',
    coordinates: MARSEILLE, status: 'active', createdAt: MAINTENANT - (o.ageJours ?? 0.2) * J, ...c,
  }, tags, { ageJours: 0.2, ...o })

test('⭐ OBF : un BILAN (niveaux et villes), jamais un titre, une description, un nom, une adresse', () => {
  const lues = alertesLisibles([
    alerte(), alerte({ type: 'info', coordinates: [4.84, 45.76] }, [['d', 'obf-2'], ['visibility', 'public']]),
    alerte({ type: 'info', status: 'resolved', coordinates: [4.84, 45.76] }, [['d', 'obf-3'], ['visibility', 'public']], { pubkey: PK2 }),
  ], MAINTENANT)
  assert.equal(lues.length, 3)
  const phrase = bilanEnPhrase(bilanAlertes(lues))
  assert.match(phrase, /3 alertes publiques OBF/)
  assert.match(phrase, /1 alerte rouge \(urgence vitale\) et 2 alertes bleues/)
  assert.match(phrase, /près de Marseille, Lyon/)
  assert.match(phrase, /1 déjà terminée/)
  assert.match(phrase, /la carte, en direct/)
  for (const interdit of ['Dupont', 'Paradis', 'Jean', '06 11', 'blessé', '43.29', '5.37']) assert.ok(!phrase.includes(interdit), interdit)
  assert.match(ligneEditorialeObf(phrase), /jamais comme une alerte en cours/)
  assert.ok(ligneEditorialeObf(phrase).includes(phrase), 'le bilan complet (non coupé) est dans la consigne')
})

test('⭐ OBF : publiques seulement, ni test, ni annulée, ni ancienne, ni retirée, ni niveau inconnu', () => {
  assert.ok(lireAlerteObf(alerte(), MAINTENANT))
  for (const v of ['contacts', 'private', undefined]) {
    const tags = v ? [['d', 'obf-1'], ['visibility', v]] : [['d', 'obf-1']]
    assert.equal(lireAlerteObf(alerte({}, tags), MAINTENANT), null, String(v))
  }
  assert.equal(lireAlerteObf(alerte({}, [['d', 'test-1'], ['visibility', 'public']]), MAINTENANT), null, 'alerte de test')
  assert.equal(lireAlerteObf(alerte({ status: 'cancelled' }), MAINTENANT), null)
  assert.equal(lireAlerteObf(alerte({ type: 'jaune' }), MAINTENANT), null)
  assert.equal(lireAlerteObf(alerte({}, undefined, { ageJours: 3 }), MAINTENANT), null, 'plus de 48 h')
  assert.equal(lireAlerteObf(alerte({ deleted: true, title: '', description: '' }), MAINTENANT), null)
  assert.equal(lireAlerteObf(alerte({}, [['d', 'obf-1'], ['visibility', 'public'], ['expiration', String(Math.floor(MAINTENANT / 1000) - 10)]]), MAINTENANT), null)
  const a = alerte()
  assert.deepEqual(alertesLisibles([a, ev(KIND_SUPPRESSION, '', [['a', `${KIND_OBF_ALERTE}:${PK}:obf-1`]], { ageJours: 0.1 })], MAINTENANT), [], 'NIP-09')
})

test('⭐ OBF : compte neuf, banni ou masqué → hors du bilan', () => {
  const [a] = alertesLisibles([alerte()], MAINTENANT)
  assert.ok(alerteDeConfiance(a, conf()))
  assert.ok(!alerteDeConfiance(a, conf({ etablis: new Set() })), 'compte neuf')
  assert.ok(!alerteDeConfiance(a, conf({ bannis: new Set([PK]) })))
  assert.ok(!alerteDeConfiance(a, conf({ masques: new Set([a.eventId]) })))
})

test('⭐ OBF : sans alerte, le fond — les détails, les conflits, les Manifestactions de soutien', () => {
  const fil = actualitesStationObf(bilanAlertes([]), '2026-10-07', MAINTENANT)
  assert.equal(fil.length, 3)
  assert.ok(fil.every(n => FOND_OBF.includes(n)))
  assert.ok(FOND_OBF.length >= 10)
  const tout = FOND_OBF.map(n => `${n.title} ${n.summary}`).join(' ')
  for (const attendu of ['quatre niveaux', 'Sentinelle', 'conflits', 'Flash', 'Ghost', 'Manifestactions', 'avant la crise', 'pendant la crise', 'après la crise']) {
    assert.ok(tout.includes(attendu), attendu)
  }
  const ligne = ligneEditorialeObf('')
  assert.match(ligne, /neutre et factuel/)
  assert.match(ligne, /engagé/)
  assert.match(ligne, /Manifestactions adaptées à la situation/)
  assert.match(ligne, /112/)
  assert.match(ligne, /n'en invente aucune/)
  assert.deepEqual(choisirFondObf(3, '2026-10-07').filter(n => choisirFondObf(3, '2026-10-08').includes(n)), [])
})

// ── Biogame ──────────────────────────────────────────────────────────────────────────────────

test('⭐ Biogame : la consigne dit 2027, le concept et les TYPES', () => {
  for (const avec of [true, false]) {
    const l = ligneEditorialeBiogame(avec)
    assert.match(l, /lancement officiel des Biogames est prévu courant 2027/)
    for (const type of ['Compétitions', 'Tournois', 'Grand Tournoi de l\'Autonomie', 'Défis', 'Challenges du mois', 'Quêtes', 'We are Alive', 'Ligue', 'Palmarès', 'forêt']) {
      assert.ok(l.includes(type), `${type} (${avec})`)
    }
  }
  assert.match(ligneEditorialeBiogame(false), /n'en invente aucun/)
  const tout = FOND_BIOGAME.map(n => `${n.title} ${n.summary}`).join(' ')
  for (const attendu of ['2027', 'plogging', 'seed-run', 'Tribus', 'GTA', 'maraude', 'We are Alive', 'Paliers 3', 'Teryaum']) assert.ok(tout.includes(attendu), attendu)
  assert.ok(FOND_BIOGAME.length >= 10)
})

test('⭐ Biogame : les Biogames validés d’abord, sinon le fond seul', () => {
  const sujet: SujetCarte = {
    famille: 'biogame', cle: 'k', auteur: PK, eventId: 'e', titre: 'Plogging des quais', lieu: 'à Lyon', quand: 'le 12 octobre',
    quoi: 'une compétition de plogging', rejoindre: "on s'inscrit dans Biogame, rubrique Compétitions", publieLe: MAINTENANT,
  }
  const avec = actualitesStationBiogame([sujet], '2026-10-07')
  assert.equal(avec[0].title, 'Plogging des quais')
  assert.equal(avec.length, 3)
  const sans = actualitesStationBiogame([], '2026-10-07')
  assert.equal(sans.length, 4)
  assert.ok(sans.every(n => FOND_BIOGAME.includes(n)))
  assert.deepEqual(choisirFondBiogame(4, '2026-10-07').filter(n => choisirFondBiogame(4, '2026-10-08').includes(n)), [])
})

test('tous les sujets de fond tiennent dans la coupe du prompt (180 caractères)', () => {
  for (const n of [...RAISONS_D_ETRE_ABONDANCE, ...FOND_OBF, ...FOND_BIOGAME]) {
    assert.ok((n.summary ?? '').length <= 180, `${n.title} : ${(n.summary ?? '').length}`)
    assert.ok(formatNewsForPrompt([n]).includes(n.summary!), n.title)
  }
})

// ── Les trois stations ───────────────────────────────────────────────────────────────────────

test('⭐ les trois stations existent : français, deux animateurs avec voix et fiche, fréquence libre', () => {
  const ids = [STATION_ABONDANCE, STATION_OBF, STATION_BIOGAME]
  const kinds: Record<string, string> = { [STATION_ABONDANCE]: 'abondance', [STATION_OBF]: 'obf', [STATION_BIOGAME]: 'bigballs' }
  const attendusDescription: Record<string, RegExp> = {
    [STATION_ABONDANCE]: /tous les projets.*nouveau projet/s,
    [STATION_OBF]: /Overwatch Blaze Field.*conflits.*Manifestactions/s,
    [STATION_BIOGAME]: /Compétitions.*Tournois.*Défis.*We are Alive.*2027/s,
  }
  for (const id of ids) {
    const st = SEED_STATIONS.find(s => s.id === id)
    assert.ok(st, id)
    assert.equal(st.kind, kinds[id])
    assert.equal(st.language, 'fr')
    assert.equal(st.hosts.length, 2)
    assert.ok(st.tagline)
    assert.match(st.description ?? '', attendusDescription[id])
    for (const h of st.hosts) {
      assert.ok(SEED_HOST_KBS[h.id], `fiche de ${h.id}`)
      assert.ok(ANIMATEURS_SANS_VOIX_INVENTEE.has(`${id}:${h.id}`) || VOIX_INVENTEES[`${id}:${h.id}`], `voix de ${h.id}`)
    }
    // 113.7 : Manifestactions (lot 7) ; aucune station ne doit être à moins de 0,1 MHz.
    for (const autre of SEED_STATIONS.filter(s => s.id !== id)) assert.ok(Math.abs(autre.frequency - st.frequency) > 0.1, `${id} chevauche ${autre.id}`)
    assert.equal(stationThema(st), kinds[id] === 'bigballs' ? 'biogame' : kinds[id])
    assert.equal(stationConcernee(st), null, 'pas une station « carte » du lot 7')
  }
  for (const s of SEED_STATIONS.filter(x => !ids.includes(x.id))) assert.equal(stationThema(s), null, s.id)
  // Fréquences des fiches 30091 publiées sur les relais (relevées le 07/10/2026) : aucune n'approche.
  for (const publiee of [87.7, 91.3, 96.0, 102.7, 105.3, 117.4, 119.8, 130.2]) {
    for (const id of [STATION_ABONDANCE, STATION_OBF]) assert.ok(Math.abs(SEED_STATIONS.find(s => s.id === id)!.frequency - publiee) > 0.1)
  }
})

test('⭐ garde : la carte aiguille les stations thématiques AVANT les siennes', () => {
  const src = readFileSync(new URL('../carte-relais.ts', import.meta.url), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
  const corps = src.slice(src.indexOf('export async function sujetsCartePourStation'))
  const aiguillage = corps.indexOf('stationThema(station)')
  const role = corps.indexOf('stationConcernee(station)')
  assert.ok(aiguillage > 0 && aiguillage < role)
  assert.match(corps, /sujetsStationThema\(thema, station, date\)/)
})
