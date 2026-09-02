/**
 * @module InfinityScheduler/Lib/ChatterboxFormatMontage/Tests
 * @description Garde le couple « format demandé ↔ décodeur du montage ».
 *
 *   data-space a proposé le 02/09/2026 de passer la synthèse en Opus pour
 *   alléger le transfert. Le flag existe et le changement tient en un mot —
 *   mais le montage décode chaque tour avec `readWav`, qui exige du RIFF.
 *
 *   🔴 Ce qui rend le piège grave n'est pas qu'il casse : c'est qu'il ne
 *   casse PAS bruyamment. Le décodage vivait dans le même `try` que
 *   l'appel réseau, dont le `catch` replie sur Piper. La bascule aurait
 *   produit 22 lignes « repli piper » — la trace exacte d'une soirée
 *   normale où Chatterbox dort — et zéro voix de personnage, sans qu'une
 *   seule ligne ne dise pourquoi.
 *
 *   Lancer :  npx tsx --test src/lib/__tests__/chatterbox-format-montage.test.ts
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { writeFileSync, mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { readWav } from '../audio'

const dossier = mkdtempSync(join(tmpdir(), 'fmt-montage-'))

/** En-tête OggS/OpusHead — ce que rendrait `response_format: "opus"`. */
function bufferOpus(): Buffer {
  const b = Buffer.alloc(64)
  b.write('OggS', 0, 'ascii')
  b.write('OpusHead', 28, 'ascii')
  return b
}

/** WAV 24 kHz mono 16 bits — la sortie réelle de Chatterbox. */
function bufferWavMinimal(): Buffer {
  const données = 32
  const b = Buffer.alloc(44 + données)
  b.write('RIFF', 0, 'ascii'); b.writeUInt32LE(36 + données, 4); b.write('WAVE', 8, 'ascii')
  b.write('fmt ', 12, 'ascii'); b.writeUInt32LE(16, 16)
  b.writeUInt16LE(1, 20); b.writeUInt16LE(1, 22)
  b.writeUInt32LE(24_000, 24); b.writeUInt32LE(48_000, 28)
  b.writeUInt16LE(2, 32); b.writeUInt16LE(16, 34)
  b.write('data', 36, 'ascii'); b.writeUInt32LE(données, 40)
  return b
}

const SRC_GENERATE = new URL('../../scripts/generate-broadcast.ts', import.meta.url)
const SRC_CHATTERBOX = new URL('../chatterbox.ts', import.meta.url)

test('TÉMOIN POSITIF : un WAV 24 kHz, la sortie Chatterbox, se décode', () => {
  // Sans ce témoin, le refus d'Opus ci-dessous ne prouverait rien : un
  // `readWav` cassé refuserait TOUT, et se ferait passer pour un garde.
  const p = join(dossier, 'bon.wav')
  writeFileSync(p, bufferWavMinimal())
  assert.equal(readWav(p).sampleRate, 24_000)
})

test('un buffer Opus est REFUSÉ par le montage — donc le montage ne peut pas être en Opus', () => {
  const p = join(dossier, 'opus.wav')
  writeFileSync(p, bufferOpus())
  assert.throws(() => readWav(p), /Pas un WAV valide/)
})

test("🔴 l'erreur de décodage porte la sentinelle sur laquelle le repli Piper s'abstient", () => {
  // Les deux moitiés du garde vivent dans le même fichier mais à 15 lignes
  // d'écart : le message levé, et le `msg.includes(...)` qui décide de NE
  // PAS replier. Si l'un est réécrit sans l'autre, le repli silencieux
  // revient sans qu'aucun autre test ne tombe.
  const src = readFileSync(SRC_GENERATE, 'utf8')
  assert.ok(
    src.includes("n'est pas du WAV décodable"),
    "l'erreur de décodage doit porter la sentinelle",
  )
  assert.ok(
    src.includes("msg.includes('pas du WAV décodable')"),
    'le catch doit refuser de replier sur cette sentinelle',
  )
})

test('le défaut de response_format reste WAV', () => {
  const src = readFileSync(SRC_CHATTERBOX, 'utf8')
  assert.match(src, /response_format:\s+opts\.format \?\? 'wav'/)
})

test("la sonde de réveil, elle, demande de l'Opus : son audio est jeté", () => {
  const src = readFileSync(SRC_CHATTERBOX, 'utf8')
  assert.match(src, /text: 'Bonjour\.', format: 'opus'/)
})
