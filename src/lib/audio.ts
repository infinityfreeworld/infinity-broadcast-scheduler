/**
 * @module InfinityScheduler/Audio
 * @description Lecture de WAV PCM 16-bit + concaténation + ré-encodage WAV.
 *   Version Node (pas de Web Audio API). Compatible avec le format produit
 *   par Piper natif.
 *
 *   Format WAV produit par Piper :
 *     - PCM 16-bit signé little-endian
 *     - Mono
 *     - Sample rate = celui du modèle (22050 Hz pour les voix medium)
 */

import { readFileSync } from 'node:fs'

const INTER_TURN_SILENCE_S = 0.35

export interface DecodedWav {
  /** Échantillons PCM en Float32 normalisé [-1, 1]. */
  samples:    Float32Array
  sampleRate: number
}

/** Parse un fichier WAV PCM 16-bit mono → Float32Array normalisé. */
export function readWav(path: string): DecodedWav {
  const buf = readFileSync(path)
  const view = new DataView(buf.buffer, buf.byteOffset, buf.byteLength)

  // Header RIFF / WAVE
  const riff = readStr(view, 0, 4)
  const wave = readStr(view, 8, 4)
  if (riff !== 'RIFF' || wave !== 'WAVE') {
    throw new Error(`Pas un WAV valide : ${path}`)
  }

  // Cherche le sub-chunk 'fmt '
  let offset = 12
  let sampleRate = 0
  let channels   = 1
  let bitsPerSample = 16
  let dataOffset = -1
  let dataSize   = 0

  while (offset < view.byteLength) {
    const chunkId   = readStr(view, offset, 4)
    const chunkSize = view.getUint32(offset + 4, true)
    if (chunkId === 'fmt ') {
      channels      = view.getUint16(offset + 10, true)
      sampleRate    = view.getUint32(offset + 12, true)
      bitsPerSample = view.getUint16(offset + 22, true)
    } else if (chunkId === 'data') {
      dataOffset = offset + 8
      dataSize   = chunkSize
      break
    }
    offset += 8 + chunkSize
  }

  if (dataOffset < 0) throw new Error(`Pas de chunk data dans : ${path}`)
  if (bitsPerSample !== 16) throw new Error(`Bits per sample ${bitsPerSample} non supporté (attendu 16)`)
  if (channels !== 1) throw new Error(`${channels} canaux non supporté (attendu mono)`)

  // Convertit PCM 16-bit signé → Float32 normalisé
  const numSamples = dataSize / 2
  const samples = new Float32Array(numSamples)
  for (let i = 0; i < numSamples; i++) {
    const s = view.getInt16(dataOffset + i * 2, true)
    samples[i] = s / 32768
  }

  return { samples, sampleRate }
}

export interface ConcatEntry {
  wav:     DecodedWav
  /** Calculé par concatWavs : début dans le buffer final (s). */
  tStart?: number
  /** Calculé : fin dans le buffer final (s). */
  tEnd?:   number
}

/**
 * Concatène N WAVs en 1 avec INTER_TURN_SILENCE_S de silence entre eux.
 * Resample par interpolation linéaire si sample rates différents (rare —
 * toutes les voix Piper du même modèle ont le même rate).
 *
 * Mute en place les `tStart`/`tEnd` des entries pour le transcript.
 */
export function concatWavs(entries: ConcatEntry[]): DecodedWav {
  if (entries.length === 0) {
    return { samples: new Float32Array(0), sampleRate: 22050 }
  }

  const targetRate = entries[0].wav.sampleRate
  const silenceSamples = Math.floor(INTER_TURN_SILENCE_S * targetRate)

  // Calcul tailles + timings
  let totalSamples = 0
  const lengths: number[] = []
  for (let i = 0; i < entries.length; i++) {
    const len = entries[i].wav.sampleRate === targetRate
      ? entries[i].wav.samples.length
      : Math.floor(entries[i].wav.samples.length * targetRate / entries[i].wav.sampleRate)
    lengths.push(len)
    entries[i].tStart = totalSamples / targetRate
    totalSamples += len
    entries[i].tEnd = totalSamples / targetRate
    if (i < entries.length - 1) totalSamples += silenceSamples
  }

  const out = new Float32Array(totalSamples)
  let offset = 0
  for (let i = 0; i < entries.length; i++) {
    const written = writeInto(entries[i].wav, targetRate, out, offset)
    offset += written
    if (i < entries.length - 1) offset += silenceSamples
  }

  return { samples: out, sampleRate: targetRate }
}

function writeInto(src: DecodedWav, targetRate: number, out: Float32Array, offset: number): number {
  if (src.sampleRate === targetRate) {
    out.set(src.samples, offset)
    return src.samples.length
  }
  // Resample par interpolation linéaire (qualité suffisante pour voix synthétisée)
  const ratio = src.sampleRate / targetRate
  const outLen = Math.floor(src.samples.length / ratio)
  for (let i = 0; i < outLen; i++) {
    const srcIdx = i * ratio
    const i0 = Math.floor(srcIdx)
    const i1 = Math.min(i0 + 1, src.samples.length - 1)
    const frac = srcIdx - i0
    out[offset + i] = src.samples[i0] * (1 - frac) + src.samples[i1] * frac
  }
  return outLen
}

/** Encode un Float32Array → Buffer WAV PCM 16-bit mono prêt pour upload. */
export function encodeWav(decoded: DecodedWav): Buffer {
  const { samples, sampleRate } = decoded
  const numChannels = 1
  const bytesPerSample = 2
  const dataSize = samples.length * bytesPerSample
  const fileSize = 44 + dataSize

  const out = Buffer.alloc(fileSize)
  // Header RIFF
  out.write('RIFF', 0)
  out.writeUInt32LE(fileSize - 8, 4)
  out.write('WAVE', 8)
  // fmt chunk
  out.write('fmt ', 12)
  out.writeUInt32LE(16, 16)
  out.writeUInt16LE(1, 20)               // PCM
  out.writeUInt16LE(numChannels, 22)
  out.writeUInt32LE(sampleRate, 24)
  out.writeUInt32LE(sampleRate * numChannels * bytesPerSample, 28)
  out.writeUInt16LE(numChannels * bytesPerSample, 32)
  out.writeUInt16LE(16, 34)
  // data chunk
  out.write('data', 36)
  out.writeUInt32LE(dataSize, 40)
  // Échantillons PCM 16-bit
  let off = 44
  for (let i = 0; i < samples.length; i++) {
    const s = Math.max(-1, Math.min(1, samples[i]))
    out.writeInt16LE(s < 0 ? s * 0x8000 : s * 0x7FFF, off)
    off += 2
  }
  return out
}

function readStr(view: DataView, offset: number, len: number): string {
  let s = ''
  for (let i = 0; i < len; i++) s += String.fromCharCode(view.getUint8(offset + i))
  return s
}

/** Durée totale en secondes. */
export function durationOf(decoded: DecodedWav): number {
  return decoded.samples.length / decoded.sampleRate
}
