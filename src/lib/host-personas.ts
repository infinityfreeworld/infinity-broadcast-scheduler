/**
 * @module InfinityScheduler/Lib/HostPersonas
 * @description Phase D.4 (2026-05-20) — Lecture des personas étendues
 *   d'animateurs Radio publiées sur NOSTR (kind:30096) par l'IHL Infinity.
 *
 *   Aligné sur le codec Infinity main : `src/modules/ihl/host-persona-codec.ts`.
 *   D-tag = `<stationId>:<hostId>`, content JSON `{stationId, hostId,
 *   name, gender, trait, color, avatar, instructions, behavior, updatedAt}`.
 *
 *   Pattern identique à `host-voice-mappings.ts` (fetch + serialize env
 *   + lookup synchrone côté sub-process generate-broadcast).
 */

import { SimplePool } from 'nostr-tools/pool'
import type { Event as NostrEvent } from 'nostr-tools/core'
import { getRelays } from './nostr'

export const KIND_HOST_PERSONA = 30096

const ENV_KEY = 'HOST_PERSONAS_JSON'

export type HostBehavior = 'warm' | 'aggressive' | 'sad' | 'neutral' | 'adaptive'

export interface HostPersona {
  stationId:    string
  hostId:       string
  name:         string
  gender:       'male' | 'female' | 'androgyn'
  trait:        string
  color:        string
  avatar:       string
  instructions: string
  behavior:     HostBehavior
  updatedAt:    number
}

function isHostBehavior(x: unknown): x is HostBehavior {
  return x === 'warm' || x === 'aggressive' || x === 'sad' || x === 'neutral' || x === 'adaptive'
}

function isGender(x: unknown): x is HostPersona['gender'] {
  return x === 'male' || x === 'female' || x === 'androgyn'
}

/** Clé canonique : `<stationId>:<hostId>` (= d-tag NOSTR). */
export function personaKey(stationId: string, hostId: string): string {
  return `${stationId}:${hostId}`
}

/**
 * Fetch toutes les personas kind:30096 depuis les relays NOSTR.
 * Retourne une Map<dTag, HostPersona>. Replaceable handling : le plus
 * récent created_at gagne en cas de doublon.
 */
export async function fetchHostPersonas(timeoutMs = 8000): Promise<Map<string, HostPersona>> {
  const relays = getRelays()
  const pool = new SimplePool()
  try {
    const events = await pool.querySync(
      relays,
      { kinds: [KIND_HOST_PERSONA] },
      { maxWait: timeoutMs },
    )

    const latest = new Map<string, NostrEvent>()
    for (const e of events) {
      const dTag = e.tags.find(t => t[0] === 'd')?.[1]
      if (!dTag) continue
      const existing = latest.get(dTag)
      if (!existing || e.created_at > existing.created_at) latest.set(dTag, e)
    }

    const result = new Map<string, HostPersona>()
    for (const [dTag, event] of latest.entries()) {
      try {
        const c = JSON.parse(event.content) as Partial<HostPersona>
        if (typeof c.name !== 'string' || c.name.length === 0) continue
        const colon = dTag.indexOf(':')
        if (colon <= 0) continue
        result.set(dTag, {
          stationId:    typeof c.stationId === 'string' ? c.stationId : dTag.slice(0, colon),
          hostId:       typeof c.hostId === 'string' ? c.hostId : dTag.slice(colon + 1),
          name:         c.name,
          gender:       isGender(c.gender) ? c.gender : 'androgyn',
          trait:        typeof c.trait === 'string' ? c.trait : '',
          color:        typeof c.color === 'string' ? c.color : '#888888',
          avatar:       typeof c.avatar === 'string' ? c.avatar : '🎙️',
          instructions: typeof c.instructions === 'string' ? c.instructions : '',
          behavior:     isHostBehavior(c.behavior) ? c.behavior : 'neutral',
          updatedAt:    typeof c.updatedAt === 'number' ? c.updatedAt : event.created_at * 1000,
        })
      } catch { /* ignore */ }
    }
    return result
  } catch (err) {
    console.warn('[host-personas] fetch échec :', err instanceof Error ? err.message : err)
    return new Map()
  } finally {
    pool.close(relays)
  }
}

/** Sérialise pour les sous-processes via env var. */
export function exportHostPersonasToEnv(personas: Map<string, HostPersona>): void {
  process.env[ENV_KEY] = JSON.stringify(Object.fromEntries(personas))
}

let cachedMap: Map<string, HostPersona> | null = null

export function loadHostPersonasFromEnv(): Map<string, HostPersona> {
  if (cachedMap) return cachedMap
  const json = process.env[ENV_KEY]
  if (!json) { cachedMap = new Map(); return cachedMap }
  try {
    const obj = JSON.parse(json) as Record<string, HostPersona>
    cachedMap = new Map(Object.entries(obj))
  } catch (err) {
    console.warn('[host-personas] env JSON cassé :', (err as Error).message)
    cachedMap = new Map()
  }
  return cachedMap
}

/** Lookup synchrone — null si pas de persona custom pour ce (station, host). */
export function getPersonaForHost(stationId: string, hostId: string): HostPersona | null {
  const map = loadHostPersonasFromEnv()
  return map.get(personaKey(stationId, hostId)) ?? null
}

/** Phrase courte à injecter dans le system prompt LLM selon le comportement. */
export function behaviorDirective(behavior: HostBehavior): string {
  switch (behavior) {
    case 'warm':
      return 'Ton ton du jour : CHALEUREUX. Sois accueillant, bienveillant, complice avec l\'auditeur. Le ton est doux mais pas mièvre.'
    case 'aggressive':
      return 'Ton ton du jour : AGRESSIF. Sois incisif, polémique, n\'aie pas peur de déranger ou de contredire. Le ton est tendu mais articulé, pas vulgaire.'
    case 'sad':
      return 'Ton ton du jour : GRAVE. Le contexte est lourd, tu traites les sujets avec sérieux et pesanteur. Pas d\'humour léger.'
    case 'neutral':
      return 'Ton ton du jour : NEUTRE. Sois informatif, factuel, sans coloration émotionnelle excessive. Reste sobre.'
    case 'adaptive':
      return 'Ton ton du jour : ADAPTATIF. Lis le sentiment moyen des actualités du jour et CHOISIS-toi un ton cohérent : chaleureux si majorité positive, grave si majorité négative, neutre sinon. Annonce-le par ton ton, pas par méta-commentaire.'
  }
}
