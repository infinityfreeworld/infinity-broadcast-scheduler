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
import { existsSync, mkdirSync, writeFileSync, unlinkSync } from 'node:fs'
import { mkdir } from 'node:fs/promises'
import { join, dirname } from 'node:path'
import { tmpdir } from 'node:os'

const exec = promisify(execFile)

// ── Paths (overridables via env pour debug) ───────────────────────────

const PIPER_DIR  = process.env.PIPER_DIR  ?? join(process.cwd(), 'piper')
const VOICES_DIR = process.env.VOICES_DIR ?? join(process.cwd(), 'voices')
/**
 * ⚠️ macOS aarch64 : l'archive amont NE CONTIENT AUCUNE `.dylib`.
 *
 * Relevé le 02/09/2026 en tentant une répétition locale. `piper` réclame
 * trois bibliothèques par `@rpath` — `libespeak-ng.1.dylib`,
 * `libpiper_phonemize.1.dylib`, `libonnxruntime.1.14.1.dylib` — et
 * `piper_macos_aarch64.tar.gz` n'en livre aucune : seulement le paquet de
 * symboles de débogage `libonnxruntime.1.14.1.dylib.dSYM`, qui a l'air
 * d'une bibliothèque dans un listing et n'en est pas une.
 *
 * `brew install espeak-ng` fournit la première ; les deux autres sont
 * propres à Piper et épinglées à une version d'onnxruntime. La synthèse
 * locale est donc IMPOSSIBLE sur ce Mac sans reconstruire Piper.
 *
 * 🔴 Ce n'est PAS un problème en production : la CI tourne sous Linux, où
 * l'archive est complète. Mais toute répétition locale s'arrête à la
 * synthèse, avec un `dyld: Library not loaded` qui ressemble à une
 * installation ratée alors que l'archive est simplement incomplète.
 */
const PIPER_BIN  = join(PIPER_DIR, 'piper')

const PIPER_VERSION = '2023.11.14-2'   // dernière release stable au 2026-05
import CIDS_PIPER from '../data/piper-cids.json'

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
  // 🔴 SOUVERAINETÉ. Nous avions quitté Hugging Face pour les voix clonées
  // en croyant nous en être affranchis — mais Piper, qui porte 93 % des
  // tours (308 sur 330 chaque nuit), y téléchargeait toujours ses modèles.
  // Nous avions libéré les 7 % et laissé les 93 %.
  //
  // Ces fichiers sont FIGÉS — une release datée, jamais modifiée : le cas
  // idéal pour l'adressage par contenu. Ils sont déposés chez data-space,
  // chacun vérifié par relecture (`souverainiser-piper.ts`).
  //
  // Hugging Face reste en SECOURS, et c'est délibéré : un dépôt unique est
  // un point unique de défaillance, et nous l'avons appris avec les
  // passerelles IPFS. Un repli est ANNONCÉ — sans quoi on se croirait
  // souverain en dépendant toujours d'un tiers.
  const source = cidsDeLaVoix(voiceId)
  const tasks = source
    ? [
        telechargerAvecRepli(urlDataspace(source.onnx), `${HF_VOICES_BASE}/${meta.hfPath}.onnx`, onnxPath),
        telechargerAvecRepli(urlDataspace(source.json), `${HF_VOICES_BASE}/${meta.hfPath}.onnx.json`, jsonPath),
      ]
    : [
        downloadFile(`${HF_VOICES_BASE}/${meta.hfPath}.onnx`, onnxPath),
        downloadFile(`${HF_VOICES_BASE}/${meta.hfPath}.onnx.json`, jsonPath),
      ]
  await Promise.all(tasks)
  console.log(`[piper] Voix ${voiceId} prête.`)
}

/** Passerelle du dépôt souverain. */
function urlDataspace(cid: string): string {
  const base = process.env.DATASPACE_GATEWAY ?? 'https://data-space.world/api/ipfs'
  return `${base}/${cid}`
}

/** Le CID de cette voix, s'il a été déposé. */
function cidsDeLaVoix(voiceId: string): { onnx: string; json: string } | null {
  const e = (CIDS_PIPER as Record<string, { onnx?: string; json?: string }>)[voiceId]
  return e?.onnx && e?.json ? { onnx: e.onnx, json: e.json } : null
}

/**
 * Essaie le dépôt souverain, retombe sur Hugging Face en le DISANT.
 *
 * Un repli silencieux ferait croire à une indépendance qu'on n'a plus :
 * c'est exactement l'erreur qui nous a fait annoncer « sans Hugging Face »
 * alors que 93 % des tours en dépendaient encore.
 */
async function telechargerAvecRepli(souverain: string, secours: string, dest: string): Promise<void> {
  try {
    await downloadFile(souverain, dest)
  } catch (err) {
    console.warn(`  [piper] dépôt souverain indisponible (${(err as Error).message.slice(0, 70)})`)
    console.warn(`  [piper] ⚠ repli sur Hugging Face pour ${dest.split('/').pop()}`)
    await downloadFile(secours, dest)
  }
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
/**
 * Comment lancer Piper sur CETTE machine.
 *
 * 🔴 Le binaire natif ne tourne pas partout. `piper_macos_aarch64.tar.gz`
 * ne livre AUCUNE `.dylib` — seulement le paquet de symboles
 * `libonnxruntime.1.14.1.dylib.dSYM`, qui ressemble à une bibliothèque
 * dans un listing et n'en est pas une. Sous Linux l'archive est complète.
 *
 * On ESSAIE donc le binaire, et on retombe sur le pont Python
 * (`piper-tts`, qui embarque son propre onnxruntime) s'il refuse. La
 * bascule est ANNONCÉE : croire qu'on utilise le binaire natif alors
 * qu'on passe par Python fausserait toute mesure de débit.
 */
type Moteur = { cmd: string; args: string[] }
let moteurResolu: Moteur | null = null

function pythonDuVenv(): string {
  return process.env.PIPER_PYTHON ?? join(process.cwd(), '.venv-piper', 'bin', 'python')
}

async function resoudreMoteur(): Promise<Moteur> {
  if (moteurResolu) return moteurResolu

  // 🔴 PAS DE SONDE. La première version lançait `piper --help` avec un
  // `timeout: 15_000` pour savoir si le binaire natif marchait.
  //
  // Le 08/09/2026, cette sonde a bloqué DEUX répétitions pendant neuf
  // heures. Le binaire est x86_64, tourne sous Rosetta, et sur ce Mac il
  // ne rend jamais la main : le processus reste en état `UE`
  // (ininterruptible), et le `timeout` d'`execFile` ne peut pas le tuer —
  // le rappel n'est jamais appelé, la promesse ne se résout jamais.
  //
  // Nous avons accusé le débit de notre partenaire pendant ce temps.
  //
  // La leçon est la même que pour le mur d'échéance : un garde qui dépend
  // de la coopération de ce qu'il surveille n'est pas un garde. Ici, la
  // seule question sûre est une question de FICHIERS, pas de processus.
  const pont = join(process.cwd(), 'scripts', 'piper-python.py')
  if (existsSync(pont) && existsSync(pythonDuVenv())) {
    moteurResolu = { cmd: pythonDuVenv(), args: [pont] }
    return moteurResolu
  }

  if (!existsSync(PIPER_BIN)) {
    throw new Error(
      'Piper inutilisable : le binaire natif refuse de démarrer (archive amont '
      + 'sans .dylib sur macOS aarch64) et le pont Python est absent. '
      + 'Créer le venv : uv venv .venv-piper --python 3.12 '
      + '&& uv pip install --python .venv-piper/bin/python piper-tts',
    )
  }
  // Le pont manque : on tente le binaire natif, qui marche sous Linux.
  console.warn('  [piper] pont Python absent — usage du binaire natif')
  moteurResolu = { cmd: PIPER_BIN, args: [] }
  return moteurResolu
}

/** Nombre de tentatives par synthèse.
 *  onnxruntime plante par intermittence à la DESTRUCTION du processus
 *  (`libc++abi: recursive_mutex lock failed: Invalid argument`), sous
 *  pression mémoire — mesuré 14 fois dans la nuit du 09/09, ce qui a
 *  coûté 8 stations sur 13. Le WAV d'un processus mort est jeté : il
 *  peut être tronqué, on ne le récupère jamais. */
const TENTATIVES_SYNTHESE = 3

/** Un seul appel au moteur. Rejette si le moteur sort non nul ou n'écrit rien. */
function unEssaiDeSynthese(
  moteur: Moteur, voicePath: string, outPath: string, text: string,
): Promise<void> {
  return new Promise((resolve, reject) => {
    // piper accepte le texte sur stdin et écrit le WAV via --output_file.
    // --sentence_silence=0.05 réduit le silence en fin de phrase de 0.2s
    // (défaut Piper) à 0.05s. Combiné avec INTER_TURN_SILENCE_S=0.10 dans
    // audio.ts, le pacing est naturel sans "trous" perceptibles.
    const child = execFile(moteur.cmd, [
      ...moteur.args,
      '--model',            voicePath,
      '--output_file',      outPath,
      '--sentence_silence', '0.05',
    ], { encoding: 'buffer' }, (err, _stdout, stderr) => {
      if (err) {
        reject(new Error(`${err.message}\n${stderr.toString()}`))
        return
      }
      if (!existsSync(outPath)) {
        reject(new Error(`piper a produit aucun fichier ${outPath}`))
        return
      }
      resolve()
    })
    child.stdin?.write(text)
    child.stdin?.end()
  })
}

/** Rejoue `faire` jusqu'à `tentatives` fois. Rend le premier succès ;
 *  si tout échoue, lève la DERNIÈRE cause, jamais un message inventé.
 *  Les traces vont sur stderr : stdout porte des données (jetons, CID). */
export async function avecReprises<T>(
  quoi: string,
  tentatives: number,
  faire: (essai: number) => Promise<T>,
  attendre: (ms: number) => Promise<void> = ms => new Promise(r => setTimeout(r, ms)),
): Promise<T> {
  let derniere: Error | undefined
  for (let essai = 1; essai <= tentatives; essai++) {
    try {
      const r = await faire(essai)
      if (essai > 1) console.error(`[piper] ${quoi} : réussi au ${essai}e essai`)
      return r
    } catch (e) {
      derniere = e as Error
      if (essai < tentatives) {
        const cause = String(derniere?.message ?? derniere).split('\n')[0]
        console.error(`[piper] ${quoi} : essai ${essai}/${tentatives} échoué, reprise — ${cause}`)
        await attendre(500 * essai)
      }
    }
  }
  throw new Error(`piper failed (${quoi}) après ${tentatives} essais: ${derniere?.message}`)
}

export async function synthesize(text: string, voiceId: string): Promise<string> {
  if (!isVoiceSupported(voiceId)) {
    throw new Error(`Voix non supportée : ${voiceId}`)
  }
  await ensurePiperBinary()
  await ensureVoice(voiceId)

  const voicePath = join(VOICES_DIR, `${voiceId}.onnx`)
  const moteur = await resoudreMoteur()

  return avecReprises(voiceId, TENTATIVES_SYNTHESE, async () => {
    // Un chemin NEUF à chaque essai : jamais réutiliser la sortie d'un
    // processus qui vient de mourir, elle peut être tronquée.
    const outPath = join(
      tmpdir(),
      `piper-${voiceId}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.wav`,
    )
    try {
      await unEssaiDeSynthese(moteur, voicePath, outPath, text)
      return outPath
    } catch (e) {
      try { if (existsSync(outPath)) unlinkSync(outPath) } catch { /* déjà parti */ }
      throw e
    }
  })
}

/** Récupère le sample rate d'une voix (utile pour audio concat). */
export function getVoiceSampleRate(voiceId: string): number {
  return VOICE_REGISTRY[voiceId]?.sampleRate ?? 22050
}

// Crée le dossier de sortie pour les téléchargements (idempotent)
mkdirSync(PIPER_DIR, { recursive: true })
mkdirSync(VOICES_DIR, { recursive: true })
