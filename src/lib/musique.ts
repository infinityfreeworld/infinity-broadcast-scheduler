/**
 * @module InfinityScheduler/Musique
 * @description Les PAUSES MUSICALES d'une émission : des morceaux déposés sur data-space
 *   (identifiés par CID, déclarés dans `station.tracks` — seed ou IHL, kind 30091), cuits
 *   DANS le fichier de l'émission entre deux blocs de dialogue.
 *
 *   ── POURQUOI CUIRE LA MUSIQUE DANS L'ÉMISSION, ET PAS LA LAISSER AU LECTEUR ──
 *   L'application joue déjà 5 min de `station.tracks` APRÈS chaque émission — mais elle ne
 *   sait pas insérer d'audio DANS un fichier déjà produit : le lecteur décode un seul
 *   AudioBuffer par émission et n'a qu'une seule voie. Cuire les pauses ici rend le résultat
 *   identique sur tous les lecteurs (appli, IPFS brut, podcast), sans fondu à réinventer
 *   côté navigateur. Le manifeste (kind 30093) porte les `segments` pour que l'appli affiche
 *   « 🎵 titre » au bon moment. Décision du fondateur, 22/09/2026 (« ok pour tout »).
 *
 *   ── RÈGLE ABSOLUE : LA MUSIQUE NE BLOQUE JAMAIS L'ÉMISSION ──
 *   Un CID injoignable, un fichier indécodable, ffmpeg absent : la pause est SAUTÉE et
 *   annoncée. Une émission sans musique vaut mieux qu'une nuit sans émission.
 *
 *   ── NIVEAU ──
 *   Piper et Chatterbox ne sortent pas au même niveau ; un MP3 de 320 kbps non plus. La
 *   musique est ramenée au niveau RMS de la VOIX de l'émission, moins une marge (défaut
 *   4 dB) : elle ne crie jamais plus fort que les animateurs, ni ne disparaît.
 */

import { execFile } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { readWav, type DecodedWav } from './audio'
import type { RadioStation, TrackRef, BroadcastSegment } from './types'

const execFileP = promisify(execFile)

/** Passerelle de lecture : la même que pour les voix Piper (piper.ts). */
export const PASSERELLE_DATASPACE = process.env.DATASPACE_GATEWAY ?? 'https://data-space.world/api/ipfs'

/** Un morceau de plus de 60 Mo n'est pas une musique de pause. */
export const TAILLE_MAX_PISTE = 60 * 1024 * 1024

export interface ReglagesMusique {
  /** Musique active pour cette émission (pistes déclarées, pas de `skipMusic`, pas de kill switch). */
  actif:       boolean
  /** Nombre de pauses DANS l'émission (0 = aucune, la musique reste entre les émissions). */
  pauses:      number
  /** Durée maximale d'une pause, en secondes ; un morceau plus court est joué en entier. */
  pauseDureeS: number
  /** Niveau de la musique par rapport à la voix, en dB (négatif = sous la voix). */
  margeDb:     number
  /** Fondus, en secondes. */
  fonduInS:    number
  fonduOutS:   number
  /** Silence encadrant chaque pause, en secondes. */
  silenceS:    number
}

function entier(brut: string | undefined, defaut: number, min: number, max: number): number {
  const n = Number.parseInt(brut ?? '', 10)
  return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : defaut
}

/**
 * Les réglages effectifs : STATION (IHL, kind 30091) > environnement > défauts.
 *   MUSIQUE_DESACTIVEE=true  coupe tout (kill switch d'une nuit)
 *   MUSIQUE_PAUSES           défaut 2
 *   MUSIQUE_PAUSE_S          défaut 180
 *   MUSIQUE_MARGE_DB         défaut -4
 */
export function reglagesMusique(station: Pick<RadioStation, 'tracks' | 'skipMusic' | 'pauses' | 'pauseDureeS'>,
                                env: NodeJS.ProcessEnv = process.env): ReglagesMusique {
  const pistes = (station.tracks ?? []).filter(t => !!t.cid || !!t.url)
  const pauses = station.pauses ?? entier(env.MUSIQUE_PAUSES, 2, 0, 6)
  const pauseDureeS = station.pauseDureeS ?? entier(env.MUSIQUE_PAUSE_S, 180, 30, 600)
  const marge = Number.parseFloat(env.MUSIQUE_MARGE_DB ?? '')
  return {
    actif:       env.MUSIQUE_DESACTIVEE !== 'true' && !station.skipMusic && pistes.length > 0 && pauses > 0,
    pauses:      Math.min(6, Math.max(0, pauses)),
    pauseDureeS: Math.min(600, Math.max(30, pauseDureeS)),
    margeDb:     Number.isFinite(marge) ? Math.min(6, Math.max(-24, marge)) : -4,
    fonduInS:    1.5,
    fonduOutS:   3,
    silenceS:    0.6,
  }
}

/**
 * APRÈS quels tours (indices 0-based) placer les pauses : à intervalles réguliers, jamais
 * avant le premier tour ni après le dernier (l'appli enchaîne déjà 5 min de musique après
 * l'émission). 22 tours, 2 pauses → après le 7ᵉ et le 15ᵉ tour : trois blocs de dialogue.
 */
export function positionsDesPauses(nbTours: number, pauses: number): number[] {
  if (nbTours < 2 || pauses < 1) return []
  const out = new Set<number>()
  for (let k = 1; k <= pauses; k++) {
    const pos = Math.round(nbTours * k / (pauses + 1)) - 1
    if (pos >= 0 && pos < nbTours - 1) out.add(pos)
  }
  return [...out].sort((a, b) => a - b)
}

/** Générateur pseudo-aléatoire déterministe (mulberry32) : même graine → même ordre. */
export function prng(graine: string): () => number {
  let a = createHash('sha256').update(graine).digest().readUInt32LE(0)
  return () => {
    a = (a + 0x6D2B79F5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/**
 * Les pistes d'une émission, tirées de façon DÉTERMINISTE par (station, date) : le Mac et
 * le secours GitHub choisissent les mêmes ; deux nuits ne se ressemblent pas ; une piste
 * n'est jamais reprise dans la même émission tant qu'il en reste d'autres.
 */
export function choisirPistes(tracks: TrackRef[], n: number, graine: string): TrackRef[] {
  const jouables = tracks.filter(t => !!t.cid || !!t.url)
  if (jouables.length === 0 || n <= 0) return []
  const rand = prng(graine)
  const ordre = [...jouables]
  for (let i = ordre.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1))
    ;[ordre[i], ordre[j]] = [ordre[j], ordre[i]]
  }
  const out: TrackRef[] = []
  for (let i = 0; i < n; i++) out.push(ordre[i % ordre.length])
  return out
}

/** Niveau RMS en dBFS (−∞ pour le silence, borné à −100). */
export function rmsDb(samples: Float32Array): number {
  if (samples.length === 0) return -100
  let acc = 0
  for (let i = 0; i < samples.length; i++) acc += samples[i] * samples[i]
  const rms = Math.sqrt(acc / samples.length)
  return rms > 0 ? Math.max(-100, 20 * Math.log10(rms)) : -100
}

/** RMS global de plusieurs tampons (pondéré par leur longueur). */
export function rmsDbGlobal(tampons: Float32Array[]): number {
  let acc = 0, n = 0
  for (const s of tampons) { for (let i = 0; i < s.length; i++) acc += s[i] * s[i]; n += s.length }
  if (n === 0) return -100
  const rms = Math.sqrt(acc / n)
  return rms > 0 ? Math.max(-100, 20 * Math.log10(rms)) : -100
}

/**
 * Ramène un tampon à un niveau RMS cible (dBFS), sans jamais écrêter : le gain est plafonné
 * pour que la crête reste sous 0,95. Rend un NOUVEAU tampon.
 */
export function ajusterNiveau(samples: Float32Array, cibleDb: number): Float32Array {
  const actuel = rmsDb(samples)
  if (actuel <= -100) return Float32Array.from(samples)
  let gain = Math.pow(10, (cibleDb - actuel) / 20)
  let crete = 0
  for (let i = 0; i < samples.length; i++) { const a = Math.abs(samples[i]); if (a > crete) crete = a }
  if (crete * gain > 0.95) gain = 0.95 / crete
  const out = new Float32Array(samples.length)
  for (let i = 0; i < samples.length; i++) out[i] = samples[i] * gain
  return out
}

/** Fondu d'entrée et de sortie (linéaires), en place, bornés à la moitié du tampon chacun. */
export function appliquerFondus(samples: Float32Array, sampleRate: number, inS: number, outS: number): Float32Array {
  const n = samples.length
  const nIn  = Math.min(Math.floor(inS  * sampleRate), Math.floor(n / 2))
  const nOut = Math.min(Math.floor(outS * sampleRate), Math.floor(n / 2))
  for (let i = 0; i < nIn; i++) samples[i] *= i / nIn
  for (let i = 0; i < nOut; i++) samples[n - 1 - i] *= i / nOut
  return samples
}

/** Encadre un tampon de silence (avant / après). */
export function encadrerDeSilence(samples: Float32Array, sampleRate: number, avantS: number, apresS: number): Float32Array {
  const a = Math.floor(avantS * sampleRate), b = Math.floor(apresS * sampleRate)
  const out = new Float32Array(a + samples.length + b)
  out.set(samples, a)
  return out
}

/** Télécharge un CID (ou une URL) depuis la passerelle data-space, borné en taille et en temps. */
export async function telechargerPiste(track: TrackRef, passerelle = PASSERELLE_DATASPACE): Promise<Buffer> {
  const url = track.cid ? `${passerelle.replace(/\/$/, '')}/${track.cid}` : track.url!
  const r = await fetch(url, { signal: AbortSignal.timeout(180_000) })
  if (!r.ok) throw new Error(`HTTP ${r.status} en lisant ${url}`)
  const taille = Number(r.headers.get('content-length'))
  if (Number.isFinite(taille) && taille > TAILLE_MAX_PISTE) throw new Error(`${(taille / 1e6).toFixed(0)} Mo : trop gros pour une pause`)
  const buf = Buffer.from(await r.arrayBuffer())
  if (buf.length > TAILLE_MAX_PISTE) throw new Error(`${(buf.length / 1e6).toFixed(0)} Mo : trop gros pour une pause`)
  if (buf.length < 1024) throw new Error(`${buf.length} octets : pas un fichier audio`)
  return buf
}

/**
 * Décode n'importe quel fichier audio (mp3, ogg, flac, m4a, wav…) en WAV PCM 16 bits MONO au
 * taux demandé, coupé à `dureeMaxS`. Par ffmpeg, via des fichiers temporaires : un WAV écrit
 * sur un tube n'a pas de taille dans son en-tête, et notre décodeur lirait 4 Go.
 */
export async function decoderEnWavMono(donnees: Buffer, sampleRate: number, dureeMaxS: number): Promise<DecodedWav> {
  const d = mkdtempSync(join(tmpdir(), 'pause-'))
  try {
    const entree = join(d, 'entree.bin'), sortie = join(d, 'sortie.wav')
    writeFileSync(entree, donnees)
    await execFileP(process.env.FFMPEG_BIN ?? 'ffmpeg', [
      '-hide_banner', '-loglevel', 'error', '-nostdin',
      '-i', entree,
      '-vn',                       // la pochette (mjpeg) n'est pas de l'audio
      '-t', String(dureeMaxS),
      '-ac', '1', '-ar', String(sampleRate),
      '-acodec', 'pcm_s16le', '-f', 'wav', '-y', sortie,
    ], { timeout: 120_000, maxBuffer: 1024 * 1024 })
    return readWav(sortie)
  } finally {
    rmSync(d, { recursive: true, force: true })
  }
}

export interface PausePrete {
  track: TrackRef
  wav:   DecodedWav
}

/**
 * Prépare UNE pause : téléchargement, décodage, niveau calé sur la voix, fondus, silences.
 * Lève en cas d'échec — l'appelant décide (et il SAUTE la pause).
 */
export async function preparerPause(
  track: TrackRef, sampleRate: number, voixRmsDb: number, r: ReglagesMusique,
  /** Silences autour, en secondes (défaut : ceux des réglages) — 0 avant pour un talk-over. */
  silences?: { avant: number; apres: number },
): Promise<PausePrete> {
  const brut = await telechargerPiste(track)
  const wav = await decoderEnWavMono(brut, sampleRate, r.pauseDureeS)
  if (wav.samples.length < sampleRate * 5) throw new Error('moins de 5 s d\'audio décodé')
  let s = ajusterNiveau(wav.samples, voixRmsDb + r.margeDb)
  s = appliquerFondus(s, wav.sampleRate, r.fonduInS, r.fonduOutS)
  s = encadrerDeSilence(s, wav.sampleRate, silences?.avant ?? r.silenceS, silences?.apres ?? r.silenceS)
  return { track, wav: { samples: s, sampleRate: wav.sampleRate } }
}

/**
 * Le plan des pauses d'une émission : quelle piste après quel tour. Rien n'est téléchargé
 * ici — pur, testable.
 */
export function planifierPauses(
  station: Pick<RadioStation, 'id' | 'tracks'>, date: string, nbTours: number, r: ReglagesMusique,
): Array<{ apresTour: number; track: TrackRef }> {
  if (!r.actif) return []
  const positions = positionsDesPauses(nbTours, r.pauses)
  const pistes = choisirPistes(station.tracks ?? [], positions.length, `${station.id}:${date}`)
  return positions.map((apresTour, i) => ({ apresTour, track: pistes[i] }))
}

/** Un segment de manifeste pour une pause déjà montée (tStart/tEnd posés par concatWavs). */
export function segmentDePause(track: TrackRef, type: BroadcastSegment['type'], tStart: number, tEnd: number): BroadcastSegment {
  return {
    type,
    ...(track.cid ? { cid: track.cid } : {}),
    title: track.title,
    tStart: Math.round(tStart * 1000) / 1000,
    tEnd:   Math.round(tEnd * 1000) / 1000,
  }
}
