/**
 * @module InfinityScheduler/Courrier/Appels
 * @description Les APPELS D'AUDITEURS d'une station, réglés dans l'IHL (fiche de station, kind
 *   30091, champ `appels { actifs, nombre 1-5, tousLesNJours 1-30 }`).
 *
 *   ⚠️ MÊME RÈGLE que `appelsDuJour` de `lib/fiche-station.ts` (branche `feat/fiche-station-ihl`,
 *   non fusionnée au 07/10/2026) : même décalage par station, mêmes bornes. Elle est reproduite
 *   ici pour ne pas dépendre d'une branche en cours ; à la fusion des deux, celle-ci pourra lire
 *   `station.appels` et appeler la fonction de la fiche (même résultat, éprouvé par les tests).
 *   De même, le 30091 est relu ici (une requête de plus) plutôt que de toucher
 *   `station-reglages.ts`, que cette branche-là réécrit.
 */
import { SimplePool } from 'nostr-tools/pool'
import type { Event as NostrEvent } from 'nostr-tools/core'
import { getRelays } from '../nostr'
import { adminPubkeys } from '../admins-radio'

export const KIND_RADIO_STATION = 30091

export interface AppelsStation {
  actifs:        boolean
  nombre:        number
  tousLesNJours: number
}

const borne = (x: unknown, min: number, max: number, defaut: number): number =>
  typeof x === 'number' && Number.isFinite(x) ? Math.max(min, Math.min(max, x)) : defaut

/** Lit `appels` dans le contenu d'un 30091 ; ignoré si `actifs` n'est pas un booléen. Pur. */
export function lireAppels(content: string): AppelsStation | undefined {
  let c: unknown
  try { c = JSON.parse(content) } catch { return undefined }
  if (!c || typeof c !== 'object') return undefined
  const a = (c as Record<string, unknown>).appels
  if (!a || typeof a !== 'object') return undefined
  const x = a as Record<string, unknown>
  if (typeof x.actifs !== 'boolean') return undefined
  return {
    actifs:        x.actifs,
    nombre:        Math.round(borne(x.nombre, 1, 5, 1)),
    tousLesNJours: Math.round(borne(x.tousLesNJours, 1, 30, 1)),
  }
}

function jourDepuisEpoque(date: string): number {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date)
  if (!m) return Number.NaN
  return Math.floor(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])) / 86_400_000)
}

function decalage(stationId: string): number {
  let h = 0
  for (const ch of stationId) h = (h * 31 + ch.codePointAt(0)!) >>> 0
  return h
}

/**
 * Nombre d'appels d'auditeurs PRÉVUS ce jour-là (déterministe). Ex. `{ actifs, nombre: 2,
 * tousLesNJours: 3 }` → 2 appels un jour sur 3, 0 les deux autres. Pas de réglage, coupés ou
 * date illisible → 0.
 */
export function appelsDuJour(reglage: AppelsStation | undefined, stationId: string, date: string): number {
  if (!reglage || !reglage.actifs) return 0
  const jour = jourDepuisEpoque(date)
  if (!Number.isFinite(jour)) return 0
  const n = Math.max(1, Math.min(30, Math.round(reglage.tousLesNJours)))
  const nombre = Math.max(1, Math.min(5, Math.round(reglage.nombre)))
  return (jour + decalage(stationId)) % n === 0 ? nombre : 0
}

/** Le 30091 le plus récent d'un ADMIN radio pour cette station. Pur. */
export function fichePlusRecente(events: readonly NostrEvent[], stationId: string, admins: ReadonlySet<string> | null): NostrEvent | null {
  let retenu: NostrEvent | null = null
  for (const e of events) {
    if (e.kind !== KIND_RADIO_STATION) continue
    if (e.tags.find(t => t[0] === 'd')?.[1] !== stationId) continue
    if (admins && !admins.has(e.pubkey.toLowerCase())) continue
    if (!retenu || e.created_at > retenu.created_at || (e.created_at === retenu.created_at && e.id > retenu.id)) retenu = e
  }
  return retenu
}

/** Le réglage des appels de la station (relais) ; `undefined` sans réglage ou relais muets. */
export async function lireAppelsDeLaStation(stationId: string, timeoutMs = 8000): Promise<AppelsStation | undefined> {
  const relays = getRelays()
  const pool = new SimplePool()
  try {
    const events = await pool.querySync(relays, { kinds: [KIND_RADIO_STATION], '#d': [stationId], limit: 20 }, { maxWait: timeoutMs })
    const e = fichePlusRecente(events, stationId, adminPubkeys())
    return e ? lireAppels(e.content) : undefined
  } catch {
    return undefined
  } finally {
    pool.close(relays)
  }
}
