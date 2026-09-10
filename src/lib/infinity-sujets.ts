/**
 * @module InfinityScheduler/TV/SujetsInfinity
 * @description Les sujets de la TÉLÉVISION viennent d'INFINITY — pas d'un fil RSS extérieur.
 *
 *   🚨 POURQUOI CE MODULE EXISTE. Retour du Bâtisseur, 09/09/2026 : « les thèmes doivent
 *   absolument concerner les sujets de l'application, comme les DAV, les Manifestactions, les
 *   projets proposés dans Abondance ». Le JT lisait Reporterre et Mr Mondialisation : de bonnes
 *   sources, mais qui ne parlent jamais de ce que les gens FONT dans l'application. Une
 *   télévision d'écosystème qui ignore son écosystème n'en est pas une.
 *
 *   Trois sujets, trois kinds :
 *     • 30500 `MHE_EVENT`          — les Manifestactions (actions écologiques humaines)
 *     • 31200 `ABONDANCE_PROJECT`  — les projets qui cherchent du soutien
 *     • 31600 `ASSEMBLEE_PROPOSAL` — les propositions soumises au vote (DAV / Palatine)
 *
 *   ── ⚠️ UN KIND EST UN ESPACE PARTAGÉ ─────────────────────────────────────────────────────
 *   Leçon déjà payée par `pulse.ts` : mesuré le 01/09/2026 sur nos.lol, le kind 30101 portait
 *   326 events de 306 pubkeys, dont AUCUNE n'était Infinity (des parties de « MatchHello », des
 *   questionnaires…). N'importe qui peut publier sur 30500. On ne lit donc pas « un event du bon
 *   kind » : on exige la FORME exacte du contenu Infinity, et on jette le reste sans bruit.
 *
 *   Ici le risque n'est pas la prise de contrôle — c'est pire à sa manière : un JT qui
 *   annoncerait sérieusement, d'une voix posée, le contenu d'un event étranger.
 */
import { SimplePool } from 'nostr-tools/pool'
import type { Event as NostrEvent } from 'nostr-tools'
import { getRelays } from './nostr'
import type { NewsItem } from './types'

export const KIND_MANIFESTACTION = 30500
export const KIND_PROJET_ABONDANCE = 31200
export const KIND_PROPOSITION_DAV = 31600

/** Au-delà, un sujet n'est plus une actualité. */
const FENETRE_JOURS = 45

/**
 * 🚨 LA FORME NE SUFFIT PAS — mesuré le 10/09/2026 au soir.
 *
 * Sur 28 events récents des trois kinds, 27 venaient d'AUTRES applications (contenus
 * `{spec, version, type…}`, `{protocol, payload…}`, `{Heartbeat}`…) : le filtre de forme les a
 * bien écartés. Le 28e était une Manifestaction Infinity bien formée — titre « jdfdosij »,
 * AUCUNE description, statut ANNULÉ, datée du 2 août. Elle est passée. Le JT du soir en a
 * tiré « Les Gardiens du Vivant — Samedi 2 août, Valais », d'une voix posée.
 *
 * Trois règles de plus, chacune tirée de ce cas réel :
 *   • on ne raconte pas ce qu'on ne peut pas raconter : une description d'au moins
 *     DESCRIPTION_MIN caractères est exigée ;
 *   • une action annulée ou en brouillon n'est pas une nouvelle ;
 *   • un événement terminé depuis plus de PASSE_TOLERANCE_J jours n'est plus une actualité,
 *     et un événement récent est présenté AU BON TEMPS (à venir, en cours, terminé).
 */
export const DESCRIPTION_MIN = 40
const STATUTS_ECARTES = new Set(['cancelled', 'canceled', 'annulee', 'annulée', 'draft', 'brouillon'])
const PASSE_TOLERANCE_J = 2
const JOUR_MS = 24 * 3600 * 1000
const dateFr = (ms: number) => new Date(ms).toLocaleDateString('fr-FR')
/** Borne de requête : de quoi couvrir la fenêtre sans inonder les relais. */
const LIMITE = 300

function contenu(e: NostrEvent): Record<string, unknown> | null {
  try {
    const c = JSON.parse(e.content) as unknown
    return c && typeof c === 'object' && !Array.isArray(c) ? (c as Record<string, unknown>) : null
  } catch { return null }
}

const texte = (v: unknown): string => (typeof v === 'string' ? v.trim() : '')

/**
 * Une Manifestaction Infinity, ou rien.
 *
 * ⚠️ Le codec de l'application rejette déjà les events « ni titre ni description » — les
 * Manifestactions fantômes qui polluaient le moniteur. On applique la MÊME règle : un JT qui
 * annonce « Pas de description » est pire qu'un JT qui n'en parle pas.
 */
export function lireManifestaction(e: NostrEvent, maintenant = Date.now()): NewsItem | null {
  const c = contenu(e)
  if (!c) return null
  const titre = texte(c.title)
  const desc = texte(c.description)
  if (desc.length < DESCRIPTION_MIN) return null
  if (STATUTS_ECARTES.has(texte(c.status).toLowerCase())) return null
  const debut = Number(c.startDate) > 0 ? Number(c.startDate) : undefined
  const fin = Number(c.endDate) > 0 ? Number(c.endDate) : debut
  if (fin && fin < maintenant - PASSE_TOLERANCE_J * JOUR_MS) return null
  const lieu = texte(c.location) || (e.tags.find((t) => t[0] === 'g')?.[1] ?? '')
  const parts = [desc.slice(0, 200)]
  if (lieu) parts.push(`Lieu : ${lieu}`)
  // Le TEMPS est dit, pas laissé à deviner : un conducteur à qui l'on donne une date nue
  // l'annonce au présent — c'est exactement ce qui est arrivé au « 2 août ».
  if (debut && debut > maintenant) parts.push(`Date : ${dateFr(debut)} (à venir)`)
  else if (fin && fin >= maintenant) parts.push(`Date : depuis le ${dateFr(debut ?? fin)} (en cours)`)
  else if (fin) parts.push(`Date : ${dateFr(fin)} (terminée — à rapporter au passé)`)
  return {
    title: titre || desc.slice(0, 80),
    summary: parts.filter(Boolean).join(' · '),
    publishedAt: e.created_at * 1000,
    sourceTitle: 'Manifestaction (Infinity)',
  }
}

/** Un projet Abondance, ou rien. Le titre seul ne suffit pas : il faut un objectif chiffré. */
export function lireProjetAbondance(e: NostrEvent): NewsItem | null {
  const c = contenu(e)
  if (!c) return null
  const titre = texte(c.title)
  if (!titre) return null
  const objectif = Number(c.goal)
  if (!Number.isFinite(objectif) || objectif <= 0) return null
  const desc = texte(c.description)
  if (desc.length < DESCRIPTION_MIN) return null
  const categorie = e.tags.find((t) => t[0] === 'category')?.[1] ?? ''
  const parts = [desc.slice(0, 200)]
  if (categorie) parts.push(`Catégorie : ${categorie}`)
  parts.push(`Objectif : ${objectif}`)
  return {
    title: titre,
    summary: parts.filter(Boolean).join(' · '),
    publishedAt: e.created_at * 1000,
    sourceTitle: 'Projet Abondance (Infinity)',
  }
}

/**
 * Une proposition soumise au vote, ou rien.
 *
 * ⚠️ ON N'ANNONCE QUE CE QUI EST OUVERT. Une proposition en brouillon n'est pas une nouvelle :
 * son auteur peut encore la réécrire entièrement. L'annoncer, ce serait rapporter une décision
 * que personne n'a prise.
 */
export function lirePropositionDav(e: NostrEvent, maintenant = Date.now()): NewsItem | null {
  const c = contenu(e)
  if (!c) return null
  const titre = texte(c.title)
  if (!titre) return null
  const statut = texte(c.status) || (e.tags.find((t) => t[0] === 'status')?.[1] ?? '')
  if (statut && statut !== 'open') return null
  const desc = texte(c.description)
  if (desc.length < DESCRIPTION_MIN) return null
  const echeance = Number(c.expiresAt)
  // Un vote dont l'échéance est passée est CLOS, même si son statut n'a pas été mis à jour.
  if (Number.isFinite(echeance) && echeance > 0 && echeance < maintenant) return null
  const parts = [desc.slice(0, 200)]
  if (Number.isFinite(echeance) && echeance > 0) {
    parts.push(`Vote ouvert jusqu'au ${new Date(echeance).toLocaleDateString('fr-FR')}`)
  }
  const quorum = Number(c.quorum)
  if (Number.isFinite(quorum) && quorum > 0) parts.push(`Quorum : ${quorum}`)
  return {
    title: titre,
    summary: parts.filter(Boolean).join(' · '),
    publishedAt: e.created_at * 1000,
    sourceTitle: 'Proposition soumise au vote (DAV)',
  }
}

const LECTEURS: Record<number, (e: NostrEvent, maintenant: number) => NewsItem | null> = {
  [KIND_MANIFESTACTION]: lireManifestaction,
  [KIND_PROJET_ABONDANCE]: lireProjetAbondance,
  [KIND_PROPOSITION_DAV]: lirePropositionDav,
}

/**
 * Trie et retient les sujets d'un lot d'events bruts.
 *
 * ⚠️ ON MÉLANGE LES TROIS FAMILLES DÉLIBÉRÉMENT, mais on garantit au moins un sujet de chaque
 * famille présente : trier par date seule donnerait, un jour de forte activité, un JT
 * entièrement consacré aux Manifestactions — et l'Assemblée n'existerait jamais à l'antenne.
 */
export function retenirSujets(events: NostrEvent[], combien: number, maintenant = Date.now()): NewsItem[] {
  const debut = maintenant - FENETRE_JOURS * 24 * 3600 * 1000
  const parFamille = new Map<number, NewsItem[]>()
  for (const e of events) {
    if (e.created_at * 1000 < debut) continue
    const lire = LECTEURS[e.kind]
    if (!lire) continue
    const item = lire(e, maintenant)
    if (!item) continue
    const l = parFamille.get(e.kind) ?? []
    l.push(item)
    parFamille.set(e.kind, l)
  }
  for (const l of parFamille.values()) l.sort((a, b) => (b.publishedAt ?? 0) - (a.publishedAt ?? 0))

  // Un tour de table d'abord (un sujet par famille), puis on complète par date.
  const retenus: NewsItem[] = []
  const restes: NewsItem[] = []
  for (const l of parFamille.values()) {
    if (l.length) retenus.push(l[0])
    restes.push(...l.slice(1))
  }
  retenus.sort((a, b) => (b.publishedAt ?? 0) - (a.publishedAt ?? 0))
  restes.sort((a, b) => (b.publishedAt ?? 0) - (a.publishedAt ?? 0))
  return [...retenus, ...restes].slice(0, Math.max(1, combien))
}

/** Va chercher les sujets sur les relais. Ne lève pas : un relais muet n'arrête pas l'antenne. */
export async function fetchSujetsInfinity(combien = 6, timeoutMs = 10000): Promise<NewsItem[]> {
  const relays = getRelays()
  const pool = new SimplePool()
  try {
    const events = await pool.querySync(
      relays,
      { kinds: [KIND_MANIFESTACTION, KIND_PROJET_ABONDANCE, KIND_PROPOSITION_DAV], limit: LIMITE },
      { maxWait: timeoutMs },
    )
    return retenirSujets(events as NostrEvent[], combien)
  } catch {
    return []
  } finally {
    try { pool.close(relays) } catch { /* rien à fermer */ }
  }
}
