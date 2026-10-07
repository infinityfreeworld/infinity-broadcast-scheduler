/**
 * @module InfinityScheduler/Lib/SujetsCarte
 * @description Ce qui se passe SUR LA CARTE d'Infinity, transformé en sujets d'antenne — PUR, sans
 *   réseau (la récupération est dans `carte-relais.ts`).
 *
 *   Décisions du Bâtisseur (07/10/2026) :
 *     1. une station « Manifestactions » parle des Manifestactions publiées par les Bâtisseurs (titre,
 *        ville, date, ce qu'on y fait, comment rejoindre) ; quand il n'y a rien (ou rien de neuf), elle
 *        parle de la RAISON D'ÊTRE des Manifestactions : œuvrer en faveur du vivant, des besoins vitaux
 *        et de l'émancipation (esprit FSTA, « From Screen To Action ») ;
 *     2. Freeworld Radio ouvre une rubrique « pendant ce temps sur la carte » : nouvelles
 *        Manifestactions, Agoras ouvertes, Biogames.
 *
 *   Trois familles, quatre sources :
 *     • 30500 `MHE_EVENT`              — Manifestaction (remplaçable, d = id)
 *     • 30360 `AGORA_PROPOSAL`         — registre des Agoras (remplaçable, d = id, tag t=agora)
 *     • 30370 / 30375 / 30377          — Biogame : Tournoi / Compétition / Défi
 *     • 30386 `BIOGAME_DECISION_ADMIN` — l'aval de l'administration : un Biogame n'est PUBLIC que
 *                                        validé, et validé dans CETTE version (tag `e`).
 *
 *   ── CE QUI N'EST JAMAIS DIT ──────────────────────────────────────────────────────────────────
 *   • rien de privé : une Manifestaction non publique est chiffrée et n'a pas le tag
 *     `visibility=public` — on EXIGE ce tag ; jamais un courriel, un contact, un lien, un numéro ;
 *   • aucun lieu plus fin que la ville (`villes.ts`) — ni `location`, ni `g`, ni `zone`, ni `region` ;
 *   • rien de retiré : version la plus récente seulement (remplaçable), pierre tombale (contenu
 *     « supprimé », vide ou `retracted`), suppression NIP-09 par l'auteur, échéance NIP-40 ;
 *   • rien de fini : Manifestaction annulée, terminée, en pause, pré-enregistrée ou échue ;
 *   • rien d'un compte banni, d'une publication masquée ou refusée par l'administration ;
 *   • rien d'un compte NEUF au moment où il a publié (cf. `ConfianceCarte.etablis`) : mesuré le
 *     07/10/2026, 501 des 531 Manifestactions des relais sont une vague de moquerie du 30/09
 *     (« Un logiciel de la honte »…), une clé jetable chacune, publiée dans la minute ;
 *   • le sigle de l'administration (règle du Bâtisseur : « l'IHL ne se nomme JAMAIS ») — cf.
 *     `sansSigleAdministration`, appliqué aux sujets ET aux répliques produites.
 */
import type { Event as NostrEvent } from 'nostr-tools'
import type { NewsItem } from './types'
import { lieuParle } from './villes'

export const KIND_MHE = 30500
export const KIND_AGORA = 30360
export const KIND_BIOGAME_TOURNOI = 30370
export const KIND_BIOGAME_COMPETITION = 30375
export const KIND_BIOGAME_DEFI = 30377
export const KIND_DECISION_BIOGAME = 30386
export const KIND_MODERATION_IHL = 30216
export const KIND_SUPPRESSION = 5
export const KINDS_BIOGAME = [KIND_BIOGAME_TOURNOI, KIND_BIOGAME_COMPETITION, KIND_BIOGAME_DEFI] as const

/** Les stations concernées (identifiants des deux seeds). */
export const STATION_MANIFESTACTIONS = 'manifestactions-radio'
export const STATION_FREEWORLD = 'freeworld-radio'

/** Le rôle de la carte pour une station : toute l'antenne, une rubrique, ou rien. */
export function stationConcernee(station: { id: string; kind: string }): 'manifestactions' | 'rubrique' | null {
  if (station.id === STATION_MANIFESTACTIONS || station.kind === 'manifestactions') return 'manifestactions'
  if (station.id === STATION_FREEWORLD) return 'rubrique'
  return null
}

const JOUR_MS = 86_400_000
/** Une Manifestaction / un Biogame « récent » : publié depuis moins de tant de jours. */
export const RECENT_JOURS = 30
/** Une Agora « nouvelle » : ouverte depuis moins de tant de jours. */
export const AGORA_RECENTE_JOURS = 45
/** « À venir » : pas plus loin que tant de jours. */
export const A_VENIR_JOURS = 90
/** Même règle que la télévision (`infinity-sujets.ts`) : on ne raconte pas ce qu'on ne peut pas raconter. */
export const DESCRIPTION_MIN = 40
/** Un compte est « établi » s'il publiait déjà au moins tant de jours AVANT sa publication (règle des
 *  comptes neufs de l'application : 7 jours, `NEWCOMER_DEFAULT.days`). */
export const ANCIENNETE_JOURS = 7
/** Une Agora floutée au-delà de cette précision n'a plus de ville fiable : on n'en dit pas. */
const PRECISION_VILLE_MAX_M = 10_000

export type FamilleCarte = 'manifestaction' | 'agora' | 'biogame'

export interface SujetCarte {
  famille:   FamilleCarte
  /** `kind:auteur:d` — jamais dit. */
  cle:       string
  /** Signataire — jamais dit, sert aux contrôles de confiance. */
  auteur:    string
  /** Identifiant de l'événement lu (contrôles de masquage / d'approbation). */
  eventId:   string
  titre:     string
  /** « à Lyon », « près de Lyon », « à distance », ou ''. */
  lieu:      string
  /** « à partir du 12 octobre », « en cours jusqu'au 3 novembre »… */
  quand:     string
  /** Ce qu'on y fait (≤ 200 caractères, nettoyé). */
  quoi:      string
  /** Comment rejoindre — toujours DANS l'application, jamais un contact. */
  rejoindre: string
  /** Date de publication (ms) — sert au tri « du plus neuf ». */
  publieLe:  number
}

/** Ce que l'administration et les relais nous disent des auteurs et des publications. */
export interface ConfianceCarte {
  /** Comptes bannis (documents de modération signés par un administrateur). */
  bannis:    ReadonlySet<string>
  /** Publications masquées ou refusées (ids d'événements). */
  masques:   ReadonlySet<string>
  /** Publications approuvées par l'administration (ids) — valent « compte établi ». */
  approuves: ReadonlySet<string>
  /** Auteurs approuvés par l'administration (règle des comptes neufs). */
  auteursApprouves: ReadonlySet<string>
  /** Auteurs qui publiaient déjà ANCIENNETE_JOURS avant leur publication (sonde des relais). */
  etablis:   ReadonlySet<string>
  /** Administrateurs : seuls juges des Biogames, et établis d'office. */
  arbitres:  ReadonlySet<string>
}

export const CONFIANCE_VIDE: ConfianceCarte = {
  bannis: new Set(), masques: new Set(), approuves: new Set(), auteursApprouves: new Set(),
  etablis: new Set(), arbitres: new Set(),
}

// ── Outils ───────────────────────────────────────────────────────────────────────────────────

const tag = (e: Pick<NostrEvent, 'tags'>, nom: string): string | undefined => e.tags.find(t => t[0] === nom)?.[1]
const texte = (v: unknown): string => (typeof v === 'string' ? v.trim() : '')
const nombre = (v: unknown): number | undefined => (typeof v === 'number' && Number.isFinite(v) ? v : undefined)

function contenu(e: NostrEvent): Record<string, unknown> | null {
  try {
    const c = JSON.parse(e.content) as unknown
    return c && typeof c === 'object' && !Array.isArray(c) ? (c as Record<string, unknown>) : null
  } catch { return null }
}

/** Remplace le sigle de l'administration : « l'IHL ne se nomme JAMAIS » (décision du Bâtisseur). */
export function sansSigleAdministration(s: string): string {
  return s
    .replace(/\bl['’]\s?I\.?H\.?L\b/gi, "l'administration")
    .replace(/\bI\.?H\.?L\b/gi, "l'administration")
}

/**
 * Un texte LIBRE d'auteur, débarrassé de ce qui ne se dit pas à l'antenne : adresses web, courriels,
 * numéros de téléphone (≥ 8 chiffres), puis coupé proprement à `max` caractères.
 */
export function nettoyerTexteLibre(s: string, max = 200): string {
  const net = sansSigleAdministration(s)
    .replace(/\b(?:https?:\/\/|www\.)\S+/gi, ' ')
    .replace(/\b[\w.+-]+@[\w-]+\.[\w.-]+\b/g, ' ')
    .replace(/\+?\d[\d .-]{6,}\d/g, ' ')
    // L'étiquette qui annonçait ce qu'on vient de retirer (« Contact : , ») ne reste pas orpheline.
    .replace(/\b(?:contact|t[ée]l(?:[ée]phone)?|e-?mail|courriel|site(?: web)?|infos?)\s*:\s*(?=[\s,.;)]*(?:[,.;)]|$))/gi, ' ')
    .replace(/\s+([,.;)])/g, '$1')
    .replace(/([.!?])\s*[,;]\s*/g, '$1 ')
    .replace(/^[\s,;.]+/, '')
    .replace(/\s+/g, ' ')
    .trim()
  if (net.length <= max) return net
  const coupe = net.slice(0, max)
  const espace = coupe.lastIndexOf(' ')
  return `${(espace > max * 0.6 ? coupe.slice(0, espace) : coupe).replace(/[\s,;:.–-]+$/, '')}…`
}

const FUSEAU = 'Europe/Paris'
/** « 12 octobre » (l'année seulement si elle n'est pas celle de `maintenant`). */
export function dateParlee(ms: number, maintenant: number): string {
  const memeAnnee = new Date(ms).getUTCFullYear() === new Date(maintenant).getUTCFullYear()
  return new Date(ms).toLocaleDateString('fr-FR', {
    day: 'numeric', month: 'long', ...(memeAnnee ? {} : { year: 'numeric' }), timeZone: FUSEAU,
  })
}

/** « YYYY-MM-DD » (dates des Biogames) → ms à midi UTC, ou undefined. */
function jourIso(s: unknown): number | undefined {
  if (typeof s !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return undefined
  const ms = Date.parse(`${s}T12:00:00Z`)
  return Number.isFinite(ms) ? ms : undefined
}

/** Échéance NIP-40 passée ? */
export function expireNip40(e: Pick<NostrEvent, 'tags'>, maintenant: number): boolean {
  const exp = Number(tag(e, 'expiration'))
  return Number.isFinite(exp) && exp > 0 && exp * 1000 <= maintenant
}

/** L'auteur a refusé la diffusion hors de l'application (`["infinity-partage","non"]`). */
const partageRefuse = (e: Pick<NostrEvent, 'tags'>) => e.tags.some(t => t[0] === 'infinity-partage' && t[1] === 'non')

export const coordonnee = (e: Pick<NostrEvent, 'kind' | 'pubkey' | 'tags'>): string | null => {
  const d = tag(e, 'd')
  return d ? `${e.kind}:${e.pubkey.toLowerCase()}:${d}` : null
}

/** Pierre tombale d'un remplaçable : contenu vide, `{deleted:true}`, ou tag `retracted`. */
export function estPierreTombale(e: NostrEvent): boolean {
  if (!e.content || !e.content.trim()) return true
  if (e.tags.some(t => t[0] === 'retracted' && t[1] === '1')) return true
  const c = contenu(e)
  return !!c && c.deleted === true
}

/**
 * Ne garde que la DERNIÈRE version de chaque remplaçable (`kind:auteur:d`). À date égale, la
 * pierre tombale l'emporte : dans le doute, on se tait. Les pierres tombales sont rendues aussi
 * (le lecteur les écarte) : sans elles, une version plus ancienne ressusciterait.
 */
export function dernieresVersions(events: readonly NostrEvent[]): NostrEvent[] {
  const parCle = new Map<string, NostrEvent>()
  for (const e of events) {
    const c = coordonnee(e)
    if (!c) continue
    const deja = parCle.get(c)
    if (!deja || e.created_at > deja.created_at
      || (e.created_at === deja.created_at && estPierreTombale(e) && !estPierreTombale(deja))) {
      parCle.set(c, e)
    }
  }
  return [...parCle.values()]
}

/**
 * Suppressions NIP-09 (kind 5) qui valent : signées par l'AUTEUR de ce qu'elles visent. Une
 * suppression signée par quelqu'un d'autre ne retire rien (sinon n'importe qui ferait taire
 * n'importe qui).
 */
export function suppressions(events: readonly NostrEvent[]): { coordonnees: Set<string>; ids: Map<string, string> } {
  const coordonnees = new Set<string>()
  const ids = new Map<string, string>()   // id visé → pubkey qui le supprime
  for (const e of events) {
    if (e.kind !== KIND_SUPPRESSION) continue
    const qui = e.pubkey.toLowerCase()
    for (const t of e.tags) {
      if (t[0] === 'a' && typeof t[1] === 'string') {
        const m = /^(\d+):([0-9a-fA-F]{64}):(.+)$/.exec(t[1])
        if (m && m[2].toLowerCase() === qui) coordonnees.add(`${m[1]}:${qui}:${m[3]}`)
      } else if (t[0] === 'e' && typeof t[1] === 'string') {
        ids.set(t[1], qui)
      }
    }
  }
  return { coordonnees, ids }
}

// ── Manifestactions ──────────────────────────────────────────────────────────────────────────

/** Statuts d'une Manifestaction qu'on peut encore REJOINDRE. Un statut inconnu n'en fait pas partie. */
const STATUTS_VIVANTS = new Set(['preparation', 'mobilisation', 'active', 'consolidation'])

/** Une Manifestaction publique, vivante, récente ou à venir — ou rien. */
export function lireManifestactionCarte(e: NostrEvent, maintenant: number): SujetCarte | null {
  if (e.kind !== KIND_MHE) return null
  // 🔒 PUBLIQUE, explicitement. Une Manifestaction « contacts » ou « privée » est chiffrée pour ses
  // destinataires : elle n'a rien à faire à l'antenne, même si un relais en garde une trace lisible.
  if (tag(e, 'visibility') !== 'public') return null
  if (partageRefuse(e) || expireNip40(e, maintenant) || estPierreTombale(e)) return null
  const c = contenu(e)
  if (!c) return null
  const titre = nettoyerTexteLibre(texte(c.title), 90)
  const description = texte(c.description)
  if (!titre || description.length < DESCRIPTION_MIN) return null
  if (!STATUTS_VIVANTS.has(texte(c.status))) return null
  // Échéance de vie (`expiresAt`, ms) : null = illimitée ; absente = `endDate` (même règle que le codec).
  const echeance = c.expiresAt === null ? undefined : (nombre(c.expiresAt) ?? nombre(c.endDate))
  if (echeance !== undefined && echeance <= maintenant) return null
  const debut = nombre(c.startDate)
  const cree = nombre(c.createdAt) ?? e.created_at * 1000
  const aVenir = debut !== undefined && debut > maintenant && debut <= maintenant + A_VENIR_JOURS * JOUR_MS
  const recente = cree <= maintenant + JOUR_MS && maintenant - cree <= RECENT_JOURS * JOUR_MS
  if (!aVenir && !recente) return null

  // Le lieu : le POINT, ramené à la ville. Jamais `location` (souvent des coordonnées en clair, parfois
  // une adresse), jamais le tag `g` (le même libellé).
  const pt = Array.isArray(c.coordinates) ? c.coordinates : []
  const lieu = lieuParle(nombre(pt[1]), nombre(pt[0]))

  let quand: string
  if (debut !== undefined && debut > maintenant) {
    quand = `à partir du ${dateParlee(debut, maintenant)}${echeance !== undefined ? `, jusqu'au ${dateParlee(echeance, maintenant)}` : ''}`
  } else {
    quand = echeance !== undefined ? `en cours, jusqu'au ${dateParlee(echeance, maintenant)}` : 'en cours, sans date de fin'
  }
  const inscription = c.inscription && typeof c.inscription === 'object' && (c.inscription as Record<string, unknown>).personnes === true
  return {
    famille: 'manifestaction',
    cle: coordonnee(e) ?? e.id,
    auteur: e.pubkey.toLowerCase(),
    eventId: e.id,
    titre,
    lieu,
    quand,
    quoi: nettoyerTexteLibre(description),
    rejoindre: inscription
      ? "s'inscrire sur sa fiche, onglet Manifestactions d'Infinity"
      : "sa fiche est sur la carte d'Infinity, onglet Manifestactions",
    publieLe: cree,
  }
}

// ── Agoras ───────────────────────────────────────────────────────────────────────────────────

const TYPES_AGORA: Readonly<Record<string, string>> = {
  marche: 'un marché permanent', festival: 'un festival', rencontre: 'un lieu de rencontre', mixte: 'une Agora mixte',
}
const BESOINS: Readonly<Record<string, string>> = {
  alimentation: 'alimentation', eau: 'eau', sante: 'santé', energie: 'énergie', abri: 'abri',
  vetements: 'vêtements', savoirs: 'savoirs',
}
const JOURS: Readonly<Record<string, string>> = {
  lun: 'lundi', mar: 'mardi', mer: 'mercredi', jeu: 'jeudi', ven: 'vendredi', sam: 'samedi', dim: 'dimanche',
}
const enumerer = (l: string[]) => l.length <= 1 ? (l[0] ?? '') : `${l.slice(0, -1).join(', ')} et ${l[l.length - 1]}`

/** Une Agora du registre, ouverte récemment — ou rien. */
export function lireAgoraCarte(e: NostrEvent, maintenant: number): SujetCarte | null {
  if (e.kind !== KIND_AGORA) return null
  // Le kind 30360 est PARTAGÉ (mesuré le 07/10 : des « agents » d'autres applications) : tag `t=agora` exigé.
  if (!e.tags.some(t => t[0] === 't' && t[1] === 'agora')) return null
  if (tag(e, 'visibility') !== 'public') return null
  if (expireNip40(e, maintenant) || estPierreTombale(e)) return null
  const c = contenu(e)
  if (!c) return null
  const nom = nettoyerTexteLibre(texte(c.name), 90)
  const lat = nombre(c.lat), lng = nombre(c.lng)
  if (!texte(c.id) || !nom || lat === undefined || lng === undefined) return null
  const cree = nombre(c.createdAt) ?? e.created_at * 1000
  if (cree > maintenant + JOUR_MS || maintenant - cree > AGORA_RECENTE_JOURS * JOUR_MS) return null
  const precision = nombre(c.precisionM) ?? Number(tag(e, 'prec'))
  const lieu = Number.isFinite(precision) && precision > PRECISION_VILLE_MAX_M ? '' : lieuParle(lat, lng)
  const besoins = (Array.isArray(c.needs) ? c.needs : []).map(n => BESOINS[String(n)]).filter((x): x is string => !!x)
  const sched = c.schedule && typeof c.schedule === 'object' ? c.schedule as Record<string, unknown> : null
  const jours = (Array.isArray(sched?.days) ? sched!.days as unknown[] : []).map(d => JOURS[String(d)]).filter((x): x is string => !!x)
  const dispo = texte(c.availability)
  const quand = dispo === 'recurrente'
    ? (jours.length ? `chaque ${enumerer(jours)}` : 'à dates régulières')
    : dispo === 'ponctuelle' ? 'ponctuelle, la date est sur sa fiche' : 'ouverte en permanence'
  return {
    famille: 'agora',
    cle: coordonnee(e) ?? e.id,
    auteur: e.pubkey.toLowerCase(),
    eventId: e.id,
    titre: nom,
    lieu,
    quand,
    quoi: `${TYPES_AGORA[texte(c.type)] ?? 'une Agora'}${besoins.length ? `, autour des besoins vitaux : ${enumerer(besoins)}` : ''}`,
    rejoindre: "sa fiche est sur la carte d'Infinity : on peut la soutenir ou y réserver un stand",
    publieLe: cree,
  }
}

// ── Biogames ─────────────────────────────────────────────────────────────────────────────────

export interface DecisionBiogame { arbitre: string; coordonnee: string; eventId: string; valide: boolean; le: number }

/** Les avis de l'administration (30386). Mal formés → ignorés. */
export function lireDecisions(events: readonly NostrEvent[]): DecisionBiogame[] {
  const out: DecisionBiogame[] = []
  for (const e of events) {
    if (e.kind !== KIND_DECISION_BIOGAME) continue
    const a = tag(e, 'a'), d = tag(e, 'd'), id = tag(e, 'e'), decision = tag(e, 'decision')
    if (!a || a !== d || !id || !/^[0-9a-f]{64}$/.test(id)) continue
    const m = /^(\d+):([0-9a-f]{64}):(.+)$/.exec(a)
    if (!m || !(KINDS_BIOGAME as readonly number[]).includes(Number(m[1]))) continue
    if (decision !== 'valide' && decision !== 'refuse') continue
    out.push({ arbitre: e.pubkey.toLowerCase(), coordonnee: a, eventId: id, valide: decision === 'valide', le: e.created_at })
  }
  return out
}

/**
 * Validé par l'administration, DANS CETTE VERSION ? Même règle que l'application
 * (`biogame-validation.ts › etatValidation`) : seuls comptent les avis d'un arbitre, sur ce Biogame,
 * sur cet événement précis ; le plus récent l'emporte, à date égale le refus.
 */
export function biogameValide(e: NostrEvent, decisions: readonly DecisionBiogame[], arbitres: ReadonlySet<string>): boolean {
  const coord = coordonnee(e)
  if (!coord) return false
  let retenue: DecisionBiogame | null = null
  for (const d of decisions) {
    if (d.coordonnee !== coord || d.eventId !== e.id || !arbitres.has(d.arbitre)) continue
    if (!retenue || d.le > retenue.le || (d.le === retenue.le && !d.valide)) retenue = d
  }
  return retenue?.valide === true
}

const SPORTS: Readonly<Record<string, string>> = {
  trail: 'trail', course: 'course à pied', marche: 'marche', plogging: 'plogging (on court en ramassant les déchets)',
  seedrun: 'seed run (on sème en courant)', velo: 'vélo', orientation: "course d'orientation", baston: 'jeu de terrain', fwc: 'jeu de terrain',
}
const QUETES: Readonly<Record<string, string>> = {
  maraude: 'maraude', aines: 'compagnie aux aînés', courses: 'courses et démarches', alimentaire: 'distribution alimentaire',
  mentorat: 'mentorat', coupdemain: 'coup de main', ecoute: 'écoute et présence', animaux: 'aide aux animaux',
}

function premierPoint(v: unknown): { lat?: number; lng?: number } {
  if (!Array.isArray(v) || !v.length) return {}
  const p = v[0] as unknown
  if (Array.isArray(p)) return { lng: nombre(p[0]), lat: nombre(p[1]) }               // [lng, lat]
  if (p && typeof p === 'object') { const o = p as Record<string, unknown>; return { lng: nombre(o.lng), lat: nombre(o.lat) } }
  return {}
}

/** Un Biogame publié (Tournoi, Compétition, Défi), à venir ou récent — SANS juger sa validation. */
export function lireBiogameCarte(e: NostrEvent, maintenant: number): SujetCarte | null {
  const etiquette = e.kind === KIND_BIOGAME_TOURNOI ? 'biogame'
    : e.kind === KIND_BIOGAME_COMPETITION ? 'biogame-defi'
    : e.kind === KIND_BIOGAME_DEFI ? 'biogame-quete' : null
  if (!etiquette || !e.tags.some(t => t[0] === 't' && t[1] === etiquette)) return null
  if (expireNip40(e, maintenant) || estPierreTombale(e)) return null
  const c = contenu(e)
  if (!c || !texte(c.id)) return null
  const titre = nettoyerTexteLibre(texte(e.kind === KIND_BIOGAME_DEFI ? c.title : c.name), 90)
  if (!titre) return null
  const cree = nombre(c.createdAt) ?? e.created_at * 1000
  const desc = nettoyerTexteLibre(texte(c.desc))

  let date: number | undefined, fin: number | undefined, lieu = '', quoi: string, rejoindre: string
  if (e.kind === KIND_BIOGAME_TOURNOI) {
    if (texte(c.status) === 'termine') return null
    date = jourIso(c.startDate); fin = jourIso(c.endDate)
    const p = premierPoint(c.parcours)
    lieu = lieuParle(p.lat, p.lng)
    quoi = `un Tournoi de l'Autonomie${desc ? ` : ${desc}` : ''}`
    rejoindre = 'on forme ou on rejoint une Tribu dans Biogame, rubrique Tournois'
  } else if (e.kind === KIND_BIOGAME_COMPETITION) {
    date = jourIso(c.date)
    if (c.mode === 'virtuel') lieu = 'à distance'
    else { const p = premierPoint(Array.isArray(c.route) && c.route.length ? c.route : c.parcours); lieu = lieuParle(p.lat, p.lng) }
    quoi = `une compétition de ${SPORTS[texte(c.sport)] ?? 'sport'}${desc ? ` : ${desc}` : ''}`
    rejoindre = "on s'inscrit dans Biogame, rubrique Compétitions"
  } else {
    date = jourIso(c.date)
    // Jamais `zone` (un quartier, parfois) ni les détails chiffrés : le point arrondi, ramené à la ville.
    lieu = lieuParle(nombre(c.lat), nombre(c.lng))
    quoi = `un défi d'entraide${QUETES[texte(c.type)] ? ` (${QUETES[texte(c.type)]})` : ''}${desc ? ` : ${desc}` : ''}`
    rejoindre = 'on se porte volontaire dans Biogame, rubrique Défis'
  }
  const finEffective = fin ?? date
  if (finEffective !== undefined && finEffective < maintenant - JOUR_MS / 2) return null
  const aVenir = date !== undefined && date > maintenant && date <= maintenant + A_VENIR_JOURS * JOUR_MS
  const recent = cree <= maintenant + JOUR_MS && maintenant - cree <= RECENT_JOURS * JOUR_MS
  if (!aVenir && !recent) return null
  const quand = date !== undefined && date > maintenant ? `le ${dateParlee(date, maintenant)}`
    : fin !== undefined ? `jusqu'au ${dateParlee(fin, maintenant)}` : 'en ce moment'
  return {
    famille: 'biogame', cle: coordonnee(e) ?? e.id, auteur: e.pubkey.toLowerCase(), eventId: e.id,
    titre, lieu, quand, quoi: nettoyerTexteLibre(quoi), rejoindre, publieLe: cree,
  }
}

// ── Confiance : modération et ancienneté ─────────────────────────────────────────────────────

const HEX64 = /^[0-9a-f]{64}$/i

/**
 * Lit les documents de modération de l'administration (kind 30216) : `ihl-account-bans` (bans de
 * comptes), `ihl-moderation` (bans + publications masquées), `ihl-account-restrictions` (avis de la
 * file de validation). Seuls comptent ceux signés par un ARBITRE. On fait l'UNION des documents —
 * pour un ban ou un masquage, la prudence ; pour une approbation, l'avis d'un administrateur suffit.
 */
export function confianceDepuisModeration(
  events: readonly NostrEvent[], arbitres: ReadonlySet<string>, maintenant: number,
): Pick<ConfianceCarte, 'bannis' | 'masques' | 'approuves' | 'auteursApprouves'> {
  const bannis = new Set<string>(), masques = new Set<string>(), approuves = new Set<string>(), auteursApprouves = new Set<string>()
  for (const e of dernieresVersions(events.filter(x => x.kind === KIND_MODERATION_IHL && arbitres.has(x.pubkey.toLowerCase())))) {
    const c = contenu(e)
    if (!c) continue
    const d = tag(e, 'd')
    const liste = (v: unknown): Record<string, unknown>[] =>
      (Array.isArray(v) ? v : []).filter((x): x is Record<string, unknown> => !!x && typeof x === 'object')
    if (d === 'ihl-account-bans') {
      for (const b of liste(c.bans)) {
        const until = nombre(b.until)
        if (typeof b.pubkey === 'string' && HEX64.test(b.pubkey) && (until === undefined || until > maintenant)) bannis.add(b.pubkey.toLowerCase())
      }
    } else if (d === 'ihl-moderation') {
      for (const b of Array.isArray(c.bans) ? c.bans : []) if (typeof b === 'string' && HEX64.test(b)) bannis.add(b.toLowerCase())
      for (const h of liste(c.hidden)) if (typeof h.id === 'string') masques.add(h.id)
    } else if (d === 'ihl-account-restrictions') {
      for (const r of liste(c.reviews)) {
        if (typeof r.id !== 'string') continue
        if (r.verdict === 'rejected') masques.add(r.id)
        else if (r.verdict === 'approved') {
          approuves.add(r.id)
          // « Une APPROBATION rend le compte établi » (règle des comptes neufs de l'application).
          if (r.rule === 'newcomer' && typeof r.pubkey === 'string' && HEX64.test(r.pubkey)) auteursApprouves.add(r.pubkey.toLowerCase())
        }
      }
    }
  }
  return { bannis, masques, approuves, auteursApprouves }
}

/**
 * Pour chaque auteur à juger, la date (secondes) AVANT laquelle il doit déjà avoir publié pour être
 * « établi » : sa publication la plus ancienne parmi celles qu'on veut dire, moins ANCIENNETE_JOURS.
 * Juger l'âge au moment de la PUBLICATION, et non aujourd'hui : un compte jetable de la vague du 30/09
 * aura bientôt sept jours, il n'en avait pas sept minutes quand il a publié.
 */
export function seuilsAnciennete(sujets: readonly SujetCarte[], conf: Pick<ConfianceCarte, 'arbitres' | 'bannis'>): Map<string, number> {
  const seuils = new Map<string, number>()
  for (const s of sujets) {
    if (s.famille === 'biogame' || conf.arbitres.has(s.auteur) || conf.bannis.has(s.auteur)) continue
    const seuil = Math.floor(s.publieLe / 1000) - ANCIENNETE_JOURS * 86_400
    const deja = seuils.get(s.auteur)
    if (deja === undefined || seuil < deja) seuils.set(s.auteur, seuil)
  }
  return seuils
}

/** Les auteurs dont un événement (signé par eux, revérifié ici) précède leur seuil. */
export function etablisDepuis(events: readonly Pick<NostrEvent, 'pubkey' | 'created_at'>[], seuils: ReadonlyMap<string, number>): Set<string> {
  const etablis = new Set<string>()
  for (const e of events) {
    const pk = e.pubkey.toLowerCase()
    const seuil = seuils.get(pk)
    if (seuil !== undefined && e.created_at <= seuil) etablis.add(pk)
  }
  return etablis
}

// ── Assemblage ───────────────────────────────────────────────────────────────────────────────

/**
 * Tout ce qui est LISIBLE et à jour, AVANT les contrôles de confiance — sert à savoir quels auteurs
 * sonder. Les Biogames non validés n'y figurent pas (ils ne seront jamais dits).
 */
export function sujetsLisibles(events: readonly NostrEvent[], maintenant: number, arbitres: ReadonlySet<string>): SujetCarte[] {
  const supp = suppressions(events)
  const decisions = lireDecisions(events)
  const out: SujetCarte[] = []
  for (const e of dernieresVersions(events.filter(x => x.kind !== KIND_SUPPRESSION && x.kind !== KIND_DECISION_BIOGAME))) {
    const coord = coordonnee(e)
    if (coord && supp.coordonnees.has(coord)) continue
    if (supp.ids.get(e.id) === e.pubkey.toLowerCase()) continue
    let s: SujetCarte | null = null
    if (e.kind === KIND_MHE) s = lireManifestactionCarte(e, maintenant)
    else if (e.kind === KIND_AGORA) s = lireAgoraCarte(e, maintenant)
    else if ((KINDS_BIOGAME as readonly number[]).includes(e.kind)) {
      s = biogameValide(e, decisions, arbitres) ? lireBiogameCarte(e, maintenant) : null
    }
    if (s) out.push(s)
  }
  return out
}

/** Peut-on dire ce sujet ? Banni / masqué → jamais ; sinon il faut un auteur établi ou approuvé. */
export function sujetDeConfiance(s: SujetCarte, conf: ConfianceCarte): boolean {
  if (conf.bannis.has(s.auteur) || conf.masques.has(s.eventId)) return false
  // Un Biogame a déjà l'aval EXPLICITE de l'administration sur cette version : c'est la preuve.
  if (s.famille === 'biogame') return true
  return conf.arbitres.has(s.auteur) || conf.approuves.has(s.eventId)
    || conf.auteursApprouves.has(s.auteur) || conf.etablis.has(s.auteur)
}

/**
 * Les sujets retenus, du plus neuf au plus ancien, avec un tour de table par famille (comme la
 * télévision : un jour de forte activité, les Agoras et les Biogames existent quand même à
 * l'antenne). Un sujet par AUTEUR au plus : une seule clé ne monopolise pas la rubrique.
 */
export function retenirSujetsCarte(
  events: readonly NostrEvent[], conf: ConfianceCarte, maintenant: number,
  opts: { combien?: number; familles?: readonly FamilleCarte[] } = {},
): SujetCarte[] {
  const familles = new Set(opts.familles ?? ['manifestaction', 'agora', 'biogame'])
  const combien = Math.max(1, opts.combien ?? 6)
  const parFamille = new Map<FamilleCarte, SujetCarte[]>()
  const auteursVus = new Set<string>()
  const tous = sujetsLisibles(events, maintenant, conf.arbitres)
    .filter(s => familles.has(s.famille) && sujetDeConfiance(s, conf))
    .sort((a, b) => b.publieLe - a.publieLe || a.cle.localeCompare(b.cle))
  for (const s of tous) {
    if (auteursVus.has(s.auteur)) continue
    auteursVus.add(s.auteur)
    const l = parFamille.get(s.famille) ?? []
    l.push(s)
    parFamille.set(s.famille, l)
  }
  const retenus: SujetCarte[] = []
  const restes: SujetCarte[] = []
  for (const f of ['manifestaction', 'agora', 'biogame'] as const) {
    const l = parFamille.get(f) ?? []
    if (l.length) retenus.push(l[0])
    restes.push(...l.slice(1))
  }
  retenus.sort((a, b) => b.publieLe - a.publieLe)
  restes.sort((a, b) => b.publieLe - a.publieLe)
  return [...retenus, ...restes].slice(0, combien)
}

const SOURCE_PAR_FAMILLE: Readonly<Record<FamilleCarte, string>> = {
  manifestaction: "Manifestaction publiée sur la carte d'Infinity",
  agora: "Agora ouverte sur la carte d'Infinity",
  biogame: "Biogame sur la carte d'Infinity",
}

/**
 * Le sujet sous la forme qu'attend le prompt (`formatNewsForPrompt` coupe le résumé à 180
 * caractères) : les REPÈRES d'abord (quand, où, comment rejoindre), la description ensuite — la coupe
 * n'emporte que la fin de la description.
 */
export function sujetVersActualite(s: SujetCarte): NewsItem {
  return {
    title: s.titre,
    summary: [s.quand, s.lieu, `Rejoindre : ${s.rejoindre}`, s.quoi].filter(Boolean).join(' · '),
    publishedAt: s.publieLe,
    sourceTitle: SOURCE_PAR_FAMILLE[s.famille],
  }
}

/** Une ligne complète (sans coupe) pour la consigne d'un tour de la rubrique. */
export function sujetEnUneLigne(s: SujetCarte): string {
  const famille = s.famille === 'manifestaction' ? 'Manifestaction' : s.famille === 'agora' ? 'Agora' : 'Biogame'
  return `${famille} « ${s.titre} »${s.lieu ? `, ${s.lieu}` : ''}, ${s.quand} — ${s.quoi.replace(/[\s.…!?]+$/, '')}. Pour rejoindre : ${s.rejoindre}.`
}

// ── La raison d'être (quand la carte n'a rien de neuf) ──────────────────────────────────────

export const SOURCE_RAISON_D_ETRE = "Raison d'être des Manifestactions"

/**
 * Sujets de FOND de la station Manifestactions. Ce ne sont PAS des événements : le prompt interdit
 * de leur inventer participants, chiffres ou lieux. Chaque résumé tient en 180 caractères (coupe de
 * `formatNewsForPrompt`). Treize sujets, trois par jour, en tournant : deux jours de suite ne
 * reprennent jamais le même, et le cycle est long (treize est premier avec trois).
 */
export const RAISONS_D_ETRE: ReadonlyArray<NewsItem> = [
  { title: 'Pourquoi des Manifestactions', summary: "Plutôt que défiler pour demander, agir pour construire : une Manifestaction est une action concrète, près de chez soi, pour le vivant, les besoins vitaux et l'émancipation.", sourceTitle: SOURCE_RAISON_D_ETRE },
  { title: "From Screen To Action", summary: "L'esprit FSTA : l'écran n'est qu'un point de départ. On s'y retrouve, on s'organise, puis on éteint et on y va. Ce qui compte se passe dehors, ensemble.", sourceTitle: SOURCE_RAISON_D_ETRE },
  { title: "L'eau, premier besoin vital", summary: "Protéger une source, nettoyer une berge, récupérer l'eau de pluie, partager un puits : autour de l'eau, une Manifestaction prend soin de ce dont tout dépend.", sourceTitle: SOURCE_RAISON_D_ETRE },
  { title: 'Se nourrir ensemble', summary: "Jardins partagés, semis, glanage, cuisine collective, terres reprises et cultivées : se nourrir est un besoin vital, et le cultiver ensemble rend libre.", sourceTitle: SOURCE_RAISON_D_ETRE },
  { title: 'Un toit sain pour chacun', summary: "Chantiers participatifs, habitats légers, rénovation, entraide pour un abri : construire des habitats sains, c'est œuvrer pour un besoin vital, de ses mains.", sourceTitle: SOURCE_RAISON_D_ETRE },
  { title: 'Le vivant autour de nous', summary: "Haies, mares, refuges pour la faune, arbres plantés, déchets ramassés : chaque Manifestaction pour le vivant répare un peu le lien entre nous et la terre.", sourceTitle: SOURCE_RAISON_D_ETRE },
  { title: "S'émanciper par l'action", summary: "Apprendre à faire, transmettre un savoir, gagner en autonomie : l'émancipation ne se demande pas, elle se pratique, une action collective après l'autre.", sourceTitle: SOURCE_RAISON_D_ETRE },
  { title: 'Hors de l\'Enclos', summary: "MHE : Manifestactions Hors de l'Enclos. Sortir de l'enclos, c'est cesser d'attendre la permission pour prendre soin de son quartier, de sa terre, des siens.", sourceTitle: SOURCE_RAISON_D_ETRE },
  { title: 'Lancer sa Manifestaction', summary: "Dans Infinity : un titre, un lieu, une date, ce qu'on va faire, combien on espère être. Elle apparaît sur la carte et dans l'onglet Manifestactions. Les petites comptent.", sourceTitle: SOURCE_RAISON_D_ETRE },
  { title: 'Rejoindre une Manifestaction', summary: "Sur la carte ou dans l'onglet Manifestactions : on ouvre la fiche, on s'inscrit, on prend l'itinéraire. Venir une heure, c'est déjà en être.", sourceTitle: SOURCE_RAISON_D_ETRE },
  { title: 'Booster, gratuitement', summary: "Le bouton Booster d'une Manifestaction est un coup de pouce gratuit et public : il la fait remonter pour que d'autres la voient. Soutenir, c'est le dire.", sourceTitle: SOURCE_RAISON_D_ETRE },
  { title: 'La santé, besoin vital', summary: "Marches, ateliers bien-être, plantes qui soignent, présence auprès des isolés : prendre soin les uns des autres est une Manifestaction à part entière.", sourceTitle: SOURCE_RAISON_D_ETRE },
  { title: "L'énergie qu'on produit soi-même", summary: "Four solaire, éolienne bricolée, atelier de réparation : produire et économiser l'énergie ensemble, c'est retrouver de l'autonomie sur un besoin vital.", sourceTitle: SOURCE_RAISON_D_ETRE },
]

/** Le numéro du jour (UTC) — même jour, même choix : rejouable. */
const numeroDuJour = (jour: Date | string): number => {
  const ms = typeof jour === 'string' ? Date.parse(`${jour}T12:00:00Z`) : jour.getTime()
  return Math.floor(ms / JOUR_MS)
}

/** `n` sujets de fond, en tournant d'un jour à l'autre (deux jours de suite : aucun en commun). */
export function choisirRaisonsDEtre(n: number, jour: Date | string): NewsItem[] {
  if (n <= 0) return []
  const total = RAISONS_D_ETRE.length
  const pas = Math.min(n, total)
  const debut = ((numeroDuJour(jour) * pas) % total + total) % total
  return Array.from({ length: pas }, (_, i) => RAISONS_D_ETRE[(debut + i) % total])
}

/** Combien de sujets de fond accompagnent toujours la station, même un jour chargé. */
const FOND_MIN = 1
/** Au-dessous de ce nombre de Manifestactions à raconter, la raison d'être complète. */
const SUJETS_MIN = 3

/**
 * Le « fil d'actualité » de la station Manifestactions : les Manifestactions retenues, complétées par
 * la raison d'être. Aucune Manifestaction → la raison d'être seule.
 */
export function actualitesStationManifestactions(sujets: readonly SujetCarte[], jour: Date | string, max = 6): NewsItem[] {
  const mhe = sujets.filter(s => s.famille === 'manifestaction').slice(0, max - FOND_MIN).map(sujetVersActualite)
  const fond = choisirRaisonsDEtre(Math.max(FOND_MIN, SUJETS_MIN - mhe.length), jour)
  return [...mhe, ...fond]
}

// ── La consigne de la station et la rubrique Freeworld ───────────────────────────────────────

/** Section « ligne éditoriale » du prompt système de la station Manifestactions. */
export function ligneEditorialeManifestactions(aDesManifestactions: boolean): string {
  return [
    "Ta station parle des Manifestactions : des actions concrètes que les Bâtisseurs proposent sur la carte d'Infinity, pour le vivant, les besoins vitaux (eau, nourriture, abri, santé, énergie) et l'émancipation. Esprit « From Screen To Action » : chaque sujet doit donner envie de se lever et d'y aller.",
    aDesManifestactions
      ? "Les Manifestactions de l'ACTUALITÉ ci-dessous sont réelles : pour chacune, dis son titre, sa ville, sa date, ce qu'on y fait et comment la rejoindre — TELS QU'ILS SONT DONNÉS. N'invente ni lieu plus précis, ni participants, ni chiffres, ni organisateur."
      : "Aujourd'hui, pas de nouvelle Manifestaction à annoncer : parle de leur RAISON D'ÊTRE à partir des sujets de fond ci-dessous, avec des exemples d'actions qu'un auditeur peut lancer ou rejoindre. Ce ne sont pas des événements : n'invente aucune date, aucun lieu, aucun participant.",
    "Termine souvent par une invitation concrète : ouvrir la carte d'Infinity, rejoindre une Manifestaction, ou lancer la sienne. Jamais d'adresse exacte, jamais de nom de personne, jamais de contact. Ne parle jamais de modération ni de validation interne.",
  ].join('\n')
}

export const TITRE_RUBRIQUE = 'Pendant ce temps sur la carte'

/** Petit hachage déterministe (FNV-1a) pour placer la rubrique sans hasard non rejouable. */
function hacher(s: string): number {
  let h = 0x811c9dc5
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0 }
  return h
}

/**
 * Où placer la rubrique « pendant ce temps sur la carte » : `nbTours` tours CONSÉCUTIFS (1 ou 2),
 * entre 40 % et 80 % de l'émission, jamais sur un tour `exclus` (ouverture, clôture, pauses, invité),
 * jamais en premier ni en dernier. `[]` s'il n'y a pas la place. Déterministe pour une même graine.
 */
export function placerRubriqueCarte(numTurns: number, exclus: ReadonlySet<number>, nbTours: number, graine: string): number[] {
  const n = Math.max(0, Math.min(2, nbTours))
  if (n === 0 || numTurns < 6) return []
  const debut = Math.max(1, Math.floor(numTurns * 0.4))
  const fin = Math.min(numTurns - 2, Math.floor(numTurns * 0.8))
  const possibles: number[] = []
  for (let i = debut; i + n - 1 <= fin; i++) {
    let libre = true
    for (let k = 0; k < n; k++) if (exclus.has(i + k)) libre = false
    if (libre) possibles.push(i)
  }
  if (!possibles.length) return n === 2 ? placerRubriqueCarte(numTurns, exclus, 1, graine) : []
  const i = possibles[hacher(graine) % possibles.length]
  return Array.from({ length: n }, (_, k) => i + k)
}
