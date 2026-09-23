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
  // Relais SOUVERAINS de data-space (22/09/2026) : le relais Cloudflare ci-dessus est le seul
  // que l'application lit, et jusqu'ici le seul à garder nos émissions. Une copie chez
  // data-space rend la mémoire de la radio indépendante de Cloudflare. Ces relais sont ceux que
  // l'application interroge déjà pour le reste (VITE_DATASPACE_PUBLIC_RELAYS).
  'wss://data-space.world/r/relais-public-1',
  'wss://data-space.world/r/relais-public-2',
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

/** Ce que rend une publication : qui a signé, l'identifiant, et la réponse de chaque relais. */
export interface BilanPublication {
  pubkey:  string
  eventId: string
  relays:  { url: string; ok: boolean; reason?: string }[]
}

/**
 * Signe et publie UN évènement sur tous les relais ; réussit si AU MOINS un relais l'a accepté.
 * Même filtrage du faux positif « connection failure » que `publishBroadcast` (cf. plus bas). Sert au
 * programme TV (kind 30184) et à la commande du Journal de Freeworld TV (kind 30078).
 */
export async function publierEvenement(
  template: { kind: number; created_at: number; tags: string[][]; content: string },
  privKeyHex: string,
): Promise<BilanPublication> {
  const signed = finalizeEvent(template, hexToBytes(privKeyHex))
  const relays = getRelays()
  const pool = new SimplePool()

  const results = await Promise.allSettled(pool.publish(relays, signed))
  const summary = results.map((r, i) => {
    const url = relays[i]
    if (r.status === 'rejected') return { url, ok: false, reason: String(r.reason?.message ?? r.reason) }
    const value = String(r.value ?? '')
    if (value.startsWith('connection failure')) return { url, ok: false, reason: value }
    return { url, ok: true, reason: value || 'ok' }
  })
  pool.close(relays)

  if (!summary.some(s => s.ok)) {
    throw new Error(`Tous les relays ont rejeté le publish:\n${summary.map(s => `- ${s.url}: ${s.reason}`).join('\n')}`)
  }
  return { pubkey: signed.pubkey, eventId: signed.id, relays: summary }
}

/** Construit le d-tag d'un broadcast (= clé replaceable). */
/** Clé publique hex d'une clé privée hex (sert à reconnaître NOS émissions sur les relais). */
export function pubkeyDe(privKeyHex: string): string {
  return getPublicKey(hexToBytes(privKeyHex))
}

/**
 * Les relais DURABLES : ceux dont l'absence rend l'émission inaudible — le relais Cloudflare
 * (le seul lu explicitement par l'application, rétention permanente) et ceux de data-space.
 * Les relais publics ne sont que de la redondance ; un échec chez eux ne se retente pas.
 */
export function estRelaisDurable(url: string): boolean {
  const u = url.replace(/\/+$/, '')
  return u.includes('infinity-radio-relay') || u.startsWith('wss://data-space.world/')
}

/** Lit un résultat de `pool.publish` en un verdict ; pure. */
export function lireResultatPublication(url: string, r: PromiseSettledResult<string>): { url: string; ok: boolean; reason?: string } {
  if (r.status === 'rejected') {
    return { url, ok: false, reason: String((r.reason as { message?: string })?.message ?? r.reason) }
  }
  const value = String(r.value ?? '')
  if (value.startsWith('connection failure')) return { url, ok: false, reason: value }
  return { url, ok: true, reason: value || 'ok' }
}

/** Les relais durables encore en échec dans un bilan ; pure. */
export function relaisDurablesEnEchec(summary: Array<{ url: string; ok: boolean }>): string[] {
  return summary.filter(s => !s.ok && estRelaisDurable(s.url)).map(s => s.url)
}

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
      // Qui a fabriqué la nuit : le Mac, le secours GitHub, l'usine de nuit (anti-doublon, 14/09/2026).
      ['producteur', process.env.PRODUCTEUR || 'inconnu'],
    ],
    content: JSON.stringify({
      stationId:   finalBroadcast.stationId,
      date:        finalBroadcast.date,
      language:    finalBroadcast.language,
      durationSec: finalBroadcast.durationSec,
      audioCid:    finalBroadcast.audioCid,
      audioMime:   finalBroadcast.audioMime,
      turns:       finalBroadcast.turns,
      // Pauses musicales / jingles : seulement quand il y en a (l'appli tolère l'absence).
      ...(finalBroadcast.segments && finalBroadcast.segments.length > 0
        ? { segments: finalBroadcast.segments } : {}),
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
  let summary = results.map((r, i) => lireResultatPublication(relays[i], r))

  pool.close(relays)

  // 🔴 23/09/2026 — LES RELAIS DURABLES SE RETENTENT. Diginomad et WTF ont été « publiées sur
  // 7/9 relais » : les deux qui manquaient étaient le relais Cloudflare (celui que l'application
  // lit en premier) — « connection timed out ». Une émission absente du relais durable est une
  // émission que personne n'entend, quel que soit le score. Un événement signé se republie sans
  // risque (remplaçable) : trois essais espacés, sur les seuls relais durables en échec.
  for (let essai = 1; essai <= 3; essai++) {
    const aRetenter = relaisDurablesEnEchec(summary)
    if (aRetenter.length === 0) break
    await new Promise(r => setTimeout(r, essai * 8_000))
    const p2 = new SimplePool()
    const res2 = await Promise.allSettled(p2.publish(aRetenter, signed))
    p2.close(aRetenter)
    const nouveaux = res2.map((r, i) => lireResultatPublication(aRetenter[i], r))
    summary = summary.map(s => nouveaux.find(n => n.url === s.url) ?? s)
    for (const n of nouveaux) console.log(`    ${n.ok ? '✓' : '✗'} relais durable, essai ${essai + 1} : ${n.url} → ${n.reason}`)
  }

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
