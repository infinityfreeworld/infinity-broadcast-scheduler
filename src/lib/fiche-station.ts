/**
 * @module InfinityScheduler/FicheStation
 * @description Ce que la fiche d'une station (kind 30091, réglée dans l'IHL) change à
 *   l'ÉCRITURE de l'émission. Tout est pur : la décision se teste sans réseau ni modèle.
 *
 *   · Rythme : réglage propre d'une persona (30103, inchangé) → `station.rythme` → ancien
 *     Pulse (30102 puis 30101, héritage, lecture seule) → défauts.
 *   · Raison d'être (`description`) : la LIGNE ÉDITORIALE, section dédiée du prompt.
 *   · Part d'actualité (0-100) : quels tours partent de l'actu récupérée, lesquels des thèmes
 *     propres de la station. 0 = l'actu n'est même pas récupérée.
 *   · Appels d'auditeurs : `appelsDuJour` dit combien d'appels sont PRÉVUS un jour donné.
 *     Aucun appel n'est fabriqué (lot suivant, décision du Bâtisseur en attente).
 */

import {
  DEFAULT_RHYTHM, DEFAULT_BEHAVIOR,
  type PulseRhythm, type PulseBehavior, type PulseSnapshot,
} from './pulse'
import type { RadioStation, AppelsStation } from './types'

// ── Rythme ──────────────────────────────────────────────────────────────

export type OrigineRythme = 'station' | 'pulse-station' | 'pulse-global' | 'defauts'

/**
 * Le rythme de la station et d'où il vient. `actif` = faut-il l'écrire dans le prompt ?
 * Comme avant : tant que RIEN n'a été réglé (ni fiche, ni Pulse), le prompt reste celui d'avant.
 */
export function rythmeEffectif(
  station: Pick<RadioStation, 'id' | 'rythme'>, snap: PulseSnapshot,
): { rhythm: PulseRhythm; origine: OrigineRythme; actif: boolean } {
  const pulsePublie = snap.global !== null
    || Object.keys(snap.byStation).length > 0
    || Object.keys(snap.byPersona).length > 0
  if (station.rythme) {
    const { dialogueDensity, interventionRate, averageSegmentSec, globalMood } = station.rythme
    return { rhythm: { dialogueDensity, interventionRate, averageSegmentSec, globalMood }, origine: 'station', actif: true }
  }
  const parStation = snap.byStation[station.id]
  if (parStation) return { rhythm: parStation, origine: 'pulse-station', actif: true }
  if (snap.global) return { rhythm: snap.global.rhythm, origine: 'pulse-global', actif: true }
  return { rhythm: DEFAULT_RHYTHM, origine: 'defauts', actif: pulsePublie }
}

/** Tenue d'une persona : son réglage propre (30103) → la station → Pulse global → défauts. */
export function tenueEffective(
  personaKey: string, station: Pick<RadioStation, 'rythme'>, snap: PulseSnapshot,
): PulseBehavior {
  const propre = snap.byPersona[personaKey]
  if (propre) return propre
  if (station.rythme) {
    const { verbosity, interruptionTendency, contradictionPropensity } = station.rythme
    return { verbosity, interruptionTendency, contradictionPropensity }
  }
  return snap.global?.behavior ?? DEFAULT_BEHAVIOR
}

// ── Raison d'être ───────────────────────────────────────────────────────

/**
 * Section « LIGNE ÉDITORIALE » du prompt : la raison d'être réglée dans l'IHL. Absente sans
 * description (le prompt reste celui d'avant).
 */
export function ligneEditoriale(station: Pick<RadioStation, 'name' | 'tagline' | 'description'>): string | undefined {
  const d = station.description?.trim()
  if (!d) return undefined
  const slogan = station.tagline?.trim() ? `\nSlogan de ${station.name} : « ${station.tagline.trim()} »` : ''
  return `${d}${slogan}\n→ C'est la RAISON D'ÊTRE de la station : chacun de tes propos la sert. Les sujets, l'angle et le ton en découlent ; ne t'en écarte pas pour meubler.`
}

// ── Part d'actualité ────────────────────────────────────────────────────

/** Faut-il récupérer l'actu ? Non seulement si la part est réglée à 0. */
export function actualitesVoulues(station: Pick<RadioStation, 'actualite'>): boolean {
  return station.actualite === undefined || station.actualite.part > 0
}

/**
 * Indices des tours qui partent de l'actualité : `round(part % × tours)` tours, répartis
 * régulièrement dans l'émission (déterministe). Sans réglage : tous (comportement d'avant).
 */
export function toursActualite(part: number | undefined, numTurns: number): Set<number> {
  const n = Math.max(0, Math.floor(numTurns))
  if (part === undefined) return new Set(Array.from({ length: n }, (_, i) => i))
  const p = Math.max(0, Math.min(100, part))
  const cible = Math.round((p / 100) * n)
  const out = new Set<number>()
  for (let i = 0; i < n; i++) {
    if (Math.floor(((i + 1) * cible) / n) > Math.floor((i * cible) / n)) out.add(i)
  }
  return out
}

/**
 * La consigne d'actualité d'UN tour (undefined sans réglage : prompt d'avant). Le bloc
 * d'actualités n'est donné QU'AUX tours d'actu (`newsPourCeTour`) : un tour « thème propre »
 * qui verrait les titres du jour finirait par en parler.
 */
export function consigneActualite(part: number | undefined, tourActu: boolean, actusDisponibles: boolean): string | undefined {
  if (part === undefined) return undefined
  if (part <= 0) {
    return 'Cette station ne traite PAS l\'actualité du jour : tu parles uniquement des thèmes propres à la station (sa raison d\'être), jamais des nouvelles du jour.'
  }
  const cadre = part >= 100
    ? 'Station d\'INFORMATION : toute l\'émission part de l\'actualité récupérée.'
    : `Environ ${part} % de l'émission part de l'actualité récupérée ; le reste porte sur les thèmes propres de la station.`
  if (!tourActu) return `${cadre}\nCE TOUR-CI : thème propre de la station (sa raison d'être), pas l'actualité du jour.`
  if (!actusDisponibles) return `${cadre}\nCE TOUR-CI devait partir de l'actualité, mais aucune n'a pu être récupérée : reste sur les thèmes de la station, sans inventer de nouvelle.`
  return `${cadre}\nCE TOUR-CI : pars d'une des actualités ci-dessus (cite-la, donne ton angle).`
}

// ── Appels d'auditeurs (lu, PAS encore fabriqué) ────────────────────────

/** Jour civil (UTC) depuis l'époque Unix ; NaN si la date est illisible. */
function jourDepuisEpoque(date: string): number {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date)
  if (!m) return Number.NaN
  return Math.floor(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])) / 86_400_000)
}

/** Décalage stable par station : toutes les stations « 1 jour sur 3 » n'appellent pas le même jour. */
function decalage(stationId: string): number {
  let h = 0
  for (const ch of stationId) h = (h * 31 + ch.codePointAt(0)!) >>> 0
  return h
}

/**
 * Nombre d'appels d'auditeurs PRÉVUS ce jour-là (déterministe). Ex. `{ actifs, nombre: 2,
 * tousLesNJours: 3 }` → 2 appels un jour sur 3, 0 les deux autres. Pas de réglage, coupés ou
 * date illisible → 0. ⚠ Non branché : aucun appel n'est fabriqué aujourd'hui.
 */
export function appelsDuJour(
  reglage: AppelsStation | undefined, station: Pick<RadioStation, 'id'>, date: string,
): number {
  if (!reglage || !reglage.actifs) return 0
  const jour = jourDepuisEpoque(date)
  if (!Number.isFinite(jour)) return 0
  const n = Math.max(1, Math.min(30, Math.round(reglage.tousLesNJours)))
  const nombre = Math.max(1, Math.min(5, Math.round(reglage.nombre)))
  return (jour + decalage(station.id)) % n === 0 ? nombre : 0
}
