/**
 * @module InfinityScheduler/Lib/HostVoiceMappings
 * @description Phase C.3 (2026-05-20) — Lecture des mappings animateur Radio
 *   → voix Chatterbox publiés sur NOSTR (kind:30095) par l'IHL Infinity.
 *
 *   Aligné sur le codec Infinity main : `src/modules/ihl/host-voice-codec.ts`.
 *   D-tag = `<stationId>:<hostId>`, content JSON `{stationId, hostId,
 *   voiceName, language?, updatedAt}`.
 *
 *   Stratégie d'usage côté scheduler :
 *     1. `generate-all.ts` appelle `fetchHostVoiceMappings()` au démarrage,
 *        sérialise le résultat en JSON dans `process.env.HOST_VOICE_MAP_JSON`.
 *     2. Les sous-processus `generate-broadcast.ts` héritent de cette env var
 *        (via `execFile({ env: process.env })`) et la chargent en mémoire
 *        via `loadHostVoiceMappingsFromEnv()`.
 *     3. `getChatterboxVoiceForHost(stationId, hostId)` lit ce cache en
 *        priorité avant les fallbacks `CHATTERBOX_VOICE_MAP` (legacy) et
 *        `CHATTERBOX_DEFAULT_VOICE`.
 */

import { SimplePool } from 'nostr-tools/pool'
import type { Event as NostrEvent } from 'nostr-tools/core'
import { getRelays } from './nostr'

export const KIND_HOST_VOICE_MAPPING = 30095

const ENV_KEY = 'HOST_VOICE_MAP_JSON'

/** Clé canonique du cache : `<stationId>:<hostId>` (= d-tag NOSTR). */
export function mappingKey(stationId: string, hostId: string): string {
  return `${stationId}:${hostId}`
}

/**
 * Fetch tous les mappings kind:30095 publiés sur les relays NOSTR
 * configurés. Retourne une Map<dTag, voiceName>. Si plusieurs events
 * partagent un d-tag (replaceable race condition), seul le plus récent
 * `created_at` est retenu.
 *
 * Robuste : timeout côté pool, erreur réseau → Map vide (le scheduler
 * tombera sur CHATTERBOX_DEFAULT_VOICE).
 */
export async function fetchHostVoiceMappings(timeoutMs = 8000): Promise<Map<string, string>> {
  const relays = getRelays()
  const pool = new SimplePool()
  try {
    const events = await pool.querySync(
      relays,
      { kinds: [KIND_HOST_VOICE_MAPPING] },
      { maxWait: timeoutMs },
    )

    // Replaceable : garder le plus récent par d-tag
    const latest = new Map<string, NostrEvent>()
    for (const e of events) {
      const dTag = e.tags.find(t => t[0] === 'd')?.[1]
      if (!dTag) continue
      const existing = latest.get(dTag)
      if (!existing || e.created_at > existing.created_at) {
        latest.set(dTag, e)
      }
    }

    const result = new Map<string, string>()
    for (const [dTag, event] of latest.entries()) {
      try {
        const content = JSON.parse(event.content) as { voiceName?: unknown }
        if (typeof content.voiceName === 'string' && content.voiceName.length > 0) {
          result.set(dTag, content.voiceName)
        }
      } catch {
        // content JSON cassé → ignore ce mapping
      }
    }
    return result
  } catch (err) {
    console.warn('[host-voice-mappings] fetch échec :', err instanceof Error ? err.message : err)
    return new Map()
  } finally {
    pool.close(relays)
  }
}

/**
 * Sérialise la Map en JSON et la met dans `process.env.HOST_VOICE_MAP_JSON`
 * (hérité par les sous-processus exec).
 */
export function exportHostVoiceMappingsToEnv(mappings: Map<string, string>): void {
  process.env[ENV_KEY] = JSON.stringify(Object.fromEntries(mappings))
}

/**
 * Cache en mémoire process. Chargé paresseusement à la 1ère lecture depuis
 * `process.env.HOST_VOICE_MAP_JSON` (généralement sérialisé par le parent
 * `generate-all.ts` puis hérité ici par `exec`).
 */
let cachedMap: Map<string, string> | null = null

export function loadHostVoiceMappingsFromEnv(): Map<string, string> {
  if (cachedMap) return cachedMap
  const json = process.env[ENV_KEY]
  if (!json) {
    cachedMap = new Map()
    return cachedMap
  }
  try {
    const obj = JSON.parse(json) as Record<string, string>
    cachedMap = new Map(Object.entries(obj))
  } catch (err) {
    console.warn('[host-voice-mappings] env JSON cassé, ignore :', (err as Error).message)
    cachedMap = new Map()
  }
  return cachedMap
}

/**
 * Lookup synchrone côté scheduler : retourne la voix Chatterbox configurée
 * pour `(stationId, hostId)` via NOSTR, ou null si pas de mapping.
 */
export function getNostrVoiceForHost(stationId: string, hostId: string): string | null {
  const map = loadHostVoiceMappingsFromEnv()
  return map.get(mappingKey(stationId, hostId)) ?? null
}
