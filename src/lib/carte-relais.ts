/**
 * @module InfinityScheduler/Lib/CarteRelais
 * @description Va chercher sur les relais (LECTURE SEULE) ce qu'il faut pour les sujets « carte » :
 *   Manifestactions, Agoras, Biogames et leurs avis, suppressions, documents de modération, puis
 *   sonde l'ancienneté des auteurs. Tout le jugement est dans `sujets-carte.ts` (pur, testé).
 *
 *   Ne lève JAMAIS : un relais muet n'arrête pas l'antenne. Sans réponse, la station Manifestactions
 *   parle de la raison d'être, et Freeworld n'ouvre pas sa rubrique.
 *   ⚠️ Prudence par construction : si la sonde d'ancienneté ne répond pas, aucun auteur n'est
 *   « établi » — on se tait plutôt que de lire une publication qu'on n'a pas pu juger.
 */
import { SimplePool } from 'nostr-tools/pool'
import type { Event as NostrEvent, Filter } from 'nostr-tools'
import { getRelays } from './nostr'
import { adminPubkeys, ADMINS_RADIO_PAR_DEFAUT } from './admins-radio'
import type { NewsItem, RadioStation } from './types'
import { stationThema } from './stations-thema'
import {
  KIND_MHE, KIND_AGORA, KINDS_BIOGAME, KIND_DECISION_BIOGAME, KIND_MODERATION_IHL, KIND_SUPPRESSION,
  confianceDepuisModeration, seuilsAnciennete, etablisDepuis, sujetsLisibles, retenirSujetsCarte,
  actualitesStationManifestactions, ligneEditorialeManifestactions, stationConcernee,
  type ConfianceCarte, type FamilleCarte, type SujetCarte,
} from './sujets-carte'

const DELAI_MS = 10_000
/** Les sondes d'ancienneté attendent moins : une réponse lente vaut « non établi » (prudence). */
const DELAI_SONDE_MS = 6_000
/** Sonde groupée : tant d'auteurs par requête. */
const PAQUET_AUTEURS = 50
/** Sonde individuelle (auteurs non tranchés par la sonde groupée) : au plus tant d'auteurs. */
const SONDES_INDIVIDUELLES_MAX = 40
const SONDES_EN_PARALLELE = 10

/** Les arbitres : la liste des administrateurs radio (racine et co-racine comprises). Jamais « tout le monde ». */
export function arbitresCarte(): Set<string> {
  return adminPubkeys() ?? new Set(ADMINS_RADIO_PAR_DEFAUT)
}

async function lire(pool: SimplePool, relays: string[], filtre: Filter, maxWait = DELAI_MS): Promise<NostrEvent[]> {
  try { return (await pool.querySync(relays, filtre, { maxWait })) as NostrEvent[] } catch { return [] }
}

export interface BilanCarte {
  sujets: SujetCarte[]
  /** Pour le journal : ce qui a été lu, écarté, sondé. */
  journal: string
}

/**
 * Les sujets « carte » du moment. `familles` restreint (la station Manifestactions ne veut que les
 * Manifestactions). Ne lève pas.
 */
export async function fetchSujetsCarte(
  opts: { combien?: number; familles?: readonly FamilleCarte[]; maintenant?: number } = {},
): Promise<BilanCarte> {
  const maintenant = opts.maintenant ?? Date.now()
  const relays = getRelays()
  const pool = new SimplePool()
  const arbitres = arbitresCarte()
  try {
    const depuis = Math.floor(maintenant / 1000) - 120 * 86_400
    const [mhe, agoras, biogames, decisions, supp, moderation] = await Promise.all([
      lire(pool, relays, { kinds: [KIND_MHE], since: depuis, limit: 1000 }),
      lire(pool, relays, { kinds: [KIND_AGORA], '#t': ['agora'], limit: 500 }),
      lire(pool, relays, { kinds: [...KINDS_BIOGAME], since: depuis, limit: 500 }),
      lire(pool, relays, { kinds: [KIND_DECISION_BIOGAME], authors: [...arbitres], limit: 1000 }),
      lire(pool, relays, { kinds: [KIND_SUPPRESSION], '#k': [KIND_MHE, KIND_AGORA, ...KINDS_BIOGAME].map(String), since: depuis, limit: 500 }),
      lire(pool, relays, { kinds: [KIND_MODERATION_IHL], authors: [...arbitres], '#d': ['ihl-account-bans', 'ihl-moderation', 'ihl-account-restrictions'], limit: 50 }),
    ])
    const tous = [...mhe, ...agoras, ...biogames, ...decisions, ...supp]
    const moder = confianceDepuisModeration(moderation, arbitres, maintenant)
    const lisibles = sujetsLisibles(tous, maintenant, arbitres)
      .filter(s => !opts.familles || opts.familles.includes(s.famille))
    const seuils = seuilsAnciennete(lisibles, { arbitres, bannis: moder.bannis })

    // 1. Sonde GROUPÉE : un événement antérieur au plus ancien des seuils prouve l'ancienneté de tous.
    const etablis = new Set<string>()
    const auteurs = [...seuils.keys()]
    if (auteurs.length) {
      const plusAncien = Math.min(...seuils.values())
      const paquets: string[][] = []
      for (let i = 0; i < auteurs.length; i += PAQUET_AUTEURS) paquets.push(auteurs.slice(i, i + PAQUET_AUTEURS))
      for (let i = 0; i < paquets.length; i += SONDES_EN_PARALLELE) {
        const reponses = await Promise.all(paquets.slice(i, i + SONDES_EN_PARALLELE)
          .map(paquet => lire(pool, relays, { authors: paquet, until: plusAncien, limit: 500 }, DELAI_SONDE_MS)))
        for (const pk of etablisDepuis(reponses.flat(), seuils)) etablis.add(pk)
      }
    }
    // 2. Sonde INDIVIDUELLE, chacun à SON seuil, les publications les plus récentes d'abord — bornée.
    const restants = lisibles
      .filter(s => seuils.has(s.auteur) && !etablis.has(s.auteur))
      .sort((a, b) => b.publieLe - a.publieLe)
      .map(s => s.auteur)
      .filter((pk, i, l) => l.indexOf(pk) === i)
      .slice(0, SONDES_INDIVIDUELLES_MAX)
    for (let i = 0; i < restants.length; i += SONDES_EN_PARALLELE) {
      const lot = restants.slice(i, i + SONDES_EN_PARALLELE)
      const reponses = await Promise.all(lot.map(pk => lire(pool, relays, { authors: [pk], until: seuils.get(pk)!, limit: 1 }, DELAI_SONDE_MS)))
      for (const pk of etablisDepuis(reponses.flat(), seuils)) etablis.add(pk)
    }

    const conf: ConfianceCarte = { ...moder, etablis, arbitres }
    const sujets = retenirSujetsCarte(tous, conf, maintenant, { combien: opts.combien, familles: opts.familles })
    const journal = `${mhe.length} Manifestaction(s), ${agoras.length} Agora(s), ${biogames.length} Biogame(s) lus · `
      + `${lisibles.length} lisible(s) · ${seuils.size} auteur(s) à juger, ${etablis.size} établi(s) · `
      + `${moder.bannis.size} banni(s), ${moder.masques.size} masqué(s) · ${sujets.length} retenu(s)`
    return { sujets, journal }
  } catch (err) {
    return { sujets: [], journal: `relais injoignables (${err instanceof Error ? err.message : String(err)})` }
  } finally {
    try { pool.close(relays) } catch { /* rien à fermer */ }
  }
}

export interface CartePourStation {
  /** La station est-elle une station « de la carte » (Manifestactions, Freeworld) ? */
  concernee: boolean
  /** Actualités à ajouter au fil de la station (Manifestactions : sujets réels + raison d'être). */
  actualites: NewsItem[]
  /** Freeworld : 0 à 2 sujets pour la rubrique « pendant ce temps sur la carte ». */
  rubrique: SujetCarte[]
  /** Station Manifestactions : sa ligne éditoriale. */
  ligneEditoriale?: string
  /** Station Abondance : la campagne de soutien du jour (identifiant), pour l'écran des liens
   *  (`liens-action.ts`) — jamais dans le prompt sous forme de lien. */
  campagneDuJour?: string
  journal: string
}

/** Ce que la carte apporte à CETTE station. Les autres stations : rien, et aucune requête. */
export async function sujetsCartePourStation(station: RadioStation, date: string): Promise<CartePourStation> {
  // 07/10/2026 — stations thématiques (Abondance, OBF, Biogame) : leurs propres lectures. Import
  // dynamique : `stations-thema-relais.ts` réutilise ce module, un import statique ferait un cycle.
  const thema = stationThema(station)
  if (thema !== null) return (await import('./stations-thema-relais')).sujetsStationThema(thema, station, date)
  const role = stationConcernee(station)
  if (role === null) return { concernee: false, actualites: [], rubrique: [], journal: '' }
  if (role === 'manifestactions') {
    const { sujets, journal } = await fetchSujetsCarte({ familles: ['manifestaction'], combien: 5 })
    return {
      concernee: true,
      actualites: actualitesStationManifestactions(sujets, date),
      rubrique: [],
      ligneEditoriale: ligneEditorialeManifestactions(sujets.length > 0),
      journal: `${journal}${sujets.length ? '' : ' → raison d\'être'}`,
    }
  }
  const { sujets, journal } = await fetchSujetsCarte({ combien: 2 })
  return { concernee: true, actualites: [], rubrique: sujets.slice(0, 2), journal: `${journal}${sujets.length ? '' : ' → pas de rubrique aujourd\'hui'}` }
}
