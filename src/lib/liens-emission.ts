/**
 * @module InfinityScheduler/LiensEmission
 * @description Les LIENS évoqués dans une émission, chacun calé sur l'instant où il est
 *   évoqué (Bâtisseur, 07/10/2026 : « un petit écran digital dans la Radio qui affiche tous
 *   les liens évoqués dans l'émission »).
 *
 *   Trois sources, dans l'ordre :
 *     1. les ACTUALITÉS réellement reprises dans un tour (le titre de l'actu se retrouve dans
 *        la réplique) — leur `link` ; les sujets de la carte d'Infinity entrent par la même
 *        porte quand ils portent un lien (ils sont glissés dans `news`) ;
 *     2. les adresses CITÉES dans le texte (« https://… », « www.… », « reporterre.net ») ;
 *     3. l'adresse d'Infinity dite sous ses formes écrites (le slogan « Infinity-freeworld.com »,
 *        reconnu par le motif de `slogan-radio.ts`, le même que `prononcerDomaine`).
 *
 *   L'instant d'un lien = le DÉBUT du premier tour qui l'évoque (`tStart`, secondes).
 *
 *   ── Ce qui n'entre jamais ──────────────────────────────────────────────────────────────
 *   Le champ est PUBLIC (kind 30093, page `/r` sous notre nom de domaine) :
 *     • http(s) seulement ; pas d'identifiant (« user:mdp@ ») ; pas d'adresse IP, de
 *       `localhost`, de `.local` / `.internal` ;
 *     • rien qui ressemble à une donnée privée : clé NOSTR secrète (`nsec1…`, `ncryptsec…`),
 *       paramètre `token`, `key`, `secret`, `password`, `auth`, `session`, `sig`, `code`… ;
 *     • une adresse de plus de `MAX_LONGUEUR_URL` caractères est ÉCARTÉE (jamais tronquée :
 *       une adresse coupée mène ailleurs).
 *   Les paramètres de pistage `utm_*` sont retirés ; une adresse n'apparaît qu'une fois
 *   (au premier instant où elle est évoquée) ; au plus `MAX_LIENS` liens par émission.
 *
 *   ── Ce qui est dit, ce qui est écrit ───────────────────────────────────────────────────
 *   Rien ici ne touche au texte des tours ni à ce que dit la voix : `prononcerDomaine` reste
 *   appliqué au seul texte de synthèse, dans `generate-broadcast`. On LIT le transcript.
 *
 *   PUR — aucune dépendance réseau, aucun effet.
 */
import type { BroadcastTurn, NewsItem } from './types'
import { compterSlogans, DOMAINE_INFINITY } from './slogan-radio'

/** Un lien évoqué dans l'émission, publié dans le contenu du kind 30093 (`liens`). */
export interface LienEmission {
  /** Adresse complète, http(s), normalisée. */
  url:    string
  /** Instant (secondes depuis le début de l'audio) du premier tour qui l'évoque. */
  t:      number
  /** Libellé lisible (titre de l'actualité), quand il existe. ≤ MAX_TITRE caractères. */
  titre?: string
  /** D'où vient le lien : une actualité reprise, ou une adresse dite dans le texte. */
  source: 'actu' | 'texte'
}

export const MAX_LIENS = 30
export const MAX_LONGUEUR_URL = 400
export const MAX_TITRE = 120

/** L'adresse publique d'Infinity, telle que l'écran la propose. */
export const URL_INFINITY = `https://${DOMAINE_INFINITY.toLowerCase()}`

const PARAMS_PRIVES = /^(?:token|access_token|id_token|refresh_token|key|api_?key|apikey|secret|client_secret|password|passwd|pwd|pass|auth|authorization|session|sessionid|sid|sig|signature|code|otp|jwt|nsec|privkey|private_key)$/i
const MARQUES_PRIVEES = /nsec1|ncryptsec|privkey|private[_-]?key/i
const HOTE_PRIVE = /(?:^localhost$|\.local$|\.localhost$|\.internal$|\.lan$|\.home$|\.onion$)/i
const IPV4 = /^\d{1,3}(?:\.\d{1,3}){3}$/

/**
 * Une adresse acceptable pour l'écran public, normalisée ; `null` si elle est écartée.
 * Normalisation : hôte en minuscules, `utm_*` retirés, fragment retiré.
 */
export function normaliserLien(brut: string): string | null {
  const s = String(brut ?? '').trim()
  if (!s || s.length > MAX_LONGUEUR_URL) return null
  if (MARQUES_PRIVEES.test(s)) return null
  let u: URL
  try { u = new URL(s) } catch { return null }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') return null
  if (u.username || u.password) return null
  const hote = u.hostname.toLowerCase()
  if (!hote.includes('.') || HOTE_PRIVE.test(hote) || IPV4.test(hote) || hote.startsWith('[')) return null
  for (const cle of [...u.searchParams.keys()]) {
    if (PARAMS_PRIVES.test(cle)) return null
    if (/^utm_/i.test(cle)) u.searchParams.delete(cle)
  }
  u.hash = ''
  const out = u.toString()
  return out.length > MAX_LONGUEUR_URL ? null : out
}

/** Clé de dédoublonnage : sans `www.`, sans barre finale, sans distinction http/https. */
export function cleLien(url: string): string {
  return url.replace(/^https?:\/\//i, '').replace(/^www\./i, '').replace(/\/+$/, '').toLowerCase()
}

/**
 * Les adresses écrites dans un texte : « https://… », « www.… », et les domaines nus des
 * extensions courantes (« reporterre.net/article »). Un courriel n'est pas une adresse web.
 */
const TLD = 'com|org|net|fr|io|info|eu|world|be|ch|ca|es|de|it|uk|pt|ru|cn|in|jp|app|dev|coop|earth|news|media|tv|radio|online|site|xyz|co|me|us|ong|bio|green|social|live'
const MOTIF_URL = new RegExp(
  String.raw`(?<![@\w.\-/])(?:https?:\/\/[^\s<>"'«»()\[\]{}]+|(?:www\.)?[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)*\.(?:${TLD})\b(?![@\-])(?:\/[^\s<>"'«»()\[\]{}]*)?)`,
  'giu',
)

export function adressesDansTexte(texte: string): string[] {
  const out: string[] = []
  for (const m of String(texte ?? '').matchAll(MOTIF_URL)) {
    // Ponctuation de fin de phrase collée à l'adresse : elle n'en fait pas partie.
    const brut = m[0].replace(/[.,;:!?…。，、)\]]+$/u, '')
    // « Infinity-freeworld.com » est traité à part (motif du slogan, formes parlées comprises).
    if (/infinity[\s-]?free[\s-]?world/i.test(brut) && !/\/[^/\s]/.test(brut.replace(/^https?:\/\//i, ''))) continue
    out.push(/^https?:\/\//i.test(brut) ? brut : `https://${brut}`)
  }
  return out
}

const sansAccents = (s: string) => s.normalize('NFD').replace(/\p{M}+/gu, '').toLowerCase()
const MOTS_VIDES = new Set([
  'dans', 'avec', 'pour', 'cette', 'entre', 'leurs', 'selon', 'apres', 'avant', 'depuis', 'comme', 'aussi',
  'about', 'after', 'their', 'there', 'which', 'would', 'could', 'other', 'these', 'those', 'where', 'while',
  'sobre', 'entre', 'desde', 'contra', 'donde', 'tras',
])
function motsForts(texte: string): string[] {
  return [...new Set(sansAccents(texte).split(/[^\p{L}\p{N}]+/u).filter(m => m.length >= 5 && !MOTS_VIDES.has(m)))]
}

/**
 * Le tour reprend-il cette actualité ? Oui quand la réplique contient au moins la moitié
 * des mots forts du titre (≥ 2), ou au moins 3 d'entre eux. Les écritures sans espaces
 * (chinois, japonais) : le titre entier, ou une tranche de 8 caractères, présent tel quel.
 */
export function tourReprendActu(texteTour: string, titreActu: string): boolean {
  const titre = String(titreActu ?? '').trim()
  if (titre.length < 6) return false
  const tour = sansAccents(texteTour ?? '')
  const mots = motsForts(titre)
  if (mots.length >= 2) {
    const vus = mots.filter(m => tour.includes(m)).length
    return vus >= 3 || vus >= Math.max(2, Math.ceil(mots.length / 2))
  }
  // Peu de « mots » au sens latin : on cherche une tranche du titre.
  const t = sansAccents(titre).replace(/\s+/g, '')
  const tt = tour.replace(/\s+/g, '')
  if (t.length <= 8) return tt.includes(t)
  for (let i = 0; i + 8 <= t.length; i += 4) if (tt.includes(t.slice(i, i + 8))) return true
  return false
}

const arrondi = (t: number) => Math.max(0, Math.round((Number.isFinite(t) ? t : 0) * 10) / 10)
const couper = (s: string, max: number) => {
  const x = s.replace(/\s+/g, ' ').trim()
  return x.length <= max ? x : `${x.slice(0, max - 1).replace(/\s+\S*$/, '')}…`
}

/**
 * Tous les liens évoqués dans l'émission, calés dans le temps, triés par instant.
 * `turns` doit porter ses `tStart` DÉFINITIFS (après le montage audio).
 */
export function extraireLiensEmission(opts: { turns: BroadcastTurn[]; news?: NewsItem[] }): LienEmission[] {
  const parCle = new Map<string, LienEmission>()
  const ajouter = (brut: string, t: number, source: LienEmission['source'], titre?: string) => {
    const url = normaliserLien(brut)
    if (!url) return
    const cle = cleLien(url)
    const deja = parCle.get(cle)
    if (deja && deja.t <= t) {
      if (!deja.titre && titre) deja.titre = couper(titre, MAX_TITRE)
      return
    }
    parCle.set(cle, { url, t, ...(titre ? { titre: couper(titre, MAX_TITRE) } : deja?.titre ? { titre: deja.titre } : {}), source })
  }

  const news = (opts.news ?? []).filter(n => !!n.link && !!n.title)
  for (const tour of opts.turns ?? []) {
    const texte = String(tour.text ?? '')
    const t = arrondi(tour.tStart)
    for (const n of news) if (tourReprendActu(texte, n.title)) ajouter(n.link!, t, 'actu', n.title)
    for (const a of adressesDansTexte(texte)) ajouter(a, t, 'texte')
    if (compterSlogans(texte) > 0) ajouter(URL_INFINITY, t, 'texte', DOMAINE_INFINITY)
  }
  return [...parCle.values()].sort((a, b) => a.t - b.t).slice(0, MAX_LIENS)
}

/** Le morceau de contenu à étaler dans le kind 30093 : absent quand il n'y a aucun lien. */
export function champLiens(liens: LienEmission[]): { liens?: LienEmission[] } {
  return liens.length > 0 ? { liens } : {}
}
