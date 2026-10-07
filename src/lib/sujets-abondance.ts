/**
 * @module InfinityScheduler/Lib/SujetsAbondance
 * @description Les projets d'ABONDANCE transformés en sujets d'antenne — PUR, sans réseau (la lecture
 *   des relais est dans `stations-thema-relais.ts`). Même patron que `sujets-carte.ts` (lot 7).
 *
 *   Décision du Bâtisseur (07/10/2026) : la station « Abondance » met en avant TOUS les projets qui
 *   figurent dans Abondance ; quand un NOUVEAU projet apparaît, elle en parle en entrant dans les
 *   détails ; le reste du temps, elle fait tourner les projets existants ; sans projet, elle parle de
 *   la raison d'être d'Abondance.
 *
 *   ── CE QUI EST LU ─────────────────────────────────────────────────────────────────────────────
 *   • 31200 `ABONDANCE_PROJECT` (remplaçable, d = id du projet) : titre, description, thèmes, besoins,
 *     objectif, porteur (nom PUBLIC choisi par l'auteur pour son projet), coordonnées arrondies ;
 *   • 30386 `BIOGAME_DECISION_ADMIN` étiqueté `abondance-validation` / `nature=projet-abondance` :
 *     l'aval de l'administration. Règle de l'application (`abondance/validation/validation-projets.ts`) :
 *     un projet n'est visible de tous QU'UNE FOIS VALIDÉ, et validé dans CETTE version (tag `e`) —
 *     modifier un projet rouvre l'examen. La radio applique exactement la même règle.
 *   • les campagnes de soutien extérieures qu'Abondance met en avant (`data/campagnes-abondance.ts`,
 *     copiées de l'application) : une par jour, à tour de rôle.
 *
 *   ── « NOUVEAU » ────────────────────────────────────────────────────────────────────────────────
 *   Un projet APPARAÎT pour le public le jour de son PREMIER aval (pas le jour de sa publication : avant
 *   l'aval, personne ne le voit). Il est « nouveau » s'il est apparu APRÈS la dernière émission publiée
 *   de la station (`referenceNouveaute`) : ce que la station a déjà pu dire, c'est ce qui était visible
 *   quand elle a parlé. Aucun registre local : le Mac, le secours GitHub et l'usine de nuit fabriquent
 *   indifféremment, un registre sur une machine serait faux sur les autres ; l'émission publiée sur les
 *   relais, elle, est la même pour tous (l'anti-doublon `deja-diffuse.ts` la lit déjà).
 *
 *   ── CE QUI N'EST JAMAIS DIT ───────────────────────────────────────────────────────────────────
 *   • un projet non validé, refusé, ou validé dans une AUTRE version ;
 *   • un projet sans `visibility=public`, retiré (pierre tombale, NIP-09, NIP-40), brouillon, fermé,
 *     expiré, échu, ou dont l'auteur refuse la diffusion hors de l'application ;
 *   • un lieu plus fin que la ville (`villes.ts`) — jamais `location` ni le tag `g` (texte libre) ;
 *   • un lien, un courriel, un numéro, un montant COLLECTÉ (déclaré, invérifiable) ;
 *   • rien d'un compte banni ni d'une publication masquée par l'administration ;
 *   • le sigle de l'administration (cf. `sansSigleAdministration`).
 */
import type { Event as NostrEvent } from 'nostr-tools'
import type { NewsItem } from './types'
import { lieuParle } from './villes'
import {
  nettoyerTexteLibre, expireNip40, estPierreTombale, dernieresVersions, suppressions, coordonnee,
  KIND_DECISION_BIOGAME, DESCRIPTION_MIN, type ConfianceCarte,
} from './sujets-carte'
import { CAMPAGNES_ABONDANCE, type CampagneAbondance } from '../data/campagnes-abondance'

export const KIND_PROJET_ABONDANCE = 31200
export const TAG_VALIDATION_ABONDANCE = 'abondance-validation'
export const STATION_ABONDANCE = 'abondance-radio'

const JOUR_MS = 86_400_000
/** Au plus tant de nouveaux projets racontés EN DÉTAIL par émission (les plus récents d'abord). */
export const NOUVEAUX_MAX = 4
/** Projets existants mis en avant chaque jour (rotation). */
export const ROTATION_PAR_JOUR = 2
/** Sans émission précédente lisible sur les relais : « nouveau » = apparu depuis tant de jours. */
export const NOUVEAUTE_PREMIERE_FOIS_JOURS = 7
/** Lecture des relais impossible : « nouveau » = apparu depuis tant d'heures (une émission par jour). */
export const NOUVEAUTE_REPLI_HEURES = 36
/** Une station restée muette longtemps ne rattrape pas plus loin que tant de jours. */
export const NOUVEAUTE_MAX_JOURS = 14

export interface ProjetAbondance {
  /** `31200:auteur:d` — jamais dit. */
  cle:         string
  auteur:      string
  eventId:     string
  titre:       string
  /** Ce que fait le projet (≤ 320 caractères, nettoyé). */
  description: string
  /** « à Lyon », « près de Lyon », ou ''. */
  lieu:        string
  /** Libellés des thèmes (« Alimentation et eau »…). */
  themes:      string[]
  /** Libellés des besoins (« du bénévolat »…). */
  besoins:     string[]
  /** Nom public du porteur, tel qu'il l'a mis sur son projet, ou ''. */
  porteur:     string
  /** « 5 000 euros », ou '' (pas d'objectif chiffré). */
  objectif:    string
  /** Financé ? (le statut est déclaré par le porteur). */
  finance:     boolean
  /** Dernière publication (ms). */
  publieLe:    number
  /** PREMIER aval de l'administration (ms) : le jour où le projet est apparu pour le public. */
  apparuLe:    number
}

// ── Libellés (copiés de l'application : abondance/themes.ts, besoins.ts, types.ts) ─────────────

const THEMES: Readonly<Record<string, string>> = {
  alimentation: 'alimentation et eau', semences: 'semences', environnement: 'environnement',
  habitat: 'habitat et autonomie', sante: 'santé', enfance: 'enfance et famille', education: 'éducation et savoirs',
  solidarite: 'solidarité', entraide: 'entraide locale', secours: 'secours', citoyennete: 'citoyenneté',
  juridique: 'droit et justice', economie: 'économie et monnaie', medias: 'médias libres',
  numerique: 'numérique libre', culture: 'art et culture', rencontres: 'rencontres',
}
/** Un projet ancien n'a qu'une catégorie : son thème (même table que `THEME_DE_CATEGORIE`, à défaut le libellé). */
const CATEGORIES: Readonly<Record<string, string>> = {
  creative: 'création artistique', social: 'entraide sociale', ecological: 'écologie', entrepreneurial: 'commerce local',
  educational: 'éducation', tech: 'numérique libre', event: 'événement', personal: 'besoin personnel',
}
const BESOINS: Readonly<Record<string, string>> = {
  financement: 'du financement', benevolat: 'des bénévoles', mecenat: 'du mécénat', materiel: 'du matériel',
  competences: 'des compétences', reseau: 'du réseau', lieu: 'un lieu', visibilite: 'de la visibilité',
}

// ── Outils ───────────────────────────────────────────────────────────────────────────────────

const tag = (e: Pick<NostrEvent, 'tags'>, nom: string): string | undefined => e.tags.find(t => t[0] === nom)?.[1]
const texte = (v: unknown): string => (typeof v === 'string' ? v.trim() : '')
const nombre = (v: unknown): number | undefined => (typeof v === 'number' && Number.isFinite(v) ? v : undefined)
const partageRefuse = (e: Pick<NostrEvent, 'tags'>) => e.tags.some(t => t[0] === 'infinity-partage' && t[1] === 'non')
const HEX64 = /^[0-9a-f]{64}$/
const enumerer = (l: readonly string[]) => l.length <= 1 ? (l[0] ?? '') : `${l.slice(0, -1).join(', ')} et ${l[l.length - 1]}`

function contenu(e: NostrEvent): Record<string, unknown> | null {
  try {
    const c = JSON.parse(e.content) as unknown
    return c && typeof c === 'object' && !Array.isArray(c) ? (c as Record<string, unknown>) : null
  } catch { return null }
}

/** Le nom public du porteur — sauf s'il ressemble à une clé (« 6f290e57… », npub), qui ne se prononce pas. */
function porteurPublic(v: unknown): string {
  const nom = nettoyerTexteLibre(texte(v), 60)
  if (!nom || nom.includes('…') || /\bnpub1|[0-9a-f]{8,}/i.test(nom)) return ''
  return nom
}

// ── Avis de l'administration ─────────────────────────────────────────────────────────────────

export interface DecisionProjet { arbitre: string; coordonnee: string; eventId: string; valide: boolean; le: number }

/** Les avis sur les projets (30386, coordonnée de kind 31200). Les avis Biogame sont ignorés, et réciproquement. */
export function lireDecisionsProjets(events: readonly NostrEvent[]): DecisionProjet[] {
  const out: DecisionProjet[] = []
  for (const e of events) {
    if (e.kind !== KIND_DECISION_BIOGAME) continue
    const a = tag(e, 'a'), d = tag(e, 'd'), id = tag(e, 'e'), decision = tag(e, 'decision')
    if (!a || a !== d || !id || !HEX64.test(id)) continue
    const m = /^(\d+):([0-9a-f]{64}):(.+)$/.exec(a)
    if (!m || Number(m[1]) !== KIND_PROJET_ABONDANCE) continue
    if (decision !== 'valide' && decision !== 'refuse') continue
    out.push({ arbitre: e.pubkey.toLowerCase(), coordonnee: a, eventId: id, valide: decision === 'valide', le: e.created_at })
  }
  return out
}

/**
 * Cette VERSION du projet est-elle validée, et depuis quand le projet est-il public ? Même règle que
 * `etatValidationProjet` de l'application : seuls comptent les avis d'un arbitre, sur ce projet, sur
 * cet événement ; le plus récent l'emporte, à date égale le refus. `apparuLe` = le PREMIER aval
 * d'un arbitre sur ce projet, toutes versions confondues (une modification revalidée n'est pas un
 * nouveau projet).
 */
export function etatProjet(
  e: NostrEvent, decisions: readonly DecisionProjet[], arbitres: ReadonlySet<string>,
): { valide: boolean; apparuLe?: number } {
  const coord = coordonnee(e)
  if (!coord) return { valide: false }
  let retenue: DecisionProjet | null = null
  let premier: number | undefined
  for (const d of decisions) {
    if (d.coordonnee !== coord || !arbitres.has(d.arbitre)) continue
    if (d.valide && (premier === undefined || d.le < premier)) premier = d.le
    if (d.eventId !== e.id) continue
    if (!retenue || d.le > retenue.le || (d.le === retenue.le && !d.valide)) retenue = d
  }
  if (retenue?.valide !== true) return { valide: false }
  return { valide: true, apparuLe: (premier ?? retenue.le) * 1000 }
}

// ── Un projet ────────────────────────────────────────────────────────────────────────────────

const STATUTS_PUBLICS = new Set(['active', 'funded'])

/** Un projet public et encore ouvert — SANS juger sa validation (cf. `etatProjet`) — ou rien. */
export function lireProjetAbondance(e: NostrEvent, maintenant: number): Omit<ProjetAbondance, 'apparuLe'> | null {
  if (e.kind !== KIND_PROJET_ABONDANCE) return null
  // 🔒 PUBLIC, explicitement (Abondance pose toujours `visibility=public` ; un événement sans ce tag
  // ne vient pas d'elle, ou n'est pas destiné à tous).
  if (tag(e, 'visibility') !== 'public') return null
  if (partageRefuse(e) || expireNip40(e, maintenant) || estPierreTombale(e)) return null
  const c = contenu(e)
  if (!c) return null
  const titre = nettoyerTexteLibre(texte(c.title) || texte(tag(e, 'title')), 90)
  const descriptionBrute = texte(c.description)
  if (!titre || descriptionBrute.length < DESCRIPTION_MIN) return null
  const statut = texte(c.status) || 'active'
  if (!STATUTS_PUBLICS.has(statut)) return null
  // Durée de collecte : `null` = sans limite ; un nombre = jours depuis la publication ; absente
  // (projet ancien) = `daysLeft`, à défaut 30 jours — compté depuis la publication, par prudence.
  const publieLe = e.created_at * 1000
  const duree = c.dureeJours === null ? null : (nombre(c.dureeJours) ?? (nombre(Number(c.daysLeft)) || 30))
  if (duree !== null && duree > 0 && publieLe + duree * JOUR_MS <= maintenant) return null

  // Le lieu : les coordonnées (déjà arrondies à ~1 km par l'application), ramenées à la VILLE.
  const pt = c.coords && typeof c.coords === 'object' ? c.coords as Record<string, unknown> : {}
  const lieu = lieuParle(nombre(pt.lat), nombre(pt.lng))

  const themesIds = Array.isArray(c.themes) ? c.themes.map(String) : []
  let themes = [...new Set(themesIds.map(t => THEMES[t]).filter((x): x is string => !!x))]
  if (!themes.length) { const cat = CATEGORIES[tag(e, 'category') ?? '']; if (cat) themes = [cat] }
  const besoins = [...new Set((Array.isArray(c.besoins) ? c.besoins : []).map(b => BESOINS[String(b)]).filter((x): x is string => !!x))]
  const goal = nombre(c.goal)
  return {
    cle: coordonnee(e) ?? e.id,
    auteur: e.pubkey.toLowerCase(),
    eventId: e.id,
    titre,
    description: nettoyerTexteLibre(descriptionBrute, 320),
    lieu,
    themes: themes.slice(0, 4),
    besoins,
    porteur: porteurPublic(c.author),
    objectif: goal !== undefined && goal > 0 && goal <= 10_000_000 ? `${Math.round(goal).toLocaleString('fr-FR').replace(/\s/g, ' ')} euros` : '',
    finance: statut === 'funded',
    publieLe,
  }
}

/**
 * Les projets que la station peut dire : dernière version, ni supprimés ni masqués, VALIDÉS dans cette
 * version, auteur non banni. Du plus récemment apparu au plus ancien. L'aval explicite de
 * l'administration vaut confiance (comme un Biogame validé) : pas de sonde d'ancienneté.
 */
export function projetsAbondance(
  events: readonly NostrEvent[], conf: Pick<ConfianceCarte, 'bannis' | 'masques' | 'arbitres'>, maintenant: number,
): ProjetAbondance[] {
  const supp = suppressions(events)
  const decisions = lireDecisionsProjets(events)
  const out: ProjetAbondance[] = []
  for (const e of dernieresVersions(events.filter(x => x.kind === KIND_PROJET_ABONDANCE))) {
    const coord = coordonnee(e)
    if (coord && supp.coordonnees.has(coord)) continue
    if (supp.ids.get(e.id) === e.pubkey.toLowerCase()) continue
    if (conf.bannis.has(e.pubkey.toLowerCase()) || conf.masques.has(e.id)) continue
    const etat = etatProjet(e, decisions, conf.arbitres)
    if (!etat.valide || etat.apparuLe === undefined) continue
    const p = lireProjetAbondance(e, maintenant)
    if (p) out.push({ ...p, apparuLe: etat.apparuLe })
  }
  return out.sort((a, b) => b.apparuLe - a.apparuLe || a.cle.localeCompare(b.cle))
}

// ── « Nouveau » ──────────────────────────────────────────────────────────────────────────────

export interface EmissionLue { pubkey: string; created_at: number; tags: string[][] }

/**
 * Quand la station a-t-elle parlé pour la dernière fois ? La plus récente de SES émissions (kind
 * 30093, `d = <station>:<date>`) signée par NOTRE clé, d'une date ANTÉRIEURE à celle qu'on fabrique
 * (refaire l'émission du jour ne doit pas rendre « anciens » les projets qu'elle annonçait). `null` =
 * aucune trouvée. Pur.
 */
export function derniereEmission(
  emissions: readonly EmissionLue[], stationId: string, date: string, auteur: string,
): number | null {
  let plusRecente: number | null = null
  for (const e of emissions) {
    if (e.pubkey !== auteur) continue
    const d = e.tags.find(t => t[0] === 'd')?.[1] ?? ''
    if (!d.startsWith(`${stationId}:`)) continue
    const jour = d.slice(stationId.length + 1)
    if (!/^\d{4}-\d{2}-\d{2}$/.test(jour) || jour >= date) continue
    const ms = e.created_at * 1000
    if (plusRecente === null || ms > plusRecente) plusRecente = ms
  }
  return plusRecente
}

/**
 * L'instant à partir duquel un projet apparu est « nouveau ».
 *   • lecture réussie, une émission précédente : son instant de publication ;
 *   • lecture réussie, aucune (première émission) : NOUVEAUTE_PREMIERE_FOIS_JOURS en arrière ;
 *   • lecture impossible : NOUVEAUTE_REPLI_HEURES en arrière (une émission par jour) ;
 *   jamais plus de NOUVEAUTE_MAX_JOURS en arrière.
 */
export function referenceNouveaute(lecture: { ok: boolean; derniere: number | null }, maintenant: number): number {
  const plancher = maintenant - NOUVEAUTE_MAX_JOURS * JOUR_MS
  if (!lecture.ok) return Math.max(plancher, maintenant - NOUVEAUTE_REPLI_HEURES * 3_600_000)
  if (lecture.derniere === null) return Math.max(plancher, maintenant - NOUVEAUTE_PREMIERE_FOIS_JOURS * JOUR_MS)
  return Math.max(plancher, Math.min(lecture.derniere, maintenant))
}

export const estNouveau = (p: Pick<ProjetAbondance, 'apparuLe'>, reference: number): boolean => p.apparuLe > reference

// ── Rotation ─────────────────────────────────────────────────────────────────────────────────

/** Le numéro du jour (UTC) — même jour, même choix : rejouable. */
export const numeroDuJour = (jour: Date | string): number => {
  const ms = typeof jour === 'string' ? Date.parse(`${jour}T12:00:00Z`) : jour.getTime()
  return Math.floor(ms / JOUR_MS)
}

/**
 * `parJour` éléments d'une liste STABLE, en tournant d'un jour à l'autre. Deux jours de suite ne
 * partagent AUCUN élément dès que la liste en compte au moins deux : on prend `k` éléments à partir
 * de `jour × k`, avec `k ≤ n / 2` (un seul par jour s'il n'y en a que 2 ou 3).
 */
export function tourner<T>(liste: readonly T[], jour: Date | string, parJour: number): T[] {
  const n = liste.length
  if (n === 0 || parJour <= 0) return []
  if (n === 1) return [liste[0]]
  const k = Math.max(1, Math.min(parJour, Math.floor(n / 2)))
  const debut = ((numeroDuJour(jour) * k) % n + n) % n
  return Array.from({ length: k }, (_, i) => liste[(debut + i) % n])
}

/** La campagne de soutien du jour (une par jour, jamais la même deux jours de suite). */
export function campagneDuJour(jour: Date | string, campagnes: readonly CampagneAbondance[] = CAMPAGNES_ABONDANCE): CampagneAbondance | null {
  return tourner(campagnes, jour, 1)[0] ?? null
}

// ── Mise en mots ─────────────────────────────────────────────────────────────────────────────

/** Une ligne COMPLÈTE (sans coupe) — pour la consigne quand le projet est nouveau. */
export function projetEnDetail(p: ProjetAbondance): string {
  const morceaux = [
    `Projet « ${p.titre} »${p.porteur ? `, porté par ${p.porteur}` : ''}${p.lieu ? `, ${p.lieu}` : ''}.`,
    `Ce qu'il fait : ${p.description.replace(/[\s.…!?]+$/, '')}.`,
    p.themes.length ? `Thèmes : ${p.themes.join(', ')}.` : '',
    p.besoins.length ? `Ce qu'il cherche : ${enumerer(p.besoins)}.` : '',
    p.objectif ? `Objectif affiché par le porteur : ${p.objectif}.` : '',
    p.finance ? 'Le porteur l\'annonce financé : on peut encore le suivre et le faire connaître.' : '',
    "Pour l'aider : sa page dans Abondance, onglet Projets d'Infinity — proposer son aide, donner, ou le faire connaître.",
  ]
  return morceaux.filter(Boolean).join(' ')
}

export const SOURCE_NOUVEAU = "Nouveau projet dans Abondance"
export const SOURCE_PROJET = "Projet dans Abondance"
export const SOURCE_CAMPAGNE = "Campagne de soutien mise en avant par Abondance"
export const SOURCE_RAISON_D_ETRE_ABONDANCE = "Raison d'être d'Abondance"

/** Le projet sous la forme qu'attend le prompt (résumé coupé à 180 : les repères d'abord). */
export function projetVersActualite(p: ProjetAbondance, nouveau: boolean): NewsItem {
  const reperes = [
    p.lieu,
    p.besoins.length ? `cherche ${enumerer(p.besoins)}` : '',
    p.themes.length ? p.themes.join(', ') : '',
    p.description,
  ].filter(Boolean).join(' · ')
  return { title: p.titre, summary: reperes, publishedAt: p.apparuLe, sourceTitle: nouveau ? SOURCE_NOUVEAU : SOURCE_PROJET }
}

export function campagneVersActualite(c: CampagneAbondance): NewsItem {
  return {
    title: c.titre,
    summary: [c.porteur, c.resume, c.description].filter(Boolean).join(' · '),
    sourceTitle: SOURCE_CAMPAGNE,
  }
}

/**
 * Sujets de FOND : la raison d'être d'Abondance (son aide, `module-help-content.ts`, ses piliers, ses
 * thèmes, sa cagnotte). Ce ne sont PAS des événements : le prompt interdit de leur inventer projets,
 * chiffres ou lieux. Chaque résumé tient en 180 caractères. Treize sujets, trois par jour au plus.
 */
export const RAISONS_D_ETRE_ABONDANCE: ReadonlyArray<NewsItem> = [
  { title: "Ce qu'est Abondance", summary: "L'économie d'entraide d'Infinity : faire circuler les ressources et financer ensemble les projets qui servent le vivant, les besoins vitaux et l'émancipation.", sourceTitle: SOURCE_RAISON_D_ETRE_ABONDANCE },
  { title: 'Les trois piliers', summary: "Le vivant (sols, semences, êtres vivants), les besoins vitaux (se nourrir, se loger, se soigner, être secouru) et l'émancipation (apprendre, s'informer, être libre).", sourceTitle: SOURCE_RAISON_D_ETRE_ABONDANCE },
  { title: "L'argent n'est qu'un soutien parmi d'autres", summary: "Un projet peut demander du bénévolat, du matériel, des compétences, du réseau, un lieu ou de la visibilité. Prêter un outil ou une heure, c'est déjà financer.", sourceTitle: SOURCE_RAISON_D_ETRE_ABONDANCE },
  { title: 'Proposer son aide', summary: "Sur la page d'un projet, on propose son aide au porteur : mécénat ou bénévolat. Il l'accepte ou non, et l'échange se fait entre vous, sans intermédiaire.", sourceTitle: SOURCE_RAISON_D_ETRE_ABONDANCE },
  { title: 'Présenter son projet', summary: "Dans Abondance, « Financer mon projet » : ce qu'il fait, ses thèmes, ses besoins, son lieu. L'administration le relit, puis il devient visible de tous.", sourceTitle: SOURCE_RAISON_D_ETRE_ABONDANCE },
  { title: 'Pourquoi une validation', summary: "Chaque projet est relu avant d'être montré : pas d'arnaque, pas de projet nuisible au vivant. Modifier un projet le fait relire à nouveau.", sourceTitle: SOURCE_RAISON_D_ETRE_ABONDANCE },
  { title: 'Financer sans intermédiaire', summary: "Un porteur relie sa cagnotte, sa campagne ou son adresse en monnaie libre Ğ1 : Infinity n'encaisse rien, le don se fait chez la plateforme choisie.", sourceTitle: SOURCE_RAISON_D_ETRE_ABONDANCE },
  { title: 'La cagnotte publique', summary: "Chaque mois, 85 % de la cagnotte d'Abondance financent des projets votés par les Bâtisseurs de Palier 3, humains certifiés : un humain, une voix.", sourceTitle: SOURCE_RAISON_D_ETRE_ABONDANCE },
  { title: 'Les campagnes de soutien', summary: "Abondance met aussi en avant des campagnes choisies : semences paysannes, secours, médias libres, enfance. Le don se fait chez l'organisme, sans montant inventé.", sourceTitle: SOURCE_RAISON_D_ETRE_ABONDANCE },
  { title: 'Près de chez soi', summary: "La carte des projets et le filtre « près de chez moi » : 10, 50 ou 200 km. Aider un projet voisin, c'est pouvoir y passer, voir, donner un coup de main.", sourceTitle: SOURCE_RAISON_D_ETRE_ABONDANCE },
  { title: 'Suivre un projet', summary: "Mettre un projet en favori, lire ses nouvelles : le porteur raconte où il en est. Un projet qu'on suit est un projet qu'on peut relayer au bon moment.", sourceTitle: SOURCE_RAISON_D_ETRE_ABONDANCE },
  { title: "De l'abondance, pas de la charité", summary: "L'idée : ce que chacun a en trop — temps, savoir, outils, argent — manque à quelqu'un d'autre. Le faire circuler crée l'abondance pour tous.", sourceTitle: SOURCE_RAISON_D_ETRE_ABONDANCE },
  { title: 'Dix-sept thèmes', summary: "Alimentation et eau, semences, habitat, santé, enfance, éducation, entraide, secours, citoyenneté, droit, monnaie, médias et numérique libres, culture…", sourceTitle: SOURCE_RAISON_D_ETRE_ABONDANCE },
]

/** `n` sujets de fond, en tournant (deux jours de suite : aucun en commun tant que 2n ≤ 13). */
export function choisirRaisonsAbondance(n: number, jour: Date | string): NewsItem[] {
  if (n <= 0) return []
  const total = RAISONS_D_ETRE_ABONDANCE.length
  const pas = Math.min(n, total)
  const debut = ((numeroDuJour(jour) * pas) % total + total) % total
  return Array.from({ length: pas }, (_, i) => RAISONS_D_ETRE_ABONDANCE[(debut + i) % total])
}

export interface AntenneAbondance {
  actualites: NewsItem[]
  nouveaux:   ProjetAbondance[]
  rotation:   ProjetAbondance[]
  campagne:   CampagneAbondance | null
  ligneEditoriale: string
}

/**
 * Ce que la station Abondance raconte aujourd'hui :
 *   1. les NOUVEAUX projets (apparus depuis `reference`), au plus NOUVEAUX_MAX, racontés en détail ;
 *   2. ROTATION_PAR_JOUR projets existants, tournant chaque jour ;
 *   3. la campagne de soutien du jour ;
 *   4. la raison d'être : 1 sujet de fond toujours, 3 quand il n'y a aucun projet de Bâtisseur.
 */
export function antenneAbondance(
  projets: readonly ProjetAbondance[], reference: number, jour: Date | string,
  campagnes: readonly CampagneAbondance[] = CAMPAGNES_ABONDANCE,
): AntenneAbondance {
  const nouveaux = projets.filter(p => estNouveau(p, reference)).slice(0, NOUVEAUX_MAX)
  const dejaDits = new Set(nouveaux.map(p => p.cle))
  // Liste STABLE pour la rotation : par clé, pas par date (une nouvelle apparition ne décale pas tout).
  const existants = projets.filter(p => !dejaDits.has(p.cle)).sort((a, b) => a.cle.localeCompare(b.cle))
  const rotation = tourner(existants, jour, ROTATION_PAR_JOUR)
  const campagne = campagneDuJour(jour, campagnes)
  const fond = choisirRaisonsAbondance(projets.length ? 1 : 3, jour)
  return {
    actualites: [
      ...nouveaux.map(p => projetVersActualite(p, true)),
      ...rotation.map(p => projetVersActualite(p, false)),
      ...(campagne ? [campagneVersActualite(campagne)] : []),
      ...fond,
    ],
    nouveaux, rotation, campagne,
    ligneEditoriale: ligneEditorialeAbondance(nouveaux, rotation.length > 0, campagne),
  }
}

/** Section « ligne éditoriale » du prompt système de la station Abondance. */
export function ligneEditorialeAbondance(
  nouveaux: readonly ProjetAbondance[], aDesProjets: boolean, campagne: CampagneAbondance | null,
): string {
  const lignes = [
    "Ta station parle d'Abondance, l'économie d'entraide d'Infinity : les projets que les Bâtisseurs y présentent pour le vivant, les besoins vitaux et l'émancipation, et la façon concrète de les aider (donner, prêter, venir, transmettre, faire connaître).",
  ]
  if (nouveaux.length) {
    lignes.push(
      `NOUVEAU dans Abondance depuis la dernière émission — ${nouveaux.length > 1 ? 'ces projets sont' : 'ce projet est'} le cœur de l'émission. Pour CHACUN, entre dans les détails : ce qu'il fait, où, ses thèmes, ses besoins, l'objectif s'il y en a un, et comment l'aider. Dis-les TELS QU'ILS SONT DONNÉS, sans rien inventer (ni lieu plus précis, ni chiffre, ni personne, ni date) :`,
      ...nouveaux.map(p => `• ${projetEnDetail(p)}`),
    )
  }
  if (aDesProjets) {
    lignes.push("Les projets de l'ACTUALITÉ marqués « Projet dans Abondance » sont réels : présente-les avec leurs repères tels quels, comme des projets déjà là qu'on redécouvre.")
  } else if (!nouveaux.length) {
    lignes.push("Aujourd'hui, aucun projet de Bâtisseur à présenter : parle de la RAISON D'ÊTRE d'Abondance à partir des sujets de fond ci-dessous, avec des exemples de projets qu'un auditeur pourrait lancer ou soutenir. Ce ne sont pas des projets réels : n'invente aucun nom, aucun lieu, aucun chiffre.")
  }
  if (campagne) {
    lignes.push(`La campagne de soutien du jour, « ${campagne.titre} » (${campagne.porteur}), est une campagne EXTÉRIEURE qu'Abondance met en avant : le don se fait chez l'organisme ; ne cite aucun montant.`)
  }
  lignes.push("Termine souvent par une invitation concrète : ouvrir Abondance dans Infinity, proposer son aide à un projet, ou présenter le sien. Jamais d'adresse, jamais de lien, jamais de contact. Ne parle jamais de modération ni de validation interne d'un projet précis.")
  return lignes.join('\n')
}

