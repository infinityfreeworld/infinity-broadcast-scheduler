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
import { getChatterboxVoiceForHost } from '../lib/chatterbox'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { SEED_STATIONS } from '../data/seed-stations'
import { fetchHostVoiceMappings, exportHostVoiceMappingsToEnv } from '../lib/host-voice-mappings'
import { fetchHostPersonas, exportHostPersonasToEnv } from '../lib/host-personas'
import { fetchRadioGuests, exportGuestsToEnv } from '../lib/guests'
import { fetchPulse, exportPulseToEnv } from '../lib/pulse'
import { fetchRadioPersonas, exportRadioPersonasToEnv } from '../lib/radio-personas'

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
  // ATTENTION : `||` (pas `??`) — le workflow YAML set `TARGET_DATE: ''` quand
  // le cron déclenche sans workflow_dispatch, ce qui faisait propager une date
  // vide partout (cf bug observé 2026-05-19 : 11 broadcasts publiés sur NOSTR
  // avec `content.date = ""` car nullish coalescing ne fallback pas sur '').
  const targetDate = process.argv[2] || process.env.TARGET_DATE || tomorrowLocalISO()

  console.log(`\n╔══════════════════════════════════════════════════════════╗`)
  console.log(`║  Infinity Broadcast Scheduler — génération pour ${targetDate}  ║`)
  console.log(`║  ${SEED_STATIONS.length} stations seed à traiter               ║`)
  console.log(`╚══════════════════════════════════════════════════════════╝`)

  // ── Auto-purge Pinata (Spring 2026) ──────────────────────────────────
  // Avant chaque run cron, on supprime les broadcasts > J-1 du compte Pinata
  // pour rester sous le quota free tier (1 GB). On garde [hier, aujourd'hui,
  // demain] = 3 jours de retention, suffit pour overlap entre J et J+1
  // + grace period si l'utilisateur reste plusieurs heures sur une page.
  // La purge Pinata a été retirée le 09/09/2026 : nous ne déposons plus
  // que chez data-space. La rétention à 10 jours y est faite par
  // `purger-emissions.ts`, appelé par la nuit — et qui ne supprime QUE ce
  // qu'il reconnaît comme émission, jamais les voix ni les modèles.

  // ── Fetch mappings animateur → voix Chatterbox (Phase C.3) ───────────
  // Publiés sur NOSTR kind:30095 par l'IHL Infinity. On les fetch UNE FOIS
  // au démarrage du parent process, on sérialise dans HOST_VOICE_MAP_JSON,
  // et chaque sous-process generate-broadcast hérite via `env: process.env`.
  // Évite N × round-trips NOSTR (1 par station). Si fetch échoue, on
  // continue avec une map vide → fallback CHATTERBOX_DEFAULT_VOICE.
  if (process.env.CHATTERBOX_TTS_URL) {
    console.log(`\n📨 Fetch mappings animateurs (NOSTR kind:30095)…`)
    const mappings = await fetchHostVoiceMappings()
    exportHostVoiceMappingsToEnv(mappings)
    console.log(`   ✓ ${mappings.size} mapping(s) trouvé(s)${
      mappings.size > 0 ? ' : ' + [...mappings.entries()].slice(0, 5).map(([k, v]) => `${k}→${v}`).join(', ') + (mappings.size > 5 ? ', …' : '') : ''
    }`)
  }

  // ── Fetch personas animateurs (Phase D.4) ────────────────────────────
  // Publiés sur NOSTR kind:30096 par l'IHL Infinity. Contiennent les
  // instructions système enrichies + le ton (warm/aggressive/sad/neutral/
  // adaptive) que l'admin a choisi pour chaque (station, host). Pattern
  // identique aux voix : 1 round-trip parent, env-serialized aux enfants.
  // Fallback : si pas de persona NOSTR pour un host, le scheduler utilise
  // la seed RadioHost (compatibilité ascendante).
  console.log(`\n📨 Fetch personas animateurs (NOSTR kind:30096)…`)
  const personas = await fetchHostPersonas()
  exportHostPersonasToEnv(personas)
  console.log(`   ✓ ${personas.size} persona(s) trouvée(s)${
    personas.size > 0 ? ' : ' + [...personas.values()].slice(0, 5).map(p => `${p.stationId}:${p.hostId}(${p.behavior})`).join(', ') + (personas.size > 5 ? ', …' : '') : ''
  }`)

  // ── Fetch invités personas (Phase H.4) ────────────────────────────────
  // Publiés sur NOSTR kind:30098 par l'IHL « 🎭 Invités ». Pool global
  // cross-stations. Le scheduler choisit 1 guest random par broadcast
  // (parmi `station.guestIds[]` filtré par langue) et l'insère sur 2
  // tours d'intervention au milieu du dialogue.
  console.log(`\n📨 Fetch invités (NOSTR kind:30098)…`)
  const guests = await fetchRadioGuests()
  exportGuestsToEnv(guests)
  console.log(`   ✓ ${guests.size} invité(s) trouvé(s)${
    guests.size > 0 ? ' : ' + [...guests.values()].slice(0, 5).map(g => g.displayName).join(', ') + (guests.size > 5 ? ', …' : '') : ''
  }`)

  // ── Fetch Pulse Pirate (2026-09-01) ──────────────────────────────────
  // kinds 30101 (global) / 30102 (override station) / 30103 (override
  // persona), réglés dans le panneau Pirate › ⚙️ Pulse. Jusqu'ici le
  // scheduler ne les lisait pas : tout ce que l'admin réglait n'avait
  // AUCUN effet sur la génération. Même patron que ci-dessus : un seul
  // aller-retour NOSTR, sérialisé en env pour les sous-processus.
  //
  // Ces kinds étaient aussi REJETÉS par notre propre relais souverain
  // (« blocked: event kind 30101 not allowed ») — corrigé le même jour
  // dans infinity-relay. Sans ce correctif déployé, la récolte reste
  // vide et le scheduler retombe sur les valeurs par défaut.
  console.log(`\n📨 Fetch Pulse (NOSTR kinds:30101/30102/30103)…`)
  const pulse = await fetchPulse(SEED_STATIONS.map(s => s.id))
  exportPulseToEnv(pulse)
  const nbStation = Object.keys(pulse.byStation).length
  const nbPersona = Object.keys(pulse.byPersona).length
  if (pulse.global) {
    console.log(`   ✓ global : ${pulse.global.rhythm.globalMood} · densité ${pulse.global.rhythm.dialogueDensity} · invités ${pulse.global.rhythm.interventionRate} · ${pulse.global.behavior.verbosity}`)
  } else {
    console.log(`   · aucun Pulse global publié → valeurs par défaut (émissions inchangées)`)
  }
  console.log(`   · ${nbStation} override(s) station, ${nbPersona} override(s) persona`)

  // ── Fetch personas unifiées (2026-09-01) ─────────────────────────────
  // kind:30104 + affinages per-station kind:30105. Modèle qui remplace le
  // couple animateur(30096)/invité(30098) : chaque persona déclare
  // elle-même les stations et les rôles qu'elle peut tenir. Le scheduler
  // ne les lisait pas — 7 personas publiées depuis juin 2026 n'avaient
  // jamais pris l'antenne.
  console.log(`\n📨 Fetch personas unifiées (NOSTR kinds:30104/30105)…`)
  const unified = await fetchRadioPersonas(SEED_STATIONS.map(s => s.id))
  exportRadioPersonasToEnv(unified)
  const listePersonas = Object.values(unified.personas)
  console.log(`   ✓ ${listePersonas.length} persona(s) unifiée(s), ${Object.keys(unified.overrides).length} affinage(s) per-station`)
  for (const p of listePersonas) {
    const roles = p.stationRules
      .filter(r => r.canHost || r.canGuest)
      .map(r => `${r.stationId}${r.canHost ? '/anim' : ''}${r.canGuest ? '/invité' : ''}`)
      .join(' ')
    console.log(`      · ${p.displayName} (${p.id})${p.voiceName ? ` voix=${p.voiceName}` : ''} → ${roles}`)
  }

  const startedAt = Date.now()
  const results: Array<{ stationId: string; ok: boolean; error?: string }> = []

  // 🔴 Les stations à voix clonée passent EN TÊTE. Sans ce tri, elles sont
  // dispersées dans l'ordre de la seed et CHACUNE repaie un réveil complet
  // de 35 minutes. Groupées, elles se partagent une seule station chaude.
  // Le tri existait pour la matrice GitHub (`lister-stations.ts`) et n'était
  // pas appliqué ici — un outil écrit puis oublié à l'endroit qui compte.
  const avecGpu = new Set<string>()
  for (const st of SEED_STATIONS) {
    const lg = st.language ?? 'fr'
    const parAnimateur = st.hosts
      .map(h => getChatterboxVoiceForHost(st.id, h.id, lg))
      .find((v): v is string => !!v)
    if (parAnimateur) avecGpu.add(st.id)
  }
  const ordreNuit = [
    ...SEED_STATIONS.filter(s => avecGpu.has(s.id)),
    ...SEED_STATIONS.filter(s => !avecGpu.has(s.id)),
  ]
  if (avecGpu.size > 0) {
    console.log(`\n🎭 ${avecGpu.size} station(s) à voix clonée passent en tête : `
      + `${[...avecGpu].join(', ')}`)
  }

  // Instant absolu au-delà duquel PLUS AUCUNE station n'attend le GPU.
  // Une échéance par station borne une station, pas la nuit.
  const budgetNuitMin = Number.parseInt(process.env.CHATTERBOX_NUIT_MINUTES ?? '150', 10)
  process.env.CHATTERBOX_FIN_NUIT = String(Date.now() + budgetNuitMin * 60_000)
  console.log(`⏳ voix clonées jusqu'à ${new Date(Number(process.env.CHATTERBOX_FIN_NUIT))
    .toLocaleTimeString('fr-FR')} — ensuite, tout en synthèse locale.`)

  for (const station of ordreNuit) {
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
