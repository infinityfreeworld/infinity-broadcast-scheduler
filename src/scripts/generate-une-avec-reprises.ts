#!/usr/bin/env tsx
/**
 * @module InfinityScheduler/Scripts/GenerateUneAvecReprises
 * @description Une station, plusieurs passages, dans UN job GitHub (lib/reprises-job.ts explique
 *   pourquoi). Chaque passage est un `generate-broadcast.ts` dans un sous-processus — exactement ce que
 *   faisait `npm run generate:one` — ; seuls les passages REPORTABLES posent `RADIO_DERNIERE_CHANCE=0`.
 *   Le chantier (tours déjà faits) reste sur le disque du job : une reprise ne refait que les tours
 *   manquants, jamais l'écriture.
 *
 *   Usage : tsx src/scripts/generate-une-avec-reprises.ts <stationId> [YYYY-MM-DD]
 *   Sortie : 0 publiée · 76 veille gardée · 75 encore à reprendre · autre = échec.
 */
import { spawn } from 'node:child_process'
import { apresPassage, passageFinal, reglagesReprisesJob } from '../lib/reprises-job'

function passage(args: string[], final: boolean): Promise<number> {
  return new Promise(resolve => {
    const enfant = spawn('npx', ['tsx', 'src/scripts/generate-broadcast.ts', ...args], {
      stdio: 'inherit',
      env: { ...process.env, RADIO_DERNIERE_CHANCE: final ? '1' : '0' },
    })
    enfant.on('exit', (code, signal) => resolve(code ?? (signal ? 1 : 0)))
    enfant.on('error', () => resolve(1))
  })
}

async function main(): Promise<number> {
  const args = process.argv.slice(2)
  if (!args[0]) {
    console.error('Usage: tsx src/scripts/generate-une-avec-reprises.ts <stationId> [YYYY-MM-DD]')
    return 1
  }
  const r = reglagesReprisesJob()
  const debut = Date.now()
  for (let passe = 1; ; passe++) {
    const final = passageFinal(passe, Date.now(), debut, r)
    console.log(`\n🔁 ${args[0]} — passage ${passe}/${r.maxPasses}${final ? ' · DERNIÈRE CHANCE (règle de publication finale)' : ' · reportable'}`)
    const code = await passage(args, final)
    const suite = apresPassage(code, final, Date.now(), debut, r)
    if (suite.suite === 'fin') {
      console.log(`🔁 ${args[0]} : ${suite.issue} au passage ${passe} (code ${suite.code})`)
      if (suite.issue === 'veille-gardee' && process.env.GITHUB_ACTIONS) {
        console.log(`::warning::${args[0]} : non publiée (voix de repli au dernier passage) — l'émission précédente reste à l'antenne`)
      }
      return suite.code
    }
    console.log(`⏸  ${args[0]} : passage ${passe} reporté (code ${code}) — reprise dans ${Math.round(suite.pauseMs / 60_000)} min`)
    if (suite.pauseMs > 0) await new Promise(res => setTimeout(res, suite.pauseMs))
  }
}

main().then(code => process.exit(code), err => { console.error(err); process.exit(1) })
