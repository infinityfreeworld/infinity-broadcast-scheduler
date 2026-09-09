/**
 * @module InfinityScheduler/Lib/Retention/Tests
 * @description 🔴 Ce garde protège des actifs IRRÉCUPÉRABLES.
 *
 *   Le dépôt contient trois familles dans le même sac : les émissions
 *   (datées, remplaçables, à purger à 10 jours), les 29 voix de référence
 *   et les 9 modèles Piper. Les deux dernières sont PERMANENTES — les
 *   perdre, c'est perdre les voix de l'antenne, et les originaux ne se
 *   retrouvent pas.
 *
 *   Une purge par âge seul les emporterait toutes au bout de dix jours.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { trier, estUneEmission, type FichierDepot } from '../retention'

const JOUR = 86_400_000
const MAINTENANT = Date.parse('2026-09-07T12:00:00Z')

function f(name: string, joursDAge: number): FichierDepot {
  return { cid: 'Qm' + name, name, size: 1, created_at: new Date(MAINTENANT - joursDAge * JOUR).toISOString() }
}

test('une émission de plus de 10 jours part', () => {
  const v = trier([f('broadcast-tech-radio-2026-08-20.opus', 18)], 10, MAINTENANT)
  assert.equal(v.aSupprimer.length, 1)
})

test('une émission de moins de 10 jours reste', () => {
  const v = trier([f('broadcast-tech-radio-2026-09-05.opus', 2)], 10, MAINTENANT)
  assert.deepEqual(v.aSupprimer, [])
  assert.equal(v.gardes.length, 1)
})

test('🔴 les VOIX DE RÉFÉRENCE ne partent JAMAIS, même vieilles d\'un an', () => {
  const voix = ['ranouna.wav', 'godefroi-de-mont-delire.wav', 'alain-morale.wav'].map(n => f(n, 365))
  const v = trier(voix, 10, MAINTENANT)
  assert.deepEqual(v.aSupprimer, [], 'aucune voix ne doit être supprimable')
  assert.equal(v.gardes.length, 3)
})

test('🔴 les MODÈLES PIPER ne partent JAMAIS', () => {
  const modeles = ['fr_FR-siwis-medium.onnx', 'ru_RU-dmitri-medium.onnx.json'].map(n => f(n, 999))
  assert.deepEqual(trier(modeles, 10, MAINTENANT).aSupprimer, [])
})

test('un fichier INCONNU est gardé, jamais supprimé par défaut', () => {
  // Le coût d'un fichier de trop est quelques mégaoctets ; celui d'un
  // fichier de moins est une voix perdue pour toujours.
  assert.deepEqual(trier([f('quelque-chose-dinattendu.bin', 500)], 10, MAINTENANT).aSupprimer, [])
})

test('un horodatage illisible rend INDÉCIDABLE, pas supprimable', () => {
  // `NaN > 10` est faux — on serait sauvé par hasard. On ne confie pas le
  // sort d'un fichier à une comparaison flottante : on le DIT.
  const casse: FichierDepot = { cid: 'Qmx', name: 'broadcast-a-2026-01-01.opus', size: 1, created_at: 'pas une date' }
  const v = trier([casse], 10, MAINTENANT)
  assert.deepEqual(v.aSupprimer, [])
  assert.equal(v.indecidables.length, 1)
})

test('le motif ne reconnaît QUE la forme exacte des émissions', () => {
  assert.ok(estUneEmission('broadcast-deglingos-radio-2026-09-07.opus'))
  // TÉMOIN NÉGATIF : sans lui, un motif trop large passerait les tests
  // ci-dessus tout en emportant des voix dont le nom commence pareil.
  assert.ok(!estUneEmission('broadcast.wav'))
  assert.ok(!estUneEmission('broadcast-sans-date.opus'))
  assert.ok(!estUneEmission('mon-broadcast-tech-2026-09-07.opus'))
  assert.ok(!estUneEmission('ranouna.wav'))
})
