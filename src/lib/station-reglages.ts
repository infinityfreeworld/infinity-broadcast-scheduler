/**
 * @module InfinityScheduler/StationReglages
 * @description Les réglages d'une station publiés depuis l'IHL (kind 30091, d-tag = id de
 *   station) : musiques (`tracks`), jingles, `skipMusic`, nombre et durée des pauses.
 *
 *   ── POURQUOI LE GÉNÉRATEUR LIT ENFIN LE 30091 ──
 *   L'onglet IHL « 📻 Stations » sait depuis mai 2026 coller un CID de musique et de jingle,
 *   et publie le tout en 30091. Le générateur, lui, ne lisait que sa seed : les choix du
 *   fondateur n'arrivaient jamais à l'antenne. Ici, ce qui est publié par un ADMIN (voir
 *   admins-radio.ts) ou par le créateur de la station REMPLACE la seed, champ par champ.
 *   Le reste de la seed (animateurs, sources, langue) n'est PAS touché : la seed reste le
 *   contrat entre les deux dépôts pour la fabrication.
 *
 *   Sans relais, sans réponse, sans admin reconnu : la seed, et on le dit.
 */

import { SimplePool } from 'nostr-tools/pool'
import type { Event as NostrEvent } from 'nostr-tools/core'
import { getRelays } from './nostr'
import { adminPubkeys } from './admins-radio'
import type { RadioStation, TrackRef } from './types'

export const KIND_RADIO_STATION = 30091

/** Ce que l'IHL peut changer sur une station seed, du point de vue du générateur. */
export interface ReglagesStation {
  tracks?:      TrackRef[]
  jingles?:     TrackRef[]
  skipMusic?:   boolean
  pauses?:      number
  pauseDureeS?: number
}

const FORME_CID = /^(Qm[1-9A-HJ-NP-Za-km-z]{44}|b[a-z2-7]{20,})$/

function pisteValide(x: unknown): TrackRef | null {
  if (!x || typeof x !== 'object') return null
  const t = x as Record<string, unknown>
  const title = typeof t.title === 'string' && t.title.trim() ? t.title.trim().slice(0, 120) : ''
  const cid = typeof t.cid === 'string' && FORME_CID.test(t.cid.trim()) ? t.cid.trim() : undefined
  const url = typeof t.url === 'string' && /^https:\/\//.test(t.url) ? t.url : undefined
  if (!cid && !url) return null
  const durationS = typeof t.durationS === 'number' && Number.isFinite(t.durationS) ? t.durationS : undefined
  return { title: title || (cid ? cid.slice(0, 12) : 'piste'), ...(cid ? { cid } : {}), ...(url ? { url } : {}), ...(durationS ? { durationS } : {}) }
}

/**
 * Lit les réglages depuis le contenu d'un event 30091. Pure : c'est la logique qui décide
 * ce qui passe à l'antenne, elle doit s'éprouver sans réseau.
 */
export function lireReglages(content: string): ReglagesStation | null {
  let c: Record<string, unknown>
  try { c = JSON.parse(content) as Record<string, unknown> } catch { return null }
  if (!c || typeof c !== 'object' || c.deleted === true) return null
  const out: ReglagesStation = {}
  if (Array.isArray(c.tracks)) {
    const t = c.tracks.map(pisteValide).filter((x): x is TrackRef => !!x)
    if (t.length > 0) out.tracks = t
  }
  if (Array.isArray(c.jingles)) {
    const j = c.jingles.map(pisteValide).filter((x): x is TrackRef => !!x)
    if (j.length > 0) out.jingles = j
  }
  if (typeof c.skipMusic === 'boolean') out.skipMusic = c.skipMusic
  if (typeof c.pauses === 'number' && Number.isInteger(c.pauses) && c.pauses >= 0 && c.pauses <= 6) out.pauses = c.pauses
  if (typeof c.pauseDureeS === 'number' && Number.isFinite(c.pauseDureeS) && c.pauseDureeS >= 30 && c.pauseDureeS <= 600) {
    out.pauseDureeS = Math.round(c.pauseDureeS)
  }
  return out
}

/**
 * Parmi des events 30091 portant le d-tag de la station : le plus récent d'un auteur
 * RECONNU (admin ou créateur de la station). Pure.
 */
export function retenirEvent(
  events: NostrEvent[], stationId: string, admins: Set<string> | null, creatorPubkey: string | null,
): NostrEvent | null {
  let retenu: NostrEvent | null = null
  for (const e of events) {
    if (e.kind !== KIND_RADIO_STATION) continue
    if (e.tags.find(t => t[0] === 'd')?.[1] !== stationId) continue
    const auteur = e.pubkey.toLowerCase()
    const reconnu = (admins ? admins.has(auteur) : true) || (!!creatorPubkey && auteur === creatorPubkey.toLowerCase())
    if (!reconnu) continue
    if (!retenu || e.created_at > retenu.created_at) retenu = e
  }
  return retenu
}

/** Applique des réglages à une station : les champs présents remplacent, les autres restent. */
export function appliquerReglages(station: RadioStation, r: ReglagesStation | null): RadioStation {
  if (!r) return station
  return {
    ...station,
    ...(r.tracks ? { tracks: r.tracks } : {}),
    ...(r.jingles ? { jingles: r.jingles } : {}),
    ...(r.skipMusic !== undefined ? { skipMusic: r.skipMusic } : {}),
    ...(r.pauses !== undefined ? { pauses: r.pauses } : {}),
    ...(r.pauseDureeS !== undefined ? { pauseDureeS: r.pauseDureeS } : {}),
  }
}

/** Interroge les relais et rend la station telle que l'IHL l'a réglée (ou la seed, en le disant). */
export async function stationSelonIHL(station: RadioStation, timeoutMs = 8000): Promise<RadioStation> {
  const relays = getRelays()
  const pool = new SimplePool()
  try {
    const events = await pool.querySync(
      relays,
      { kinds: [KIND_RADIO_STATION], '#d': [station.id], limit: 20 },
      { maxWait: timeoutMs },
    )
    const e = retenirEvent(events, station.id, adminPubkeys(), station.creatorPubkey)
    if (!e) {
      console.log(`    [station] aucun réglage IHL reconnu pour ${station.id} — seed`)
      return station
    }
    const r = lireReglages(e.content)
    if (!r) return station
    const quoi = [
      r.tracks ? `${r.tracks.length} musique(s)` : null,
      r.jingles ? `${r.jingles.length} jingle(s)` : null,
      r.skipMusic !== undefined ? `skipMusic=${r.skipMusic}` : null,
      r.pauses !== undefined ? `pauses=${r.pauses}` : null,
      r.pauseDureeS !== undefined ? `pause=${r.pauseDureeS}s` : null,
    ].filter(Boolean).join(', ')
    console.log(`    [station] réglages IHL de ${e.pubkey.slice(0, 8)} (${new Date(e.created_at * 1000).toISOString().slice(0, 10)}) : ${quoi || 'rien d\'utile'}`)
    return appliquerReglages(station, r)
  } catch (err) {
    console.warn(`    [station] relais illisibles (${(err as Error).message.slice(0, 80)}) — seed`)
    return station
  } finally {
    pool.close(relays)
  }
}
