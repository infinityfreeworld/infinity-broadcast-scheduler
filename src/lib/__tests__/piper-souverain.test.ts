/**
 * @module InfinityScheduler/Lib/PiperSouverain/Tests
 * @description 🔴 Nous avions annoncé « sans Hugging Face » alors que 93 %
 *   des tours en dépendaient encore.
 *
 *   Le raisonnement était : Chatterbox a quitté Hugging Face, donc nous
 *   aussi. Mais Piper — 308 tours sur 330 chaque nuit — y téléchargeait
 *   toujours ses modèles. Nous avions libéré les 7 % visibles et laissé
 *   les 93 % qui ne se voyaient pas.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import CIDS from '../../data/piper-cids.json'

const SRC = new URL('../piper.ts', import.meta.url)

test('le manifeste couvre les neuf modèles, avec des CID DISTINCTS', () => {
  const e = Object.entries(CIDS as Record<string, { onnx: string; json: string }>)
  assert.equal(e.length, 9)
  // 🔴 Deux modèles partageant un CID signalerait un dépôt qui a menti —
  // c'est arrivé, et c'est ce qui a motivé la relecture systématique.
  const onnx = new Set(e.map(([, v]) => v.onnx))
  assert.equal(onnx.size, 9, 'chaque modèle doit avoir son propre CID')
  const json = new Set(e.map(([, v]) => v.json))
  assert.equal(json.size, 9)
  for (const [nom, v] of e) {
    assert.match(v.onnx, /^Qm[1-9A-HJ-NP-Za-km-z]{44}$/, `CID malformé pour ${nom}`)
    assert.notEqual(v.onnx, v.json, `${nom} : le modèle et sa config ne peuvent partager un CID`)
  }
})

test('data-space est essayé AVANT Hugging Face', () => {
  const src = readFileSync(SRC, 'utf8')
  // ⚠️ Vérifier la seule ligne d'appel ne suffisait pas : neutraliser
  // `source` la laissait intacte et le test passait quand même. On exige
  // donc que la SOURCE soit réellement consultée, et que la branche
  // souveraine en dépende.
  assert.match(src, /const source = cidsDeLaVoix\(voiceId\)/)
  assert.match(src, /telechargerAvecRepli\(urlDataspace\(source\.onnx\)/)
  assert.match(src, /source\n?\s*\?/, 'la branche doit dépendre de `source`')
})

test('🔴 un repli sur Hugging Face est ANNONCÉ, jamais silencieux', () => {
  // Un repli muet ferait croire à une indépendance qu'on n'a plus — c'est
  // exactement l'erreur qu'on répare ici.
  const src = readFileSync(SRC, 'utf8')
  const bloc = /async function telechargerAvecRepli[\s\S]*?\n}/.exec(src)?.[0] ?? ''
  assert.ok(bloc.length > 0, 'telechargerAvecRepli introuvable')
  assert.match(bloc, /repli sur Hugging Face/)
  assert.ok(bloc.includes('console.warn'), 'le repli doit être écrit dans le journal')
})

test("🔴 aucune SONDE de processus pour choisir le moteur", () => {
  // Le 08/09/2026, `piper --help` a bloqué deux répétitions NEUF HEURES.
  // Le binaire est x86_64 sous Rosetta ; sur ce Mac il ne rend jamais la
  // main, le processus reste en état `UE` (ininterruptible), et le
  // `timeout` d'`execFile` ne peut pas le tuer — le rappel n'est jamais
  // appelé. Nous avons accusé le débit de notre partenaire pendant ce
  // temps.
  //
  // Un garde qui dépend de la coopération de ce qu'il surveille n'est pas
  // un garde. Le choix du moteur se fait sur des FICHIERS, pas sur un
  // processus qu'il faudrait lancer pour l'interroger.
  // ⚠️ On dépouille les COMMENTAIRES : ce test doit interdire un USAGE,
  // pas une explication. Sans ça il interdirait de documenter le défaut
  // qu'il empêche — et il a d'abord échoué pour cette raison exacte.
  const codeSeul = (t: string) =>
    t.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
  const src = codeSeul(readFileSync(SRC, 'utf8'))
  const bloc = /async function resoudreMoteur[\s\S]*?\n}/.exec(src)?.[0] ?? ''
  assert.ok(bloc.length > 0, 'resoudreMoteur introuvable')
  assert.ok(!bloc.includes("'--help'"), 'aucune sonde --help ne doit subsister')
  assert.ok(!bloc.includes('execFile'), 'aucun processus ne doit être lancé pour décider')
  assert.match(bloc, /existsSync\(pont\)/, 'la décision se prend sur des fichiers')
})
