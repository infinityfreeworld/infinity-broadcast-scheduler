/**
 * @module InfinityScheduler/Lib/Pulse
 * @description Lecture du « Pulse Pirate » publié par l'IHL Infinity —
 *   le rythme de l'antenne et le comportement des personas, réglés dans
 *   le panneau Pirate › ⚙️ Pulse.
 *
 *   Trois kinds, une cascade :
 *     - kind:30101 `RADIO_PULSE_CONFIG`            d-tag `global`
 *     - kind:30102 `RADIO_PULSE_STATION_OVERRIDE`  d-tag `<stationId>`
 *     - kind:30103 `RADIO_PULSE_PERSONA_OVERRIDE`  d-tag `<personaKey>`
 *
 *   Sémantique **all-or-nothing** (identique au navigateur) : si un
 *   override existe, ses champs remplacent INTÉGRALEMENT ceux du niveau
 *   au-dessus. Pas de fusion champ par champ.
 *
 *   Aligné sur les codecs Infinity main :
 *     `src/modules/radio/pulse/pulse-config-codec.ts`
 *     `src/modules/radio/pulse/station-pulse-override-codec.ts`
 *     `src/modules/radio/pulse/persona-pulse-override-codec.ts`
 *
 *   ── POURQUOI CE MODULE EST PLUS STRICT QUE LE CODEC DU NAVIGATEUR ──
 *
 *   Un kind NOSTR est un espace PARTAGÉ : n'importe quelle application
 *   peut publier sur 30101. Mesuré le 2026-09-01 sur nos.lol : 326 events
 *   kind:30101, 306 pubkeys distinctes, aucune n'étant Infinity (des
 *   parties de jeu « MatchHello », des questionnaires…).
 *
 *   Le codec du navigateur retombe sur `DEFAULT_PULSE_CONFIG` champ par
 *   champ quand un champ manque. Appliqué tel quel ici, un event étranger
 *   se parserait en config « valide » et irait piloter le ton de nos
 *   émissions. Le navigateur s'en protège autrement : il filtre par
 *   pubkey admin avant de parser.
 *
 *   Le scheduler n'a pas cette liste d'admins. Il se protège donc par la
 *   FORME : un event n'est retenu que s'il porte TOUS les champs
 *   discriminants, aux bons types. Un event étranger n'en porte aucun.
 *   `RADIO_ADMIN_PUBKEYS` (optionnel) ajoute le filtre par auteur quand
 *   on veut verrouiller davantage.
 */

import { SimplePool } from 'nostr-tools/pool'
import type { Event as NostrEvent } from 'nostr-tools/core'
import { getRelays } from './nostr'

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


export const KIND_PULSE_CONFIG            = 30101
export const KIND_PULSE_STATION_OVERRIDE  = 30102
export const KIND_PULSE_PERSONA_OVERRIDE  = 30103

const ENV_KEY = 'RADIO_PULSE_JSON'

export const INTERVENTION_RATES = ['rare', 'normal', 'frenetic'] as const
export type InterventionRate = (typeof INTERVENTION_RATES)[number]

export const GLOBAL_MOODS = ['satirique', 'analytique', 'chaotique', 'didactique'] as const
export type GlobalMood = (typeof GLOBAL_MOODS)[number]

export const VERBOSITIES = ['concise', 'normal', 'verbose'] as const
export type Verbosity = (typeof VERBOSITIES)[number]

/** Les 4 champs « Rythme Radio » (global ou override station). */
export interface PulseRhythm {
  dialogueDensity:   number
  interventionRate:  InterventionRate
  averageSegmentSec: number
  globalMood:        GlobalMood
}

/** Les 3 champs « Comportement Persona » (global ou override persona). */
export interface PulseBehavior {
  verbosity:               Verbosity
  interruptionTendency:    number
  contradictionPropensity: number
}

/** Doit rester identique à `DEFAULT_PULSE_CONFIG` côté navigateur. */
export const DEFAULT_RHYTHM: PulseRhythm = {
  dialogueDensity:   60,
  interventionRate:  'normal',
  averageSegmentSec: 60,
  globalMood:        'satirique',
}
export const DEFAULT_BEHAVIOR: PulseBehavior = {
  verbosity:               'normal',
  interruptionTendency:    35,
  contradictionPropensity: 50,
}

export interface PulseSnapshot {
  /** Niveau global (kind:30101). Null = jamais publié → défauts. */
  global:     { rhythm: PulseRhythm; behavior: PulseBehavior } | null
  /** Overrides par station (kind:30102), clé = stationId. */
  byStation:  Record<string, PulseRhythm>
  /** Overrides par persona (kind:30103), clé = personaKey. */
  byPersona:  Record<string, PulseBehavior>
}

const EMPTY_SNAPSHOT: PulseSnapshot = { global: null, byStation: {}, byPersona: {} }

// ── Validation stricte ───────────────────────────────────────────────

function isInterventionRate(x: unknown): x is InterventionRate {
  return typeof x === 'string' && (INTERVENTION_RATES as readonly string[]).includes(x)
}
function isGlobalMood(x: unknown): x is GlobalMood {
  return typeof x === 'string' && (GLOBAL_MOODS as readonly string[]).includes(x)
}
function isVerbosity(x: unknown): x is Verbosity {
  return typeof x === 'string' && (VERBOSITIES as readonly string[]).includes(x)
}
function clamp(n: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, n))
}
/** Exige un NOMBRE fini présent — pas de valeur par défaut silencieuse. */
function requireNumber(x: unknown, min: number, max: number): number | null {
  if (typeof x !== 'number' || !Number.isFinite(x)) return null
  return clamp(x, min, max)
}

/**
 * Rythme : exige les 4 champs, aux bons types. Un seul manquant ⇒ null
 * (l'event n'est pas de nous). Voir l'en-tête du module.
 */
export function parseRhythmStrict(c: Record<string, unknown>): PulseRhythm | null {
  const dialogueDensity   = requireNumber(c.dialogueDensity,   0,  100)
  const averageSegmentSec = requireNumber(c.averageSegmentSec, 30, 180)
  if (dialogueDensity === null || averageSegmentSec === null) return null
  if (!isInterventionRate(c.interventionRate)) return null
  if (!isGlobalMood(c.globalMood)) return null
  return {
    dialogueDensity,
    averageSegmentSec,
    interventionRate: c.interventionRate,
    globalMood:       c.globalMood,
  }
}

/** Comportement : exige les 3 champs, aux bons types. */
export function parseBehaviorStrict(c: Record<string, unknown>): PulseBehavior | null {
  const interruptionTendency    = requireNumber(c.interruptionTendency,    0, 100)
  const contradictionPropensity = requireNumber(c.contradictionPropensity, 0, 100)
  if (interruptionTendency === null || contradictionPropensity === null) return null
  if (!isVerbosity(c.verbosity)) return null
  return { verbosity: c.verbosity, interruptionTendency, contradictionPropensity }
}

function getDTag(e: NostrEvent): string | null {
  return e.tags.find(t => t[0] === 'd')?.[1] ?? null
}

function contentOf(e: NostrEvent): Record<string, unknown> | null {
  try {
    const c: unknown = JSON.parse(e.content)
    if (typeof c !== 'object' || c === null || Array.isArray(c)) return null
    return c as Record<string, unknown>
  } catch {
    return null
  }
}

/** Liste blanche d'auteurs, optionnelle. Vide ⇒ pas de filtre par auteur. */
function adminPubkeys(): Set<string> | null {
  const raw = process.env.RADIO_ADMIN_PUBKEYS
  if (!raw) return null
  const set = new Set(raw.split(',').map(s => s.trim().toLowerCase()).filter(Boolean))
  return set.size > 0 ? set : null
}

/** Garde le plus récent par d-tag (sémantique replaceable). */
function latestByDTag(events: NostrEvent[], allowed: Set<string> | null): Map<string, NostrEvent> {
  const latest = new Map<string, NostrEvent>()
  for (const e of events) {
    if (allowed && !allowed.has(e.pubkey.toLowerCase())) continue
    const dTag = getDTag(e)
    if (!dTag) continue
    const existing = latest.get(dTag)
    if (!existing || e.created_at > existing.created_at) latest.set(dTag, e)
  }
  return latest
}

// ── Fetch ────────────────────────────────────────────────────────────

/**
 * Récupère les 3 kinds Pulse en UNE requête. `knownStationIds` sert de
 * filtre d'authenticité pour les overrides station : un d-tag qui ne
 * désigne aucune de nos stations n'est pas de nous.
 */
export async function fetchPulse(
  knownStationIds: ReadonlyArray<string>,
  timeoutMs = 8000,
): Promise<PulseSnapshot> {
  const relays = getRelays()
  const pool = new SimplePool()
  try {
    const events = await pool.querySync(
      relays,
      { kinds: [KIND_PULSE_CONFIG, KIND_PULSE_STATION_OVERRIDE, KIND_PULSE_PERSONA_OVERRIDE], limit: LIMITE_REQUETE },
      { maxWait: timeoutMs },
    )
    const allowed = adminPubkeys()
    const stations = new Set(knownStationIds)

    // ── Global (d-tag 'global' obligatoire) ──────────────────────────
    const globals = latestByDTag(
      events.filter(e => e.kind === KIND_PULSE_CONFIG && getDTag(e) === 'global'),
      allowed,
    )
    let global: PulseSnapshot['global'] = null
    const globalEvent = globals.get('global')
    if (globalEvent) {
      const c = contentOf(globalEvent)
      if (c) {
        const rhythm   = parseRhythmStrict(c)
        const behavior = parseBehaviorStrict(c)
        // Le global porte les 7 champs. S'il n'en porte qu'une partie,
        // l'event n'est pas une PulseConfig Infinity.
        if (rhythm && behavior) global = { rhythm, behavior }
      }
    }

    // ── Overrides station ────────────────────────────────────────────
    const byStation: Record<string, PulseRhythm> = {}
    for (const [dTag, e] of latestByDTag(
      events.filter(x => x.kind === KIND_PULSE_STATION_OVERRIDE), allowed,
    )) {
      if (!stations.has(dTag)) continue      // d-tag = stationId connu, sinon étranger
      const c = contentOf(e)
      if (!c) continue
      const rhythm = parseRhythmStrict(c)
      if (rhythm) byStation[dTag] = rhythm
    }

    // ── Overrides persona ────────────────────────────────────────────
    const byPersona: Record<string, PulseBehavior> = {}
    for (const [dTag, e] of latestByDTag(
      events.filter(x => x.kind === KIND_PULSE_PERSONA_OVERRIDE), allowed,
    )) {
      if (!isPersonaKey(dTag)) continue
      const c = contentOf(e)
      if (!c) continue
      const behavior = parseBehaviorStrict(c)
      if (behavior) byPersona[dTag] = behavior
    }

    return { global, byStation, byPersona }
  } catch (err) {
    console.warn('[pulse] fetch échec :', err instanceof Error ? err.message : err)
    return EMPTY_SNAPSHOT
  } finally {
    pool.close(relays)
  }
}

// ── Clés persona (miroir de persona-pulse-override-codec.ts) ─────────

export function personaKeyForHost(stationId: string, hostId: string): string {
  return `host:${stationId}:${hostId}`
}
export function personaKeyForGuest(guestId: string): string {
  return `guest:${guestId}`
}
export function personaKeyForUnified(personaId: string): string {
  return `unified:${personaId}`
}

function isPersonaKey(dTag: string): boolean {
  return dTag.startsWith('host:') || dTag.startsWith('guest:') || dTag.startsWith('unified:')
}

// ── Transport parent → sous-processus ────────────────────────────────

export function exportPulseToEnv(snapshot: PulseSnapshot): void {
  process.env[ENV_KEY] = JSON.stringify(snapshot)
}

let cached: PulseSnapshot | null = null

export function loadPulseFromEnv(): PulseSnapshot {
  if (cached) return cached
  const json = process.env[ENV_KEY]
  if (!json) { cached = EMPTY_SNAPSHOT; return cached }
  try {
    cached = JSON.parse(json) as PulseSnapshot
  } catch (err) {
    console.warn('[pulse] env JSON cassé :', (err as Error).message)
    cached = EMPTY_SNAPSHOT
  }
  return cached
}

// ── Résolution de la cascade ─────────────────────────────────────────

/** Override station (all-or-nothing) → global → défauts. */
export function resolveRhythmForStation(stationId: string): PulseRhythm {
  const snap = loadPulseFromEnv()
  return snap.byStation[stationId] ?? snap.global?.rhythm ?? DEFAULT_RHYTHM
}

/** Override persona (all-or-nothing) → global → défauts. */
export function resolveBehaviorForPersona(personaKey: string): PulseBehavior {
  const snap = loadPulseFromEnv()
  return snap.byPersona[personaKey] ?? snap.global?.behavior ?? DEFAULT_BEHAVIOR
}

/** Vrai si le Pulse vient d'un event publié, pas des valeurs par défaut. */
export function hasPublishedPulse(): boolean {
  const snap = loadPulseFromEnv()
  return snap.global !== null
    || Object.keys(snap.byStation).length > 0
    || Object.keys(snap.byPersona).length > 0
}

// ── Traduction en directives de prompt ───────────────────────────────

const MOOD_DIRECTIVE: Record<GlobalMood, string> = {
  satirique:  'Registre de l\'antenne : SATIRIQUE. On moque, on détourne, on épingle. L\'ironie est l\'outil principal.',
  analytique: 'Registre de l\'antenne : ANALYTIQUE. On décortique, on met en perspective, on cherche le mécanisme derrière le fait.',
  chaotique:  'Registre de l\'antenne : CHAOTIQUE. On coupe, on digresse, on part en vrille — l\'énergie prime sur la ligne droite.',
  didactique: 'Registre de l\'antenne : DIDACTIQUE. On explique pour être compris de quelqu\'un qui découvre le sujet.',
}

const VERBOSITY_DIRECTIVE: Record<Verbosity, string> = {
  concise: 'Longueur : TRÈS COURT. Une à deux phrases, sèches. Tu laisses de l\'air.',
  normal:  'Longueur : NORMALE. Deux à trois phrases par tour.',
  verbose: 'Longueur : AMPLE. Trois à quatre phrases, tu développes ton idée jusqu\'au bout.',
}

/**
 * Directive de rythme injectée dans le prompt de chaque animateur.
 * `dialogueDensity` et `averageSegmentSec` décrivent le tempo attendu ;
 * ils ne coupent rien mécaniquement, ils orientent l'écriture.
 */
export function rhythmDirective(rhythm: PulseRhythm): string {
  const tempo = rhythm.dialogueDensity >= 75
    ? 'Le débit est DENSE : peu de respiration, on enchaîne.'
    : rhythm.dialogueDensity <= 35
      ? 'Le débit est AÉRÉ : on prend son temps, on laisse retomber.'
      : 'Le débit est ÉQUILIBRÉ.'
  const segment = `Un segment tient environ ${rhythm.averageSegmentSec} secondes à l'oral.`
  return `${MOOD_DIRECTIVE[rhythm.globalMood]}\n${tempo} ${segment}`
}

/** Directive de comportement injectée dans le prompt d'une persona. */
export function behaviorPulseDirective(behavior: PulseBehavior): string {
  const lines: string[] = [VERBOSITY_DIRECTIVE[behavior.verbosity]]
  if (behavior.interruptionTendency >= 65) {
    lines.push('Tu COUPES volontiers la parole : commence souvent en réagissant à chaud à ce qui vient d\'être dit.')
  } else if (behavior.interruptionTendency <= 20) {
    lines.push('Tu ne coupes jamais : tu laisses l\'autre finir et tu reprends posément.')
  }
  if (behavior.contradictionPropensity >= 65) {
    lines.push('Tu CONTREDIS souvent : cherche l\'angle par lequel ton confrère a tort.')
  } else if (behavior.contradictionPropensity <= 20) {
    lines.push('Tu contredis rarement : tu prolonges et tu complètes plutôt que tu ne t\'opposes.')
  }
  return lines.join('\n')
}

/**
 * Nombre d'interventions d'invités attendues sur un broadcast, selon
 * `interventionRate`. Le scheduler n'en programme qu'un seul aujourd'hui ;
 * `rare` permet de n'en programmer aucun certains jours.
 */
export function guestSlotsForRate(rate: InterventionRate, rng: () => number = Math.random): number {
  switch (rate) {
    case 'rare':     return rng() < 0.34 ? 1 : 0    // ~1 jour sur 3
    case 'normal':   return 1
    case 'frenetic': return 2
  }
}
