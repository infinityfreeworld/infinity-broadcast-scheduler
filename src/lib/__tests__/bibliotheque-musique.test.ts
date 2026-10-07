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
  cleDePiste, pistesDeLaStation, type PisteBibliotheque, type PisteJouable, type ReglesMusiqueStation,
} from '../selection-musique'
import { KIND_RADIO_MUSIQUE, avecSaMusique, lireMusiqueBibliotheque, retenirBibliotheque } from '../bibliotheque-musique'
import { appliquerReglages, lireReglages, restreindreFicheAncienne, FICHE_COMPLETE_DEPUIS_DEFAUT } from '../station-reglages'
import { planifierPauses, reglagesMusique, telechargerPiste } from '../musique'
import { SEED_STATIONS } from '../../data/seed-stations'

interface Cas { nom: string; station: { tracks?: PisteJouable[]; musique?: ReglesMusiqueStation }; attendu: string[] }
const ICI = dirname(fileURLToPath(import.meta.url))
const CAS = JSON.parse(readFileSync(resolve(ICI, 'cas-selection-musique.json'), 'utf8')) as { bibliotheque: PisteBibliotheque[]; cas: Cas[] }

for (const c of CAS.cas) {
  test(`🎚️ cas partagé avec l'app — ${c.nom}`, () => {
    assert.deepEqual(pistesDeLaStation(c.station, CAS.bibliotheque).map(cleDePiste), c.attendu)
  })
}

const ADMIN = 'a'.repeat(64)
const INTRUS = 'b'.repeat(64)
const CID_A = 'bafybeibhjj5cyhauwnrrjntrkwncl6y3bhyetzow54jieku47f2igchw7e'
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

test('station sans règles : `tracks` inchangées (la bibliothèque n’ajoute rien)', () => {
  assert.deepEqual(avecSaMusique(pirate, BIBLIO).tracks, pirate.tracks)
})

test('🔴 DROITS OBLIGATOIRES : une musique sans droits n’entre jamais dans une émission, ni par règle ni par choix', () => {
  const s = avecSaMusique({ ...pirate, tracks: [{ title: 'Chanson festive', cid: CID_B }], musique: { etiquettes: { genres: ['électro'] } } }, BIBLIO)
  assert.deepEqual(s.tracks, [{ title: 'Aube', cid: CID_A }])
  // …et les pauses de la nuit ne tirent que dans cette liste-là.
  const r = reglagesMusique(s, {})
  const plan = planifierPauses(s, '2026-10-08', 22, r)
  assert.ok(plan.length > 0)
  for (const p of plan) assert.equal(p.track.cid, CID_A)
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
