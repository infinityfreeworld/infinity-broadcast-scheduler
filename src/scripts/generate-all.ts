#!/usr/bin/env tsx
/**
 * @module InfinityScheduler/Scripts/GenerateAll
 * @description Boucle sur toutes les stations seed et génère le broadcast
 *   du lendemain pour chacune. Tourne séquentiellement (1 station après
 *   l'autre) pour ne pas saturer Anthropic + Pinata.
 *
 *   Robustesse : si une station échoue, on log l'erreur et on continue
 *   avec les suivantes. Le job CI n'échoue que si TOUTES échouent.
 *
 *   Usage :
 *     tsx src/scripts/generate-all.ts [YYYY-MM-DD]
 *
 *   Variables d'env : cf. generate-broadcast.ts
 */

import 'dotenv/config'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { SEED_STATIONS } from '../data/seed-stations'

const exec = promisify(execFile)

function tomorrowLocalISO(): string {
  const d = new Date()
  d.setDate(d.getDate() + 1)
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const dd = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${dd}`
}

async function main() {
  const targetDate = process.argv[2] ?? process.env.TARGET_DATE ?? tomorrowLocalISO()

  console.log(`\n╔══════════════════════════════════════════════════════════╗`)
  console.log(`║  Infinity Broadcast Scheduler — génération pour ${targetDate}  ║`)
  console.log(`║  ${SEED_STATIONS.length} stations seed à traiter               ║`)
  console.log(`╚══════════════════════════════════════════════════════════╝`)

  const startedAt = Date.now()
  const results: Array<{ stationId: string; ok: boolean; error?: string }> = []

  for (const station of SEED_STATIONS) {
    console.log(`\n────────────────────────────────────────────────────────────`)
    console.log(`▶ ${station.name} (${station.id})`)
    console.log(`────────────────────────────────────────────────────────────`)
    try {
      // On fork un sous-process tsx pour isoler les générations
      // (chaque station = process clean, pas de fuite de state Piper).
      const { stdout, stderr } = await exec(
        'npx',
        ['tsx', 'src/scripts/generate-broadcast.ts', station.id, targetDate],
        { env: process.env, maxBuffer: 50 * 1024 * 1024 },   // 50 MB output max
      )
      if (stdout) process.stdout.write(stdout)
      if (stderr) process.stderr.write(stderr)
      results.push({ stationId: station.id, ok: true })
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      console.error(`✗ ${station.id} : ${msg}`)
      results.push({ stationId: station.id, ok: false, error: msg })
    }
  }

  const totalSec = ((Date.now() - startedAt) / 1000).toFixed(0)
  const okCount = results.filter(r => r.ok).length
  const failCount = results.length - okCount

  console.log(`\n╔══════════════════════════════════════════════════════════╗`)
  console.log(`║  Résumé : ${okCount}/${results.length} OK · ${failCount} échec(s) · ${totalSec}s wall time  ║`)
  console.log(`╚══════════════════════════════════════════════════════════╝`)

  if (failCount > 0) {
    console.log('\nÉchecs :')
    for (const r of results.filter(r => !r.ok)) {
      console.log(`  - ${r.stationId}: ${r.error?.split('\n')[0] ?? '(no message)'}`)
    }
  }

  if (okCount === 0) {
    console.error('\n❌ Toutes les stations ont échoué.')
    process.exit(1)
  }
}

main().catch(err => {
  console.error('\n❌ Erreur fatale :', err)
  process.exit(1)
})
