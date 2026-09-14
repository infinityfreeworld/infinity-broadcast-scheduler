/**
 * @module InfinityScheduler/Lib/EnVolTests
 * @description 🚀 k tours en vol chez data-space : jamais plus de k, l'ordre des tours gardé,
 *   et aucune erreur perdue ni « rejet non géré ».
 *
 *   Lancer :  npx tsx --test src/lib/__tests__/en-vol.test.ts
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileEnVol } from '../en-vol'

/** Tâches qu'on résout à la main, pour observer ce qui est en vol à chaque instant. */
function banc(total: number) {
  const ouvertes = new Map<number, { ok: (v: string) => void; ko: (e: Error) => void }>()
  let maxSimultanees = 0
  const lancees: number[] = []
  const lancer = (i: number) => new Promise<string>((ok, ko) => {
    lancees.push(i); ouvertes.set(i, { ok, ko })
    maxSimultanees = Math.max(maxSimultanees, ouvertes.size)
  }).finally(() => ouvertes.delete(i))
  return { lancer, ouvertes, lancees, max: () => maxSimultanees, total }
}

test('⭐ jamais plus de k en vol, et chaque tour rend SON résultat, dans l’ordre', async () => {
  const b = banc(8)
  const f = fileEnVol(b.total, 3, () => true, b.lancer)
  const lus: string[] = []
  for (let i = 0; i < b.total; i++) {
    f.remplir(i)
    assert.ok(f.enVol() <= 3, `au tour ${i}, ${f.enVol()} en vol`)
    // On termine les tâches dans le DÉSORDRE : la dernière lancée d'abord.
    for (const j of [...b.ouvertes.keys()].sort((x, y) => y - x)) b.ouvertes.get(j)!.ok(`tour-${j}`)
    lus.push(await f.prendre(i))
  }
  assert.deepEqual(lus, Array.from({ length: b.total }, (_, i) => `tour-${i}`))
  assert.equal(b.max(), 3)
})

test('les tours sans voix de personnage ne partent pas, et ne comptent pas', () => {
  const b = banc(6)
  const f = fileEnVol(b.total, 2, i => i % 2 === 0, b.lancer)
  f.remplir(0)
  assert.deepEqual(b.lancees, [0, 2])
})

test('⭐ une erreur survenue AVANT son tour n’est ni perdue ni « non gérée »', async () => {
  let nonGere = false
  const surveille = () => { nonGere = true }
  process.on('unhandledRejection', surveille)
  try {
    const f = fileEnVol(3, 3, () => true, async i => { if (i === 2) throw new Error('file saturée'); return i })
    f.remplir(0)
    await new Promise(r => setTimeout(r, 20))   // le tour 2 échoue pendant qu'on attend le 0
    assert.equal(await f.prendre(0), 0)
    assert.equal(await f.prendre(1), 1)
    await assert.rejects(f.prendre(2), /file saturée/)
    await new Promise(r => setTimeout(r, 20))
    assert.equal(nonGere, false)
  } finally {
    process.off('unhandledRejection', surveille)
  }
})

test('k = 1 retrouve l’ancien comportement : un tour à la fois', () => {
  const b = banc(4)
  const f = fileEnVol(b.total, 1, () => true, b.lancer)
  f.remplir(0)
  assert.deepEqual(b.lancees, [0])
})

test('le générateur passe bien par la file en vol, k = 3 par défaut', () => {
  const src = readFileSync(new URL('../../scripts/generate-broadcast.ts', import.meta.url), 'utf8')
  assert.match(src, /fileEnVol\(/)
  assert.match(src, /CHATTERBOX_EN_VOL \?\? '3'/)
  assert.match(src, /await file\.prendre\(i\)/)
  assert.doesNotMatch(src.slice(src.indexOf('PHASE 2'), src.indexOf('// Concat + encode')), /await synthesizeWithChatterbox\(/,
    'plus d’appel synthétiseur un par un dans la boucle')
})
