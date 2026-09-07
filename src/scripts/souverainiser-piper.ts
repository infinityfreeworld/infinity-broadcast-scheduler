#!/usr/bin/env tsx
/**
 * @module InfinityScheduler/Scripts/SouverainiserPiper
 * @description Dépose les modèles de voix Piper chez data-space et rend le
 *   manifeste des CID.
 *
 *   ── POURQUOI ──
 *   Nous avions quitté Hugging Face pour Chatterbox, en croyant nous en
 *   être affranchis. Mais Piper — qui porte **93 % des tours** (308 sur
 *   330 chaque nuit) — téléchargeait toujours ses modèles depuis
 *   `huggingface.co`. Nous avions libéré les 7 % et laissé les 93 %.
 *
 *   Ces fichiers sont FIGÉS (une release datée, jamais modifiée) : ils
 *   sont donc le cas idéal pour l'adressage par contenu.
 *
 *   Usage : tsx src/scripts/souverainiser-piper.ts [--executer]
 */
import 'dotenv/config'
import { existsSync, mkdirSync, readFileSync, writeFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { dataspacePinFile } from '../lib/dataspace'
import { jetonDataspace } from '../lib/dataspace-jeton'

const HF = 'https://huggingface.co/rhasspy/piper-voices/resolve/v1.0.0'
const DIR = process.env.VOICES_DIR ?? join(process.cwd(), 'voices')

const CHEMINS = [
  'fr/fr_FR/siwis/medium/fr_FR-siwis-medium',
  'fr/fr_FR/gilles/low/fr_FR-gilles-low',
  'es/es_ES/davefx/medium/es_ES-davefx-medium',
  'es/es_ES/sharvard/medium/es_ES-sharvard-medium',
  'ru/ru_RU/dmitri/medium/ru_RU-dmitri-medium',
  'ru/ru_RU/denis/medium/ru_RU-denis-medium',
  'en/en_GB/cori/medium/en_GB-cori-medium',
  'en/en_GB/alba/medium/en_GB-alba-medium',
  'en/en_GB/northern_english_male/medium/en_GB-northern_english_male-medium',
]

async function telecharger(url: string, dest: string): Promise<void> {
  if (existsSync(dest) && statSync(dest).size > 0) return
  const r = await fetch(url, { signal: AbortSignal.timeout(600_000) })
  if (!r.ok) throw new Error(`HTTP ${r.status} sur ${url}`)
  writeFileSync(dest, Buffer.from(await r.arrayBuffer()))
}

async function main() {
  const executer = process.argv.includes('--executer')
  mkdirSync(DIR, { recursive: true })
  const cle = executer ? await jetonDataspace() : ''
  if (executer && !cle) throw new Error('jeton data-space indisponible')

  const manifeste: Record<string, { onnx: string; json: string }> = {}
  for (const chemin of CHEMINS) {
    const id = chemin.split('/').pop()!
    const paires: Array<[string, string]> = [
      [`${HF}/${chemin}.onnx`,      join(DIR, `${id}.onnx`)],
      [`${HF}/${chemin}.onnx.json`, join(DIR, `${id}.onnx.json`)],
    ]
    const cids: string[] = []
    for (const [url, dest] of paires) {
      await telecharger(url, dest)
      const octets = readFileSync(dest)
      if (!executer) { cids.push(`(${(octets.length/1048576).toFixed(1)} Mo)`); continue }
      // 🔴 Reprise sur à-coup. Le 07/09/2026, un 502 de leur passerelle
      // au 9e fichier a fait perdre les HUIT dépôts réussis : le manifeste
      // ne s'écrit qu'à la fin. Un à-coup ne doit pas annuler du travail
      // abouti — d'autant que l'envoi est idempotent (même octets, même
      // CID), donc une reprise ne coûte qu'un peu de bande passante.
      let cid = ''
      for (let essai = 1; essai <= 4; essai++) {
        try {
          cid = (await dataspacePinFile(octets, dest.split('/').pop()!, 'application/octet-stream', cle)).cid
          break
        } catch (err) {
          const m = (err as Error).message
          if (essai === 4) throw err
          console.warn(`    reprise ${essai}/3 — ${m.slice(0, 70)}`)
          await new Promise(r => setTimeout(r, 15_000 * essai))
        }
      }
      cids.push(cid)
    }
    manifeste[id] = { onnx: cids[0], json: cids[1] }
    console.log(`  ${id.padEnd(42)} ${cids[0]}`)
  }
  if (executer) {
    writeFileSync(join(process.cwd(), 'src/data/piper-cids.json'), JSON.stringify(manifeste, null, 2) + '\n')
    console.log('\n  → src/data/piper-cids.json')
  } else {
    console.log('\n  Mode à blanc. Relancer avec --executer.')
  }
}
main().catch(e => { console.error('ECHEC', e.message); process.exit(1) })
