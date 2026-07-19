/**
 * @module InfinityScheduler/TV/Conductor
 * @description Génère le CONDUCTEUR d'un épisode TV via le LLM (réutilise
 *   `callAnthropic`). Entrée : thème de chaîne + actualités ; sortie : un JSON
 *   { title, segments[] } où chaque segment porte un titre (lower-third), un
 *   prompt d'image (pour WAF) et une narration (voix-off, TTS ultérieur).
 */
import { callAnthropic } from './anthropic'
import type { TvChannelConfig, TvConductor, TvSegment } from './tv-types'

const SYSTEM = `Tu es le rédacteur en chef d'une chaîne de télévision décentralisée.
À partir d'un thème et d'actualités, tu produis le CONDUCTEUR d'un court épisode
(type journal / magazine). Tu réponds UNIQUEMENT par un objet JSON valide, sans
texte autour, de la forme :
{
  "title": "titre de l'épisode",
  "segments": [
    { "title": "titre court du plan (lower-third)", "subtitle": "accroche courte",
      "imagePrompt": "prompt visuel en anglais, cinématique, 16:9, sans texte incrusté",
      "narration": "1 à 2 phrases de voix-off", "durationSec": 8 }
  ]
}
Règles : segments concis, imagePrompt DESCRIPTIF et visuel (pas de mots dans l'image),
narration factuelle et posée, durationSec entre 5 et 12. Pas de contenu haineux,
racoleur ni faux. Langue de title/subtitle/narration = la langue demandée.`

function extractJson(text: string): unknown {
  // Le modèle peut entourer le JSON de ``` ou de texte : on isole { … }.
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/)
  const raw = fenced ? fenced[1] : text
  const start = raw.indexOf('{')
  const end = raw.lastIndexOf('}')
  if (start < 0 || end <= start) throw new Error('conducteur : pas de JSON dans la réponse LLM')
  return JSON.parse(raw.slice(start, end + 1))
}

function sanitizeSegments(raw: unknown, want: number): TvSegment[] {
  const arr = Array.isArray(raw) ? raw : []
  const segs: TvSegment[] = arr
    .filter((s): s is Record<string, unknown> => !!s && typeof s === 'object')
    .map(s => ({
      title:       String(s.title ?? '').slice(0, 80),
      subtitle:    s.subtitle ? String(s.subtitle).slice(0, 120) : undefined,
      imagePrompt: String(s.imagePrompt ?? s.title ?? '').slice(0, 400),
      narration:   s.narration ? String(s.narration).slice(0, 400) : undefined,
      durationSec: Math.min(12, Math.max(5, Number(s.durationSec) || 8)),
    }))
    .filter(s => s.title && s.imagePrompt)
  return segs.slice(0, Math.max(1, want))
}

/**
 * Produit le conducteur. `newsBlock` = actualités déjà formatées (peut être vide).
 */
export async function generateConductor(
  channel: TvChannelConfig,
  newsBlock: string,
  apiKey: string,
  model?: string,
): Promise<TvConductor> {
  const want = channel.segments ?? 4
  const user = [
    `Chaîne : ${channel.name}`,
    `Thème : ${channel.theme}`,
    `Langue : ${channel.language}`,
    `Nombre de segments : ${want}`,
    newsBlock ? `\nActualités récentes :\n${newsBlock}` : '\n(Pas d’actualités fournies — compose un épisode intemporel sur le thème.)',
  ].join('\n')

  const resp = await callAnthropic({
    apiKey,
    model,
    systemPrompt: SYSTEM,
    messages: [{ role: 'user', content: user }],
    maxTokens: 1400,
    temperature: 0.8,
  })

  const obj = extractJson(resp.text) as { title?: unknown; segments?: unknown }
  const segments = sanitizeSegments(obj.segments, want)
  if (!segments.length) throw new Error('conducteur : aucun segment exploitable')
  return {
    title: String(obj.title ?? channel.name).slice(0, 120),
    segments,
  }
}
