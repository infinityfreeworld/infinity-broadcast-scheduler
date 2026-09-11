/**
 * La nuit du 09/09 a perdu 8 stations sur 13 : onnxruntime plante par
 * intermittence à la destruction du processus (`libc++abi:
 * recursive_mutex lock failed: Invalid argument`) et `synthesize`
 * n'avait AUCUNE reprise — un plantage isolé tuait la station entière.
 *
 * Ces tests prouvent la reprise ET son branchement dans `synthesize`.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { avecReprises } from '../piper'

/** Capture stderr le temps d'un appel. */
async function traces<T>(f: () => Promise<T>): Promise<{ r?: T; err?: Error; lignes: string[] }> {
  const lignes: string[] = []
  const vrai = console.error
  console.error = (...a: unknown[]) => { lignes.push(a.map(String).join(' ')) }
  try {
    return { r: await f(), lignes }
  } catch (e) {
    return { err: e as Error, lignes }
  } finally {
    console.error = vrai
  }
}

const sansAttente = async () => {}

test('un succès du premier coup n’appelle qu’une fois et ne trace rien', async () => {
  let appels = 0
  const { r, lignes } = await traces(() =>
    avecReprises('voix-x', 3, async () => { appels++; return 'ok' }, sansAttente))
  assert.equal(r, 'ok')
  assert.equal(appels, 1, 'un succès ne doit PAS être rejoué')
  assert.deepEqual(lignes, [], 'rien à signaler quand tout va bien')
})

test('deux plantages puis un succès : la synthèse aboutit', async () => {
  let appels = 0
  const { r, err, lignes } = await traces(() =>
    avecReprises('fr_FR-siwis-medium', 3, async n => {
      appels++
      if (n < 3) throw new Error('recursive_mutex lock failed: Invalid argument\nbruit')
      return '/tmp/bon.wav'
    }, sansAttente))
  assert.equal(err, undefined, 'ne doit pas lever : le 3e essai réussit')
  assert.equal(r, '/tmp/bon.wav')
  assert.equal(appels, 3)
  assert.equal(lignes.filter(l => l.includes('échoué, reprise')).length, 2)
  assert.ok(lignes.some(l => l.includes('réussi au 3e essai')), 'la reprise doit être visible dans le journal de nuit')
  assert.ok(lignes.every(l => !l.includes('bruit')), 'seule la 1re ligne de la cause est tracée')
})

test('échec permanent : lève la DERNIÈRE cause, après exactement N essais', async () => {
  let appels = 0
  const { err } = await traces(() =>
    avecReprises('en_GB-alba-medium', 3, async n => {
      appels++
      throw new Error(`panne ${n}`)
    }, sansAttente))
  assert.equal(appels, 3, 'ni plus ni moins que le budget d’essais')
  assert.ok(err, 'doit lever')
  assert.match(err!.message, /piper failed \(en_GB-alba-medium\) après 3 essais/)
  assert.match(err!.message, /panne 3/, 'la cause rendue est la DERNIÈRE, pas la première')
})

test('un budget de 1 essai se comporte comme avant la reprise', async () => {
  let appels = 0
  const { err, lignes } = await traces(() =>
    avecReprises('v', 1, async () => { appels++; throw new Error('boum') }, sansAttente))
  assert.equal(appels, 1)
  assert.deepEqual(lignes, [], 'aucune reprise annoncée quand il n’y en a pas')
  assert.match(err!.message, /après 1 essais/)
})

// ── Couplage : sans ces tests, la mécanique pourrait être parfaite et
//    `synthesize` ne jamais s’en servir (c’est exactement ce qui a coûté
//    la nuit du 09/09 : un tri GPU correct mais inerte).
const source = readFileSync(resolve(process.cwd(), 'src/lib/piper.ts'), 'utf-8')
const codeSeul = source
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .split('\n').map(l => l.replace(/\/\/.*$/, '')).join('\n')
const corpsSynthese = codeSeul.slice(codeSeul.indexOf('export async function synthesize'))

test('synthesize passe RÉELLEMENT par avecReprises', () => {
  assert.match(corpsSynthese, /return avecReprises\(voiceId, TENTATIVES_SYNTHESE,/)
})

test('le budget d’essais est supérieur à 1, sinon la reprise est inerte', () => {
  const m = /const TENTATIVES_SYNTHESE = (\d+)/.exec(codeSeul)
  assert.ok(m, 'TENTATIVES_SYNTHESE doit exister')
  assert.ok(Number(m![1]) >= 2, `un budget de ${m![1]} ne reprend rien`)
})

test('le chemin de sortie est calculé DANS la reprise, pas en dehors', () => {
  const iRep = corpsSynthese.indexOf('avecReprises')
  const iOut = corpsSynthese.indexOf('const outPath')
  assert.ok(iOut > iRep, 'un outPath partagé ferait relire le WAV tronqué du processus mort')
})

test('le WAV d’un essai raté est effacé', () => {
  assert.match(corpsSynthese, /unlinkSync\(outPath\)/)
})
