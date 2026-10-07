/**
 * @module InfinityScheduler/Types
 * @description Types portés depuis infinity/src/modules/radio/types.ts.
 *
 *   IMPORTANT : ces types DOIVENT rester en sync avec ceux du repo Infinity
 *   (panneau-radio, broadcast-codec) pour que les events NOSTR kind:30093
 *   publiés ici soient correctement parsés là-bas.
 */

import type { InterventionRate, GlobalMood, Verbosity } from './pulse'

export type StationKind =
  | 'wtf' | 'freeworld' | 'bigballs' | 'mindctrl'
  | 'hydrogene' | 'g1' | 'deglingos' | 'diginomad' | 'tech'
  | 'pirate' | 'oasis'
  | 'manifestactions'   // 07/10/2026 — les Manifestactions de la carte, ou leur raison d'être
  | 'abondance'         // 07/10/2026 — les projets d'Abondance, ou sa raison d'être
  | 'obf'               // 07/10/2026 — le système d'alerte OBF, les crises, et comment le soutenir
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
  /** 07/10/2026 — rythme PROPRE à la station (IHL, kind 30091), remplace le Pulse 30101/30102. */
  rythme?:      RythmeStation
  /** 07/10/2026 — part de l'actualité dans l'émission (IHL, kind 30091). */
  actualite?:   ActualiteStation
  /** 07/10/2026 — appels d'auditeurs (IHL, kind 30091). Lu, PAS encore fabriqué. */
  appels?:      AppelsStation
}

/**
 * 07/10/2026 — Contrat avec l'app (`src/modules/radio/types.ts`, branche
 * `feat/radio-stations-reglages-ihl`) : mêmes noms, bornes et sens que le Pulse.
 */
export interface RythmeStation {
  /** 0-100 */
  dialogueDensity:         number
  interventionRate:        InterventionRate
  /** 30-180 secondes */
  averageSegmentSec:       number
  globalMood:              GlobalMood
  verbosity:               Verbosity
  /** 0-100 */
  interruptionTendency:    number
  /** 0-100 */
  contradictionPropensity: number
}

/** 0-100 — part du temps de parole consacrée à l'actualité récupérée. */
export interface ActualiteStation {
  part: number
}

/** `nombre` (1-5) appels d'auditeurs tous les `tousLesNJours` (1-30) jours. */
export interface AppelsStation {
  actifs:        boolean
  nombre:        number
  tousLesNJours: number
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
  /**
   * Titre court de l'émission (≤ 70 car., langue de la station) pour la liste « Émissions
   * précédentes ». OPTIONNEL (04/10/2026) : absent quand le modèle n'a pas pu l'écrire.
   */
  titre?:      string
  /** Résumé du thème, 1 ou 2 phrases (≤ 220 car., langue de la station). OPTIONNEL. */
  resume?:     string
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
