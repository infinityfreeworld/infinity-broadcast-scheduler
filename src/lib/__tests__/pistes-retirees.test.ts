/**
 * Décision de Med du 07/10/2026 : les 10 « Default Track » (mai 2026, sans aucune mention de
 * droits) sont RETIRÉES de l'antenne. Les stations de départ n'ont plus de musique, et une
 * ancienne fiche 30091 qui les cite encore (9 fiches d'admins sur 10 le 07/10) ne les remet pas
 * dans une émission. Sans musique diffusable, l'émission reste VALIDE : ni pause musicale, ni
 * lit, ni consigne « lancer le morceau » donnée aux animateurs.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { PISTES_RETIREES, estPisteRetiree } from '../selection-musique'
import { avecSaMusique } from '../bibliotheque-musique'
import { appliquerReglages, lireReglages } from '../station-reglages'
import { choisirPistes, planifierPauses, reglagesMusique } from '../musique'
import { SEED_STATIONS } from '../../data/seed-stations'

const ICI = dirname(fileURLToPath(import.meta.url))
const CHANSON_RUSSE = 'QmU7Htd4J9EQttvs2s2wWm6TyiV3wPY7nxYLLRYvX7j4tE'
const anciennes = PISTES_RETIREES.map((cid, i) => ({ title: `Default Track ${String(i + 1).padStart(2, '0')}`, cid }))

test('🚫 les 10 pistes retirées ; la chanson russe n’en fait pas partie', () => {
  assert.equal(PISTES_RETIREES.length, 10)
  assert.equal(new Set(PISTES_RETIREES).size, 10)
  assert.equal(estPisteRetiree({ cid: CHANSON_RUSSE }), false)
  assert.equal(estPisteRetiree({ url: `https://data-space.world/api/ipfs/${PISTES_RETIREES[2]}` }), true)
})

test('🚫 aucune station de départ ne porte de musique', () => {
  for (const s of SEED_STATIONS) assert.deepEqual(s.tracks ?? [], [], s.id)
})

test('🚫 une ancienne fiche d’admin qui ne cite que les pistes retirées : aucune musique dans l’émission', () => {
  const pirate = SEED_STATIONS.find(s => s.id === 'pirate-radio')!
  // La fiche telle qu'elle est sur les relais (tracks = les 10 anciennes pistes, pauses demandées).
  const fiche = appliquerReglages(pirate, lireReglages(JSON.stringify({ tracks: anciennes, pauses: 2 })))
  assert.equal(fiche.tracks?.length, 10, 'la fiche est bien lue telle quelle…')
  const s = avecSaMusique(fiche, [{ title: 'Chanson festive Russe', cid: CHANSON_RUSSE }])
  assert.deepEqual(s.tracks, [], '…mais la règle n’en garde aucune (et la chanson russe, sans droits, non plus)')

  // L'émission reste valide : musique inactive, aucune pause, aucun lit, aucune consigne de pause.
  const r = reglagesMusique(s, {})
  assert.equal(r.actif, false)
  assert.deepEqual(planifierPauses(s, '2026-10-08', 22, r), [])
  assert.deepEqual(choisirPistes(s.tracks ?? [], 1, `${s.id}:2026-10-08:lit`), [])
})

test('🚫 la nuit : la musique de la station passe par la règle AVANT toute décision (pauses, lit, épinglage)', () => {
  const sansCommentaires = (f: string) => readFileSync(resolve(ICI, f), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
  const gb = sansCommentaires('../../scripts/generate-broadcast.ts')
  assert.match(gb, /const station = await stationAvecSaMusique\(stationFiche\)/)
  assert.match(gb, /if \(r\.actif && habillageActif\('HABILLAGE_LIT'\)\)/, 'le lit ne tourne que si la musique est active')
  const ep = sansCommentaires('../../scripts/epingler-pistes.ts')
  assert.match(ep, /const station = await stationAvecSaMusique\(await stationSelonIHL\(seed\)\)/)
})
