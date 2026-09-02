/**
 * @module InfinityScheduler/Lib/Tests/ChatterboxFormatMontage
 * @description Garde le couple « format demandé ↔ décodeur du montage ».
 *
 *   data-space a proposé le 02/09/2026 de passer la synthèse en Opus pour
 *   alléger le transfert. Le flag existe et le changement est d'un mot —
 *   mais le montage décode chaque tour avec `readWav`, qui exige du RIFF.
 *
 *   🔴 Ce qui rend le piège grave n'est pas qu'il casse : c'est qu'il ne
 *   casse PAS bruyamment. L'appelant enveloppait le décodage dans le même
 *   `try` que l'appel réseau, et repliait sur Piper à la moindre erreur.
 *   Un buffer Opus aurait donc produit 22 lignes « repli piper » — la
 *   trace exacte d'une soirée normale où Chatterbox dort — et zéro voix
 *   de personnage, sans qu'aucune ligne ne dise pourquoi.
 */

import { describe, it, expect } from 'vitest'
import { writeFileSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { readWav } from '../audio'

const dossier = mkdtempSync(join(tmpdir(), 'fmt-montage-'))

/** En-tête OggS — ce que rend `response_format: "opus"`. */
function bufferOpus(): Buffer {
  const b = Buffer.alloc(64)
  b.write('OggS', 0, 'ascii')
  b.write('OpusHead', 28, 'ascii')
  return b
}

function bufferWavMinimal(): Buffer {
  const données = 32
  const b = Buffer.alloc(44 + données)
  b.write('RIFF', 0, 'ascii'); b.writeUInt32LE(36 + données, 4); b.write('WAVE', 8, 'ascii')
  b.write('fmt ', 12, 'ascii'); b.writeUInt32LE(16, 16)
  b.writeUInt16LE(1, 20); b.writeUInt16LE(1, 22)
  b.writeUInt32LE(24000, 24); b.writeUInt32LE(48000, 28)
  b.writeUInt16LE(2, 32); b.writeUInt16LE(16, 34)
  b.write('data', 36, 'ascii'); b.writeUInt32LE(données, 40)
  return b
}

describe('format Chatterbox ↔ décodeur du montage', () => {
  it('TÉMOIN POSITIF : un WAV 24 kHz (sortie Chatterbox) se décode', () => {
    // Sans ce témoin, l'échec ci-dessous ne prouverait rien : un readWav
    // cassé refuserait TOUT, Opus comme WAV.
    const p = join(dossier, 'bon.wav')
    writeFileSync(p, bufferWavMinimal())
    expect(readWav(p).sampleRate).toBe(24_000)
  })

  it('un buffer Opus est REFUSÉ par le montage — donc le montage ne peut pas être en Opus', () => {
    const p = join(dossier, 'opus.wav')
    writeFileSync(p, bufferOpus())
    expect(() => readWav(p)).toThrow(/Pas un WAV valide/)
  })

  it('🔴 le message d\'erreur de décodage porte la sentinelle sur laquelle le repli Piper s\'abstient', async () => {
    // Les deux moitiés du garde vivent dans deux fichiers : le message levé
    // dans generate-broadcast.ts, et le `msg.includes(...)` qui décide de NE
    // PAS replier. Si l'un change sans l'autre, le repli silencieux revient
    // sans qu'aucun autre test ne tombe.
    const { readFileSync } = await import('node:fs')
    const src = readFileSync(
      new URL('../../scripts/generate-broadcast.ts', import.meta.url), 'utf8',
    )
    const SENTINELLE = 'pas du WAV décodable'
    const levée = src.includes(`n'est pas du WAV décodable`)
    const testée = src.includes(`msg.includes('${SENTINELLE}')`)
    expect(levée, 'l\'erreur de décodage doit porter la sentinelle').toBe(true)
    expect(testée, 'le catch doit s\'abstenir de replier sur cette sentinelle').toBe(true)
  })

  it('le défaut de response_format reste WAV', async () => {
    const { readFileSync } = await import('node:fs')
    const src = readFileSync(new URL('../chatterbox.ts', import.meta.url), 'utf8')
    expect(src).toMatch(/response_format:\s+opts\.format \?\? 'wav'/)
  })
})
