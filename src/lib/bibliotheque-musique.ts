/**
 * @module InfinityScheduler/BibliothequeMusique
 * @description La BIBLIOTHÈQUE MUSICALE de la radio (kind 30108), lue par le générateur, et la
 *   liste résultante de chaque station (Bâtisseur, 07/10/2026 : « chaque station doit avoir son
 *   propre système qui intègre la musique à la station sélectionnée »).
 *
 *   Une musique = un événement 30108 (d-tag `piste-…`), publié dans l'IHL par un ADMINISTRATEUR
 *   radio (même liste blanche que les fiches de station, lib/admins-radio.ts) : titre, CID
 *   data-space ou adresse https, artiste, genres, ambiances, énergie, langue, et MENTION DE
 *   DROITS. Le dernier événement d'un admin par d-tag fait foi ; une pierre tombale (`deleted`)
 *   retire la musique.
 *
 *   La liste d'une station = `pistesDeLaStation` (lib/selection-musique.ts, IDENTIQUE à l'app) :
 *   ses choix explicites + les musiques de la bibliothèque qui répondent à ses règles, jamais une
 *   musique sans droits. Elle REMPLACE `station.tracks` avant toute décision musicale de la nuit
 *   (réglages, pauses, lit musical, épinglage) : un seul endroit, une seule règle. Elle porte
 *   aussi les MUSIQUES DE TOUTES LES RADIOS et les JINGLES GARANTIS (décision de Med du
 *   08/10/2026, `PISTES_COMMUNES` et `JINGLES_GARANTIS`), quoi que dise la fiche 30091.
 *
 *   RÈGLE ABSOLUE (lib/musique.ts) : la musique ne bloque jamais l'émission. Relais muets ou
 *   bibliothèque illisible → la station garde ses choix explicites, et on le dit.
 */

import { SimplePool } from 'nostr-tools/pool'
import type { Event as NostrEvent } from 'nostr-tools/core'
import { getRelays } from './nostr'
import { adminPubkeys } from './admins-radio'
import { estAdmin } from './station-reglages'
import {
  estPisteCommune, jinglesDeLaStation, lireDroits, lireEnergie, lireEtiquettes, lireTexte, pistesDeLaStation, reglesActives,
  type PisteBibliotheque,
} from './selection-musique'
import type { RadioStation, TrackRef } from './types'

export const KIND_RADIO_MUSIQUE = 30108

const FORME_CID = /^(Qm[1-9A-HJ-NP-Za-km-z]{44}|b[a-z2-7]{20,})$/

/** Une musique de la bibliothèque depuis son événement ; `null` si illisible ou retirée. Pure. */
export function lireMusiqueBibliotheque(e: Pick<NostrEvent, 'kind' | 'tags' | 'content'>): PisteBibliotheque | null {
  if (e.kind !== KIND_RADIO_MUSIQUE) return null
  const d = e.tags.find(t => t[0] === 'd')?.[1]
  if (!d || !d.startsWith('piste-')) return null
  if (e.tags.some(t => t[0] === 'deleted' && t[1] === 'true')) return null
  let c: Record<string, unknown>
  try { c = JSON.parse(e.content) as Record<string, unknown> } catch { return null }
  if (typeof c !== 'object' || c === null || c.deleted === true) return null
  const title = lireTexte(c.title)
  if (!title) return null
  const cid = typeof c.cid === 'string' && FORME_CID.test(c.cid.trim()) ? c.cid.trim() : undefined
  const url = typeof c.url === 'string' && /^https:\/\//.test(c.url) ? c.url : undefined
  if (!cid && !url) return null
  const artiste = lireTexte(c.artiste)
  const genres = lireEtiquettes(c.genres)
  const ambiances = lireEtiquettes(c.ambiances)
  const energie = lireEnergie(c.energie)
  const langue = lireTexte(c.langue, 12)
  const droits = lireDroits(c.droits)
  const durationS = typeof c.durationS === 'number' && Number.isFinite(c.durationS) && c.durationS > 0 ? c.durationS : undefined
  return {
    title, ...(cid ? { cid } : {}), ...(url ? { url } : {}),
    ...(artiste ? { artiste } : {}), ...(genres ? { genres } : {}), ...(ambiances ? { ambiances } : {}),
    ...(energie !== undefined ? { energie } : {}), ...(langue ? { langue } : {}),
    ...(droits ? { droits } : {}), ...(durationS ? { durationS } : {}),
  }
}

/**
 * La bibliothèque telle que les ADMINS l'ont posée : par d-tag, le dernier événement signé par un
 * admin (égalité : l'id départage) ; retiré s'il s'agit d'une pierre tombale. Triée par d-tag. Pure.
 */
export function retenirBibliotheque(events: NostrEvent[], admins: ReadonlySet<string> | null): PisteBibliotheque[] {
  const parD = new Map<string, NostrEvent>()
  for (const e of events) {
    if (e.kind !== KIND_RADIO_MUSIQUE || !estAdmin(e.pubkey, admins)) continue
    const d = e.tags.find(t => t[0] === 'd')?.[1]
    if (!d) continue
    const r = parD.get(d)
    if (!r || e.created_at > r.created_at || (e.created_at === r.created_at && e.id > r.id)) parD.set(d, e)
  }
  return [...parD.keys()].sort()
    .map(d => lireMusiqueBibliotheque(parD.get(d)!))
    .filter((x): x is PisteBibliotheque => !!x)
}

/**
 * La station avec sa liste RÉSULTANTE à la place de `tracks` (dont les musiques de toutes les
 * radios, décision de Med du 08/10/2026) et ses jingles garantis ajoutés aux siens, même quand
 * sa fiche 30091 remplace `tracks` ou `jingles`. Pure.
 */
export function avecSaMusique(station: RadioStation, bibliotheque: readonly PisteBibliotheque[]): RadioStation {
  const tracks = pistesDeLaStation(station, bibliotheque) as TrackRef[]
  const jingles = jinglesDeLaStation(station) as TrackRef[]
  return { ...station, tracks, ...(jingles.length > 0 ? { jingles } : {}) }
}

/** Interroge les relais : la bibliothèque des admins (relais illisibles → `null`). */
export async function fetchBibliotheque(timeoutMs = 8000): Promise<PisteBibliotheque[] | null> {
  const relays = getRelays()
  const pool = new SimplePool()
  try {
    const events = await pool.querySync(relays, { kinds: [KIND_RADIO_MUSIQUE], limit: 1000 }, { maxWait: timeoutMs })
    return retenirBibliotheque(events, adminPubkeys())
  } catch (err) {
    console.warn(`    [musique] bibliothèque illisible (${(err as Error).message.slice(0, 80)}) — choix explicites seulement`)
    return null
  } finally {
    pool.close(relays)
  }
}

/** La station, avec la musique que lui donnent ses choix et ses règles — et on dit ce qu'il en est. */
export async function stationAvecSaMusique(station: RadioStation, timeoutMs = 8000): Promise<RadioStation> {
  const biblio = await fetchBibliotheque(timeoutMs)
  const s = avecSaMusique(station, biblio ?? [])
  const avant = station.tracks?.length ?? 0
  const apres = s.tracks?.length ?? 0
  const sansDroits = (biblio ?? []).filter(b => !lireDroits(b.droits) && !estPisteCommune(b)).length
  console.log(`    [musique] ${apres} musique(s) pour ${station.id} (choix : ${avant}${reglesActives(station.musique) ? ', + règles' : ''}`
    + `${biblio ? `, bibliothèque : ${biblio.length}${sansDroits ? `, dont ${sansDroits} sans droits — jamais diffusée(s)` : ''}` : ''})`)
  return s
}
