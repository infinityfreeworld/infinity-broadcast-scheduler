/**
 * @module InfinityScheduler/TV/Assemble
 * @description Fonctions PURES d'assemblage (testables hors-ligne, sans WAF ni
 *   relais) : conducteur → shots de montage, → segments EPG (chapitrage), →
 *   objet TvProgram prêt à publier.
 */
import type { TvChannelConfig, TvConductor, TvProgram } from './tv-types'
import type { RenderShot, RenderResult } from './waf'

/** Conducteur + assetIds d'images WAF → shots pour /api/v1/render.
 *  Le mouvement Ken Burns alterne in/out pour du rythme. */
export function buildShots(conductor: TvConductor, imageAssetIds: string[]): RenderShot[] {
  return conductor.segments.map((s, i) => ({
    assetId: imageAssetIds[i],
    durationSec: s.durationSec,
    motion: i % 2 === 0 ? 'in' : 'out',
    title: s.title,
    subtitle: s.subtitle,
  }))
}

/** Segments EPG (chapitrage) : startSec cumulé à partir des durées. */
export function buildEpg(conductor: TvConductor): { title: string; startSec: number; durationSec: number }[] {
  let t = 0
  return conductor.segments.map(s => {
    const seg = { title: s.title, startSec: t, durationSec: s.durationSec }
    t += s.durationSec
    return seg
  })
}

/** Durée totale prévue (somme des segments). */
export function totalDuration(conductor: TvConductor): number {
  return conductor.segments.reduce((a, s) => a + s.durationSec, 0)
}

/** Date ISO (YYYY-MM-DD) en UTC — clé de replaceable stable par jour. */
export function isoDate(airDateMs: number): string {
  return new Date(airDateMs).toISOString().slice(0, 10)
}

/**
 * Assemble l'objet TvProgram final. `render` optionnel : sans lui (dry-run), le
 * programme est produit sans vidéo (pour inspection). Avec lui, on prend le CID
 * si WAF l'a déjà pinné, sinon l'URL publique WAF en `blossomUrl` (jouable tout
 * de suite par le player en attendant le pin IPFS).
 */
export function buildProgram(
  channel: TvChannelConfig,
  conductor: TvConductor,
  airDateMs: number,
  render?: RenderResult,
): TvProgram {
  const id = `${channel.id}:${isoDate(airDateMs)}`
  return {
    id,
    channelId: channel.id,
    title: conductor.title,
    videoCid: render?.ipfs,
    blossomUrl: render && !render.ipfs ? render.url : undefined,
    durationSec: render?.durationSec ?? totalDuration(conductor),
    airDateMs,
    segments: buildEpg(conductor),
    generator: 'ffmpeg-compose+llm',
  }
}
