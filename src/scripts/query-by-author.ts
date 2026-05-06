#!/usr/bin/env tsx
/** Diagnostic : query CF par author pour voir TOUS les events */
import { SimplePool } from 'nostr-tools/pool'

const CF = 'wss://infinity-radio-relay.digitalforlifeagency.workers.dev'
const SCHEDULER_PUBKEY = '9a8098f002e03b14260cdced2a18e4068678880814f96ebb46ce7d1993bcbecd'

async function main() {
  const pool = new SimplePool()
  const evts = await pool.querySync([CF], { authors: [SCHEDULER_PUBKEY], limit: 200 })
  console.log(`Events by scheduler pubkey: ${evts.length}`)
  evts.forEach(e => {
    const d = e.tags.find(t => t[0] === 'd')?.[1] ?? '(no d)'
    console.log(`  ${e.id.slice(0,12)}… kind=${e.kind} d="${d}" created=${new Date(e.created_at*1000).toISOString()}`)
  })

  console.log('\n--- Tous events kind:30093 quel que soit l\'author ---')
  const evts2 = await pool.querySync([CF], { kinds: [30093], limit: 200 })
  console.log(`Total: ${evts2.length}`)
  evts2.forEach(e => {
    const d = e.tags.find(t => t[0] === 'd')?.[1] ?? '(no d)'
    console.log(`  ${e.id.slice(0,12)}… author=${e.pubkey.slice(0,12)}… d="${d}"`)
  })

  pool.close([CF])
}
main().catch(err => { console.error('FATAL:', err); process.exit(1) })
