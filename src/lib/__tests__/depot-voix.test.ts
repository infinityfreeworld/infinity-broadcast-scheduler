/**
 * @module InfinityScheduler/Voix/DepotTests
 * @description 📇 Les voix inventées des animateurs (fondateur, 14/09/2026) entrent au catalogue data-space
 *   par un workflow GitHub, avec la clé du générateur en secret : ni le Mac allumé, ni une clé qui périme.
 *
 *   Lancer :  npx tsx --test src/lib/__tests__/depot-voix.test.ts
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const lire = (chemin: string) => readFileSync(new URL(chemin, import.meta.url), 'utf8')
const ENVOYER = lire('../../scripts/envoyer-voix.ts')
const DECLARER = lire('../../scripts/declarer-voix.ts')
const WF = lire('../../../.github/workflows/deposer-voix.yml')

test('⭐ envoi et déclaration acceptent la clé NOSTR du générateur (jeton dérivé, ne périme pas)', () => {
  for (const [nom, src] of [['envoyer-voix', ENVOYER], ['declarer-voix', DECLARER]]) {
    assert.match(src, /await jetonDataspace\(\)/, nom)
    assert.doesNotMatch(src, /process\.env\.DATASPACE_API_KEY \?\? ''/, `${nom} : plus de lecture de la seule clé d'API`)
  }
})

test('⭐ l’envoi écrit la correspondance que la déclaration relit', () => {
  assert.match(ENVOYER, /writeFileSync\(sortieJson, JSON\.stringify\(Object\.fromEntries\(cids\)/)
  assert.match(WF, /envoyer-voix\.ts voix --executer --json cids\.json/)
  assert.match(WF, /declarer-voix\.ts cids\.json --executer/)
  assert.ok(WF.indexOf('envoyer-voix.ts') < WF.indexOf('declarer-voix.ts'), 'envoyer AVANT de déclarer')
})

test('⭐ le dépôt ne part QUE sur demande, avec le secret du générateur', () => {
  assert.match(WF, /workflow_dispatch:/)
  assert.doesNotMatch(WF, /^\s*(schedule|push|pull_request):/m)
  assert.match(WF, /DATASPACE_NOSTR_KEY: \$\{\{ secrets\.DATASPACE_NOSTR_KEY \}\}/)
})

test('les voix viennent d’un BROUILLON de release (dépôt public), et l’entrée ne passe pas par le shell', () => {
  assert.match(WF, /Accept: application\/octet-stream/)
  assert.match(WF, /VERSION:\s+\$\{\{ github\.event\.inputs\.version \}\}/)
  assert.doesNotMatch(WF.slice(WF.indexOf('run: |')), /\$\{\{ github\.event\.inputs/, 'aucune entrée interpolée dans un script')
})
