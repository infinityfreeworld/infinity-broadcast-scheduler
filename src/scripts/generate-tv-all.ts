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
 *   🦎 Depuis le 15/09/2026, `tv-main-1` peut déjà porter le Journal de Freeworld TV (workflow
 *   jt-freeworld, 19 h 30 UTC, même d-tag, même clé). Ce canal-là est SAUTÉ quand son programme du
 *   jour est déjà sur les relais, signé par notre clé ; les autres canaux ne changent pas.
 *
 *   Usage :
 *     tsx src/scripts/generate-tv-all.ts [--muet] [--fixture]
 *     TV_AIR_MS=... tsx src/scripts/generate-tv-all.ts
 *     FORCER_REGENERATION=1 tsx src/scripts/generate-tv-all.ts   (refait tv-main-1 quand même)
 *
 *   Variables d'env : cf. generate-tv-program.ts
 */
import 'dotenv/config'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { TV_CHANNELS } from '../data/seed-tv-channels'
import { dTagsPublies } from '../lib/deja-diffuse'
import { getRelays, pubkeyDe } from '../lib/nostr'
import { TV_PROGRAM_KIND, programDTag } from '../lib/tv-nostr'
import { isoDate } from '../lib/tv-assemble'
import { CANAL_JT, raisonDeSauterCanal } from '../lib/jt-freeworld'

const exec = promisify(execFile)

async function main() {
  const muet = process.argv.includes('--muet')
  // Se transmet aux chaînes : éprouver TOUTES les chaînes d'un coup, sans clé
  // de langage et sans rien publier, est le seul moyen de vérifier qu'une
  // chaîne seed nouvellement ajoutée produit bien quelque chose.
  const fixture = process.argv.includes('--fixture')
  const startedAt = Date.now()
  const results: Array<{ id: string; ok: boolean; saute?: boolean; error?: string }> = []

  // ── LE JOURNAL DE FREEWORLD TV N'EST PAS ÉCRASÉ (15/09/2026) ──
  // Publié à 19 h 30 UTC sur `tv-main-1`, sous le d-tag que ce script s'apprête à écrire : le refaire
  // ici le REMPLACERAIT par le JT en images. On regarde donc les relais AVANT de dépenser un jeton.
  // Même date que generate-tv-program (TV_AIR_MS, sinon aujourd'hui UTC), donc même d-tag.
  // Relais illisibles ou clé absente → on produit, comme avant (cf. lib/deja-diffuse).
  // `FORCER_REGENERATION=1` refait quand même (un programme raté qu'on veut remplacer).
  const date = isoDate(Number(process.env.TV_AIR_MS) || Date.parse(new Date().toISOString().slice(0, 10)))
  let deja: Set<string> | null = new Set()
  if (!fixture && process.env.FORCER_REGENERATION !== '1') {
    const cle = process.env.NOSTR_PRIVATE_KEY
    try {
      deja = cle ? await dTagsPublies(TV_PROGRAM_KIND, [programDTag(CANAL_JT, date)], pubkeyDe(cle), getRelays()) : null
    } catch {
      deja = null   // clé illisible : generate-tv-program le dira lui-même, en toutes lettres
    }
    if (deja === null) console.warn(`⚠ impossible de savoir si ${CANAL_JT} est déjà à l'antenne (relais muets ou clé absente) — on produit.`)
  }

  console.log(`\n╔══════════════════════════════════════════════════════════╗`)
  console.log(`║  Infinity TV — ${TV_CHANNELS.length} chaîne(s) à produire${muet ? ' (SANS VOIX)' : ''}${fixture ? ' [FIXTURE, sans publication]' : ''}`)
  console.log(`╚══════════════════════════════════════════════════════════╝`)

  for (const channel of TV_CHANNELS) {
    console.log(`\n────────────────────────────────────────────────────────────`)
    console.log(`▶ ${channel.name} (${channel.id})`)
    console.log(`────────────────────────────────────────────────────────────`)
    const raison = raisonDeSauterCanal(channel.id, date, deja)
    if (raison) {
      console.log(`⏭  sauté : ${raison}.`)
      results.push({ id: channel.id, ok: true, saute: true })
      continue
    }
    try {
      const args = ['tsx', 'src/scripts/generate-tv-program.ts', channel.id]
      if (muet) args.push('--muet')
      if (fixture) args.push('--fixture')
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
  // Un canal sauté est À L'ANTENNE : il compte comme produit.
  const okCount = results.filter(r => r.ok).length
  const sautes = results.filter(r => r.saute).length
  console.log(`\n╔══════════════════════════════════════════════════════════╗`)
  console.log(`║  Résumé TV : ${okCount}/${results.length} OK${sautes ? ` (dont ${sautes} déjà à l'antenne)` : ''} · ${results.length - okCount} échec(s) · ${totalSec}s  ║`)
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
