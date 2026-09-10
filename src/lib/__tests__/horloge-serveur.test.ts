/**
 * Nuit du 10/09/2026 : svoboda-fm n'a pas été déposée. La lecture de l'heure
 * de data-space a échoué UNE fois ; le repli sur l'horloge locale — en retard
 * de ~127 s, hors de la fenêtre NIP-98 de ± 60 s — rendait un 401 certain.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { horlogeServeur } from '../dataspace-jeton'

const DATE = 'Thu, 10 Sep 2026 23:18:42 GMT'
const sansAttente = async () => {}

async function avecFetch<T>(faux: typeof fetch, f: () => Promise<T>): Promise<T> {
  const vrai = globalThis.fetch
  globalThis.fetch = faux
  try { return await f() } finally { globalThis.fetch = vrai }
}

test('🔴 deux ratés réseau puis une réponse : on a l’heure du SERVEUR', async () => {
  let appels = 0
  const r = await avecFetch((async () => {
    appels++
    if (appels < 3) throw new TypeError('fetch failed')
    return new Response(null, { headers: { date: DATE } })
  }) as typeof fetch, () => horlogeServeur(3, sansAttente))
  assert.equal(r.source, 'serveur')
  assert.equal(r.t, Date.parse(DATE) / 1000)
  assert.equal(appels, 3)
})

test('un 429 porte aussi une heure : pas besoin de recommencer', async () => {
  let appels = 0
  const r = await avecFetch((async () => {
    appels++
    return new Response('Trop de requêtes.', { status: 429, headers: { date: DATE } })
  }) as typeof fetch, () => horlogeServeur(3, sansAttente))
  assert.equal(r.source, 'serveur')
  assert.equal(appels, 1)
})

test('panne durable : repli local, après exactement N essais', async () => {
  let appels = 0
  const r = await avecFetch((async () => { appels++; throw new TypeError('fetch failed') }) as typeof fetch,
    () => horlogeServeur(3, sansAttente))
  assert.equal(r.source, 'locale')
  assert.equal(appels, 3)
})

test('la dérivation du jeton passe par l’horloge réessayée', () => {
  const src = readFileSync(resolve(process.cwd(), 'src/lib/dataspace-jeton.ts'), 'utf8')
  const m = /export async function horlogeServeur\(\s*essais = (\d+)/.exec(src)
  assert.ok(m, 'horlogeServeur doit accepter un nombre d’essais')
  assert.ok(Number(m![1]) >= 2, `${m![1]} essai : un seul raté coûte encore une station`)
  assert.match(src, /await horlogeServeur\(\)/, 'deriverJeton doit appeler horlogeServeur avec ses essais par défaut')
})
