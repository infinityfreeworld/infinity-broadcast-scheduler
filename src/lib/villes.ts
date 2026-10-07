/**
 * @module InfinityScheduler/Lib/Villes
 * @description « Où ? » à l'échelle de la VILLE, jamais plus fin.
 *
 *   🔴 POURQUOI. Une Manifestaction publiée porte un point GPS (`coordinates`) et un libellé
 *   (`location`) qui est, mesuré sur les relais le 07/10/2026, presque toujours ces mêmes
 *   coordonnées écrites en clair (« 48.8466°N, 2.3243°E ») — parfois une adresse. Lire l'un ou
 *   l'autre à l'antenne, c'est donner une adresse. Décision du Bâtisseur (07/10/2026) : la radio ne
 *   dit JAMAIS une position plus fine que la ville.
 *
 *   On ramène donc un point à une ville d'une table FIGÉE (≥ 15 000 habitants dans les pays
 *   francophones, ≥ 100 000 ailleurs, sans arrondissements — `data/villes.ts`, GeoNames CC BY 4.0) :
 *     - la ville la PLUS PEUPLÉE à moins de AGGLO_KM du point, sinon la plus proche à moins de
 *       MAX_KM : une banlieue ou un quartier-ville se dit « près de Lyon », pas par son nom ;
 *     - à moins de PRES_KM de cette ville : « à Lyon », sinon « près de Lyon » ;
 *     - rien à moins de MAX_KM : rien. On ne devine pas.
 *   Le libellé libre de l'auteur (`location`, `zone`, `region`…) n'est JAMAIS lu : il peut contenir
 *   un nom de rue, un quartier, un lieu-dit.
 */
import { VILLES_BRUTES } from '../data/villes'

export const PRES_KM = 8
export const AGGLO_KM = 12
export const MAX_KM = 30

interface Ville { nom: string; pays: string; lat: number; lng: number; pop: number }

/** Les noms GeoNames sont parfois anglais ou locaux : la radio parle français. */
const NOMS_FRANCAIS: Readonly<Record<string, string>> = {
  Brussels: 'Bruxelles', Antwerpen: 'Anvers', Gent: 'Gand', Brugge: 'Bruges', Mechelen: 'Malines',
  Leuven: 'Louvain', Basel: 'Bâle', Bern: 'Berne', 'Zürich': 'Zurich', Luzern: 'Lucerne',
  Geneva: 'Genève', London: 'Londres', Moscow: 'Moscou', Roma: 'Rome', Rome: 'Rome', Milano: 'Milan',
  Milan: 'Milan', Torino: 'Turin', Turin: 'Turin', Napoli: 'Naples', Naples: 'Naples', Venice: 'Venise',
  Florence: 'Florence', Munich: 'Munich', Cologne: 'Cologne', Vienna: 'Vienne', Prague: 'Prague',
  Warsaw: 'Varsovie', Lisbon: 'Lisbonne', Athens: 'Athènes', Seville: 'Séville', Barcelona: 'Barcelone',
  Montreal: 'Montréal', Quebec: 'Québec', Algiers: 'Alger', Tangier: 'Tanger', Marrakesh: 'Marrakech',
  Fes: 'Fès', Casablanca: 'Casablanca', Tunis: 'Tunis',
}

let index: Map<string, Ville[]> | null = null
const cle = (lat: number, lng: number) => `${Math.floor(lat)}:${Math.floor(lng)}`

function charger(): Map<string, Ville[]> {
  if (index) return index
  index = new Map()
  for (const ligne of VILLES_BRUTES.split(';')) {
    const [nom, pays, la, ln, p] = ligne.split('|')
    const lat = Number(la), lng = Number(ln)
    if (!nom || !Number.isFinite(lat) || !Number.isFinite(lng)) continue
    const v: Ville = { nom: NOMS_FRANCAIS[nom] ?? nom, pays, lat, lng, pop: Number(p) || 0 }
    const k = cle(lat, lng)
    const l = index.get(k) ?? []
    l.push(v)
    index.set(k, l)
  }
  return index
}

function distanceKm(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const r = Math.PI / 180
  const dLat = (lat2 - lat1) * r
  const dLng = (lng2 - lng1) * r
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * r) * Math.cos(lat2 * r) * Math.sin(dLng / 2) ** 2
  return 2 * 6371 * Math.asin(Math.min(1, Math.sqrt(a)))
}

/**
 * La ville à nommer pour ce point (et sa distance) : la plus peuplée à moins de AGGLO_KM, sinon la
 * plus proche à moins de MAX_KM ; `null` au-delà ou pour un point invalide.
 */
export function villeLaPlusProche(lat: number, lng: number): { nom: string; pays: string; km: number } | null {
  if (!Number.isFinite(lat) || !Number.isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180) return null
  const idx = charger()
  let proche: (Ville & { km: number }) | null = null
  let peuplee: (Ville & { km: number }) | null = null
  for (let dLat = -1; dLat <= 1; dLat++) {
    for (let dLng = -1; dLng <= 1; dLng++) {
      for (const v of idx.get(cle(lat + dLat, lng + dLng)) ?? []) {
        const km = distanceKm(lat, lng, v.lat, v.lng)
        if (!proche || km < proche.km) proche = { ...v, km }
        if (km <= AGGLO_KM && (!peuplee || v.pop > peuplee.pop)) peuplee = { ...v, km }
      }
    }
  }
  const choisie = peuplee ?? proche
  return choisie && choisie.km <= MAX_KM ? { nom: choisie.nom, pays: choisie.pays, km: choisie.km } : null
}

/** « à Lyon » / « au Havre » / « aux Sables… » ; « près de Lyon » / « près d'Aurillac » / « près du Havre ». */
function avecPreposition(nom: string, pres: boolean): string {
  if (/^Les /.test(nom)) return `${pres ? 'près des' : 'aux'} ${nom.slice(4)}`
  if (/^Le /.test(nom)) return `${pres ? 'près du' : 'au'} ${nom.slice(3)}`
  if (!pres) return `à ${nom}`
  return /^[AEIOUYÂÊÎÔÛÉÈÀH]/i.test(nom) ? `près d'${nom}` : `près de ${nom}`
}

/** « à Lyon », « près de Lyon », ou `''` — la seule forme de lieu que la radio prononce. */
export function lieuParle(lat: number | undefined, lng: number | undefined): string {
  if (lat === undefined || lng === undefined) return ''
  const v = villeLaPlusProche(lat, lng)
  if (!v) return ''
  return avecPreposition(v.nom, v.km > PRES_KM)
}
