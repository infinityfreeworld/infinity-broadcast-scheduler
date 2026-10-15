/**
 * @module InfinityScheduler/AnnoncesNuit
 * @description Le branchement des annonces d'animateur dans la nuit d'une station
 *   (lib/annonces.ts : format et règles ; lib/annonces-fabrique.ts : fabrication).
 *
 *   Appelé par generate-broadcast APRÈS le dépôt de l'émission (la voix de l'émission a fini de
 *   servir), AVANT sa publication. Ne lève JAMAIS : au pire, l'émission part sans annonces —
 *   exactement comme avant.
 */

import { SimplePool } from 'nostr-tools/pool'
import { chatterboxBranche, getChatterboxVoiceForHost, ouvrirEcheanceClone, preparerAccesChatterbox } from './chatterbox'
import { estVoixKokoro } from './kokoro'
import { voixPourLangue } from './voix'
import { voixPersonnagePourLangue } from './voix-zh'
import { fetchBibliotheque, musiqueDuDirect } from './bibliotheque-musique'
import { broadcastDTag, getRelays, RADIO_BROADCAST_KIND } from './nostr'
import {
  ecrireCacheAnnonces, fichierCacheAnnonces, importerAnnoncesPubliees, lireCacheAnnonces, reglagesAnnonces,
  type AnnonceAntenne,
} from './annonces'
import { dependancesReelles, fabriquerAnnonces, ligneBilanAnnonces } from './annonces-fabrique'
import type { RadioStation, StationLanguage } from './types'

/**
 * La voix des annonces : celle du premier animateur, clonée (data-space). Pour le chinois sans
 * clone demandé, sa voix d'antenne Kokoro. Jamais Piper. `null` → pas d'annonces.
 */
export function voixDesAnnonces(station: RadioStation): { id: string; animateur: string } | null {
  const hote = station.hosts[0]
  if (!hote) return null
  const langue = (station.language ?? 'fr') as StationLanguage
  const clonee = voixPersonnagePourLangue(langue, chatterboxBranche() ? getChatterboxVoiceForHost(station.id, hote.id, langue) : null)
  if (clonee) return { id: clonee, animateur: hote.id }
  if (langue === 'zh') {
    const locale = voixPourLangue(langue, hote.gender, hote.id)
    if (locale && estVoixKokoro(locale)) return { id: locale, animateur: hote.id }
  }
  return null
}

/** La veille et l'avant-veille (YYYY-MM-DD). Pure. */
export function joursPrecedents(date: string, n = 2): string[] {
  const t = Date.parse(`${date}T12:00:00Z`)
  if (!Number.isFinite(t)) return []
  return Array.from({ length: n }, (_, i) => new Date(t - (i + 1) * 86_400_000).toISOString().slice(0, 10))
}

/** Les annonces des émissions précédentes de la station (pour nourrir le cache). Jamais bloquant. */
async function annoncesPrecedentes(stationId: string, date: string, pubkey: string, timeoutMs = 6000): Promise<unknown[]> {
  const relays = getRelays()
  const pool = new SimplePool()
  try {
    const evs = await pool.querySync(relays, {
      kinds: [RADIO_BROADCAST_KIND], authors: [pubkey], '#d': joursPrecedents(date).map(j => broadcastDTag(stationId, j)),
    }, { maxWait: timeoutMs })
    const out: unknown[] = []
    for (const e of evs) {
      try {
        const c = JSON.parse(e.content) as { annonces?: unknown }
        if (Array.isArray(c.annonces)) out.push(...c.annonces)
      } catch { /* contenu illisible : ignoré */ }
    }
    return out
  } catch {
    return []
  } finally {
    pool.close(relays)
  }
}

/**
 * Les annonces de la nuit pour une station. `fiche` = la station telle que posée dans l'IHL (ou
 * la seed), AVANT que `tracks` soit remplacé ; `station` = celle de la nuit (animateurs, voix).
 */
export async function annoncesDeLaNuit(opts: {
  fiche: RadioStation
  station: RadioStation
  date: string
  cleDataspace: string
  pubkey: string
}): Promise<AnnonceAntenne[]> {
  const reglages = reglagesAnnonces()
  if (!reglages.actif) { console.log('    · annonces coupées (ANNONCES=false)'); return [] }
  try {
    const t0 = Date.now()
    await preparerAccesChatterbox()
    const voix = voixDesAnnonces(opts.station)
    if (!voix) { console.log(`    · annonces : aucune voix clonée pour ${opts.station.hosts[0]?.name ?? '?'} — on s'en passe`); return [] }
    const biblio = await fetchBibliotheque()
    const pistes = musiqueDuDirect(opts.fiche, biblio ?? [])
    const cheminCache = fichierCacheAnnonces()
    const cache = lireCacheAnnonces(cheminCache)
    const importees = importerAnnoncesPubliees(cache, await annoncesPrecedentes(opts.station.id, opts.date, opts.pubkey), opts.date)
    if (importees > 0) console.log(`    · annonces : ${importees} reprise(s) des émissions précédentes`)
    // La fenêtre de voix clonée de l'émission est consommée : les annonces ont la leur, courte.
    // L'échéance de la NUIT (CHATTERBOX_FIN_NUIT) reste souveraine.
    ouvrirEcheanceClone(reglages.echeanceS)
    const bilan = await fabriquerAnnonces({
      station: opts.station, pistes, voix, cache, reglages, date: opts.date,
      deps: await dependancesReelles(opts.cleDataspace), journal: l => console.warn(l),
    })
    try { ecrireCacheAnnonces(cheminCache, cache) } catch (err) {
      console.warn(`    ⚠ cache des annonces non écrit : ${(err as Error).message.slice(0, 100)}`)
    }
    console.log(ligneBilanAnnonces(opts.station.id, bilan))
    console.log(`    · annonces : ${pistes.length} piste(s) au direct, durée ajoutée ${((Date.now() - t0) / 1000).toFixed(1)} s`)
    return bilan.annonces
  } catch (err) {
    console.warn(`    ⚠ annonces abandonnées (${(err as Error).message.slice(0, 120)}) — l'émission part sans`)
    return []
  }
}
