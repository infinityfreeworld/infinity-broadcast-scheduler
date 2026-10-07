/**
 * @module InfinityScheduler/Lib/StationsThema
 * @description Les trois stations THÉMATIQUES du 07/10/2026 — Abondance, OBF, Biogame — et leur
 *   reconnaissance. PUR. La lecture des relais est dans `stations-thema-relais.ts`, les sujets dans
 *   `sujets-abondance.ts`, `sujets-obf.ts`, `sujets-biogame.ts`.
 */
import { STATION_ABONDANCE } from './sujets-abondance'
import { STATION_OBF } from './sujets-obf'
import { STATION_BIOGAME } from './sujets-biogame'

export type StationThema = 'abondance' | 'obf' | 'biogame'

/** Le thème d'une station, ou null (les autres stations : rien, et aucune requête). */
export function stationThema(station: { id: string; kind: string }): StationThema | null {
  if (station.id === STATION_ABONDANCE || station.kind === 'abondance') return 'abondance'
  if (station.id === STATION_OBF || station.kind === 'obf') return 'obf'
  if (station.id === STATION_BIOGAME) return 'biogame'
  return null
}
