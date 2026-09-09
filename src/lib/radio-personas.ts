/**
 * @module InfinityScheduler/Lib/RadioPersonas
 * @description Lecture des **personas unifiées** publiées par l'IHL
 *   Infinity (kind:30104 `RADIO_PERSONA`) et de leurs affinages
 *   per-station (kind:30105 `RADIO_PERSONA_STATION_OVERRIDE`).
 *
 *   Une persona unifiée remplace le couple historique
 *   « animateur (30096) + invité (30098) » : c'est UNE entité globale qui
 *   déclare, station par station, les rôles qu'elle peut tenir
 *   (`stationRules[]` → `canHost` / `canGuest`).
 *
 *   Aligné sur les codecs Infinity main :
 *     `src/modules/radio/personas/radio-persona-codec.ts`
 *     `src/modules/radio/personas/persona-station-override-codec.ts`
 *     `src/modules/radio/personas/radio-persona-helpers.ts`
 *
 *   ── AUTHENTICITÉ ──
 *   Comme pour le Pulse, le kind est un espace PARTAGÉ. Trois filtres,
 *   du moins cher au plus cher :
 *     1. `displayName` non vide et `stationRules` tableau (forme),
 *     2. au moins une règle visant une de NOS stations seed,
 *     3. `RADIO_ADMIN_PUBKEYS` (optionnel) — filtre par auteur.
 *   Le filtre 2 est le plus discriminant : une autre application ne
 *   connaît pas nos identifiants de stations.
 *
 *   ── TOMBSTONES ──
 *   Une persona supprimée est republiée avec `{deleted:true}` sur le même
 *   d-tag. Relevé en vrai le 2026-09-01 : `alain-moral` est dans cet état.
 *   Sans ce test, elle reviendrait à l'antenne sans nom.
 */

import { SimplePool } from 'nostr-tools/pool'
import type { Event as NostrEvent } from 'nostr-tools/core'
import { getRelays } from './nostr'
import type { StationLanguage } from './types'

/**
 * ⚠️ UN RELAIS SEUL PEUT OMETTRE UN DOCUMENT QU'IL STOCKE POURTANT.
 *
 * Constaté le 01/09/2026 sur notre relais souverain : une requête large
 * `{kinds:[30104,30105]}` rendait 9 events là où une interrogation ciblée
 * par `#d` en trouvait un 10ᵉ, bien présent en base
 * (`godefroid-de-mont-delire`). Le résultat variait d'un appel à l'autre,
 * sans erreur ni avertissement.
 *
 * ⚠️ Une `limit` explicite est posée par prudence, mais elle NE GARANTIT
 * RIEN : le même appel avec `limit: 500` a omis le document que
 * `limit: 200` rapportait. Ce n'est donc pas la limite qui est en cause.
 *
 * Ce qui protège réellement, c'est la REDONDANCE : `getRelays()` interroge
 * 7 relais et l'union est complète (7 personas rendues, 4 essais sur 4).
 * ⇒ Ne jamais réduire la lecture de la configuration à un relais unique.
 */
const LIMITE_REQUETE = 500


export const KIND_RADIO_PERSONA                  = 30104
export const KIND_RADIO_PERSONA_STATION_OVERRIDE = 30105

const ENV_KEY = 'RADIO_PERSONAS_UNIFIED_JSON'

export type HostBehavior = 'warm' | 'aggressive' | 'sad' | 'neutral' | 'adaptive'

export interface PersonaStationRule {
  stationId: string
  canHost:   boolean
  canGuest:  boolean
}

export interface RadioPersona {
  id:                    string
  displayName:           string
  realIdentityHint:      string
  gender:                'male' | 'female' | 'androgyn'
  avatar:                string
  color:                 string
  trait:                 string
  bio:                   string
  instructions:          string
  behavior:              HostBehavior
  /** Voix Chatterbox globale, cross-station. */
  voiceName?:            string
  unavailableLanguages?: StationLanguage[]
  stationRules:          PersonaStationRule[]
  updatedAt:             number
}

export interface PersonaStationOverride {
  personaId:          string
  stationId:          string
  traitOverride?:     string
  extraInstructions?: string
  behaviorOverride?:  HostBehavior
  voiceNameOverride?: string
  updatedAt:          number
}

export interface PersonasSnapshot {
  personas:  Record<string, RadioPersona>
  /** Clé `<personaId>:<stationId>`. */
  overrides: Record<string, PersonaStationOverride>
}

const EMPTY: PersonasSnapshot = { personas: {}, overrides: {} }

const VALID_LANGUAGES: ReadonlyArray<StationLanguage> = ['fr', 'en', 'es', 'it', 'pt', 'hi', 'ja', 'zh', 'ru']

function isBehavior(x: unknown): x is HostBehavior {
  return x === 'warm' || x === 'aggressive' || x === 'sad' || x === 'neutral' || x === 'adaptive'
}
function isGender(x: unknown): x is RadioPersona['gender'] {
  return x === 'male' || x === 'female' || x === 'androgyn'
}
function str(x: unknown, fallback = ''): string {
  return typeof x === 'string' ? x : fallback
}
function sanitizeLanguages(x: unknown): StationLanguage[] | undefined {
  if (!Array.isArray(x)) return undefined
  const out = x.filter((l): l is StationLanguage =>
    typeof l === 'string' && (VALID_LANGUAGES as readonly string[]).includes(l))
  return out.length > 0 ? out : undefined
}
function sanitizeStationRules(x: unknown): PersonaStationRule[] {
  if (!Array.isArray(x)) return []
  return x
    .filter((r): r is Record<string, unknown> => typeof r === 'object' && r !== null)
    .filter(r => typeof r.stationId === 'string' && (r.stationId as string).length > 0)
    .map(r => ({
      stationId: r.stationId as string,
      canHost:   r.canHost  === true,
      canGuest:  r.canGuest === true,
    }))
}

function getDTag(e: NostrEvent): string | null {
  return e.tags.find(t => t[0] === 'd')?.[1] ?? null
}

function adminPubkeys(): Set<string> | null {
  const raw = process.env.RADIO_ADMIN_PUBKEYS
  if (!raw) return null
  const set = new Set(raw.split(',').map(s => s.trim().toLowerCase()).filter(Boolean))
  return set.size > 0 ? set : null
}

function latestByDTag(events: NostrEvent[], allowed: Set<string> | null): Map<string, NostrEvent> {
  const latest = new Map<string, NostrEvent>()
  for (const e of events) {
    if (allowed && !allowed.has(e.pubkey.toLowerCase())) continue
    const d = getDTag(e)
    if (!d) continue
    const prev = latest.get(d)
    if (!prev || e.created_at > prev.created_at) latest.set(d, e)
  }
  return latest
}

// ── Fetch ────────────────────────────────────────────────────────────

export async function fetchRadioPersonas(
  knownStationIds: ReadonlyArray<string>,
  timeoutMs = 8000,
): Promise<PersonasSnapshot> {
  const relays = getRelays()
  const pool = new SimplePool()
  try {
    const events = await pool.querySync(
      relays,
      { kinds: [KIND_RADIO_PERSONA, KIND_RADIO_PERSONA_STATION_OVERRIDE], limit: LIMITE_REQUETE },
      { maxWait: timeoutMs },
    )
    const allowed = adminPubkeys()
    const stations = new Set(knownStationIds)

    const personas: Record<string, RadioPersona> = {}
    for (const [dTag, e] of latestByDTag(
      events.filter(x => x.kind === KIND_RADIO_PERSONA), allowed,
    )) {
      let c: Record<string, unknown>
      try {
        const parsed: unknown = JSON.parse(e.content)
        if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) continue
        c = parsed as Record<string, unknown>
      } catch { continue }

      if (c.deleted === true) continue                       // tombstone
      const displayName = str(c.displayName)
      if (displayName.length === 0) continue

      const stationRules = sanitizeStationRules(c.stationRules)
      // Filtre d'authenticité : au moins une règle sur une de NOS stations.
      if (!stationRules.some(r => stations.has(r.stationId) && (r.canHost || r.canGuest))) continue

      personas[dTag] = {
        id:                   dTag,
        displayName,
        realIdentityHint:     str(c.realIdentityHint),
        gender:               isGender(c.gender) ? c.gender : 'androgyn',
        avatar:               str(c.avatar) || '🎙️',
        color:                /^#[0-9a-fA-F]{6}$/.test(str(c.color)) ? str(c.color) : '#888888',
        trait:                str(c.trait),
        bio:                  str(c.bio),
        instructions:         str(c.instructions),
        behavior:             isBehavior(c.behavior) ? c.behavior : 'adaptive',
        voiceName:            str(c.voiceName) || undefined,
        unavailableLanguages: sanitizeLanguages(c.unavailableLanguages),
        stationRules,
        updatedAt:            typeof c.updatedAt === 'number' ? c.updatedAt : e.created_at * 1000,
      }
    }

    const overrides: Record<string, PersonaStationOverride> = {}
    for (const [dTag, e] of latestByDTag(
      events.filter(x => x.kind === KIND_RADIO_PERSONA_STATION_OVERRIDE), allowed,
    )) {
      const colon = dTag.indexOf(':')
      if (colon <= 0 || colon >= dTag.length - 1) continue
      const personaId = dTag.slice(0, colon)
      const stationId = dTag.slice(colon + 1)
      if (!stations.has(stationId)) continue                 // pas une de nos stations
      let c: Record<string, unknown>
      try {
        const parsed: unknown = JSON.parse(e.content)
        if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) continue
        c = parsed as Record<string, unknown>
      } catch { continue }
      overrides[dTag] = {
        personaId, stationId,
        traitOverride:     str(c.traitOverride)     || undefined,
        extraInstructions: str(c.extraInstructions) || undefined,
        behaviorOverride:  isBehavior(c.behaviorOverride) ? c.behaviorOverride : undefined,
        voiceNameOverride: str(c.voiceNameOverride) || undefined,
        updatedAt:         typeof c.updatedAt === 'number' ? c.updatedAt : e.created_at * 1000,
      }
    }

    return { personas, overrides }
  } catch (err) {
    console.warn('[radio-personas] fetch échec :', err instanceof Error ? err.message : err)
    return EMPTY
  } finally {
    pool.close(relays)
  }
}

// ── Transport parent → sous-processus ────────────────────────────────

export function exportRadioPersonasToEnv(snapshot: PersonasSnapshot): void {
  process.env[ENV_KEY] = JSON.stringify(snapshot)
}

let cached: PersonasSnapshot | null = null

export function loadRadioPersonasFromEnv(): PersonasSnapshot {
  if (cached) return cached
  const json = process.env[ENV_KEY]
  if (!json) { cached = EMPTY; return cached }
  try {
    cached = JSON.parse(json) as PersonasSnapshot
  } catch (err) {
    console.warn('[radio-personas] env JSON cassé :', (err as Error).message)
    cached = EMPTY
  }
  return cached
}

// ── Helpers purs (miroir de radio-persona-helpers.ts) ────────────────

export type RoleOnStation = 'host' | 'guest' | 'both' | 'none'

export function getPersonaRoleOnStation(persona: RadioPersona, stationId: string): RoleOnStation {
  const rule = persona.stationRules.find(r => r.stationId === stationId)
  if (!rule) return 'none'
  if (rule.canHost && rule.canGuest) return 'both'
  if (rule.canHost)  return 'host'
  if (rule.canGuest) return 'guest'
  return 'none'
}

/**
 * Tire « host » ou « guest » pour une persona en mode mixte. La règle
 * posée côté navigateur est de ne JAMAIS la programmer dans les deux
 * rôles le même jour : c'est ce tirage unique qui la garantit.
 */
export function pickRoleForMixed(
  persona: RadioPersona,
  stationId: string,
  rng: () => number = Math.random,
): 'host' | 'guest' | null {
  const role = getPersonaRoleOnStation(persona, stationId)
  if (role === 'host')  return 'host'
  if (role === 'guest') return 'guest'
  if (role === 'both')  return rng() < 0.5 ? 'host' : 'guest'
  return null
}

function isAvailableForLanguage(persona: RadioPersona, language: StationLanguage): boolean {
  if (!persona.unavailableLanguages || persona.unavailableLanguages.length === 0) return true
  return !persona.unavailableLanguages.includes(language)
}

/**
 * Répartit les personas de cette station entre animateurs et invités,
 * en UN SEUL tirage.
 *
 * Le tirage doit être unique, et c'est tout l'intérêt de cette fonction :
 * si `unifiedHostsForStation` et `unifiedGuestsForStation` tiraient
 * chacune de leur côté, une persona en mode mixte (`canHost && canGuest`)
 * pourrait sortir « host » d'un appel et « guest » de l'autre, et se
 * retrouver des deux côtés du micro le même jour — exactement ce que la
 * règle posée côté navigateur interdit.
 *
 * Le résultat est mémorisé par (station, langue) : un processus de
 * génération = un broadcast = une répartition stable.
 */
const repartitions = new Map<string, { hosts: RadioPersona[]; guests: RadioPersona[] }>()

export function assignRolesForStation(
  stationId: string,
  language: StationLanguage,
  rng: () => number = Math.random,
): { hosts: RadioPersona[]; guests: RadioPersona[] } {
  const cle = `${stationId}|${language}`
  const dejaFait = repartitions.get(cle)
  if (dejaFait) return dejaFait

  const { personas } = loadRadioPersonasFromEnv()
  const hosts: RadioPersona[] = []
  const guests: RadioPersona[] = []
  for (const p of Object.values(personas)) {
    if (!isAvailableForLanguage(p, language)) continue
    const role = pickRoleForMixed(p, stationId, rng)   // un seul tirage par persona
    if (role === 'host')  hosts.push(p)
    else if (role === 'guest') guests.push(p)
  }
  const resultat = { hosts, guests }
  repartitions.set(cle, resultat)
  return resultat
}

/** Remet à zéro la répartition mémorisée ET le cache d'env (tests). */
export function resetRoleAssignments(): void {
  repartitions.clear()
  cached = null
}

/** Personas jouables comme INVITÉ sur cette station, langue comprise. */
export function unifiedGuestsForStation(
  stationId: string,
  language: StationLanguage,
  rng: () => number = Math.random,
): RadioPersona[] {
  return assignRolesForStation(stationId, language, rng).guests
}

/** Personas jouables comme ANIMATRICE sur cette station. */
export function unifiedHostsForStation(
  stationId: string,
  language: StationLanguage,
  rng: () => number = Math.random,
): RadioPersona[] {
  return assignRolesForStation(stationId, language, rng).hosts
}

export interface ResolvedPersona {
  trait:        string
  instructions: string
  behavior:     HostBehavior
  voiceName:    string | undefined
}

/**
 * Applique l'override per-station (kind:30105). `extraInstructions` est
 * AJOUTÉ aux instructions de base, pas substitué — même séparateur que
 * côté navigateur, pour que le rendu soit identique des deux côtés.
 */
export function resolvePersonaForStation(persona: RadioPersona, stationId: string): ResolvedPersona {
  const { overrides } = loadRadioPersonasFromEnv()
  const ovr = overrides[`${persona.id}:${stationId}`]
  if (!ovr) {
    return {
      trait:        persona.trait,
      instructions: persona.instructions,
      behavior:     persona.behavior,
      voiceName:    persona.voiceName,
    }
  }
  const instructions = ovr.extraInstructions
    ? `${persona.instructions}\n\n=== Spécifique ${stationId} ===\n${ovr.extraInstructions}`
    : persona.instructions
  return {
    trait:        ovr.traitOverride     ?? persona.trait,
    instructions,
    behavior:     ovr.behaviorOverride  ?? persona.behavior,
    voiceName:    ovr.voiceNameOverride ?? persona.voiceName,
  }
}

/** Vrai si au moins une persona unifiée a été récoltée. */
export function hasUnifiedPersonas(): boolean {
  return Object.keys(loadRadioPersonasFromEnv().personas).length > 0
}
