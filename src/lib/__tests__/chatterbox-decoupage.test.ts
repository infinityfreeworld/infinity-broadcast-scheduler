/**
 * @module InfinityScheduler/Lib/Chatterbox/DecoupageTests
 * @description ✂️ Rester sous le plafond du modèle SANS toucher au texte.
 *
 *   data-space, 10/09/2026 : un texte trop long est coupé par le modèle, l'audio sort « trop
 *   court pour son texte », et leur serveur le refuse (422) à chaque essai. Consigne : moins de
 *   ~400 caractères par requête. Nous découpons à 350.
 *
 *   Le piège que ces contrôles gardent : un découpage qui MODIFIE le texte. Recoller « 1. » et
 *   « 5 km » avec une espace ferait lire « un, cinq kilomètres » — une faute que personne ne
 *   verrait dans un journal, et que tout le monde entendrait.
 *
 *   Lancer :  npx tsx --test src/lib/__tests__/chatterbox-decoupage.test.ts
 */
import { test, mock, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import { decouperTexte, synthesizeWithChatterbox, ChatterboxError } from '../chatterbox'
import { encodeWav, decodeWav, durationOf } from '../audio'

process.env.CHATTERBOX_TTS_URL = 'https://station.exemple.test'
afterEach(() => mock.restoreAll())

const phrase = (n: number, lettre: string) => `${lettre.repeat(6)} `.repeat(Math.floor(n / 7)).trim() + '.'
const LONG = [phrase(120, 'a'), phrase(130, 'b'), phrase(110, 'c'), phrase(140, 'd'), phrase(100, 'e')].join(' ')

test('un texte court part tel quel, d’un bloc', () => {
  assert.deepEqual(decouperTexte('Bonjour à toutes et à tous.', 350), ['Bonjour à toutes et à tous.'])
})

test('⭐ aucun morceau ne dépasse la limite', () => {
  for (const m of decouperTexte(LONG, 350)) assert.ok(m.length <= 350, `${m.length} > 350`)
})

test('⭐ le texte n’est pas modifié : recollé, il redonne l’original', () => {
  assert.equal(decouperTexte(LONG, 350).join(' '), LONG)
})

test('⭐ on coupe à une fin de phrase quand il y en a une', () => {
  for (const m of decouperTexte(LONG, 350)) assert.match(m, /\.$/, `morceau non terminé par une phrase : « …${m.slice(-20)} »`)
})

test('⭐ « 1.5 km » n’est jamais tranché', () => {
  const t = `${'x'.repeat(330)} il reste 1.5 km avant le col. ${'y'.repeat(100)}.`
  const m = decouperTexte(t, 350)
  assert.ok(!m.some(b => b.endsWith('1.')), `coupé dans le nombre : ${m.map(b => b.slice(-12)).join(' | ')}`)
  assert.equal(m.join(' '), t)
})

test('une phrase trop longue sans point se coupe à une espace, jamais dans un mot', () => {
  const mots = Array.from({ length: 120 }, (_, i) => `mot${i}`)
  const t = mots.join(' ')
  const m = decouperTexte(t, 120)
  for (const b of m) {
    assert.ok(b.length <= 120)
    for (const w of b.split(' ')) assert.ok(mots.includes(w), `mot tranché : « ${w} »`)
  }
  assert.equal(m.join(' '), t)
})

test('« Bonjour ! » dit-il : la réplique courte reste d’un seul tenant', () => {
  assert.equal(decouperTexte('« Bonjour ! » dit-il en souriant.', 350).length, 1)
})

test('la limite se règle, et une valeur absurde retombe sur 350', () => {
  process.env.CHATTERBOX_MAX_CARACTERES = '200'
  assert.ok(decouperTexte(LONG).every(m => m.length <= 200))
  process.env.CHATTERBOX_MAX_CARACTERES = '5'
  assert.ok(decouperTexte(LONG).every(m => m.length <= 350))
  delete process.env.CHATTERBOX_MAX_CARACTERES
})

// ── la synthèse découpée, contre un serveur simulé ─────────────────────────────
const wavDe = (secondes: number) =>
  encodeWav({ samples: new Float32Array(Math.round(22050 * secondes)).fill(0.1), sampleRate: 22050 })

function serveur(repondre: (input: string) => Response) {
  const recus: string[] = []
  mock.method(globalThis, 'fetch', async (_u: unknown, init?: { body?: string }) => {
    const input = String(JSON.parse(init?.body ?? '{}').input ?? '')
    recus.push(input)
    return repondre(input)
  })
  return recus
}

test('⭐ un texte long part en plusieurs requêtes, toutes sous la limite, et revient en UN WAV', async () => {
  const recus = serveur(() => new Response(wavDe(1), { status: 200 }))
  const buf = await synthesizeWithChatterbox({ text: LONG, voice: 'ranouna' })
  assert.ok(recus.length >= 2, `une seule requête pour ${LONG.length} caractères`)
  for (const r of recus) assert.ok(r.length <= 350, `requête de ${r.length} caractères`)
  assert.equal(recus.join(' '), LONG, 'le serveur doit recevoir exactement le texte, rien de plus, rien de moins')
  const wav = decodeWav(buf)
  // n morceaux d'1 s + (n-1) respirations de 0,10 s
  const attendu = recus.length + (recus.length - 1) * 0.10
  assert.ok(Math.abs(durationOf(wav) - attendu) < 0.02, `durée ${durationOf(wav)} ≠ ${attendu}`)
})

test('un texte court ne fait qu’une requête (rien ne change pour lui)', async () => {
  const recus = serveur(() => new Response(wavDe(1), { status: 200 }))
  await synthesizeWithChatterbox({ text: 'Bonjour.', voice: 'ranouna' })
  assert.equal(recus.length, 1)
})

test('l’Opus n’est pas découpé : on ne sait pas le recoller', async () => {
  const recus = serveur(() => new Response(Buffer.from('OggS'), { status: 200 }))
  await synthesizeWithChatterbox({ text: LONG, voice: 'ranouna', format: 'opus' })
  assert.equal(recus.length, 1)
})

test('⭐ un morceau qui échoue fait échouer TOUT le tour (pas de voix qui change en pleine phrase)', async () => {
  let n = 0
  serveur(() => (++n === 2
    ? new Response(JSON.stringify({ error: { code: 'synthesis_failed' } }), { status: 502 })
    : new Response(wavDe(1), { status: 200 })))
  await assert.rejects(synthesizeWithChatterbox({ text: LONG, voice: 'ranouna' }), ChatterboxError)
})

test('un morceau illisible est un défaut CHEZ NOUS, jamais avalé par le repli', async () => {
  serveur(() => new Response(Buffer.from('pas un wav'), { status: 200 }))
  await assert.rejects(
    synthesizeWithChatterbox({ text: LONG, voice: 'ranouna' }),
    (e: unknown) => !(e instanceof ChatterboxError) && /pas du WAV décodable/.test((e as Error).message),
  )
})
