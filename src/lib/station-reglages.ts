/**
 * @module InfinityScheduler/StationReglages
 * @description La FICHE d'une station publiée depuis l'IHL (kind 30091, d-tag = id de station).
 *
 *   ── 07/10/2026 : LA FICHE ENTIÈRE, ET SEULEMENT CELLE D'UN ADMINISTRATEUR ──
 *   Décision du Bâtisseur : « la radio se règle UNIQUEMENT depuis l'IHL ; chaque station a ses
 *   propres réglages ; Pulse est fondu dans la station ; aucune station créée par un Bâtisseur ».
 *   Jusqu'ici le générateur ne reprenait du 30091 que les musiques, jingles et pauses : le nom,
 *   le slogan, la raison d'être, les sources, la langue et les animateurs réglés dans l'IHL ne
 *   changeaient RIEN à l'antenne. Désormais tout ce que l'app sait écrire est honoré :
 *     · name, tagline, description (= la ligne éditoriale, injectée dans le prompt) ;
 *     · language — seulement si une voix commercialisable existe (sinon la langue de la seed) ;
 *     · hosts — seulement les animateurs complets (sinon ceux de la seed) ;
 *     · guestIds ;
 *     · sources — remplacent celles de la seed (une liste vide ne remplace rien) ;
 *     · rythme / actualite / appels (nouveaux, voir lib/fiche-station.ts) ;
 *     · tracks, jingles, skipMusic, pauses, pauseDureeS (comme avant).
 *   Un champ absent ou illisible garde la valeur de la seed : une fiche ancienne ne casse rien.
 *
 *   Qui a le droit : la liste blanche `admins-radio.ts` (la même que pour les voix, personas et
 *   Pulse). Le « créateur de la station » n'est PLUS reconnu : un 30091 d'un non-admin est ignoré.
 *
 *   Sans relais, sans réponse, sans admin reconnu : la seed, et on le dit.
 */

import { SimplePool } from 'nostr-tools/pool'
import type { Event as NostrEvent } from 'nostr-tools/core'
import { getRelays } from './nostr'
import { adminPubkeys } from './admins-radio'
import { langueSynthetisable } from './voix'
import { INTERVENTION_RATES, GLOBAL_MOODS, VERBOSITIES, DEFAULT_RHYTHM, DEFAULT_BEHAVIOR } from './pulse'
import type {
  RadioStation, TrackRef, RadioHost, NewsSource, StationLanguage, StationKind,
  RythmeStation, ActualiteStation, AppelsStation,
} from './types'

export const KIND_RADIO_STATION = 30091

/** Ce que l'IHL peut régler sur une station, du point de vue du générateur. */
export interface ReglagesStation {
  name?:        string
  tagline?:     string
  description?: string
  language?:    StationLanguage
  hosts?:       RadioHost[]
  guestIds?:    string[]
  sources?:     NewsSource[]
  tracks?:      TrackRef[]
  jingles?:     TrackRef[]
  skipMusic?:   boolean
  pauses?:      number
  pauseDureeS?: number
  rythme?:      RythmeStation
  actualite?:   ActualiteStation
  appels?:      AppelsStation
}

const FORME_CID = /^(Qm[1-9A-HJ-NP-Za-km-z]{44}|b[a-z2-7]{20,})$/
export const LANGUES: readonly StationLanguage[] = ['fr', 'en', 'es', 'it', 'pt', 'hi', 'ja', 'zh', 'ru']
const GENRES: readonly RadioHost['gender'][] = ['male', 'female', 'androgyn']
const TYPES_SOURCES: readonly NewsSource['type'][] = ['rss', 'web', 'nostr']
/** Miroir de `VALID_KINDS` du codec de l'app : une fiche d'un autre type n'y est pas affichée. */
const TYPES_STATION: readonly StationKind[] = [
  'wtf', 'freeworld', 'bigballs', 'mindctrl', 'hydrogene', 'g1', 'deglingos', 'diginomad', 'tech',
  'pirate', 'oasis', 'user',
]
/** Miroir de `LOCK_TOLERANCE` (app, seed-stations.ts) : deux stations à moins de 0,05 MHz se chevauchent. */
export const TOLERANCE_FREQUENCE = 0.05

const MAX_HOTES = 6
const MAX_INVITES = 30
const MAX_SOURCES = 12
const MAX_DESCRIPTION = 2000

const estObjet = (x: unknown): x is Record<string, unknown> =>
  typeof x === 'object' && x !== null && !Array.isArray(x)
const texte = (x: unknown, max: number): string | undefined =>
  typeof x === 'string' && x.trim() ? x.trim().slice(0, max) : undefined

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
 * Un animateur COMPLET (même exigence que `isHost` du codec de l'app, plus un id et un prénom
 * non vides) : sans genre, pas de voix ; sans prénom, pas de « Tu es … ». Sinon : écarté.
 */
export function animateurValide(x: unknown): RadioHost | null {
  if (!estObjet(x)) return null
  const id = texte(x.id, 80), name = texte(x.name, 80)
  if (!id || !name) return null
  if (!(GENRES as readonly unknown[]).includes(x.gender)) return null
  if (typeof x.trait !== 'string' || typeof x.color !== 'string' || typeof x.avatar !== 'string') return null
  return { id, name, gender: x.gender as RadioHost['gender'], trait: x.trait.trim().slice(0, 300), color: x.color, avatar: x.avatar }
}

function sourceValide(x: unknown): NewsSource | null {
  if (!estObjet(x)) return null
  const url = typeof x.url === 'string' ? x.url.trim() : ''
  if (!url || !(TYPES_SOURCES as readonly unknown[]).includes(x.type)) return null
  return { type: x.type as NewsSource['type'], url, title: typeof x.title === 'string' ? x.title.trim() : '' }
}

function borne(x: unknown, min: number, max: number, defaut: number): number {
  const v = typeof x === 'number' && Number.isFinite(x) ? x : defaut
  return Math.max(min, Math.min(max, v))
}
const parmi = <T extends string>(liste: readonly T[], x: unknown, defaut: T): T =>
  typeof x === 'string' && (liste as readonly string[]).includes(x) ? x as T : defaut

/** `rythme` : même lecture que `lireRythme` de l'app (objet → 7 champs bornés, défauts Pulse sinon). */
export function lireRythme(x: unknown): RythmeStation | undefined {
  if (!estObjet(x)) return undefined
  return {
    dialogueDensity:         borne(x.dialogueDensity, 0, 100, DEFAULT_RHYTHM.dialogueDensity),
    interventionRate:        parmi(INTERVENTION_RATES, x.interventionRate, DEFAULT_RHYTHM.interventionRate),
    averageSegmentSec:       borne(x.averageSegmentSec, 30, 180, DEFAULT_RHYTHM.averageSegmentSec),
    globalMood:              parmi(GLOBAL_MOODS, x.globalMood, DEFAULT_RHYTHM.globalMood),
    verbosity:               parmi(VERBOSITIES, x.verbosity, DEFAULT_BEHAVIOR.verbosity),
    interruptionTendency:    borne(x.interruptionTendency, 0, 100, DEFAULT_BEHAVIOR.interruptionTendency),
    contradictionPropensity: borne(x.contradictionPropensity, 0, 100, DEFAULT_BEHAVIOR.contradictionPropensity),
  }
}

/** `actualite` : ignorée si `part` n'est pas un nombre ; sinon entier ramené dans 0-100. */
export function lireActualite(x: unknown): ActualiteStation | undefined {
  if (!estObjet(x) || typeof x.part !== 'number' || !Number.isFinite(x.part)) return undefined
  return { part: Math.round(borne(x.part, 0, 100, 50)) }
}

/** `appels` : ignorés si `actifs` n'est pas un booléen ; `nombre` 1-5, `tousLesNJours` 1-30. */
export function lireAppels(x: unknown): AppelsStation | undefined {
  if (!estObjet(x) || typeof x.actifs !== 'boolean') return undefined
  return {
    actifs:        x.actifs,
    nombre:        Math.round(borne(x.nombre, 1, 5, 1)),
    tousLesNJours: Math.round(borne(x.tousLesNJours, 1, 30, 1)),
  }
}

/**
 * Lit la fiche depuis le contenu d'un event 30091. Pure : c'est la logique qui décide
 * ce qui passe à l'antenne, elle doit s'éprouver sans réseau.
 */
export function lireReglages(content: string): ReglagesStation | null {
  let c: Record<string, unknown>
  try { c = JSON.parse(content) as Record<string, unknown> } catch { return null }
  if (!estObjet(c) || c.deleted === true) return null
  const out: ReglagesStation = {}

  const name = texte(c.name, 80);               if (name) out.name = name
  const tagline = texte(c.tagline, 200);        if (tagline) out.tagline = tagline
  const description = texte(c.description, MAX_DESCRIPTION); if (description) out.description = description
  if ((LANGUES as readonly unknown[]).includes(c.language)) out.language = c.language as StationLanguage

  if (Array.isArray(c.hosts)) {
    const vus = new Set<string>()
    const h = c.hosts.map(animateurValide)
      .filter((x): x is RadioHost => !!x && !vus.has(x.id) && !!vus.add(x.id))
      .slice(0, MAX_HOTES)
    if (h.length > 0) out.hosts = h       // aucun animateur complet : la seed garde les siens
  }
  if (Array.isArray(c.guestIds)) {
    out.guestIds = [...new Set(c.guestIds.filter((x): x is string => typeof x === 'string' && !!x.trim()).map(x => x.trim()))]
      .slice(0, MAX_INVITES)
  }
  if (Array.isArray(c.sources)) {
    const s = c.sources.map(sourceValide).filter((x): x is NewsSource => !!x).slice(0, MAX_SOURCES)
    if (s.length > 0) out.sources = s     // liste vide : on ne coupe pas l'actu (c'est le rôle d'`actualite.part = 0`)
  }
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
  const rythme = lireRythme(c.rythme);          if (rythme) out.rythme = rythme
  const actualite = lireActualite(c.actualite); if (actualite) out.actualite = actualite
  const appels = lireAppels(c.appels);          if (appels) out.appels = appels
  return out
}

/** Auteur reconnu ? `admins` null = filtre levé (`RADIO_ADMIN_PUBKEYS='*'`, explicitement). */
export function estAdmin(pubkey: string, admins: ReadonlySet<string> | null): boolean {
  return admins === null || admins.has(pubkey.toLowerCase())
}

/**
 * Parmi des events 30091 portant le d-tag de la station : le plus récent (date SIGNÉE) d'un
 * ADMINISTRATEUR radio. Égalité de date : l'id départage (comme l'app). Pure.
 */
export function retenirEvent(
  events: NostrEvent[], stationId: string, admins: ReadonlySet<string> | null,
): NostrEvent | null {
  let retenu: NostrEvent | null = null
  for (const e of events) {
    if (e.kind !== KIND_RADIO_STATION) continue
    if (e.tags.find(t => t[0] === 'd')?.[1] !== stationId) continue
    if (!estAdmin(e.pubkey, admins)) continue
    if (!retenu || e.created_at > retenu.created_at || (e.created_at === retenu.created_at && e.id > retenu.id)) retenu = e
  }
  return retenu
}

/**
 * Applique une fiche à une station : les champs présents remplacent, les autres restent. Pure.
 * La langue n'est reprise que si elle a une voix commercialisable (lib/voix.ts) : sinon
 * `generate-broadcast` renoncerait à toute l'émission pour un réglage impossible.
 */
export function appliquerReglages(station: RadioStation, r: ReglagesStation | null): RadioStation {
  if (!r) return station
  const langueOk = r.language !== undefined && langueSynthetisable(r.language)
  return {
    ...station,
    ...(r.name ? { name: r.name } : {}),
    ...(r.tagline ? { tagline: r.tagline } : {}),
    ...(r.description ? { description: r.description } : {}),
    ...(langueOk ? { language: r.language } : {}),
    ...(r.hosts && r.hosts.length > 0 ? { hosts: r.hosts } : {}),
    ...(r.guestIds ? { guestIds: r.guestIds } : {}),
    ...(r.sources && r.sources.length > 0 ? { sources: r.sources } : {}),
    ...(r.tracks ? { tracks: r.tracks } : {}),
    ...(r.jingles ? { jingles: r.jingles } : {}),
    ...(r.skipMusic !== undefined ? { skipMusic: r.skipMusic } : {}),
    ...(r.pauses !== undefined ? { pauses: r.pauses } : {}),
    ...(r.pauseDureeS !== undefined ? { pauseDureeS: r.pauseDureeS } : {}),
    ...(r.rythme ? { rythme: r.rythme } : {}),
    ...(r.actualite ? { actualite: r.actualite } : {}),
    ...(r.appels ? { appels: r.appels } : {}),
  }
}

/** Ce qui a changé, en clair, pour le journal de la nuit. Pure. */
export function resumerReglages(r: ReglagesStation, station?: RadioStation): string {
  const langueRefusee = r.language !== undefined && !langueSynthetisable(r.language)
  return [
    r.name ? `nom « ${r.name} »` : null,
    r.tagline ? 'slogan' : null,
    r.description ? 'raison d\'être' : null,
    r.language ? (langueRefusee ? `langue ${r.language} REFUSÉE (aucune voix) → ${station?.language ?? 'fr'}` : `langue ${r.language}`) : null,
    r.hosts ? `${r.hosts.length} animateur(s)` : null,
    r.guestIds ? `${r.guestIds.length} invité(s)` : null,
    r.sources ? `${r.sources.length} source(s)` : null,
    r.tracks ? `${r.tracks.length} musique(s)` : null,
    r.jingles ? `${r.jingles.length} jingle(s)` : null,
    r.skipMusic !== undefined ? `skipMusic=${r.skipMusic}` : null,
    r.pauses !== undefined ? `pauses=${r.pauses}` : null,
    r.pauseDureeS !== undefined ? `pause=${r.pauseDureeS}s` : null,
    r.rythme ? `rythme ${r.rythme.globalMood}/${r.rythme.dialogueDensity}` : null,
    r.actualite ? `actualité ${r.actualite.part} %` : null,
    r.appels ? `appels ${r.appels.actifs ? `${r.appels.nombre}/${r.appels.tousLesNJours} j` : 'coupés'}` : null,
  ].filter(Boolean).join(', ')
}

// ── Stations AJOUTÉES depuis l'IHL (d-tag hors seed) ─────────────────────

/** Pourquoi une fiche hors seed n'est pas fabriquée (null = complète). Pure. */
export function stationAjoutee(
  e: NostrEvent, seeds: readonly RadioStation[],
): { station: RadioStation | null; motif?: string } {
  const id = e.tags.find(t => t[0] === 'd')?.[1]
  if (!id || !/^[a-z0-9][a-z0-9-]{1,63}$/.test(id)) return { station: null, motif: 'd-tag illisible' }
  let c: Record<string, unknown>
  try { c = JSON.parse(e.content) as Record<string, unknown> } catch { return { station: null, motif: 'contenu illisible' } }
  if (!estObjet(c) || c.deleted === true) return { station: null, motif: 'pierre tombale' }
  if (!(TYPES_STATION as readonly unknown[]).includes(c.kind)) return { station: null, motif: 'type de station inconnu de l\'app' }
  const frequency = Number(c.frequency)
  if (!Number.isFinite(frequency)) return { station: null, motif: 'sans fréquence' }
  if (seeds.some(s => Math.abs(s.frequency - frequency) <= TOLERANCE_FREQUENCE)) {
    return { station: null, motif: `fréquence ${frequency} déjà prise par une station de départ (l'app ne l'affiche pas)` }
  }
  const r = lireReglages(e.content)
  if (!r?.name) return { station: null, motif: 'sans nom' }
  if (!r.language) return { station: null, motif: 'sans langue' }
  if (!langueSynthetisable(r.language)) return { station: null, motif: `langue ${r.language} sans voix commercialisable` }
  if (!r.hosts || r.hosts.length === 0) return { station: null, motif: 'aucun animateur complet' }
  const base: RadioStation = {
    id, kind: c.kind as StationKind, frequency, name: r.name, tagline: '',
    color: typeof c.color === 'string' ? c.color : '#7c3aed',
    language: r.language, hosts: r.hosts, live: false, creatorPubkey: null,
  }
  return { station: appliquerReglages(base, r) }
}

/**
 * Les stations ajoutées par un ADMIN dans l'IHL : pour chaque d-tag hors seed, la fiche la plus
 * récente d'un admin, si elle est complète (nom, langue avec voix, au moins un animateur). Pure.
 */
export function stationsAjouteesIHL(
  events: NostrEvent[], admins: ReadonlySet<string> | null, seeds: readonly RadioStation[],
): { stations: RadioStation[]; ecartees: Array<{ id: string; motif: string }> } {
  const seedIds = new Set(seeds.map(s => s.id))
  const ids = new Set<string>()
  for (const e of events) {
    const d = e.tags.find(t => t[0] === 'd')?.[1]
    if (e.kind === KIND_RADIO_STATION && d && !seedIds.has(d) && estAdmin(e.pubkey, admins)) ids.add(d)
  }
  const stations: RadioStation[] = []
  const ecartees: Array<{ id: string; motif: string }> = []
  for (const id of [...ids].sort()) {
    const e = retenirEvent(events, id, admins)!
    const { station, motif } = stationAjoutee(e, seeds)
    if (station) stations.push(station)
    else ecartees.push({ id, motif: motif ?? '?' })
  }
  return { stations, ecartees }
}

// ── Réseau ───────────────────────────────────────────────────────────────

async function lireEvents(filtre: { '#d'?: string[] }, timeoutMs: number): Promise<NostrEvent[]> {
  const relays = getRelays()
  const pool = new SimplePool()
  try {
    return await pool.querySync(relays, { kinds: [KIND_RADIO_STATION], limit: 500, ...filtre }, { maxWait: timeoutMs })
  } finally {
    pool.close(relays)
  }
}

/** Interroge les relais et rend la station telle que l'IHL l'a réglée (ou la seed, en le disant). */
export async function stationSelonIHL(station: RadioStation, timeoutMs = 8000): Promise<RadioStation> {
  try {
    const events = await lireEvents({ '#d': [station.id] }, timeoutMs)
    const e = retenirEvent(events, station.id, adminPubkeys())
    if (!e) {
      console.log(`    [station] aucune fiche IHL d'administrateur pour ${station.id} — seed`)
      return station
    }
    const r = lireReglages(e.content)
    if (!r) return station
    console.log(`    [station] fiche IHL de ${e.pubkey.slice(0, 8)} (${new Date(e.created_at * 1000).toISOString().slice(0, 10)}) : ${resumerReglages(r, station) || 'rien d\'utile'}`)
    return appliquerReglages(station, r)
  } catch (err) {
    console.warn(`    [station] relais illisibles (${(err as Error).message.slice(0, 80)}) — seed`)
    return station
  }
}

/** Une station AJOUTÉE dans l'IHL (hors seed), relue sur les relais ; null si absente ou incomplète. */
export async function stationAjouteeSelonIHL(
  stationId: string, seeds: readonly RadioStation[], timeoutMs = 8000,
): Promise<RadioStation | null> {
  try {
    const events = await lireEvents({ '#d': [stationId] }, timeoutMs)
    const e = retenirEvent(events, stationId, adminPubkeys())
    if (!e) return null
    const { station, motif } = stationAjoutee(e, seeds)
    if (!station) console.warn(`    [station] fiche IHL de ${stationId} écartée : ${motif}`)
    return station
  } catch (err) {
    console.warn(`    [station] relais illisibles (${(err as Error).message.slice(0, 80)})`)
    return null
  }
}

/** Toutes les stations ajoutées par un admin dans l'IHL (relais illisibles → aucune, en le disant). */
export async function fetchStationsAjoutees(
  seeds: readonly RadioStation[], timeoutMs = 8000,
): Promise<RadioStation[]> {
  try {
    const { stations, ecartees } = stationsAjouteesIHL(await lireEvents({}, timeoutMs), adminPubkeys(), seeds)
    for (const x of ecartees) console.log(`   · ${x.id} écartée : ${x.motif}`)
    return stations
  } catch (err) {
    console.warn(`   ⚠ relais illisibles (${(err as Error).message.slice(0, 80)}) — aucune station ajoutée cette nuit`)
    return []
  }
}
