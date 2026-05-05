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
  | 'user'

export type StationLanguage = 'fr' | 'en' | 'es' | 'it' | 'pt' | 'hi' | 'ja' | 'zh'

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

export interface RadioBroadcast {
  stationId:   string
  date:        string       // YYYY-MM-DD
  language:    string
  durationSec: number
  audioCid:    string
  audioMime:   string
  turns:       BroadcastTurn[]
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
