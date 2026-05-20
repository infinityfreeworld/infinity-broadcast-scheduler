/**
 * @module InfinityScheduler/Lib/Guests
 * @description Phase H.4 (2026-05-20) — Récupération des invités personas
 *   (kind:30098) depuis NOSTR + résolution des invités à inviter pour
 *   un broadcast donné.
 *
 *   Alignement avec le codec Infinity main (`src/modules/radio/guests/
 *   guest-codec.ts`) : même schéma JSON, même validation.
 *
 *   Pattern identique à `host-personas.ts` : fetch UNE FOIS au démarrage
 *   parent, sérialise en env `RADIO_GUESTS_JSON`, sous-processus
 *   `generate-broadcast.ts` consomme depuis cache lazy.
 */

import { SimplePool } from 'nostr-tools/pool'
import type { Event as NostrEvent } from 'nostr-tools/core'
import { getRelays } from './nostr'
import type { StationLanguage } from './types'

export const KIND_RADIO_GUEST = 30098

const ENV_KEY = 'RADIO_GUESTS_JSON'

export type HostBehavior = 'warm' | 'aggressive' | 'sad' | 'neutral' | 'adaptive'

export interface RadioGuest {
  id:                    string
  displayName:           string
  realIdentityHint:      string
  gender:                'male' | 'female' | 'androgyn'
  avatar:                string
  color:                 string
  bio:                   string
  instructions:          string
  behavior:              HostBehavior
  unavailableLanguages?: StationLanguage[]
  updatedAt:             number
}

function isBehavior(x: unknown): x is HostBehavior {
  return x === 'warm' || x === 'aggressive' || x === 'sad' || x === 'neutral' || x === 'adaptive'
}
function isGender(x: unknown): x is RadioGuest['gender'] {
  return x === 'male' || x === 'female' || x === 'androgyn'
}

/**
 * Fetch les events kind:30098 depuis NOSTR. Garde le plus récent par
 * d-tag (le pubkey émetteur est ignoré — admin-whitelist côté browser
 * filtre déjà ce qui passe).
 */
export async function fetchRadioGuests(timeoutMs = 8000): Promise<Map<string, RadioGuest>> {
  const relays = getRelays()
  const pool = new SimplePool()
  try {
    const events = await pool.querySync(
      relays,
      { kinds: [KIND_RADIO_GUEST] },
      { maxWait: timeoutMs },
    )
    const latest = new Map<string, NostrEvent>()
    for (const e of events) {
      const dTag = e.tags.find(t => t[0] === 'd')?.[1]
      if (!dTag) continue
      const existing = latest.get(dTag)
      if (!existing || e.created_at > existing.created_at) latest.set(dTag, e)
    }
    const result = new Map<string, RadioGuest>()
    for (const [dTag, event] of latest.entries()) {
      try {
        const c = JSON.parse(event.content) as Partial<RadioGuest> & { deleted?: boolean }
        if (c.deleted === true) continue
        if (typeof c.displayName !== 'string' || c.displayName.length === 0) continue
        result.set(dTag, {
          id:                   dTag,
          displayName:          c.displayName,
          realIdentityHint:     typeof c.realIdentityHint === 'string' ? c.realIdentityHint : '',
          gender:               isGender(c.gender) ? c.gender : 'androgyn',
          avatar:               typeof c.avatar === 'string' && c.avatar.length > 0 ? c.avatar : '🎙️',
          color:                typeof c.color === 'string' ? c.color : '#888888',
          bio:                  typeof c.bio === 'string' ? c.bio : '',
          instructions:         typeof c.instructions === 'string' ? c.instructions : '',
          behavior:             isBehavior(c.behavior) ? c.behavior : 'adaptive',
          unavailableLanguages: Array.isArray(c.unavailableLanguages)
                                  ? c.unavailableLanguages.filter((l): l is StationLanguage => typeof l === 'string')
                                  : undefined,
          updatedAt:            typeof c.updatedAt === 'number' ? c.updatedAt : event.created_at * 1000,
        })
      } catch { /* ignore */ }
    }
    return result
  } catch (err) {
    console.warn('[guests] fetch échec :', err instanceof Error ? err.message : err)
    return new Map()
  } finally {
    pool.close(relays)
  }
}

export function exportGuestsToEnv(guests: Map<string, RadioGuest>): void {
  process.env[ENV_KEY] = JSON.stringify(Object.fromEntries(guests))
}

let cachedMap: Map<string, RadioGuest> | null = null

export function loadGuestsFromEnv(): Map<string, RadioGuest> {
  if (cachedMap) return cachedMap
  const json = process.env[ENV_KEY]
  if (!json) { cachedMap = new Map(); return cachedMap }
  try {
    const obj = JSON.parse(json) as Record<string, RadioGuest>
    cachedMap = new Map(Object.entries(obj))
  } catch (err) {
    console.warn('[guests] env JSON cassé :', (err as Error).message)
    cachedMap = new Map()
  }
  return cachedMap
}

export function getGuestById(guestId: string): RadioGuest | null {
  return loadGuestsFromEnv().get(guestId) ?? null
}

export function isGuestAvailableForLanguage(guest: RadioGuest, language: StationLanguage): boolean {
  if (!guest.unavailableLanguages || guest.unavailableLanguages.length === 0) return true
  return !guest.unavailableLanguages.includes(language)
}

/**
 * Résout le guest à inviter pour ce broadcast.
 *  - Si la station n'a pas de `guestIds` → null (pas d'invité)
 *  - Si non vide → choisit un guest au hasard parmi ceux dispo dans le
 *    cache ET disponible pour la langue de la station
 *  - Retourne null si filtrage exclut tout
 */
export function pickGuestForStation(
  guestIds: ReadonlyArray<string> | undefined,
  language: StationLanguage,
): RadioGuest | null {
  if (!guestIds || guestIds.length === 0) return null
  const candidates: RadioGuest[] = []
  for (const id of guestIds) {
    const g = getGuestById(id)
    if (g && isGuestAvailableForLanguage(g, language)) candidates.push(g)
  }
  if (candidates.length === 0) return null
  return candidates[Math.floor(Math.random() * candidates.length)]
}

/**
 * Phrase courte de directive de ton à injecter dans le prompt du guest.
 * Reprend la même grille que `behaviorDirective` pour les hosts.
 */
export function guestBehaviorDirective(behavior: HostBehavior): string {
  switch (behavior) {
    case 'warm':
      return 'Ton ton : CHALEUREUX. Accueillant, complice mais avec ton tempérament de caricature.'
    case 'aggressive':
      return 'Ton ton : AGRESSIF. Incisif, polémique, dérangeant mais articulé.'
    case 'sad':
      return 'Ton ton : GRAVE. Solennel, lourd, peu d\'humour.'
    case 'neutral':
      return 'Ton ton : NEUTRE. Informatif, factuel, ton de la caricature.'
    case 'adaptive':
      return 'Ton ton : ADAPTATIF. Choisis selon le sujet du jour et le tempérament de ta caricature.'
  }
}
