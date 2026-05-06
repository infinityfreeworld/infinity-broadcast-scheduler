/**
 * @module InfinityScheduler/Nostr
 * @description Publish d'events NOSTR depuis Node via nostr-tools.
 *
 *   Le scheduler publie 1 event par broadcast (kind 30093 RADIO_BROADCAST,
 *   parameterized replaceable, d-tag = `${stationId}:${date}`).
 *
 *   Relays : liste curatée des plus stables (overridable via env).
 *   On publie sur TOUS pour redondance ; on accepte si AU MOINS 1 OK.
 */

import { finalizeEvent, getPublicKey } from 'nostr-tools/pure'
import { SimplePool } from 'nostr-tools/pool'
import { hexToBytes } from '@noble/hashes/utils'
import type { RadioBroadcast } from './types'

export const RADIO_BROADCAST_KIND = 30093

const DEFAULT_RELAYS = [
  // Spring 2026 — Relay perso Cloudflare (rétention permanente kind:30093)
  // Avant : les events kind custom étaient purgés rapidement par les relais
  // publics (~quelques heures). Ce relay garde tout définitivement via D1.
  'wss://infinity-radio-relay.digitalforlifeagency.workers.dev',
  // Relais publics : redondance + découvrabilité (les bots/clients qui
  // suivent les pubkey Infinity peuvent voir les events publiés ici aussi).
  'wss://relay.damus.io',
  'wss://nos.lol',
  'wss://relay.snort.social',
  'wss://relay.nostr.band',
  'wss://nostr.mom',
  'wss://relay.primal.net',
]

export function getRelays(): string[] {
  const fromEnv = process.env.NOSTR_RELAYS
  if (fromEnv) return fromEnv.split(',').map(s => s.trim()).filter(Boolean)
  return DEFAULT_RELAYS
}

/** Construit le d-tag d'un broadcast (= clé replaceable). */
export function broadcastDTag(stationId: string, date: string): string {
  return `${stationId}:${date}`
}

/**
 * Publie un broadcast NOSTR sur tous les relays. Renvoie le pubkey utilisé
 * pour signer (utile pour mettre à jour broadcast.generatedBy avant de
 * sérialiser le contenu).
 *
 * @param broadcast Broadcast complet (avec audioCid déjà uploadé sur IPFS)
 * @param privKeyHex  Clé privée hex 64 chars (env NOSTR_PRIVATE_KEY)
 */
export async function publishBroadcast(
  broadcast: RadioBroadcast,
  privKeyHex: string,
): Promise<{ pubkey: string; eventId: string; relays: { url: string; ok: boolean; reason?: string }[] }> {
  const sk = hexToBytes(privKeyHex)
  const pubkey = getPublicKey(sk)

  // Met à jour generatedBy avec le pubkey effectif (au cas où)
  const finalBroadcast = { ...broadcast, generatedBy: pubkey }

  const eventTpl = {
    kind:       RADIO_BROADCAST_KIND,
    created_at: Math.floor(Date.now() / 1000),
    tags: [
      ['d',          broadcastDTag(finalBroadcast.stationId, finalBroadcast.date)],
      ['station',    finalBroadcast.stationId],
      ['date',       finalBroadcast.date],
      ['lang',       finalBroadcast.language],
      ['duration',   String(Math.round(finalBroadcast.durationSec))],
      ['t',          'radio-broadcast'],
      ['visibility', 'public'],
    ],
    content: JSON.stringify({
      stationId:   finalBroadcast.stationId,
      date:        finalBroadcast.date,
      language:    finalBroadcast.language,
      durationSec: finalBroadcast.durationSec,
      audioCid:    finalBroadcast.audioCid,
      audioMime:   finalBroadcast.audioMime,
      turns:       finalBroadcast.turns,
      newsRefs:    finalBroadcast.newsRefs,
      model:       finalBroadcast.model,
      generatedAt: finalBroadcast.generatedAt,
    }),
  }

  const signed = finalizeEvent(eventTpl, sk)
  const relays = getRelays()
  const pool = new SimplePool()

  const results = await Promise.allSettled(pool.publish(relays, signed))
  // nostr-tools' pool.publish returns "connection failure: …" as a fulfilled
  // string when ensureRelay() fails (it does NOT reject). Si on se contente de
  // r.status === 'fulfilled' on a un faux positif. Un vrai OK est le reason
  // renvoyé par le relay (ex: "Event saved successfully" ou ""), donc on rejette
  // explicitement les valeurs qui commencent par "connection failure".
  const summary = results.map((r, i) => {
    const url = relays[i]
    if (r.status === 'rejected') {
      return { url, ok: false, reason: String(r.reason?.message ?? r.reason) }
    }
    const value = String(r.value ?? '')
    if (value.startsWith('connection failure')) {
      return { url, ok: false, reason: value }
    }
    return { url, ok: true, reason: value || 'ok' }
  })

  pool.close(relays)

  if (!summary.some(s => s.ok)) {
    throw new Error(`Tous les relays ont rejeté le publish:\n${summary.map(s => `- ${s.url}: ${s.reason}`).join('\n')}`)
  }

  return { pubkey, eventId: signed.id, relays: summary }
}

/** Helper : génère une nouvelle clé privée hex (pour le setup initial). */
export function generatePrivateKey(): string {
  const arr = crypto.getRandomValues(new Uint8Array(32))
  return Array.from(arr).map(b => b.toString(16).padStart(2, '0')).join('')
}
