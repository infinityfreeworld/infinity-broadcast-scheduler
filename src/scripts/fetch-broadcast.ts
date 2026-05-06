#!/usr/bin/env tsx
/**
 * @module InfinityScheduler/Scripts/FetchBroadcast
 * @description Récupère un broadcast NOSTR (kind:30093) et imprime les
 *   tours du dialogue en clair, pour analyse de qualité éditoriale sans
 *   devoir écouter le WAV.
 *
 *   Usage :
 *     tsx src/scripts/fetch-broadcast.ts <stationId> [YYYY-MM-DD]
 *
 *   Exemples :
 *     tsx src/scripts/fetch-broadcast.ts pirate-radio
 *     tsx src/scripts/fetch-broadcast.ts wtf-radio 2026-05-06
 *
 *   Si la date est omise, prend J+1 (cohérent avec le cron).
 *   Le pubkey est dérivé de NOSTR_PRIVATE_KEY (.env).
 */

import 'dotenv/config'
import { SimplePool } from 'nostr-tools/pool'
import { getPublicKey } from 'nostr-tools/pure'
import { hexToBytes } from '@noble/hashes/utils'
import { getRelays, RADIO_BROADCAST_KIND, broadcastDTag } from '../lib/nostr'
import type { BroadcastTurn } from '../lib/types'

interface BroadcastContent {
  stationId:   string
  date:        string
  language:    string
  durationSec: number
  audioCid:    string
  audioMime:   string
  turns:       BroadcastTurn[]
  newsRefs:    string[]
  model:       string
  generatedAt: number
}

function tomorrowLocalISO(): string {
  const d = new Date()
  d.setDate(d.getDate() + 1)
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const dd = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${dd}`
}

async function main(): Promise<void> {
  const stationId = process.argv[2]
  if (!stationId) {
    console.error('Usage : tsx src/scripts/fetch-broadcast.ts <stationId|--list> [YYYY-MM-DD]')
    console.error('  --list : liste tous les broadcasts publiés par ce pubkey')
    process.exit(1)
  }

  const privKey = process.env.NOSTR_PRIVATE_KEY
  if (!privKey) {
    console.error('❌ NOSTR_PRIVATE_KEY manquante dans .env')
    process.exit(1)
  }
  const pubkey = getPublicKey(hexToBytes(privKey))
  const relays = getRelays()
  const pool = new SimplePool()

  // Mode --list : liste tous les broadcasts du pubkey, ne dépend pas du d-tag.
  if (stationId === '--list') {
    console.error(`🔍 Liste des broadcasts (kind:30093, author=${pubkey.slice(0, 12)}…)\n`)
    const events = await pool.querySync(relays, {
      kinds:   [RADIO_BROADCAST_KIND],
      authors: [pubkey],
      limit:   50,
    })
    pool.close(relays)
    events.sort((a, b) => b.created_at - a.created_at)
    for (const e of events) {
      const dTag = e.tags.find(t => t[0] === 'd')?.[1] ?? '(none)'
      const station = e.tags.find(t => t[0] === 'station')?.[1] ?? '?'
      const date = e.tags.find(t => t[0] === 'date')?.[1] ?? '?'
      const dur = e.tags.find(t => t[0] === 'duration')?.[1] ?? '?'
      const created = new Date(e.created_at * 1000).toISOString()
      console.log(`${e.id.slice(0, 12)}… station=${station.padEnd(15)} date="${date}" d-tag="${dTag}" durée=${dur}s ${created}`)
    }
    console.error(`\n${events.length} event(s) trouvés.`)
    return
  }

  const date = process.argv[3] ?? tomorrowLocalISO()
  const dTag = broadcastDTag(stationId, date)

  console.error(`🔍 Recherche broadcast ${stationId}:${date}`)
  console.error(`   pubkey : ${pubkey.slice(0, 12)}…`)
  console.error(`   d-tag  : ${dTag}`)
  console.error(`   relays : ${relays.length}\n`)

  // Tente d'abord avec le d-tag classique, puis fallback sur recherche
  // station+author si pas trouvé (utile pour les broadcasts avec d-tag tronqué).
  let event = await pool.get(relays, {
    kinds:   [RADIO_BROADCAST_KIND],
    authors: [pubkey],
    '#d':    [dTag],
  })

  if (!event) {
    console.error(`⚠️  Pas trouvé avec d-tag "${dTag}", tentative par station tag…`)
    const candidates = await pool.querySync(relays, {
      kinds:   [RADIO_BROADCAST_KIND],
      authors: [pubkey],
      '#station': [stationId],
      limit:   10,
    })
    candidates.sort((a, b) => b.created_at - a.created_at)
    event = candidates[0] ?? null
    if (event) {
      const foundDTag = event.tags.find(t => t[0] === 'd')?.[1]
      console.error(`✓ Trouvé event ${event.id.slice(0, 12)}… avec d-tag réel "${foundDTag}"\n`)
    }
  }

  pool.close(relays)

  if (!event) {
    console.error(`❌ Aucun event trouvé pour station=${stationId}`)
    process.exit(1)
  }

  const content = JSON.parse(event.content) as BroadcastContent

  // Imprime un rapport synthétique stdout
  console.log(`\n# ${content.stationId.toUpperCase()} — ${content.date}`)
  console.log(`Audio : https://gateway.pinata.cloud/ipfs/${content.audioCid}`)
  console.log(`Durée : ${(content.durationSec / 60).toFixed(1)} min · ${content.turns.length} tours`)
  console.log(`Model : ${content.model} · publié ${new Date(content.generatedAt * 1000).toISOString()}`)
  if (content.newsRefs.length > 0) {
    console.log(`\nSources actu utilisées : ${content.newsRefs.length}`)
    for (const ref of content.newsRefs.slice(0, 5)) console.log(`  - ${ref}`)
    if (content.newsRefs.length > 5) console.log(`  ... +${content.newsRefs.length - 5} autres`)
  }
  console.log('\n---\n')

  for (let i = 0; i < content.turns.length; i++) {
    const t = content.turns[i]
    console.log(`## [${i + 1}/${content.turns.length}] ${t.hostName} (${(t.tStart).toFixed(1)}s → ${(t.tEnd).toFixed(1)}s)`)
    console.log(t.text)
    console.log()
  }
}

main().catch(err => {
  console.error('\n❌ Échec :', err instanceof Error ? err.message : err)
  process.exit(1)
})
