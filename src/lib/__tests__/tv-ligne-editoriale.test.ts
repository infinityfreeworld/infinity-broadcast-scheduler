/**
 * @module InfinityScheduler/TV/LigneEditoriale/Tests
 * @description 🗞️ La ligne éditoriale du fondateur (14/09/2026), rendue vérifiable :
 *   « majoritairement des actualités positives des dernières 24 h, mais peut également évoquer des
 *   sujets plus anciens » ; « mélanger les informations avec des sujets de l'écosystème, du
 *   quotidien dans le monde ; éventuellement des news plus anxiogènes mais sur un ton doux,
 *   humoristique, en évoquant des solutions, éventuellement en lien avec l'écosystème ».
 *
 *   Lancer :  npx tsx --test src/lib/__tests__/tv-ligne-editoriale.test.ts
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { choisirActualites, formatNewsForPrompt } from '../news'
import type { NewsItem } from '../types'

const MAINTENANT = Date.UTC(2026, 8, 14, 12)
const H = 3_600_000
const n = (title: string, heures: number | null, sourceTitle = 'A'): NewsItem =>
  ({ title, sourceTitle, publishedAt: heures === null ? undefined : MAINTENANT - heures * H })

test('⭐ MAJORITAIREMENT le frais : les nouvelles des dernières 24 h passent devant', () => {
  const items = [n('vieille', 60), n('fraîche 1', 2), n('fraîche 2', 20), n('très vieille', 400), n('limite', 23.9)]
  const r = choisirActualites(items, { frais: 6, anciens: 2, maintenant: MAINTENANT })
  assert.deepEqual(r.map(i => i.title), ['fraîche 1', 'fraîche 2', 'limite', 'vieille'])
})

test('quelques sujets plus anciens, bornés (≤ 7 jours, pas plus que demandé)', () => {
  const items = [n('j2', 48), n('j3', 72), n('j4', 96), n('j10', 240), n('frais', 1)]
  const r = choisirActualites(items, { frais: 6, anciens: 2, maintenant: MAINTENANT })
  assert.deepEqual(r.map(i => i.title), ['frais', 'j2', 'j3'])
})

test('une nouvelle SANS date n’est jamais présentée comme du jour', () => {
  const r = choisirActualites([n('sans date', null), n('frais', 3)], { frais: 6, anciens: 2, maintenant: MAINTENANT })
  assert.deepEqual(r.map(i => i.title), ['frais', 'sans date'])
})

test('⭐ plusieurs sources à tour de rôle : le flux le plus bavard ne remplit pas tout', () => {
  const items = [n('A1', 1, 'A'), n('A2', 2, 'A'), n('A3', 3, 'A'), n('A4', 4, 'A'), n('B1', 5, 'B'), n('C1', 6, 'C')]
  const r = choisirActualites(items, { frais: 3, anciens: 0, maintenant: MAINTENANT })
  assert.deepEqual(r.map(i => i.sourceTitle).sort(), ['A', 'B', 'C'])
})

test('les doublons (même titre repris par deux flux) sont retirés', () => {
  const r = choisirActualites([n('Même titre', 1, 'A'), n('même titre ', 2, 'B')], { maintenant: MAINTENANT })
  assert.equal(r.length, 1)
})

test('⭐ la fraîcheur est ÉCRITE pour le rédacteur (sinon il ne peut pas trier)', () => {
  const t = formatNewsForPrompt([n('frais', 5), n('ancien', 50)], { maintenant: MAINTENANT })
  assert.match(t, /\[il y a 5 h\] frais/)
  assert.match(t, /· plus ancien\] ancien/)
  // Sans `maintenant`, le format de la RADIO reste strictement le même.
  assert.doesNotMatch(formatNewsForPrompt([n('frais', 5)]), /il y a/)
})

test('⭐ la consigne du rédacteur porte la ligne éditoriale, et l’interdit sur l’humour', () => {
  const src = readFileSync(new URL('../tv-conductor.ts', import.meta.url), 'utf8')
  assert.match(src, /MAJORITAIREMENT POSITIVES/)
  assert.match(src, /DERNIÈRES 24 HEURES/)
  assert.match(src, /MÉLANGE — la vie de l'écosystème/)
  assert.match(src, /SOLUTIONS/)
  assert.match(src, /JAMAIS sur les personnes touchées/, 'l’humour ne vise jamais les victimes')
  assert.match(src, /L'ÉCOSYSTÈME A TOUJOURS SA PLACE/)
})

test('⭐ un long flux plein d’entités (Reporterre) se lit — il était MUET le 14/09/2026', async () => {
  // « Entity expansion limit exceeded: 1009 > 1000 » : chaque `&amp;` comptait, un flux ordinaire
  // dépassait la limite et la source entière disparaissait du journal, sans autre signe qu'un log.
  const { fetchNewsForStation } = await import('../news')
  const item = (i: number) => `<item><title>Titre ${i} &amp; co &#8217;</title><description>a &amp; b &amp; c &amp; d &amp; e &amp; f &amp; g &amp; h &amp; i &amp; j</description><pubDate>Mon, 14 Sep 2026 10:00:00 GMT</pubDate></item>`
  const xml = `<?xml version="1.0"?><rss><channel><title>Flux</title>${Array.from({ length: 120 }, (_, i) => item(i)).join('')}</channel></rss>`
  const avant = globalThis.fetch
  globalThis.fetch = (async () => new Response(xml, { status: 200, headers: { 'content-type': 'application/rss+xml' } })) as typeof fetch
  try {
    const r = await fetchNewsForStation({ sources: [{ type: 'rss', url: 'https://flux.exemple.test/rss', title: 'Flux' }] } as never, 10)
    assert.ok(r.length > 0, 'la source doit rendre des nouvelles')
    assert.match(r[0].title, /&/, 'les entités sont bien décodées')
  } finally {
    globalThis.fetch = avant
  }
})
