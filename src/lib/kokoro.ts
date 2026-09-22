/**
 * @module InfinityScheduler/Lib/Kokoro
 * @description Voix chinoises NATIVES, par Kokoro-82M v1.1-zh.
 *
 *   ── POURQUOI ──
 *   自由之声 n'avait aucune voix : la seule voix Piper chinoise
 *   (zh_CN-huayan) n'a pas de licence déclarée, et une voix française qui
 *   lit des sinogrammes les ÉPELLE (mesuré ×11,2 en durée le 29/08/2026).
 *   La station était donc refusée chaque nuit.
 *
 *   Kokoro-82M v1.1-zh (hexgrad) : poids Apache-2.0, 100 voix chinoises
 *   natives, données chinoises cédées par LongMaoData (龙猫数据). Moteur
 *   kokoro-onnx (MIT), phonétique misaki (Apache-2.0). Processeur seul,
 *   sans GPU : ~7,9 s d'audio en 5 s sur ce Mac, chargement compris.
 *
 *   ── ISOLÉ DE PIPER ──
 *   Son propre environnement Python (`.venv-kokoro`) : Kokoro tire un
 *   onnxruntime plus récent (1.30) que celui de Piper (1.29). Un
 *   environnement partagé aurait pu casser la voix de treize stations pour
 *   en servir une.
 *
 *   ── SOUVERAINETÉ (22/09/2026) ──
 *   Les poids viennent D'ABORD de NOTRE miroir (models.data-space.world,
 *   servi par le disque du hub, repli IPFS), GitHub n'étant plus qu'un
 *   REPLI annoncé. Ils sont FIGÉS et vérifiés par empreinte, quelle que
 *   soit la source. Le vocabulaire (config.json, 3 Ko, Apache-2.0) est
 *   EMBARQUÉ dans le dépôt : plus aucune requête Hugging Face sur le chemin
 *   d'une nuit radio. (Le miroir sert aussi par Range, donc une connexion
 *   fragile reprend là où elle s'est arrêtée — le 524 du 11/09 est derrière nous.)
 */

import { execFile } from 'node:child_process'
import { createHash } from 'node:crypto'
import { copyFileSync, createReadStream, existsSync, mkdirSync, unlinkSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

export const PREFIXE_KOKORO = 'kokoro-zh:'

/** Fréquence de sortie de Kokoro. Piper sort du 22 050 Hz ; le montage rééchantillonne. */
export const TAUX_KOKORO = 24000

/** Même raison que pour Piper : un moteur natif peut mourir pour une raison étrangère au texte. */
const TENTATIVES = 3

export function estVoixKokoro(voix: string): boolean {
  return voix.startsWith(PREFIXE_KOKORO)
}

/** `kokoro-zh:zf_001` → `zf_001`, le nom que connaît le fichier de voix. */
export function nomKokoro(voix: string): string {
  if (!estVoixKokoro(voix)) throw new Error(`pas une voix Kokoro : ${voix}`)
  return voix.slice(PREFIXE_KOKORO.length)
}

export interface FichierFige {
  nom: string
  sha256: string
  /** Source d'origine (GitHub / Hugging Face) : REPLI seulement. */
  source: string
  /** Notre miroir (models.data-space.world) : essayé en PREMIER. */
  miroir?: string
  /** Copie figée dans le dépôt : lue AVANT toute tentative de téléchargement. */
  embarque?: string
}

/** Hôte du miroir de poids ; `MODELES_HOST` le remplace pour un banc d'essai. */
export const MIROIR_MODELES = process.env.MODELES_HOST ?? 'https://models.data-space.world'

/**
 * Release DATÉE (`model-files-v1.1`), jamais « la dernière » : un modèle
 * qui changerait sous nos pieds changerait les voix sans que personne ne
 * l'ait décidé. L'empreinte le garantit.
 */
export const FICHIERS_KOKORO: Record<'modele' | 'voix' | 'config', FichierFige> = {
  modele: {
    nom: 'kokoro-v1.1-zh.onnx',
    sha256: '859f9ded9f53be16c24857cdab3254a45da53c3afd5ba6ef134c7de3f822e326',
    source: 'https://github.com/thewh1teagle/kokoro-onnx/releases/download/model-files-v1.1/kokoro-v1.1-zh.onnx',
    miroir: `${MIROIR_MODELES}/thewh1teagle/kokoro-onnx/releases/download/model-files-v1.1/kokoro-v1.1-zh.onnx`,
  },
  voix: {
    nom: 'voices-v1.1-zh.bin',
    sha256: '14cb6186c99e4f6016871405f62046c5df863ae27465cbdc4ee08be7dd703acd',
    source: 'https://github.com/thewh1teagle/kokoro-onnx/releases/download/model-files-v1.1/voices-v1.1-zh.bin',
    miroir: `${MIROIR_MODELES}/thewh1teagle/kokoro-onnx/releases/download/model-files-v1.1/voices-v1.1-zh.bin`,
  },
  config: {
    nom: 'config-v1.1-zh.json',
    sha256: 'bc333efa5ce4ceff433c8c8e5d027a1eca0166001e4e4a62bea2d26ff7a46890',
    source: 'https://huggingface.co/hexgrad/Kokoro-82M-v1.1-zh/raw/main/config.json',
    embarque: 'src/data/kokoro-config-v1.1-zh.json',
  },
}

function dossier(): string { return join(process.env.VOICES_DIR ?? join(process.cwd(), 'voices'), 'kokoro') }
function chemin(f: FichierFige): string { return join(dossier(), f.nom) }
function python(): string { return join(process.cwd(), '.venv-kokoro', 'bin', 'python') }
function pont(): string { return join(process.cwd(), 'scripts', 'kokoro-python.py') }

/**
 * Kokoro est-il installé sur CETTE machine ? Sans réseau, sans lever.
 * Kokoro n'est que le REPLI du chinois : Chatterbox (data-space) est
 * multilingue et porte les voix de 自由之声. Son absence doit être ANNONCÉE,
 * pas fatale — c'est ce qui a tué la station chaque nuit du 18 au 22/09/2026.
 */
export function kokoroDisponible(): boolean {
  return existsSync(python()) && existsSync(pont())
}

export function empreinte(fichier: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const h = createHash('sha256')
    createReadStream(fichier)
      .on('data', d => h.update(d))
      .on('end', () => resolve(h.digest('hex')))
      .on('error', reject)
  })
}

let pret = false

/** Environnement, pont et fichiers présents et INTACTS — sinon lève en disant quoi faire. */
export async function ensureKokoro(): Promise<void> {
  if (pret) return
  if (!existsSync(python()) || !existsSync(pont())) {
    throw new Error('Kokoro absent. Créer son environnement : `uv venv --python 3.12 .venv-kokoro && '
      + 'uv pip install --python .venv-kokoro/bin/python kokoro-onnx "misaki[zh]"`')
  }
  mkdirSync(dossier(), { recursive: true })
  for (const f of Object.values(FICHIERS_KOKORO)) {
    const p = chemin(f)
    if (!existsSync(p)) {
      const copie = f.embarque ? join(process.cwd(), f.embarque) : null
      if (copie && existsSync(copie)) {
        copyFileSync(copie, p)
      } else {
        // Notre miroir d'abord ; la source d'origine seulement s'il ne répond pas — et on le dit.
        const sources = [...(f.miroir ? [f.miroir] : []), f.source]
        let obtenu = false
        for (const url of sources) {
          const hote = new URL(url).host
          try {
            const r = await fetch(url, { signal: AbortSignal.timeout(600_000) })
            if (!r.ok) throw new Error(`HTTP ${r.status}`)
            writeFileSync(p, Buffer.from(await r.arrayBuffer()))
            console.log(`  [kokoro] ${f.nom} téléchargé depuis ${hote}${url === f.source ? ' (REPLI — le miroir n\'a pas répondu)' : ''}`)
            obtenu = true
            break
          } catch (err) {
            console.warn(`  [kokoro] ⚠ ${f.nom} depuis ${hote} : ${(err as Error).message.slice(0, 80)}`)
          }
        }
        if (!obtenu) throw new Error(`[kokoro] ${f.nom} : aucune source n'a répondu`)
      }
    }
    const e = await empreinte(p)
    if (e !== f.sha256) {
      throw new Error(`[kokoro] ${f.nom} : empreinte ${e.slice(0, 12)}… au lieu de ${f.sha256.slice(0, 12)}… `
        + '— fichier altéré ou autre version')
    }
  }
  pret = true
}

/**
 * La CAUSE d'un échec du pont, en une ligne. « Command failed: <commande> »
 * ne dit rien : répétition du 11/09/2026, deux échecs dont le journal ne
 * montrait que la ligne de commande, tronquée. La cause est dans le signal
 * (processus tué, souvent par manque de mémoire) ou dans les dernières
 * lignes de stderr.
 */
export function causeDEchec(err: { message: string; signal?: string | null; code?: number | string | null }, stderr: string[]): string {
  const utiles = stderr.filter(l => l.trim() && !l.includes('lettres latines') && !l.includes('en_callable is None'))
  const morceaux = [
    err.signal ? `tué par ${err.signal}` : '',
    typeof err.code === 'number' ? `code ${err.code}` : '',
    utiles.slice(-2).map(l => l.trim()).join(' | '),
  ].filter(Boolean)
  return morceaux.length ? morceaux.join(' · ') : err.message
}

function unEssai(texte: string, voix: string, sortie: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const enfant = execFile(python(), [
      pont(),
      '--model',       chemin(FICHIERS_KOKORO.modele),
      '--voices',      chemin(FICHIERS_KOKORO.voix),
      '--config',      chemin(FICHIERS_KOKORO.config),
      '--voice',       nomKokoro(voix),
      '--output_file', sortie,
    ], { encoding: 'buffer', maxBuffer: 64 * 1024 * 1024 }, (err, _stdout, stderr) => {
      const lignes = stderr.toString().split('\n').filter(l => l && !l.includes('en_callable is None'))
      if (err) { reject(new Error(`${causeDEchec(err, lignes)}\n${err.message}`)); return }
      const latines = lignes.find(l => l.includes('lettres latines'))
      if (latines) console.warn(`  [kokoro] ${latines}`)
      if (!existsSync(sortie)) { reject(new Error(`kokoro n'a produit aucun fichier ${sortie}`)); return }
      resolve()
    })
    enfant.stdin?.write(texte)
    enfant.stdin?.end()
  })
}

/** Synthétise un tour → chemin d'un WAV 24 kHz. Réessaie ; ne relit jamais la sortie d'un essai raté. */
export async function synthesizeKokoro(texte: string, voix: string): Promise<string> {
  await ensureKokoro()
  let derniere: Error | undefined
  for (let essai = 1; essai <= TENTATIVES; essai++) {
    const sortie = join(tmpdir(), `kokoro-${nomKokoro(voix)}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.wav`)
    try {
      await unEssai(texte, voix, sortie)
      if (essai > 1) console.error(`[kokoro] ${voix} : réussi au ${essai}e essai`)
      return sortie
    } catch (err) {
      derniere = err as Error
      try { if (existsSync(sortie)) unlinkSync(sortie) } catch { /* déjà parti */ }
      if (essai < TENTATIVES) {
        console.error(`[kokoro] ${voix} : essai ${essai}/${TENTATIVES} échoué, reprise — ${derniere.message.split('\n')[0]}`)
        await new Promise(r => setTimeout(r, 500 * essai))
      }
    }
  }
  throw new Error(`kokoro failed (${voix}) après ${TENTATIVES} essais: ${derniere?.message}`)
}
