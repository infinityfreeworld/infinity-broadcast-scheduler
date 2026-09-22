/**
 * @module InfinityScheduler/Types
 * @description Types portés depuis infinity/src/modules/radio/types.ts.
 *
 *   IMPORTANT : ces types DOIVENT rester en sync avec ceux du repo Infinity
 *   (panneau-radio, broadcast-codec) pour que les events NOSTR kind:30093
 *   publiés ici soient correctement parsés là-bas.
 */

export type StationKind =
  | 'wtf' | 'freeworld' | 'bigballs' | 'mindctrl'
  | 'hydrogene' | 'g1' | 'deglingos' | 'diginomad' | 'tech'
  | 'pirate' | 'oasis'
  | 'user'

export type StationLanguage = 'fr' | 'en' | 'es' | 'it' | 'pt' | 'hi' | 'ja' | 'zh' | 'ru'

/** Phase H.3 (2026-05-20) — IDs des guests assignables à une station.
 *  Ajouté à `RadioStation.guestIds?: string[]` dans l'interface ci-dessous. */

export interface TrackRef {
  title: string
  cid?: string
  url?: string
  durationS?: number
}

export interface RadioHost {
  id: string
  name: string
  gender: 'male' | 'female' | 'androgyn'
  trait: string
  color: string
  avatar: string
}

export interface NewsSource {
  type:  'rss' | 'web' | 'nostr'
  url:   string
  title: string
}

export interface RadioStation {
  id:           string
  kind:         StationKind
  frequency:    number
  name:         string
  tagline:      string
  color:        string
  language?:    StationLanguage
  hosts:        RadioHost[]
  live:         boolean
  creatorPubkey: string | null
  tracks?:      TrackRef[]
  sources?:     NewsSource[]
  description?: string
  skipMusic?:   boolean
  /**
   * Jingles (CID) joués au début et à la fin de l'émission — distincts des `tracks`
   * (musiques de pause). Déclarés dans l'IHL (📯 Jingles, kind 30091).
   */
  jingles?:     TrackRef[]
  /** Nombre de pauses musicales DANS l'émission (IHL, kind 30091) ; défaut : MUSIQUE_PAUSES ou 2. */
  pauses?:      number
  /** Durée maximale d'une pause, en secondes (IHL, kind 30091) ; défaut : MUSIQUE_PAUSE_S ou 180. */
  pauseDureeS?: number
  /** Phase H.3 — IDs des guests (kind:30098) invitables par cette station. */
  guestIds?:    string[]
}

export interface HostKBEntry {
  id:       string
  title:    string
  body:     string
  tags:     string[]
  weight:   1 | 2 | 3
  sources?: string[]
}

export interface HostKB {
  hostId:       string
  stationId:    string
  personality:  string
  entries:      HostKBEntry[]
  updatedAt:    number
}

export interface BroadcastTurn {
  id:       string
  hostId:   string
  hostName: string
  color:    string
  avatar:   string
  text:     string
  tStart:   number
  tEnd:     number
}

/**
 * Un passage NON parlé de l'émission, cuit dans l'audio : pause musicale ou jingle.
 * Contrat avec l'application (`src/modules/radio/broadcast/types.ts`, 16/09/2026 pour
 * `jingle`, 22/09/2026 pour `music`) : elle s'en sert pour afficher « 🎵 titre ».
 */
export interface BroadcastSegment {
  type:   'music' | 'jingle'
  cid?:   string
  title?: string
  tStart: number
  tEnd:   number
}

export interface RadioBroadcast {
  stationId:   string
  date:        string       // YYYY-MM-DD
  language:    string
  durationSec: number
  audioCid:    string
  audioMime:   string
  turns:       BroadcastTurn[]
  /** Pauses musicales et jingles (absent quand l'émission n'en a pas). */
  segments?:   BroadcastSegment[]
  newsRefs:    string[]
  model:       string
  generatedBy: string       // pubkey hex
  generatedAt: number       // unix epoch sec
}

export interface NewsItem {
  title:        string
  summary?:     string
  link?:        string
  publishedAt?: number    // epoch ms
  sourceTitle:  string
}
