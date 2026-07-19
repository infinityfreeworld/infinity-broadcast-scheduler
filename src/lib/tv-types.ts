/**
 * @module InfinityScheduler/TV
 * @description Modèle du générateur TV. Miroir léger des types côté app Infinity
 *   (`src/modules/tv/tv-types.ts`) : une CHAÎNE a une config (thème + sources),
 *   un PROGRAMME quotidien est produit (JT/émission) puis publié en NOSTR
 *   (kind TV_PROGRAM = 30184). La VIDÉO reste hors-event (CID IPFS renvoyé par
 *   WAF /api/v1/render).
 */
import type { NewsSource } from './types'

/** Chaîne TV côté générateur (config éditoriale). */
export interface TvChannelConfig {
  /** Identifiant stable (= TvChannel.id côté app, ex 'tv-jt-fr'). */
  id: string
  /** Nom affiché. */
  name: string
  /** Langue du conducteur/narration. */
  language: 'fr' | 'en' | 'es' | 'pt' | 'ru'
  /** Thème éditorial (guide le LLM). Ex : « journal des solutions écologiques ». */
  theme: string
  /** Sources RSS pour nourrir le conducteur (réutilise la couche news radio). */
  sources?: NewsSource[]
  /** Nombre de segments visés (défaut 4). */
  segments?: number
  /** Résolution/fps de rendu (défauts 1280×720 @ 30). */
  width?: number
  height?: number
  fps?: number
}

/** Un segment de conducteur produit par le LLM. */
export interface TvSegment {
  /** Titre affiché en lower-third (bandeau bas). */
  title: string
  /** Sous-titre / accroche (optionnel). */
  subtitle?: string
  /** Prompt d'image (envoyé à WAF pour générer le visuel du plan). */
  imagePrompt: string
  /** Voix-off (narration) — utilisée plus tard pour le TTS (optionnel en v0). */
  narration?: string
  /** Durée du plan, en secondes. */
  durationSec: number
}

/** Conducteur complet d'un épisode. */
export interface TvConductor {
  title: string
  segments: TvSegment[]
}

/**
 * Un PROGRAMME TV prêt à publier (kind TV_PROGRAM 30184). Champs alignés 1:1 sur
 * `src/modules/tv/tv-program-codec.ts` de l'app (round-trip garanti).
 */
export interface TvProgram {
  /** d-tag. Convention : `${channelId}:${airDateISO}`. */
  id: string
  channelId: string
  title: string
  /** CID IPFS du .mp4 rendu (renvoyé par WAF /api/v1/render). */
  videoCid?: string
  blossomUrl?: string
  sha256?: string
  durationSec: number
  /** Diffusion prévue (ms epoch) — ancre d'horloge virtuelle côté player. */
  airDateMs: number
  poster?: string
  segments?: { title: string; startSec: number; durationSec?: number }[]
  /** Origine (ex 'ffmpeg-compose+haiku'). */
  generator?: string
}
