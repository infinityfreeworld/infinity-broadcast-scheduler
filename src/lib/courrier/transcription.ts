/**
 * @module InfinityScheduler/Courrier/Transcription
 * @description Transcrire un message VOCAL d'auditeur pour le MODÉRER (insultes, doute) comme un
 *   message écrit. whisper.cpp (`whisper-cli`), le même outil et les MÊMES réglages que l'oreille
 *   de contrôle (`lib/oreille.ts`, branche `feat/voix-fiables-oreille`) : `OREILLE_BINAIRE`,
 *   `OREILLE_MODELE`. Même interface `Transcripteur` : à la fusion, l'un remplacera l'autre sans
 *   rien changer aux appelants.
 *
 *   Langue « auto » : un auditeur peut parler une autre langue que celle de la station.
 *   Pas de transcripteur → le vocal n'est pas jugé par le modèle, il va à l'IHL (prudence).
 *   `COURRIER_TRANSCRIPTION=0` coupe la transcription.
 */
import { execFile } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { delimiter, join } from 'node:path'
import { promisify } from 'node:util'
import { encodeWav, type DecodedWav } from '../audio'

const exec = promisify(execFile)

export interface Transcripteur {
  /** Rend le texte entendu, ou lève. */
  transcrire(wav: DecodedWav, langue: string): Promise<string>
}

/** Ramène un WAV à 16 kHz (ce qu'attend Whisper), par interpolation linéaire. Pur. */
export function reechantillonner16k(wav: DecodedWav): DecodedWav {
  const cible = 16_000
  if (wav.sampleRate === cible) return wav
  const rapport = wav.sampleRate / cible
  const n = Math.max(0, Math.floor(wav.samples.length / rapport))
  const out = new Float32Array(n)
  for (let i = 0; i < n; i++) {
    const x = i * rapport
    const i0 = Math.floor(x)
    const i1 = Math.min(i0 + 1, wav.samples.length - 1)
    const f = x - i0
    out[i] = wav.samples[i0] * (1 - f) + wav.samples[i1] * f
  }
  return { samples: out, sampleRate: cible }
}

function dansLePath(nom: string, path = process.env.PATH): string | null {
  for (const d of (path ?? '').split(delimiter)) {
    if (d && existsSync(join(d, nom))) return join(d, nom)
  }
  return null
}

function modeleParDefaut(): string {
  const base = existsSync(join(homedir(), 'Library'))
    ? join(homedir(), 'Library', 'Application Support', 'infinity-radio')
    : join(process.env.XDG_STATE_HOME ?? join(homedir(), '.local', 'state'), 'infinity-radio')
  return join(base, 'whisper', 'ggml-base.bin')
}

/** Le transcripteur de cette machine, ou la RAISON de son absence. Ne lève jamais. */
export function transcripteurCourrier(env: NodeJS.ProcessEnv = process.env): Transcripteur | { indisponible: string } {
  if (env.COURRIER_TRANSCRIPTION === '0') return { indisponible: 'coupée (COURRIER_TRANSCRIPTION=0)' }
  const binaire = env.OREILLE_BINAIRE || dansLePath('whisper-cli', env.PATH) || dansLePath('whisper-cpp', env.PATH)
  if (!binaire || !existsSync(binaire)) return { indisponible: 'whisper-cli introuvable (brew install whisper-cpp)' }
  const modele = env.OREILLE_MODELE || modeleParDefaut()
  if (!existsSync(modele)) return { indisponible: `modèle Whisper absent (${modele})` }
  return {
    async transcrire(wav, langue) {
      const dossier = mkdtempSync(join(tmpdir(), 'courrier-'))
      try {
        const entree = join(dossier, 'vocal.wav')
        writeFileSync(entree, encodeWav(reechantillonner16k(wav)))
        const sortie = join(dossier, 'vocal')
        await exec(binaire, ['-m', modele, '-f', entree, '-l', langue || 'auto', '-nt', '-np', '-otxt', '-of', sortie],
          { timeout: 180_000, maxBuffer: 8 * 1024 * 1024 })
        return readFileSync(`${sortie}.txt`, 'utf8').trim()
      } finally {
        rmSync(dossier, { recursive: true, force: true })
      }
    },
  }
}
