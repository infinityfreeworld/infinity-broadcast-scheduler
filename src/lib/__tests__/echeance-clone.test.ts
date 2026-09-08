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
import { ouvrirEcheanceClone, echeanceClonePassee, synthesizeWithChatterbox, avecEcheance } from '../chatterbox'

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

test("🔴 LE TEST QUI COMPTE : une promesse qui ne finit JAMAIS est interrompue", async () => {
  // La première version du mur vérifiait l'échéance AVANT l'appel. Elle
  // empêchait d'en démarrer un nouveau, mais pas de rester bloqué dedans :
  // une répétition est restée figée NEUF HEURES dans un appel commencé
  // avant l'expiration. Le mur n'a pas dit un mot — on ne le lui a jamais
  // redemandé.
  //
  // Une vérification n'est pas une garantie. Seule une course en est une.
  const jamais = new Promise<string>(() => { /* ne se résout ni ne rejette */ })
  const t0 = Date.now()
  await assert.rejects(
    () => avecEcheance(jamais, 300, 'appel figé'),
    /abandonné après/,
  )
  const ecoule = Date.now() - t0
  assert.ok(ecoule >= 250 && ecoule < 3000, `interrompu en ${ecoule} ms, attendu ~300`)
})

test('une promesse qui aboutit AVANT l\'échéance passe intacte', async () => {
  // TÉMOIN POSITIF : une course qui rejetterait toujours passerait le test
  // ci-dessus sans rien garder d'utile.
  const r = await avecEcheance(Promise.resolve('fini'), 5000, 'rapide')
  assert.equal(r, 'fini')
})

test("le minuteur est TOUJOURS nettoyé — sinon le processus ne rend jamais la main", async () => {
  // Un setTimeout non annulé garde la boucle d'événements vivante : le
  // script se terminerait… quand le minuteur expire. Sur 22 tours et un
  // mur de 20 minutes, c'est une nuit qui ne se termine pas.
  const src = readFileSync(SRC, 'utf8')
  const bloc = /export async function avecEcheance[\s\S]*?\n}/.exec(src)?.[0] ?? ''
  assert.ok(bloc.includes('finally'), 'le nettoyage doit être dans un finally')
  assert.ok(bloc.includes('clearTimeout'), 'le minuteur doit être annulé')
})

test("🔴 la course est BRANCHÉE dans la synthèse — pas seulement disponible", () => {
  // Le défaut d'origine n'était pas qu'un mécanisme manquait : c'est qu'il
  // n'était pas APPLIQUÉ à l'appel qui se bloquait. Un test qui éprouve
  // `avecEcheance` isolément passe même si la synthèse ne s'en sert pas —
  // vérifié par mutation, il ne mordait pas.
  const src = readFileSync(SRC, 'utf8')
  const corps = /export async function synthesizeWithChatterbox[\s\S]*?\n}/.exec(src)?.[0] ?? ''
  assert.ok(corps.length > 0, 'synthesizeWithChatterbox introuvable')
  assert.match(corps, /return avecEcheance\(/, "l'appel doit COURIR contre l'horloge")
  assert.ok(
    !/return synthetiserSansMur\(opts\)\s*\n?}/.test(corps),
    'la synthèse ne doit jamais être appelée sans course',
  )
})
