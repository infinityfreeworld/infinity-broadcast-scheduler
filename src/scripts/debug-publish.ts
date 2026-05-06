#!/usr/bin/env tsx
/** Debug : publie un event kind:30093 minimal et voit lesquels relays acceptent vraiment. */
import 'dotenv/config'
import { SimplePool } from 'nostr-tools/pool'
import { finalizeEvent, getPublicKey } from 'nostr-tools/pure'
import { hexToBytes } from '@noble/hashes/utils'
import { getRelays } from '../lib/nostr'

async function main() {
  const sk = hexToBytes(process.env.NOSTR_PRIVATE_KEY!)
  const pubkey = getPublicKey(sk)
  console.log(`pubkey: ${pubkey}`)
  const relays = getRelays()
  console.log(`relays (${relays.length}):`, relays)

  const event = finalizeEvent({
    kind: 30093,
    created_at: Math.floor(Date.now() / 1000),
    tags: [['d', 'debug-test-' + Date.now()], ['t', 'debug-test']],
    content: 'test debug publish',
  }, sk)
  console.log(`Test event id: ${event.id}`)

  const pool = new SimplePool()
  const promises = pool.publish(relays, event)
  console.log('publish() returned, awaiting per-relay results...\n')

  const results = await Promise.allSettled(promises)
  results.forEach((r, i) => {
    if (r.status === 'fulfilled') console.log(`✓ ${relays[i]}: ${r.value}`)
    else console.log(`✗ ${relays[i]}: ${r.reason?.message ?? r.reason}`)
  })

  console.log('\n--- Waiting 5s for propagation ---')
  await new Promise(r => setTimeout(r, 5000))

  console.log('\n--- Querying back ---')
  const events = await pool.querySync(relays, {
    kinds: [30093],
    authors: [pubkey],
    limit: 50,
  })
  console.log(`Retrieved ${events.length} events from query`)
  if (events.length > 0) {
    console.log('IDs:', events.slice(0, 5).map(e => e.id.slice(0, 12)))
  }

  pool.close(relays)
}
main().catch(e => { console.error('FATAL:', e); process.exit(1) })
