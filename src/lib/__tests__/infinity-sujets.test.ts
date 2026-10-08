/**
 * @module InfinityScheduler/Lib/SujetsInfinity/Tests
 * @description 🌍 La télévision parle de l'APPLICATION — et seulement de ce qui mérite d'être dit,
 *   JAMAIS plus précisément que la ville (07/10/2026).
 *
 *   Retour du Bâtisseur (09/09/2026) : « les thèmes doivent absolument concerner les sujets de
 *   l'application ». Mesuré le 10/09 au soir : sur 28 events récents des trois kinds, 27 venaient
 *   d'autres applications, et le 28e était une Manifestaction de TEST — « jdfdosij ».
 *   Relevé le 07/10 : le JT lisait encore `location` (coordonnées en clair, parfois une adresse).
 *
 *   Lancer :  npx tsx --test src/lib/__tests__/infinity-sujets.test.ts
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import type { Event as NostrEvent } from 'nostr-tools'
import {
  lirePropositionDav, propositionsDav, retenirSujets, assemblerSujets, DESCRIPTION_MIN,
  KIND_MANIFESTACTION, KIND_PROJET_ABONDANCE, KIND_PROPOSITION_DAV,
} from '../infinity-sujets'
import { CONFIANCE_VIDE, KIND_SUPPRESSION, KIND_DECISION_BIOGAME, type ConfianceCarte } from '../sujets-carte'
import { TAG_VALIDATION_ABONDANCE } from '../sujets-abondance'
import { formatNewsForPrompt } from '../news'

const MAINTENANT = Date.UTC(2026, 9, 7, 12)          // 7 octobre 2026
const J = 86_400_000
const PK = 'a'.repeat(64)
const PK2 = 'b'.repeat(64)
const ADMIN = 'c'.repeat(64)
const D = 'On plante une haie champêtre le long du chemin, outils fournis, venez comme vous êtes.'
const PARIS: [number, number] = [2.3243, 48.8466]   // [lng, lat] — relevé réel du 07/10 (« 48.8466°N, 2.3243°E »)
const ADRESSE = '12 rue des Lilas, 75006 Paris'
const GPS = '48.8466°N, 2.3243°E'
let seq = 0
const nid = () => (++seq).toString(16).padStart(64, '0')

function ev(kind: number, content: unknown, tags: string[][], o: { pubkey?: string; ageJours?: number; id?: string } = {}): NostrEvent {
  return {
    kind, id: o.id ?? nid(), pubkey: o.pubkey ?? PK, sig: 's', tags,
    created_at: Math.floor((MAINTENANT - (o.ageJours ?? 1) * J) / 1000),
    content: typeof content === 'string' ? content : JSON.stringify(content),
  } as NostrEvent
}
const PUBLIC = (d: string) => [['d', d], ['visibility', 'public']]
/** Une Manifestaction telle que l'application la publie : point GPS + `location` en clair + tag `g`. */
const mhe = (c: Record<string, unknown> = {}, tags: string[][] = [...PUBLIC('m1'), ['g', GPS]], o = {}) => ev(KIND_MANIFESTACTION, {
  title: 'Haie du chemin creux', description: D, status: 'preparation', location: ADRESSE,
  coordinates: PARIS, createdAt: MAINTENANT - 2 * J, expiresAt: null, startDate: MAINTENANT + 5 * J, ...c,
}, tags, o)
const dav = (c: Record<string, unknown> = {}, tags: string[][] = PUBLIC('p1'), o = {}) => ev(KIND_PROPOSITION_DAV, {
  title: 'Article 4 — l’eau', description: D, status: 'open', expiresAt: MAINTENANT + 20 * J, quorum: 50, ...c,
}, tags, o)
const conf = (p: Partial<ConfianceCarte> = {}): ConfianceCarte => ({ ...CONFIANCE_VIDE, etablis: new Set([PK, PK2]), arbitres: new Set([ADMIN]), ...p })
const JT = (events: NostrEvent[], c = conf()) => retenirSujets(events, 6, MAINTENANT, c)
/** Tout ce que le rédacteur du JT reçoit d'Infinity, tel quel. */
const matiere = (events: NostrEvent[], c = conf()) => formatNewsForPrompt(JT(events, c))

/** Ce qui ne doit JAMAIS atteindre le JT : rue, code postal, coordonnées. */
function assertJamaisPlusFinQueLaVille(s: string): void {
  for (const interdit of ['rue', 'Lilas', '75006', '48.8', '48,8', '2.32', '2,32', '°N', '°E']) {
    assert.ok(!s.includes(interdit), `« ${interdit} » a atteint le JT : ${s}`)
  }
}

test('les témoins font bien le minimum exigé (sinon les tests ne prouvent rien)', () => {
  assert.ok(D.length >= DESCRIPTION_MIN)
  assert.equal(JT([mhe()]).length, 1, 'la Manifestaction témoin doit passer')
  assert.equal(JT([dav()]).length, 1, 'la proposition témoin doit passer')
})

// ── 🔒 Jamais plus fin que la ville ──────────────────────────────────────────────────────────

test('⭐ une Manifestaction avec ADRESSE et coordonnées → le JT ne reçoit que la VILLE', () => {
  const m = matiere([mhe()])
  assert.match(m, /Haie du chemin creux/)
  assert.match(m, / · à Paris · /, 'la ville seule, sans arrondissement ni quartier')
  assertJamaisPlusFinQueLaVille(m)
})

test('⭐ `location` et le tag `g` ne sont JAMAIS lus : sans point GPS, aucun lieu (on ne devine pas)', () => {
  const m = matiere([mhe({ coordinates: undefined, location: 'Sion, 3 chemin des Vignes' }, [...PUBLIC('m1'), ['g', 'Sion']])])
  assert.match(m, /Haie du chemin creux/, 'la Manifestaction est dite…')
  assert.ok(!m.includes('Sion') && !m.includes('Vignes'), `… mais sans le libellé libre : ${m}`)
})

test('⭐ un point en pleine campagne (aucune ville à moins de 30 km) → aucun lieu, pas de village', () => {
  const m = matiere([mhe({ coordinates: [2.98, 44.62] })])    // plateau de l'Aubrac
  assert.match(m, /Haie du chemin creux/)
  assert.ok(!/ à [A-Z]| près d/.test(m.replace(/à partir du/g, '')), m)
})

test('⭐ une commune de banlieue se dit par la GRANDE ville (Montreuil → « à Paris »)', () => {
  const m = matiere([mhe({ coordinates: [2.4485, 48.8638] })])
  assert.match(m, / · à Paris · /)
  assert.ok(!m.includes('Montreuil'), m)
})

test('⭐ la mise en forme garde la ville en tête : elle survit à la coupe à 180 caractères', () => {
  const longue = `${D} `.repeat(5).trim()
  const m = matiere([mhe({ description: longue })])
  assert.match(m, /à Paris/)
  assert.match(m, /à partir du 12 octobre/)
})

// ── Rien de privé, rien de retiré, rien d'échu ───────────────────────────────────────────────

test('⭐ privée / sans `visibility=public` → absente', () => {
  assert.equal(JT([mhe({}, [['d', 'm1'], ['visibility', 'contacts']])]).length, 0, 'contacts')
  assert.equal(JT([mhe({}, [['d', 'm1']])]).length, 0, 'sans tag')
  assert.equal(JT([dav({}, [['d', 'p1']])]).length, 0, 'proposition sans tag')
})

test('⭐ retirée par son auteur → absente (pierre tombale, NIP-09, refus de partage)', () => {
  const vivante = mhe({}, PUBLIC('m1'), { ageJours: 2 })
  const tombale = ev(KIND_MANIFESTACTION, { deleted: true }, PUBLIC('m1'), { ageJours: 1 })
  assert.equal(JT([vivante, tombale]).length, 0, 'pierre tombale plus récente')
  const supp = ev(KIND_SUPPRESSION, '', [['a', `${KIND_MANIFESTACTION}:${PK}:m1`], ['k', String(KIND_MANIFESTACTION)]])
  assert.equal(JT([mhe(), supp]).length, 0, 'NIP-09 par l’auteur')
  const suppAutrui = ev(KIND_SUPPRESSION, '', [['a', `${KIND_MANIFESTACTION}:${PK}:m1`]], { pubkey: PK2 })
  assert.equal(JT([mhe(), suppAutrui]).length, 1, 'une suppression signée par un AUTRE ne retire rien')
  assert.equal(JT([mhe({}, [...PUBLIC('m1'), ['infinity-partage', 'non']])]).length, 0, 'partage refusé')
  const p = dav({}, PUBLIC('p1'), { ageJours: 2 })
  assert.equal(JT([p, ev(KIND_SUPPRESSION, '', [['e', p.id]])]).length, 0, 'proposition supprimée (NIP-09)')
})

test('⭐ expirée / échue / finie → absente', () => {
  const exp = String(Math.floor((MAINTENANT - J) / 1000))
  assert.equal(JT([mhe({}, [...PUBLIC('m1'), ['expiration', exp]])]).length, 0, 'NIP-40')
  assert.equal(JT([mhe({ expiresAt: MAINTENANT - J })]).length, 0, 'échéance passée')
  assert.equal(JT([mhe({ status: 'cancelled' })]).length, 0, 'annulée')
  assert.equal(JT([mhe({ status: 'completed' })]).length, 0, 'terminée')
  assert.equal(JT([dav({ expiresAt: MAINTENANT - J })]).length, 0, 'vote échu')
  assert.equal(JT([dav({ status: 'draft' })]).length, 0, 'brouillon')
  assert.equal(JT([dav({ status: 'closed' })]).length, 0, 'clos')
})

test('⭐ l’événement RÉEL du 10/09 reste rejeté : « jdfdosij », sans description, annulé, passé', () => {
  const jdfdosij = ev(KIND_MANIFESTACTION, {
    title: 'jdfdosij', description: '', categories: [], status: 'cancelled',
    location: 'Valais', coordinates: [7.3, 46.2], startDate: Date.UTC(2026, 7, 2),
  }, PUBLIC('j'), { ageJours: 38 })
  assert.equal(JT([jdfdosij]).length, 0)
})

test('⭐ ce qui n’est pas un contenu Infinity reste REJETÉ', () => {
  for (const etranger of [
    { spec: 'x', version: 1, type: 't', id: 'i', scope: 's', visibility: 'v' },
    { protocol: 'p', v: 1, channel: 'c', payload: {} },
    'partie de MatchHello',
    '[1,2,3]',
  ]) {
    assert.equal(JT([ev(KIND_MANIFESTACTION, etranger, PUBLIC('x'))]).length, 0)
    assert.equal(JT([ev(KIND_PROPOSITION_DAV, etranger, PUBLIC('x'))]).length, 0)
  }
})

// ── Rien d'un compte banni, masqué ou jetable ────────────────────────────────────────────────

test('⭐ compte banni, publication masquée, auteur NON établi → absents', () => {
  assert.equal(JT([mhe()], conf({ bannis: new Set([PK]) })).length, 0, 'banni')
  const m = mhe()
  assert.equal(JT([m], conf({ masques: new Set([m.id]) })).length, 0, 'masquée')
  assert.equal(JT([mhe()], conf({ etablis: new Set() })).length, 0, 'compte neuf')
  assert.equal(JT([dav()], conf({ bannis: new Set([PK]) })).length, 0, 'proposition d’un banni')
  assert.equal(JT([dav()], conf({ etablis: new Set() })).length, 0, 'proposition d’un compte neuf')
  assert.equal(JT([dav()], conf({ etablis: new Set(), auteursApprouves: new Set([PK]) })).length, 1, 'approuvé : dit')
})

// ── Liens, courriels, numéros ────────────────────────────────────────────────────────────────

test('⭐ liens, courriels et numéros sont retirés de TOUT texte libre (Manifestaction, proposition)', () => {
  const sale = `${D} Infos : https://exemple.org/inscription, ecrire à jean.dupont@exemple.fr ou au 06 12 34 56 78.`
  const m = matiere([
    mhe({ title: 'Haie — www.haie.fr', description: sale }),
    dav({ description: sale }, PUBLIC('p1'), { pubkey: PK2 }),
  ])
  assert.match(m, /Haie/)
  assert.match(m, /Article 4/)
  for (const interdit of ['http', 'www.', 'exemple.org', '@', 'dupont', '06 12', '12 34 56 78']) {
    assert.ok(!m.includes(interdit), `« ${interdit} » a atteint le JT : ${m}`)
  }
})

// ── Abondance : la règle de l'application (validé dans cette version), la ville seulement ────

test('⭐ un projet Abondance n’est dit que VALIDÉ, ramené à la ville, nettoyé', () => {
  const projet = ev(KIND_PROJET_ABONDANCE, {
    title: 'Four solaire partagé', description: `${D} Contact : four@exemple.fr`, goal: 1500, status: 'active',
    coords: { lat: PARIS[1], lng: PARIS[0] }, location: ADRESSE, dureeJours: null,
  }, [...PUBLIC('f1'), ['g', GPS]])
  assert.equal(JT([projet]).length, 0, 'non validé : absent')
  const a = `${KIND_PROJET_ABONDANCE}:${PK}:f1`
  const aval = ev(KIND_DECISION_BIOGAME, '', [['d', a], ['a', a], ['e', projet.id], ['decision', 'valide'], ['t', TAG_VALIDATION_ABONDANCE]], { pubkey: ADMIN })
  const m = matiere([projet, aval])
  assert.match(m, /Four solaire partagé/)
  assert.match(m, /à Paris/)
  assertJamaisPlusFinQueLaVille(m)
  assert.ok(!m.includes('@') && !m.includes('four@'), m)
})

// ── Propositions et tri ──────────────────────────────────────────────────────────────────────

test('une proposition ouverte se lit, avec son échéance en tête', () => {
  const p = lirePropositionDav(dav(), MAINTENANT)
  assert.ok(p)
  assert.match(p.actualite.summary ?? '', /^Vote ouvert jusqu'au 27\/10\/2026 · Quorum : 50/)
  assert.equal(p.auteur, PK)
})

test('seule la DERNIÈRE version d’une proposition compte', () => {
  const ancienne = dav({ title: 'Version 1' }, PUBLIC('p1'), { ageJours: 3 })
  const close = dav({ title: 'Version 2', status: 'closed' }, PUBLIC('p1'), { ageJours: 1 })
  assert.equal(propositionsDav([ancienne, close], MAINTENANT).length, 0)
})

test('⭐ le tri ne laisse aucune famille hors antenne', () => {
  const l = assemblerSujets([
    [{ title: 'M1', sourceTitle: 's', publishedAt: 3 }, { title: 'M2', sourceTitle: 's', publishedAt: 2 }],
    [{ title: 'P1', sourceTitle: 's', publishedAt: 1 }],
    [{ title: 'D1', sourceTitle: 's', publishedAt: 0 }],
  ], 3).map(s => s.title)
  assert.deepEqual(l.sort(), ['D1', 'M1', 'P1'])
})

// ── Garde : le code du JT ne lit plus le libellé libre ──────────────────────────────────────

test('🔒 garde : `infinity-sujets.ts` ne lit ni `location`, ni le tag `g`, ni aucun champ de lieu libre', () => {
  const brut = readFileSync(new URL('../infinity-sujets.ts', import.meta.url), 'utf8')
  // Les commentaires en parlent (c'est leur rôle) : on les retire avant de juger le CODE.
  const code = brut.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1')
  for (const motif of [/\.location\b/, /\[\s*['"]location['"]\s*\]/, /['"]g['"]/, /\.zone\b/, /\.region\b/, /['"](locality|region|subregion)['"]/]) {
    assert.ok(!motif.test(code), `motif interdit dans le code du JT : ${motif}`)
  }
})
