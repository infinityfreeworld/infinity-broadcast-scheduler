/**
 * @module InfinityScheduler/Piper
 * @description Wrapper Node autour du binaire natif Piper TTS.
 *
 *   Pourquoi Piper natif (vs piper-tts-web utilisé dans le browser) :
 *     - piper-tts-web cible le browser (OPFS, Web Worker, WASM dynamique)
 *       et ne tourne pas en Node sans hacks majeurs.
 *     - Le binaire natif Piper (C++) est ~50× plus rapide que la version
 *       WASM et plus stable. Idéal pour CI/cron.
 *
 *   Modèles téléchargés depuis https://huggingface.co/rhasspy/piper-voices
 *   et cachés dans VOICES_DIR (caché entre runs CI via actions/cache).
 *
 *   Le binaire piper est dans PIPER_DIR (idem caché).
 *
 *   API :
 *     - ensurePiperBinary()      : s'assure que le binaire est dispo
 *     - ensureVoice(voiceId)     : télécharge le modèle ONNX + JSON
 *     - synthesize(text, voiceId): génère un WAV → renvoie path local
 */

import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { mkdir } from 'node:fs/promises'
import { join, dirname } from 'node:path'
import { tmpdir } from 'node:os'

const exec = promisify(execFile)

// ── Paths (overridables via env pour debug) ───────────────────────────

const PIPER_DIR  = process.env.PIPER_DIR  ?? join(process.cwd(), 'piper')
const VOICES_DIR = process.env.VOICES_DIR ?? join(process.cwd(), 'voices')
const PIPER_BIN  = join(PIPER_DIR, 'piper')

const PIPER_VERSION = '2023.11.14-2'   // dernière release stable au 2026-05
const HF_VOICES_BASE = 'https://huggingface.co/rhasspy/piper-voices/resolve/v1.0.0'

// ── Voix supportées (fr/en seulement pour les seed stations) ──────────

interface VoiceMeta {
  /** Path relatif sur HuggingFace (langue/locale/nom/qualité). */
  hfPath: string
  /** Sample rate du modèle. */
  sampleRate: number
}

const VOICE_REGISTRY: Record<string, VoiceMeta> = {
  // ⚠️ Toute voix ajoutée ici DOIT être déclarée dans `voix-licences.ts`.
  // Une voix inconnue de ce registre de licences est refusée par défaut, et
  // `__tests__/voix-licences.test.ts` fait rougir la porte.
  // Les `sampleRate` ci-dessous ont été relevés sur les fiches de modèle
  // (`<voix>.onnx.json` → `audio.sample_rate`), pas déduits du suffixe.

  // ── FR ────────────────────────────────────────────────────────────
  'fr_FR-siwis-medium': { hfPath: 'fr/fr_FR/siwis/medium/fr_FR-siwis-medium', sampleRate: 22050 },
  'fr_FR-gilles-low':   { hfPath: 'fr/fr_FR/gilles/low/fr_FR-gilles-low',     sampleRate: 16000 },
  // `fr_FR-tom-medium` est VOLONTAIREMENT absente : AGPLv3, écartée par
  // l'audit du 04/08/2026 (cf. voix-licences.ts). Ne pas la remettre.

  // ── ES ────────────────────────────────────────────────────────────
  'es_ES-davefx-medium':   { hfPath: 'es/es_ES/davefx/medium/es_ES-davefx-medium',     sampleRate: 22050 },
  // 2 locuteurs dans ce modèle ; faute de `--speaker`, Piper prend le 0.
  'es_ES-sharvard-medium': { hfPath: 'es/es_ES/sharvard/medium/es_ES-sharvard-medium', sampleRate: 22050 },

  // ── RU ────────────────────────────────────────────────────────────
  // Pas de voix féminine : `irina` est sans licence, `ruslan` est
  // NonCommercial. Le timbre féminin retombe sur une voix masculine —
  // pis-aller ASSUMÉ, pas un défaut technique.
  'ru_RU-dmitri-medium': { hfPath: 'ru/ru_RU/dmitri/medium/ru_RU-dmitri-medium', sampleRate: 22050 },
  'ru_RU-denis-medium':  { hfPath: 'ru/ru_RU/denis/medium/ru_RU-denis-medium',   sampleRate: 22050 },

  // ── EN ────────────────────────────────────────────────────────────
  // Trois voix britanniques auditées le 01/09/2026 ; les voix US usuelles
  // sont refusées (ryan = NonCommercial, lessac = licence de recherche).
  'en_GB-cori-medium':                  { hfPath: 'en/en_GB/cori/medium/en_GB-cori-medium',                                   sampleRate: 22050 },
  'en_GB-alba-medium':                  { hfPath: 'en/en_GB/alba/medium/en_GB-alba-medium',                                   sampleRate: 22050 },
  'en_GB-northern_english_male-medium': { hfPath: 'en/en_GB/northern_english_male/medium/en_GB-northern_english_male-medium', sampleRate: 22050 },

  // ── ZH : AUCUNE voix ──────────────────────────────────────────────
  // `zh_CN-huayan` n'a aucune licence déclarée et c'était la seule. Le
  // chinois n'est donc pas synthétisable : `voixPourLangue()` rend null
  // et la station n'est pas générée du tout, plutôt que de publier une
  // voix étrangère qui ÉPELLE les sinogrammes (mesuré ×11 en durée).
}

export function isVoiceSupported(voiceId: string): boolean {
  return voiceId in VOICE_REGISTRY
}

/** Toutes les voix que ce scheduler sait télécharger et exécuter. */
export function voixDuRegistre(): string[] {
  return Object.keys(VOICE_REGISTRY)
}

// ── Setup binaire Piper ───────────────────────────────────────────────

/**
 * Télécharge le binaire piper si pas déjà présent.
 * Plateformes : Linux x86_64 (CI Ubuntu) + Linux arm64 (Mac M-series via Docker).
 * Pour macOS dev : install via brew (`brew install piper`).
 */
export async function ensurePiperBinary(): Promise<void> {
  if (existsSync(PIPER_BIN)) return

  await mkdir(PIPER_DIR, { recursive: true })

  const arch = process.arch
  const platform = process.platform
  let archiveName: string
  if (platform === 'linux' && arch === 'x64')   archiveName = `piper_linux_x86_64.tar.gz`
  else if (platform === 'linux' && arch === 'arm64') archiveName = `piper_linux_aarch64.tar.gz`
  else if (platform === 'darwin' && arch === 'x64') archiveName = `piper_macos_x64.tar.gz`
  else if (platform === 'darwin' && arch === 'arm64') archiveName = `piper_macos_aarch64.tar.gz`
  else throw new Error(`Plateforme non supportée pour Piper natif : ${platform}/${arch}. Install manuellement.`)

  const url = `https://github.com/rhasspy/piper/releases/download/${PIPER_VERSION}/${archiveName}`
  console.log(`[piper] Téléchargement binaire ${archiveName}…`)

  const res = await fetch(url)
  if (!res.ok) throw new Error(`HTTP ${res.status} ${url}`)
  const archivePath = join(PIPER_DIR, archiveName)
  const arrayBuffer = await res.arrayBuffer()
  writeFileSync(archivePath, Buffer.from(arrayBuffer))

  // Extract — utilise tar système (toujours dispo Linux/macOS)
  console.log('[piper] Extraction…')
  await exec('tar', ['-xzf', archivePath, '-C', PIPER_DIR, '--strip-components=1'])

  if (!existsSync(PIPER_BIN)) {
    throw new Error(`Binaire piper introuvable après extraction : ${PIPER_BIN}`)
  }
  console.log('[piper] Binaire prêt :', PIPER_BIN)
}

// ── Setup voix ────────────────────────────────────────────────────────

/**
 * Télécharge le modèle ONNX + son JSON config pour une voix donnée.
 * Idempotent (skip si déjà présent).
 */
export async function ensureVoice(voiceId: string): Promise<void> {
  const meta = VOICE_REGISTRY[voiceId]
  if (!meta) throw new Error(`Voix non enregistrée : ${voiceId}. Ajoute-la dans VOICE_REGISTRY de lib/piper.ts.`)

  const onnxPath = join(VOICES_DIR, `${voiceId}.onnx`)
  const jsonPath = join(VOICES_DIR, `${voiceId}.onnx.json`)

  if (existsSync(onnxPath) && existsSync(jsonPath)) return

  await mkdir(VOICES_DIR, { recursive: true })

  console.log(`[piper] Téléchargement voix ${voiceId}…`)
  const tasks = [
    downloadFile(`${HF_VOICES_BASE}/${meta.hfPath}.onnx`, onnxPath),
    downloadFile(`${HF_VOICES_BASE}/${meta.hfPath}.onnx.json`, jsonPath),
  ]
  await Promise.all(tasks)
  console.log(`[piper] Voix ${voiceId} prête.`)
}

async function downloadFile(url: string, dest: string): Promise<void> {
  const res = await fetch(url)
  if (!res.ok) throw new Error(`HTTP ${res.status} ${url}`)
  await mkdir(dirname(dest), { recursive: true })
  const ab = await res.arrayBuffer()
  writeFileSync(dest, Buffer.from(ab))
}

// ── Synthèse ──────────────────────────────────────────────────────────

/**
 * Synthétise du texte → fichier WAV. Retourne le path local du WAV.
 * Le caller est responsable de cleanup (le fichier reste dans tmpdir).
 */
export async function synthesize(text: string, voiceId: string): Promise<string> {
  if (!isVoiceSupported(voiceId)) {
    throw new Error(`Voix non supportée : ${voiceId}`)
  }
  await ensurePiperBinary()
  await ensureVoice(voiceId)

  const voicePath = join(VOICES_DIR, `${voiceId}.onnx`)
  const outPath = join(tmpdir(), `piper-${voiceId}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.wav`)

  // piper accepte le texte sur stdin et écrit le WAV via --output_file.
  // --sentence_silence=0.05 réduit le silence en fin de phrase de 0.2s
  // (défaut Piper) à 0.05s. Combiné avec INTER_TURN_SILENCE_S=0.10 dans
  // audio.ts, le pacing est naturel sans "trous" perceptibles.
  return new Promise((resolve, reject) => {
    const child = execFile(PIPER_BIN, [
      '--model',            voicePath,
      '--output_file',      outPath,
      '--sentence_silence', '0.05',
    ], { encoding: 'buffer' }, (err, _stdout, stderr) => {
      if (err) {
        reject(new Error(`piper failed (${voiceId}): ${err.message}\n${stderr.toString()}`))
        return
      }
      if (!existsSync(outPath)) {
        reject(new Error(`piper a produit aucun fichier ${outPath}`))
        return
      }
      resolve(outPath)
    })
    child.stdin?.write(text)
    child.stdin?.end()
  })
}

/** Récupère le sample rate d'une voix (utile pour audio concat). */
export function getVoiceSampleRate(voiceId: string): number {
  return VOICE_REGISTRY[voiceId]?.sampleRate ?? 22050
}

// Crée le dossier de sortie pour les téléchargements (idempotent)
mkdirSync(PIPER_DIR, { recursive: true })
mkdirSync(VOICES_DIR, { recursive: true })
