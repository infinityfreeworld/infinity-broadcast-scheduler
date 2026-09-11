/**
 * @module InfinityScheduler/TV/Assemble
 * @description Fonctions PURES d'assemblage (testables hors-ligne, sans WAF ni
 *   relais) : conducteur → shots de montage, → segments EPG (chapitrage), →
 *   objet TvProgram prêt à publier.
 */
import type { TvChannelConfig, TvConductor, TvProgram } from './tv-types'
import type { RenderShot, RenderResult } from './waf'
import type { VoiceTiming } from './tv-voice'

/**
 * Réécrit les durées du conducteur avec celles MESURÉES à la synthèse vocale.
 *
 * Le LLM propose une durée sans savoir combien de temps sa phrase prend à dire.
 * Une fois la voix enregistrée, cette proposition n'a plus lieu d'être : on la
 * remplace, sinon l'image et le son dérivent l'un de l'autre dès le deuxième
 * sujet (le montage cale la vidéo sur la durée de l'audio).
 *
 * Fonction PURE — c'est elle qu'on vérifie hors ligne, pas la synthèse.
 */
export function applyTimings(conductor: TvConductor, timings: VoiceTiming[]): TvConductor {
  return {
    ...conductor,
    segments: conductor.segments.map((s, i) => {
      const t = timings.find(x => x.index === i)
      return t ? { ...s, durationSec: t.durationSec } : s
    }),
  }
}

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
  opts: { generator?: string } = {},
): TvProgram {
  const id = `${channel.id}:${isoDate(airDateMs)}`
  return {
    id,
    channelId: channel.id,
    title: conductor.title,
    videoCid: render?.ipfs,
    // L'URL de la forge reste un SECOURS, jamais l'unique adresse : elle sert
    // à jouer tout de suite, le CID à survivre au domaine.
    // ⚠️ L'URL DE LA FORGE PART TOUJOURS, CID OU PAS. Jusqu'au 11/09/2026 elle n'était publiée
    // qu'en l'ABSENCE de CID ; depuis qu'on attend le CID (attendreCid), elle ne partait plus du
    // tout — et la télé est restée NOIRE. La passerelle IPFS de data-space devine le type de
    // CHAQUE plage d'octets : une plage prise au milieu part en `application/octet-stream` +
    // `nosniff`, Chrome la bloque (ERR_BLOCKED_BY_ORB) et la vidéo reste figée SANS erreur. Le
    // JT du 09/09 (2,6 Mo) arrivait en entier du premier coup ; celui du 10/09 (5,6 Mo) exigeait
    // une plage au milieu pour l'horloge virtuelle. La forge, elle, sert `video/mp4`, et le
    // lecteur la met en tête des sources. Les deux adresses sont complémentaires : l'URL pour
    // jouer, le CID pour survivre au domaine.
    blossomUrl: render?.url,
    // La vignette évite le rectangle noir sur la grille des chaînes. On
    // préfère son CID à son URL, pour la même raison que la vidéo.
    poster: render?.poster?.ipfs ?? render?.poster?.url,
    durationSec: render?.durationSec ?? totalDuration(conductor),
    airDateMs,
    segments: buildEpg(conductor),
    generator: opts.generator ?? 'ffmpeg-compose+llm',
  }
}
