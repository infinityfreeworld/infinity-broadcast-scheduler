#!/usr/bin/env tsx
/**
 * @module InfinityScheduler/Scripts/BulkAssignVoices
 * @description One-shot script (2026-05-20) — publie une voix Chatterbox
 *   par défaut pour CHAQUE (station, host) seed sur NOSTR (kind:30095).
 *
 *   Permet de seeder les mappings d'un coup au lieu de demander à l'admin
 *   de cliquer 30+ dropdowns dans l'IHL. Voix attribuées en rotation,
 *   filtrées par genre du host.
 *
 *   Idempotent : kind:30095 est parameterized replaceable (d-tag =
 *   `<stationId>:<hostId>`), donc re-run écrase les mappings précédents.
 *   L'admin peut toujours override depuis l'IHL ensuite (sa pubkey
 *   différente est sans effet — le scheduler fetch TOUS les events
 *   30095 et garde le plus récent par d-tag).
 *
 *   Usage :
 *     tsx src/scripts/bulk-assign-voices.ts
 *
 *   Variables requises (depuis .env) :
 *     - NOSTR_PRIVATE_KEY : clé hex 64 chars
 *     - NOSTR_RELAYS      : (optionnel) liste relays virgule-séparés
 */

import 'dotenv/config'
import { SimplePool } from 'nostr-tools/pool'
import { finalizeEvent, getPublicKey } from 'nostr-tools/pure'
import { hexToBytes } from '@noble/hashes/utils'
import { SEED_STATIONS } from '../data/seed-stations'
import { getRelays } from '../lib/nostr'
import { KIND_HOST_VOICE_MAPPING } from '../lib/host-voice-mappings'

// Voix Chatterbox disponibles par défaut (devnen/chatterbox-tts-server).
// Genres approximés depuis les prénoms anglo-saxons usuels.
const FEMALE_VOICES = [
  'Abigail', 'Alice', 'Cora', 'Elena', 'Emily', 'Gianna', 'Jade', 'Layla',
]
const MALE_VOICES = [
  'Adrian', 'Alexander', 'Austin', 'Axel', 'Connor', 'Eli', 'Everett',
  'Gabriel', 'Henry', 'Ian', 'Jeremiah', 'Jordan', 'Julian', 'Leonardo',
  'Michael', 'Miles',
]
const NEUTRAL_VOICES = [...FEMALE_VOICES, ...MALE_VOICES]

function pickVoice(gender: 'male' | 'female' | 'androgyn', idx: number): string {
  const pool = gender === 'female'
    ? FEMALE_VOICES
    : gender === 'male'
      ? MALE_VOICES
      : NEUTRAL_VOICES
  return pool[idx % pool.length]
}

async function main(): Promise<void> {
  const privHex = process.env.NOSTR_PRIVATE_KEY
  if (!privHex || privHex.length !== 64) {
    console.error('❌ NOSTR_PRIVATE_KEY manquant ou pas 64 chars hex')
    process.exit(1)
  }
  const sk = hexToBytes(privHex)
  const pubkey = getPublicKey(sk)
  const relays = getRelays()
  console.log(`📨 Publish kind:${KIND_HOST_VOICE_MAPPING} signé par ${pubkey.slice(0, 12)}…`)
  console.log(`📡 Relays : ${relays.join(', ')}\n`)

  const pool = new SimplePool()
  let femaleIdx = 0
  let maleIdx = 0
  let neutralIdx = 0
  let okCount = 0
  let failCount = 0

  for (const station of SEED_STATIONS) {
    console.log(`▶ ${station.frequency.toFixed(1)} ${station.name}`)
    for (const host of station.hosts) {
      const idx = host.gender === 'female'
        ? femaleIdx++
        : host.gender === 'male'
          ? maleIdx++
          : neutralIdx++
      const voice = pickVoice(host.gender, idx)
      const dTag = `${station.id}:${host.id}`
      const updatedAt = Date.now()
      const event = finalizeEvent({
        kind:       KIND_HOST_VOICE_MAPPING,
        created_at: Math.floor(updatedAt / 1000),
        tags: [
          ['d',       dTag],
          ['station', station.id],
          ['host',    host.id],
          ['voice',   voice],
          ['lang',    station.language ?? 'fr'],
        ],
        content: JSON.stringify({
          stationId: station.id,
          hostId:    host.id,
          voiceName: voice,
          language:  station.language ?? 'fr',
          updatedAt,
        }),
      }, sk)

      try {
        const results = await Promise.allSettled(pool.publish(relays, event))
        const okRelays = results.filter(r =>
          r.status === 'fulfilled'
          && typeof r.value === 'string'
          && !r.value.toLowerCase().startsWith('connection')
          && !r.value.toLowerCase().includes('failed'),
        ).length
        if (okRelays > 0) {
          okCount++
          console.log(`   ✓ ${host.avatar} ${host.name.padEnd(10)} (${host.gender.padEnd(8)}) → ${voice} [${okRelays}/${relays.length} relays]`)
        } else {
          failCount++
          console.log(`   ✗ ${host.name} : 0 relay acceptant`)
        }
      } catch (err) {
        failCount++
        console.log(`   ✗ ${host.name} : ${err instanceof Error ? err.message : err}`)
      }
    }
  }

  pool.close(relays)
  console.log(`\n╔════════════════════════════════════════════════╗`)
  console.log(`║  ${okCount} mapping(s) publié(s) · ${failCount} échec(s)`)
  console.log(`╚════════════════════════════════════════════════╝`)
}

main().catch(err => {
  console.error('❌ Échec :', err)
  process.exit(1)
})
