#!/usr/bin/env tsx
/**
 * @module InfinityScheduler/TV/GenerateAll
 * @description Génère le programme du jour pour TOUTES les chaînes TV seed.
 *   Même patron que la radio (`generate-all.ts`) : une chaîne après l'autre,
 *   dans un sous-processus isolé, et un échec n'emporte pas les suivantes.
 *
 *   Séquentiel de bout en bout, délibérément : chaque chaîne fait générer
 *   plusieurs images puis un montage ffmpeg à la forge. Les lancer en parallèle
 *   mettrait la file de la forge à genoux et, quand la vidéo animée arrivera,
 *   réveillerait plusieurs stations GPU à la fois — exactement ce que les
 *   plafonds de dépense interdisent.
 *
 *   Usage :
 *     tsx src/scripts/generate-tv-all.ts [--muet]
 *     TV_AIR_MS=... tsx src/scripts/generate-tv-all.ts
 *
 *   Variables d'env : cf. generate-tv-program.ts
 */
import 'dotenv/config'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { TV_CHANNELS } from '../data/seed-tv-channels'

const exec = promisify(execFile)

async function main() {
  const muet = process.argv.includes('--muet')
  const startedAt = Date.now()
  const results: Array<{ id: string; ok: boolean; error?: string }> = []

  console.log(`\n╔══════════════════════════════════════════════════════════╗`)
  console.log(`║  Infinity TV — ${TV_CHANNELS.length} chaîne(s) à produire${muet ? ' (SANS VOIX)' : ''}`)
  console.log(`╚══════════════════════════════════════════════════════════╝`)

  for (const channel of TV_CHANNELS) {
    console.log(`\n────────────────────────────────────────────────────────────`)
    console.log(`▶ ${channel.name} (${channel.id})`)
    console.log(`────────────────────────────────────────────────────────────`)
    try {
      const args = ['tsx', 'src/scripts/generate-tv-program.ts', channel.id]
      if (muet) args.push('--muet')
      const { stdout, stderr } = await exec('npx', args, {
        env: process.env,
        maxBuffer: 50 * 1024 * 1024,
      })
      if (stdout) process.stdout.write(stdout)
      if (stderr) process.stderr.write(stderr)
      results.push({ id: channel.id, ok: true })
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      console.error(`✗ ${channel.id} : ${msg}`)
      results.push({ id: channel.id, ok: false, error: msg })
    }
  }

  const totalSec = ((Date.now() - startedAt) / 1000).toFixed(0)
  const okCount = results.filter(r => r.ok).length
  console.log(`\n╔══════════════════════════════════════════════════════════╗`)
  console.log(`║  Résumé TV : ${okCount}/${results.length} OK · ${results.length - okCount} échec(s) · ${totalSec}s  ║`)
  console.log(`╚══════════════════════════════════════════════════════════╝`)
  for (const r of results.filter(r => !r.ok)) {
    console.log(`  - ${r.id}: ${r.error?.split('\n')[0] ?? '(sans message)'}`)
  }

  // Une chaîne muette ce soir n'est pas une panne du service ; zéro chaîne
  // produite en est une.
  if (okCount === 0) {
    console.error('\n❌ Aucune chaîne produite.')
    process.exit(1)
  }
}

main().catch(err => {
  console.error('\n❌ Erreur fatale :', err)
  process.exit(1)
})
