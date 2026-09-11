/**
 * @module InfinityScheduler/Opus
 * @description Encodage des émissions : WAV → Opus (`opusenc`), puis
 *   emballage en WebM (`ffmpeg -c:a copy`). ~16× plus petit qu'un WAV brut
 *   pour de la voix, sans dégradation audible (32 kbps suffit à la parole).
 *
 *   Pré-requis système :
 *     - macOS : `brew install opus-tools ffmpeg`
 *     - Ubuntu : `sudo apt-get install -y opus-tools ffmpeg`
 *
 *   Spring 2026 : l'Opus a été choisi pour rester sous le quota Pinata
 *   (11 stations × 100+ MB de WAV par jour).
 */

import { execFile } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

/**
 * Le format dans lequel les émissions sont PUBLIÉES.
 *
 * WebM, et non Ogg. Mesuré le 11/09/2026 dans le WebKit SYSTÈME de ce Mac
 * (macOS 14.7, Safari 17.6, WebKit 19618) — celui de Safari ET de
 * l'application native, qui passe par WKWebView :
 *
 *   ogg / opus    decodeAudioData → « Decoding failed »
 *   mp4 / opus    « Decoding failed »
 *   webm / opus   ✅
 *   mp3, aac      ✅
 *
 * Même codec, mêmes octets audio : seul l'emballage change, la taille ne
 * bouge presque pas. Chrome, Firefox et Android lisent le WebM/Opus comme
 * l'Ogg/Opus.
 *
 * Ce module affirmait jusque-là que « tous les navigateurs modernes, Safari
 * compris, décodent l'OGG/Opus nativement ». C'était faux, et toutes les
 * émissions publiées depuis juillet étaient muettes sous Safari et dans
 * l'app macOS, avec pour seul message « Decoding failed ».
 */
export const FORMAT_EMISSION = { extension: 'webm', mime: 'audio/webm' } as const

/**
 * Encode un Buffer WAV en Buffer Opus (container OGG).
 * Streaming via stdin/stdout, pas de fichier intermédiaire.
 *
 * ⚠️ Ne PAS publier ce résultat tel quel : voir `encoderEmission`.
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

/**
 * En-tête EBML (1A 45 DF A3) ET DocType « webm ». Un Matroska générique ne
 * suffit pas : WebKit ne lit que le profil WebM.
 */
export function estWebm(b: Buffer): boolean {
  return b.length > 40
    && b[0] === 0x1a && b[1] === 0x45 && b[2] === 0xdf && b[3] === 0xa3
    && b.subarray(0, 64).includes(Buffer.from('webm', 'latin1'))
}

/**
 * Change l'EMBALLAGE d'un flux Ogg/Opus pour du WebM, sans réencoder.
 *
 * Passe par des fichiers, pas par des tubes : un WebM écrit dans un tube
 * ne peut pas revenir inscrire sa durée ni son index en tête de fichier.
 */
export async function oggOpusVersWebm(ogg: Buffer): Promise<Buffer> {
  if (ogg.subarray(0, 4).toString('latin1') !== 'OggS') {
    throw new Error('oggOpusVersWebm : l\'entrée n\'est pas un flux Ogg (en-tête OggS absent)')
  }
  const dossier = mkdtempSync(join(tmpdir(), 'emission-webm-'))
  const entree = join(dossier, 'entree.ogg')
  const sortie = join(dossier, 'sortie.webm')
  try {
    writeFileSync(entree, ogg)
    await new Promise<void>((resolve, reject) => {
      execFile(
        'ffmpeg',
        ['-v', 'error', '-y', '-i', entree, '-map', '0:a:0', '-c:a', 'copy', '-f', 'webm', sortie],
        { maxBuffer: 10 * 1024 * 1024 },
        (err, _stdout, stderr) => {
          if (err) reject(new Error(`ffmpeg (Ogg → WebM) a échoué : ${err.message}\n${String(stderr)}`))
          else resolve()
        },
      )
    })
    const webm = readFileSync(sortie)
    if (!estWebm(webm)) throw new Error('ffmpeg a rendu un fichier qui n\'est pas du WebM')
    return webm
  } finally {
    rmSync(dossier, { recursive: true, force: true })
  }
}

/** L'émission telle qu'elle doit être publiée : Opus, emballé en WebM. */
export async function encoderEmission(wav: Buffer, bitrateKbps: number = 32): Promise<Buffer> {
  return oggOpusVersWebm(await encodeWavToOpus(wav, bitrateKbps))
}
