#!/usr/bin/env tsx
/** Diagnostic : publish event broadcast RÉALISTE sur CF + query immédiat */
import 'dotenv/config'
import { SimplePool } from 'nostr-tools/pool'
import { finalizeEvent, getPublicKey } from 'nostr-tools/pure'
import { hexToBytes } from '@noble/hashes/utils'

const CF_RELAY = 'wss://infinity-radio-relay.digitalforlifeagency.workers.dev'

async function main() {
  const sk = hexToBytes(process.env.NOSTR_PRIVATE_KEY!)
  const pubkey = getPublicKey(sk)
  console.log(`pubkey: ${pubkey}`)

  // Event réaliste comme un broadcast (kind 30093, d-tag complet, content JSON)
  const stationId = 'test-station'
  const date = '2026-05-07'
  const event = finalizeEvent({
    kind: 30093,
    created_at: Math.floor(Date.now() / 1000),
    tags: [
      ['d', `${stationId}:${date}`],
      ['station', stationId],
      ['date', date],
      ['lang', 'fr'],
      ['duration', '1800'],
      ['t', 'radio-broadcast'],
      ['visibility', 'public'],
    ],
    content: JSON.stringify({
      stationId, date, language: 'fr', durationSec: 1800,
      audioCid: 'bafybeitestcidtestcidtestcidtestcidtestcidtestcidtestcid',
      audioMime: 'audio/ogg',
      turns: [{ id: 't1', hostId: 'test', hostName: 'Test', color: '#fff', avatar: '🎤', text: 'Hello world test broadcast realistic content', tStart: 0, tEnd: 5 }],
      newsRefs: [],
      model: 'claude-haiku-4-5-20251001',
      generatedAt: Math.floor(Date.now() / 1000),
    }),
  }, sk)

  console.log(`Event id: ${event.id}, content size: ${event.content.length} bytes\n`)

  const pool = new SimplePool()

  console.log('=== Publish on CF ===')
  const results = await Promise.allSettled(pool.publish([CF_RELAY], event))
  results.forEach(r => {
    if (r.status === 'fulfilled') console.log(`✓ ${CF_RELAY}: "${r.value}"`)
    else console.log(`✗ ${CF_RELAY}: ${r.reason?.message ?? r.reason}`)
  })

  console.log('\n=== Wait 3s + Query back ===')
  await new Promise(r => setTimeout(r, 3000))

  const events = await pool.querySync([CF_RELAY], { kinds: [30093], limit: 100 })
  console.log(`Total events kind 30093 sur CF : ${events.length}`)
  events.forEach(e => {
    const d = e.tags.find(t => t[0] === 'd')?.[1] ?? '(no d)'
    console.log(`  ${e.id.slice(0, 12)}… d="${d}"`)
  })

  pool.close([CF_RELAY])
}
main().catch(err => { console.error('FATAL:', err); process.exit(1) })
