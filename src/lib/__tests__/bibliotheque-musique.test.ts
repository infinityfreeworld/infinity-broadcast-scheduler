/**
 * La musique de chaque station (07/10/2026) : bibliothèque 30108 des seuls admins, règles du 30091,
 * date butoir, et JAMAIS une musique sans mention de droits. Les cas de la règle viennent de
 * `cas-selection-musique.json`, le MÊME fichier que dans l'app (src/modules/radio/musique/__tests__/).
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { Event as NostrEvent } from 'nostr-tools/core'
import {
  JINGLES_GARANTIS, PISTES_COMMUNES, cleDePiste, jinglesDeLaStation, pistesDeLaStation, type PisteBibliotheque, type PisteJouable, type ReglesMusiqueStation,
} from '../selection-musique'
import { KIND_RADIO_MUSIQUE, avecSaMusique, lireMusiqueBibliotheque, retenirBibliotheque } from '../bibliotheque-musique'
import { appliquerReglages, lireReglages, restreindreFicheAncienne, FICHE_COMPLETE_DEPUIS_DEFAUT } from '../station-reglages'
import { planifierPauses, reglagesMusique, telechargerPiste } from '../musique'
import { SEED_STATIONS } from '../../data/seed-stations'

interface Cas { nom: string; station: { tracks?: PisteJouable[]; musique?: ReglesMusiqueStation }; communes?: PisteJouable[]; attendu: string[] }
interface CasJingles { nom: string; station: { id: string; jingles?: PisteJouable[] }; garantis: PisteJouable[]; attendu: string[] }
const ICI = dirname(fileURLToPath(import.meta.url))
const CAS = JSON.parse(readFileSync(resolve(ICI, 'cas-selection-musique.json'), 'utf8')) as { bibliotheque: PisteBibliotheque[]; cas: Cas[]; jingles: CasJingles[] }

for (const c of CAS.cas) {
  test(`🎚️ cas partagé avec l'app — ${c.nom}`, () => {
    assert.deepEqual(pistesDeLaStation(c.station, CAS.bibliotheque, c.communes ?? []).map(cleDePiste), c.attendu)
  })
}
for (const c of CAS.jingles) {
  test(`🎺 cas partagé avec l'app — ${c.nom}`, () => {
    assert.deepEqual(jinglesDeLaStation(c.station, c.garantis).map(cleDePiste), c.attendu)
  })
}

const ADMIN = 'a'.repeat(64)
const INTRUS = 'b'.repeat(64)
const CID_A = 'bafybeihdwdcefgh4dqkjv67uzcmw7ojee6xedzdetojuzjevtenxquvyku'
const CID_B = 'bafybeigdyrzt5sfp7udm7hu76uh7y26nf3efuylqabf3oclgtqy55fbzdi'
const DROITS = { type: 'licence', licence: 'CC BY 4.0', auteur: 'Lena' }

let n = 0
const ev = (content: object, extra: Partial<NostrEvent> = {}, d = `piste-${CID_A}`): NostrEvent => ({
  id: String(++n).padStart(64, '0'), pubkey: ADMIN, kind: KIND_RADIO_MUSIQUE, created_at: 1_759_800_000,
  tags: [['d', d]], content: JSON.stringify(content), sig: 's', ...extra,
})

test('30108 : étiquettes et droits lus et bornés ; une musique d’avant (titre + CID) reste lisible', () => {
  assert.deepEqual(lireMusiqueBibliotheque(ev({
    title: ' Aube ', cid: CID_A, artiste: 'Lena', genres: ['Électro', 'électro'], ambiances: ['Calme'], energie: 9, langue: 'fr', droits: DROITS, durationS: 200,
  })), {
    title: 'Aube', cid: CID_A, artiste: 'Lena', genres: ['électro'], ambiances: ['calme'], energie: 5, langue: 'fr',
    droits: { type: 'licence', licence: 'CC BY 4.0', auteur: 'Lena' }, durationS: 200,
  })
  assert.deepEqual(lireMusiqueBibliotheque(ev({ title: 'Vieille', cid: CID_A })), { title: 'Vieille', cid: CID_A })
  assert.equal(lireMusiqueBibliotheque(ev({ title: 'Faux', cid: 'pas-un-cid' })), null)
  assert.equal(lireMusiqueBibliotheque(ev({ title: 'Http', url: 'http://x.org/a.mp3' })), null, 'https seulement')
  assert.equal(lireMusiqueBibliotheque(ev({ deleted: true }, { tags: [['d', `piste-${CID_A}`], ['deleted', 'true']] })), null)
})

test('bibliothèque : seuls les admins comptent ; le plus récent l’emporte ; une pierre tombale retire', () => {
  const admins = new Set([ADMIN])
  const b = retenirBibliotheque([
    ev({ title: 'Aube v1', cid: CID_A, droits: DROITS }, { created_at: 1 }),
    ev({ title: 'Aube v2', cid: CID_A, droits: DROITS }, { created_at: 2 }),
    ev({ title: 'Pirate', cid: CID_B, droits: DROITS }, { pubkey: INTRUS }, `piste-${CID_B}`),
    ev({ title: 'Retirée', cid: CID_B }, { created_at: 1 }, `piste-${CID_B}x`),
    ev({ deleted: true }, { created_at: 2, tags: [['d', `piste-${CID_B}x`], ['deleted', 'true']] }, `piste-${CID_B}x`),
  ], admins)
  assert.deepEqual(b.map(m => m.title), ['Aube v2'])
})

const pirate = SEED_STATIONS.find(s => s.id === 'pirate-radio')!
const BIBLIO: PisteBibliotheque[] = [
  { title: 'Aube', cid: CID_A, genres: ['électro'], energie: 2, droits: { type: 'licence', licence: 'CC0' } },
  { title: 'Chanson festive', cid: CID_B, genres: ['électro'], energie: 4 },
]

test('station sans règles : ses `tracks` + les musiques de toutes les radios (la bibliothèque n’ajoute rien)', () => {
  assert.deepEqual(avecSaMusique(pirate, BIBLIO).tracks, [...(pirate.tracks ?? []), ...PISTES_COMMUNES])
})

test('🔴 DROITS OBLIGATOIRES : une musique sans droits n’entre jamais dans une émission, ni par règle ni par choix', () => {
  const s = avecSaMusique({ ...pirate, tracks: [{ title: 'Chanson festive', cid: CID_B }], musique: { etiquettes: { genres: ['électro'] } } }, BIBLIO)
  assert.deepEqual(s.tracks, [...PISTES_COMMUNES, { title: 'Aube', cid: CID_A }])
  // …et les pauses de la nuit ne tirent que dans cette liste-là.
  const r = reglagesMusique(s, {})
  const plan = planifierPauses(s, '2026-10-08', 22, r)
  assert.ok(plan.length > 0)
  const permises = new Set([CID_A, ...PISTES_COMMUNES.map(p => p.cid)])
  for (const p of plan) assert.ok(permises.has(p.track.cid), p.track.cid)
})

test('règles de la station : lues sur une fiche RÉCENTE, ignorées sur une fiche d’avant la date butoir', () => {
  const contenu = JSON.stringify({ musique: { etiquettes: { genres: ['Électro'] }, energie: [1, 3], exclure: [CID_B] } })
  const recente = restreindreFicheAncienne(lireReglages(contenu), FICHE_COMPLETE_DEPUIS_DEFAUT + 60, FICHE_COMPLETE_DEPUIS_DEFAUT)
  assert.deepEqual(recente?.musique, { etiquettes: { genres: ['électro'] }, energie: [1, 3], exclure: [CID_B] })
  assert.deepEqual(appliquerReglages(pirate, recente).musique, recente?.musique)
  const ancienne = restreindreFicheAncienne(lireReglages(contenu), FICHE_COMPLETE_DEPUIS_DEFAUT - 60, FICHE_COMPLETE_DEPUIS_DEFAUT)
  assert.equal(ancienne?.musique, undefined)
  assert.equal(appliquerReglages(pirate, ancienne).musique, undefined)
  assert.equal(lireReglages(JSON.stringify({ musique: 'rock' }))?.musique, undefined)
})

test('téléchargement : si le CID ne répond pas, l’adresse de secours est essayée', async () => {
  const vues: string[] = []
  const fetchAvant = globalThis.fetch
  globalThis.fetch = (async (url: string) => {
    vues.push(url)
    if (url.includes('/ipfs/')) return new Response('', { status: 504 })
    return new Response(new Uint8Array(4096), { status: 200 })
  }) as typeof fetch
  try {
    const buf = await telechargerPiste({ title: 'Aube', cid: CID_A, url: 'https://blossom.exemple/a.mp3' }, 'https://passerelle.exemple/ipfs')
    assert.equal(buf.length, 4096)
    assert.deepEqual(vues, [`https://passerelle.exemple/ipfs/${CID_A}`, 'https://blossom.exemple/a.mp3'])
    await assert.rejects(telechargerPiste({ title: 'Aube', cid: CID_A }, 'https://passerelle.exemple/ipfs'), /HTTP 504/)
  } finally { globalThis.fetch = fetchAvant }
})

// ── Décision de Med du 08/10/2026 : musiques de toutes les radios + jingles de la Radio Pirate ──
const CHANSON_RUSSE = 'QmU7Htd4J9EQttvs2s2wWm6TyiV3wPY7nxYLLRYvX7j4tE'

test('🎵 les 24 musiques de toutes les radios : CID valides, sans doublon, aucune retirée, la chanson russe en fait partie', () => {
  assert.equal(PISTES_COMMUNES.length, 24)
  assert.equal(new Set(PISTES_COMMUNES.map(p => p.cid)).size, 24)
  for (const p of PISTES_COMMUNES) assert.match(p.cid ?? '', /^Qm[1-9A-HJ-NP-Za-km-z]{44}$/)
  assert.ok(PISTES_COMMUNES.some(p => p.cid === CHANSON_RUSSE && p.title === 'Chanson festive Russe'))
  assert.deepEqual(Object.keys(JINGLES_GARANTIS), ['pirate-radio'])
  assert.equal(JINGLES_GARANTIS['pirate-radio'].length, 3)
})

test('🎵 TOUTES les stations, avec une fiche qui remplace `tracks` (ancienne ou récente), reçoivent les 24 musiques', () => {
  for (const seed of SEED_STATIONS) {
    for (const quand of [FICHE_COMPLETE_DEPUIS_DEFAUT - 60, FICHE_COMPLETE_DEPUIS_DEFAUT + 60]) {
      const r = restreindreFicheAncienne(lireReglages(JSON.stringify({ tracks: [{ title: 'Autre', cid: CID_A }] })), quand, FICHE_COMPLETE_DEPUIS_DEFAUT)
      const s = avecSaMusique(appliquerReglages(seed, r), [{ title: 'Chanson festive Russe', cid: CHANSON_RUSSE }])
      assert.deepEqual(s.tracks?.map(t => t.cid), [CID_A, ...PISTES_COMMUNES.map(p => p.cid)], seed.id)
    }
  }
})

test('🎵 une station retire une musique commune seulement par `musique.exclure`', () => {
  const s = avecSaMusique({ ...pirate, tracks: [], musique: { exclure: [CHANSON_RUSSE] } }, [])
  assert.equal(s.tracks?.length, 23)
  assert.ok(!s.tracks?.some(t => t.cid === CHANSON_RUSSE))
})

test('🎺 Radio Pirate : ses 3 jingles, au départ ET quand une fiche remplace `jingles` ; les autres stations n’en reçoivent pas', () => {
  const garantis = JINGLES_GARANTIS['pirate-radio'].map(j => j.cid)
  assert.deepEqual(pirate.jingles?.map(j => j.cid), garantis, 'dans la station de départ')
  assert.deepEqual(avecSaMusique(pirate, []).jingles?.map(j => j.cid), garantis)
  const fiche = appliquerReglages(pirate, lireReglages(JSON.stringify({ jingles: [{ title: 'Ancien', cid: CID_B }] })))
  assert.deepEqual(fiche.jingles?.map(j => j.cid), [CID_B], 'la fiche remplace bien `jingles`…')
  assert.deepEqual(avecSaMusique(fiche, []).jingles?.map(j => j.cid), [CID_B, ...garantis], '…mais les jingles garantis reviennent')
  const wtf = SEED_STATIONS.find(s => s.id === 'wtf-radio')!
  assert.equal(avecSaMusique(wtf, []).jingles, wtf.jingles)
})
