/**
 * @module InfinityScheduler/TV/SujetsInfinity
 * @description Les sujets de la TÉLÉVISION viennent d'INFINITY — pas d'un fil RSS extérieur.
 *
 *   🚨 POURQUOI CE MODULE EXISTE. Retour du Bâtisseur, 09/09/2026 : « les thèmes doivent
 *   absolument concerner les sujets de l'application, comme les DAV, les Manifestactions, les
 *   projets proposés dans Abondance ». Le JT lisait Reporterre et Mr Mondialisation : de bonnes
 *   sources, mais qui ne parlent jamais de ce que les gens FONT dans l'application.
 *
 *   Trois sujets, trois kinds :
 *     • 30500 `MHE_EVENT`          — les Manifestactions (actions écologiques humaines)
 *     • 31200 `ABONDANCE_PROJECT`  — les projets qui cherchent du soutien
 *     • 31600 `ASSEMBLEE_PROPOSAL` — les propositions soumises au vote (DAV / Palatine)
 *
 *   ── 🔒 LE JT N'EST JAMAIS PLUS PRÉCIS QUE LA VILLE (07/10/2026) ─────────────────────────────
 *   Jusqu'ici ce module lisait le champ `location` des Manifestactions (à défaut le tag `g`) et
 *   l'écrivait tel quel dans la matière du rédacteur : « Lieu : 48.8466°N, 2.3243°E », parfois une
 *   ADRESSE. Le rédacteur pouvait la dire, la sous-titrer, la mettre dans une consigne d'image. Les
 *   descriptions passaient sans nettoyage (liens, courriels, numéros), une Manifestaction non publique
 *   ou retirée par son auteur n'était pas écartée, un compte banni ou jetable non plus.
 *
 *   Le JT applique désormais EXACTEMENT les règles de la radio, en RÉUTILISANT ses modules (aucune
 *   seconde copie de la logique) :
 *     • Manifestactions : `sujets-carte.ts` (+ `carte-relais.ts` pour la lecture et la sonde
 *       d'ancienneté) — publiques seulement, dernière version, ni retirées (pierre tombale, NIP-09,
 *       NIP-40, `infinity-partage=non`) ni échues ni finies, auteur établi ou approuvé, jamais banni ni
 *       masqué ; lieu = le POINT ramené à la ville (`villes.ts`), jamais `location` ni `g` ;
 *     • projets Abondance : `sujets-abondance.ts` (+ `stations-thema-relais.ts`) — validés par
 *       l'administration DANS cette version, comme dans l'application ; lieu ramené à la ville ;
 *     • propositions DAV : lues ici (aucun module radio ne les lit), mais avec les outils de
 *       `sujets-carte.ts` : `visibility=public`, dernière version, retraits, échéances, bans, masquages,
 *       ancienneté de l'auteur, texte libre nettoyé (`nettoyerTexteLibre`). Aucun champ de lieu lu.
 *
 *   ── ⚠️ UN KIND EST UN ESPACE PARTAGÉ ─────────────────────────────────────────────────────
 *   N'importe qui peut publier sur ces kinds (mesuré le 10/09/2026 : 27 events sur 28 venaient
 *   d'autres applications). On exige la FORME exacte du contenu Infinity, et on jette le reste.
 */
import { SimplePool } from 'nostr-tools/pool'
import type { Event as NostrEvent } from 'nostr-tools'
import { getRelays } from './nostr'
import type { NewsItem } from './types'
import {
  KIND_SUPPRESSION, KIND_MODERATION_IHL, DESCRIPTION_MIN, nettoyerTexteLibre, expireNip40, estPierreTombale,
  dernieresVersions, suppressions, coordonnee, retenirSujetsCarte, sujetVersActualite, publicationDeConfiance,
  confianceDepuisModeration, seuilsAnciennete, type ConfianceCarte,
} from './sujets-carte'
import { projetsAbondance, projetVersActualite } from './sujets-abondance'
import { arbitresCarte, fetchSujetsCarte, sonderAnciennete } from './carte-relais'
import { fetchProjetsAbondance } from './stations-thema-relais'

export { DESCRIPTION_MIN }
export const KIND_MANIFESTACTION = 30500
export const KIND_PROJET_ABONDANCE = 31200
export const KIND_PROPOSITION_DAV = 31600

/** Au-delà, une proposition n'est plus une actualité. */
const FENETRE_JOURS = 45
const JOUR_MS = 86_400_000
const DELAI_MS = 10_000
/** Borne de requête : de quoi couvrir la fenêtre sans inonder les relais. */
const LIMITE = 300

const tag = (e: Pick<NostrEvent, 'tags'>, nom: string): string | undefined => e.tags.find(t => t[0] === nom)?.[1]
const texte = (v: unknown): string => (typeof v === 'string' ? v.trim() : '')
const partageRefuse = (e: Pick<NostrEvent, 'tags'>) => e.tags.some(t => t[0] === 'infinity-partage' && t[1] === 'non')

function contenu(e: NostrEvent): Record<string, unknown> | null {
  try {
    const c = JSON.parse(e.content) as unknown
    return c && typeof c === 'object' && !Array.isArray(c) ? (c as Record<string, unknown>) : null
  } catch { return null }
}

// ── Propositions soumises au vote (DAV) ──────────────────────────────────────────────────────

export interface PropositionDav {
  /** Signataire — jamais dit, sert aux contrôles de confiance. */
  auteur:    string
  eventId:   string
  publieLe:  number
  actualite: NewsItem
}

/**
 * Une proposition PUBLIQUE, ouverte au vote, ni retirée ni échue — SANS juger son auteur (cf.
 * `propositionsDav` + `publicationDeConfiance`) — ou rien.
 *
 * ⚠️ ON N'ANNONCE QUE CE QUI EST OUVERT. Une proposition en brouillon n'est pas une nouvelle :
 * son auteur peut encore la réécrire entièrement.
 */
export function lirePropositionDav(e: NostrEvent, maintenant = Date.now()): PropositionDav | null {
  if (e.kind !== KIND_PROPOSITION_DAV) return null
  // 🔒 PUBLIQUE, explicitement (le codec Palatine pose toujours `visibility=public`).
  if (tag(e, 'visibility') !== 'public') return null
  if (partageRefuse(e) || expireNip40(e, maintenant) || estPierreTombale(e)) return null
  const c = contenu(e)
  if (!c) return null
  const titre = nettoyerTexteLibre(texte(c.title), 90)
  if (!titre) return null
  const statut = texte(c.status) || (tag(e, 'status') ?? '')
  if (statut && statut !== 'open') return null
  const descBrute = texte(c.description)
  if (descBrute.length < DESCRIPTION_MIN) return null
  const echeance = Number(c.expiresAt)
  // Un vote dont l'échéance est passée est CLOS, même si son statut n'a pas été mis à jour.
  if (Number.isFinite(echeance) && echeance > 0 && echeance < maintenant) return null
  // Repères d'abord (l'échéance dit qu'un débat est EN COURS), description ensuite : la coupe à
  // 180 caractères de `formatNewsForPrompt` n'emporte que la fin.
  const reperes: string[] = []
  if (Number.isFinite(echeance) && echeance > 0) {
    reperes.push(`Vote ouvert jusqu'au ${new Date(echeance).toLocaleDateString('fr-FR')}`)
  }
  const quorum = Number(c.quorum)
  if (Number.isFinite(quorum) && quorum > 0) reperes.push(`Quorum : ${quorum}`)
  const publieLe = e.created_at * 1000
  return {
    auteur: e.pubkey.toLowerCase(),
    eventId: e.id,
    publieLe,
    actualite: {
      title: titre,
      summary: [...reperes, nettoyerTexteLibre(descBrute)].filter(Boolean).join(' · '),
      publishedAt: publieLe,
      sourceTitle: 'Proposition soumise au vote (DAV)',
    },
  }
}

/** Les propositions LISIBLES (dernière version, non supprimées par leur auteur, récentes), avant la confiance. */
export function propositionsDav(events: readonly NostrEvent[], maintenant: number): PropositionDav[] {
  const supp = suppressions(events)
  const debut = maintenant - FENETRE_JOURS * JOUR_MS
  const out: PropositionDav[] = []
  for (const e of dernieresVersions(events.filter(x => x.kind === KIND_PROPOSITION_DAV))) {
    if (e.created_at * 1000 < debut) continue
    const coord = coordonnee(e)
    if (coord && supp.coordonnees.has(coord)) continue
    if (supp.ids.get(e.id) === e.pubkey.toLowerCase()) continue
    const p = lirePropositionDav(e, maintenant)
    if (p) out.push(p)
  }
  return out.sort((a, b) => b.publieLe - a.publieLe || a.eventId.localeCompare(b.eventId))
}

// ── Assemblage ───────────────────────────────────────────────────────────────────────────────

/**
 * Mélange les familles, en garantissant au moins un sujet de chaque famille présente : trier par
 * date seule donnerait, un jour de forte activité, un JT entièrement consacré aux Manifestactions.
 */
export function assemblerSujets(familles: readonly (readonly NewsItem[])[], combien: number): NewsItem[] {
  const parDate = (a: NewsItem, b: NewsItem) => (b.publishedAt ?? 0) - (a.publishedAt ?? 0)
  const retenus: NewsItem[] = []
  const restes: NewsItem[] = []
  for (const f of familles) {
    const l = [...f].sort(parDate)
    if (l.length) retenus.push(l[0])
    restes.push(...l.slice(1))
  }
  return [...retenus.sort(parDate), ...restes.sort(parDate)].slice(0, Math.max(1, combien))
}

/**
 * PUR : de bout en bout, d'un lot d'events bruts (+ ce que l'on sait des auteurs) à ce que reçoit le
 * JT. C'est EXACTEMENT le chemin de `fetchSujetsInfinity`, sans le réseau : mêmes lecteurs, même
 * jugement (les Manifestactions par `retenirSujetsCarte`, les projets par `projetsAbondance`).
 */
export function retenirSujets(
  events: readonly NostrEvent[], combien: number, maintenant: number, conf: ConfianceCarte,
): NewsItem[] {
  const mhe = retenirSujetsCarte(events, conf, maintenant, { familles: ['manifestaction'], combien })
    .map(sujetVersActualite)
  const projets = projetsAbondance(events, conf, maintenant).map(p => projetVersActualite(p, false))
  const dav = propositionsDav(events, maintenant).filter(p => publicationDeConfiance(p, conf)).map(p => p.actualite)
  return assemblerSujets([mhe, projets, dav], combien)
}

// ── Réseau (LECTURE SEULE) ───────────────────────────────────────────────────────────────────

async function fetchPropositionsDav(maintenant: number): Promise<{ liste: NewsItem[]; journal: string }> {
  const relays = getRelays()
  const pool = new SimplePool()
  const arbitres = arbitresCarte()
  const lire = (filtre: Parameters<SimplePool['querySync']>[1]) =>
    pool.querySync(relays, filtre, { maxWait: DELAI_MS }).then(l => l as NostrEvent[]).catch(() => [] as NostrEvent[])
  try {
    const depuis = Math.floor(maintenant / 1000) - FENETRE_JOURS * 86_400
    const [props, supp, moderation] = await Promise.all([
      lire({ kinds: [KIND_PROPOSITION_DAV], since: depuis, limit: LIMITE }),
      lire({ kinds: [KIND_SUPPRESSION], '#k': [String(KIND_PROPOSITION_DAV)], since: depuis, limit: 500 }),
      lire({ kinds: [KIND_MODERATION_IHL], authors: [...arbitres], '#d': ['ihl-account-bans', 'ihl-moderation', 'ihl-account-restrictions'], limit: 50 }),
    ])
    const moder = confianceDepuisModeration(moderation, arbitres, maintenant)
    const lisibles = propositionsDav([...props, ...supp], maintenant)
    const seuils = seuilsAnciennete(lisibles, { arbitres, bannis: moder.bannis })
    const etablis = await sonderAnciennete(pool, relays, seuils, lisibles)
    const conf: ConfianceCarte = { ...moder, etablis, arbitres }
    const liste = lisibles.filter(p => publicationDeConfiance(p, conf)).map(p => p.actualite)
    return { liste, journal: `${props.length} proposition(s) DAV lues, ${lisibles.length} lisible(s), ${liste.length} retenue(s)` }
  } catch (err) {
    return { liste: [], journal: `relais injoignables (${err instanceof Error ? err.message : String(err)})` }
  } finally {
    try { pool.close(relays) } catch { /* rien à fermer */ }
  }
}

/** Va chercher les sujets sur les relais. Ne lève pas : un relais muet n'arrête pas l'antenne. */
export async function fetchSujetsInfinity(combien = 6): Promise<NewsItem[]> {
  const maintenant = Date.now()
  try {
    const [carte, projets, dav] = await Promise.all([
      fetchSujetsCarte({ familles: ['manifestaction'], combien, maintenant }),
      fetchProjetsAbondance(maintenant),
      fetchPropositionsDav(maintenant),
    ])
    console.log(`   🗺️  Manifestactions : ${carte.journal}`)
    console.log(`   🌱 Abondance : ${projets.journal}`)
    console.log(`   🗳️  DAV : ${dav.journal}`)
    return assemblerSujets([
      carte.sujets.map(sujetVersActualite),
      projets.liste.map(p => projetVersActualite(p, false)),
      dav.liste,
    ], combien)
  } catch {
    return []
  }
}
