/**
 * @module InfinityScheduler/Lib/EcheanceClone/Tests
 * @description 🔴 Une émission est restée bloquée 8 h 25 sur son PREMIER tour.
 *
 *   Deux budgets existaient pourtant. Celui du réveil (720 s) a
 *   correctement abandonné. Celui de la file (1800 s) n'a jamais parlé —
 *   pas une ligne « file pleine » dans le journal. L'appel était figé DANS
 *   un `fetch`, malgré son `AbortSignal` de 300 s, et nous n'avons pas
 *   établi pourquoi.
 *
 *   Un garde qui dépend de la bonne volonté du réseau n'est pas un garde.
 *   Celui-ci ne dépend que de l'horloge.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { ouvrirEcheanceClone, echeanceClonePassee, synthesizeWithChatterbox } from '../chatterbox'

const SRC = new URL('../chatterbox.ts', import.meta.url)

test("sans échéance ouverte, rien n'est bloqué", () => {
  // TÉMOIN : un mur qui refuserait TOUJOURS passerait les tests suivants
  // sans rien garder d'utile.
  assert.equal(echeanceClonePassee(), false)
})

test("une échéance ouverte dans le futur ne bloque pas", () => {
  ouvrirEcheanceClone(60)
  assert.equal(echeanceClonePassee(), false)
})

test('🔴 une échéance dépassée BLOQUE, sans attendre le réseau', async () => {
  ouvrirEcheanceClone(-1)
  assert.equal(echeanceClonePassee(), true)
  // Et le refus est IMMÉDIAT : pas de fetch, donc pas de blocage possible.
  const t0 = Date.now()
  await assert.rejects(
    () => synthesizeWithChatterbox({ voice: 'x.wav', text: 'test' }),
    /échéance de synthèse clonée dépassée/,
  )
  assert.ok(Date.now() - t0 < 500, 'le refus doit être immédiat, pas après un appel réseau')
  ouvrirEcheanceClone(3600)   // on referme pour ne pas polluer les autres tests
})

test("le mur est consulté AVANT toute logique de reprise", () => {
  // S'il était consulté après, un fetch figé le contournerait — ce qui est
  // exactement le défaut qu'il répare.
  const src = readFileSync(SRC, 'utf8')
  const corps = /export async function synthesizeWithChatterbox[\s\S]{0,400}/.exec(src)?.[0] ?? ''
  assert.match(corps, /echeanceClonePassee\(\)/)
})
