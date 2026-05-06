/**
 * @module InfinityScheduler/Opus
 * @description Encodage WAV → Opus (container OGG) via subprocess `opusenc`
 *   d'opus-tools. ~16× plus petit qu'un WAV brut pour de la voix Piper TTS,
 *   sans dégradation audible (bitrate 32 kbps suffit pour de la parole).
 *
 *   Pré-requis système :
 *     - Ubuntu CI : `sudo apt-get install -y opus-tools`
 *     - macOS dev : `brew install opus-tools`
 *
 *   Garantit la compatibilité navigateur : tous les navigateurs modernes
 *   (Chrome / Firefox / Safari / iOS Safari 11+) décodent OGG/Opus nativement
 *   via `AudioContext.decodeAudioData()`.
 *
 *   Spring 2026 : ajouté pour rester sous le quota Pinata 1 GB free tier
 *   (sinon 11 stations × 100+ MB WAV/jour = blocage rapide).
 */

import { execFile } from 'node:child_process'

/**
 * Encode un Buffer WAV en Buffer Opus (container OGG).
 * Streaming via stdin/stdout, pas de fichier intermédiaire.
 *
 * @param wav         Buffer WAV (PCM16 typiquement)
 * @param bitrateKbps Cible débit Opus. 32 kbps = qualité voix excellente
 *                    (broadcasts Piper FR). Pour musique, monter à 64-96.
 */
export function encodeWavToOpus(wav: Buffer, bitrateKbps: number = 32): Promise<Buffer> {
  return new Promise<Buffer>((resolve, reject) => {
    // opusenc lit stdin et écrit stdout quand on passe '-' aux 2 paramètres.
    // --quiet : pas de banner verbeux. --bitrate : kbps cible.
    const child = execFile(
      'opusenc',
      ['--quiet', '--bitrate', String(bitrateKbps), '-', '-'],
      { encoding: 'buffer', maxBuffer: 500 * 1024 * 1024 },   // 500 MB output max
      (err, stdout, stderr) => {
        if (err) {
          reject(new Error(
            `opusenc failed: ${err.message}\n${(stderr as Buffer | string).toString()}`,
          ))
          return
        }
        resolve(stdout as Buffer)
      },
    )
    if (!child.stdin) {
      reject(new Error('opusenc: stdin not available'))
      return
    }
    child.stdin.on('error', (e) => reject(e))
    child.stdin.write(wav)
    child.stdin.end()
  })
}
