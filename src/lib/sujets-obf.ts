/**
 * @module InfinityScheduler/Lib/SujetsObf
 * @description La station OBF — PUR, sans réseau (la lecture des relais est dans
 *   `stations-thema-relais.ts`).
 *
 *   Décision du Bâtisseur (07/10/2026) : la station explique ce qu'est le système OBF DANS LES DÉTAILS
 *   (Overwatch Blaze Field, l'alerte communautaire d'Infinity — `obf/types.ts`, `gravite-alerte.ts`,
 *   `triage-urgence.ts`, `identite-alerte.ts`, Sentinelle, Flash / Ghost), parle des CONFLITS, de la
 *   nécessité de le soutenir, notamment en mettant en place des Manifestactions selon différentes
 *   situations et stratégies ; elle peut s'appuyer sur l'actualité (flux de la seed, réglables dans
 *   l'IHL). Neutre et factuelle sur les faits, militante sur l'action.
 *
 *   ── LES ALERTES DES RELAIS : UN BILAN, JAMAIS UNE ALERTE ─────────────────────────────────────
 *   Une alerte OBF (kind 30501) vit au plus 24 heures ; l'émission est fabriquée la nuit et écoutée
 *   le lendemain. Annoncer une alerte comme EN COURS serait faux, et dangereux (on enverrait des gens
 *   vers un danger fini, ou on les rassurerait à tort). Une alerte porte aussi, souvent, un nom, une
 *   accusation, une détresse. La radio n'en dit donc QU'UN BILAN : combien d'alertes publiques ces
 *   dernières heures, de quels niveaux, près de quelles villes — jamais un titre, une description, un
 *   nom, une adresse. Pour le détail : la carte, en direct. Mêmes filtres que le lot 7 : publiques
 *   seulement, dernière version, retirées / supprimées / échues écartées, alertes de TEST écartées,
 *   comptes bannis et publications masquées écartés, auteur ÉTABLI au moment de sa publication (la
 *   sonde d'ancienneté est faite par l'appelant).
 */
import type { Event as NostrEvent } from 'nostr-tools'
import type { NewsItem } from './types'
import { lieuParle } from './villes'
import { expireNip40, estPierreTombale, dernieresVersions, suppressions, coordonnee, type ConfianceCarte } from './sujets-carte'
import { numeroDuJour } from './sujets-abondance'

export const KIND_OBF_ALERTE = 30501
export const STATION_OBF = 'obf-radio'
/** Le bilan porte sur les alertes déclenchées depuis tant d'heures. */
export const BILAN_HEURES = 48

export type NiveauObf = 'ok' | 'info' | 'warning' | 'critical'
const NIVEAUX: readonly NiveauObf[] = ['critical', 'warning', 'info', 'ok']
const NOM_NIVEAU: Readonly<Record<NiveauObf, [string, string]>> = {
  critical: ['alerte rouge (urgence vitale)', 'alertes rouges (urgence vitale)'],
  warning:  ['alerte orange (danger imminent)', 'alertes orange (danger imminent)'],
  info:     ['alerte bleue (danger non imminent)', 'alertes bleues (danger non imminent)'],
  ok:       ['alerte verte (sans danger vital)', 'alertes vertes (sans danger vital)'],
}

export interface AlerteObf {
  cle:      string
  auteur:   string
  eventId:  string
  niveau:   NiveauObf
  /** « à Lyon », « près de Lyon », ou ''. */
  lieu:     string
  /** Déclenchée le (ms). */
  le:       number
  terminee: boolean
}

const tag = (e: Pick<NostrEvent, 'tags'>, nom: string): string | undefined => e.tags.find(t => t[0] === nom)?.[1]
const texte = (v: unknown): string => (typeof v === 'string' ? v.trim() : '')
const nombre = (v: unknown): number | undefined => (typeof v === 'number' && Number.isFinite(v) ? v : undefined)

/** Une alerte publique, réelle, récente — ou rien. On n'en garde que le niveau, la ville et l'heure. */
export function lireAlerteObf(e: NostrEvent, maintenant: number): AlerteObf | null {
  if (e.kind !== KIND_OBF_ALERTE) return null
  if (tag(e, 'visibility') !== 'public') return null
  if (e.tags.some(t => t[0] === 'infinity-partage' && t[1] === 'non')) return null
  if (expireNip40(e, maintenant) || estPierreTombale(e)) return null
  const d = tag(e, 'd') ?? ''
  if (!d || d.startsWith('test-')) return null                 // une alerte de TEST ne se publie pas
  let c: Record<string, unknown>
  try { c = JSON.parse(e.content) as Record<string, unknown> } catch { return null }
  if (!c || typeof c !== 'object') return null
  if (!texte(c.title) && !texte(c.description)) return null    // même garde que l'application
  const niveau = texte(c.type) as NiveauObf
  if (!NIVEAUX.includes(niveau)) return null
  const evenementMs = e.created_at * 1000
  const brute = nombre(c.createdAt)
  const le = brute !== undefined && brute > 0 && brute <= evenementMs ? brute : evenementMs
  if (le > maintenant + 3_600_000 || maintenant - le > BILAN_HEURES * 3_600_000) return null
  const statut = texte(c.status) || 'active'
  if (statut === 'cancelled') return null
  const pt = Array.isArray(c.coordinates) ? c.coordinates : []      // [lng, lat]
  return {
    cle: coordonnee(e) ?? e.id, auteur: e.pubkey.toLowerCase(), eventId: e.id, niveau,
    lieu: lieuParle(nombre(pt[1]), nombre(pt[0])), le, terminee: statut === 'resolved' || statut === 'expired',
  }
}

/** Les alertes lisibles (avant la confiance) : dernière version, ni supprimées ni retirées. */
export function alertesLisibles(events: readonly NostrEvent[], maintenant: number): AlerteObf[] {
  const supp = suppressions(events)
  const out: AlerteObf[] = []
  for (const e of dernieresVersions(events.filter(x => x.kind === KIND_OBF_ALERTE))) {
    const coord = coordonnee(e)
    if (coord && supp.coordonnees.has(coord)) continue
    if (supp.ids.get(e.id) === e.pubkey.toLowerCase()) continue
    const a = lireAlerteObf(e, maintenant)
    if (a) out.push(a)
  }
  return out
}

/** Banni / masqué → jamais ; sinon il faut un auteur établi ou approuvé (comme `sujetDeConfiance`). */
export function alerteDeConfiance(a: AlerteObf, conf: ConfianceCarte): boolean {
  if (conf.bannis.has(a.auteur) || conf.masques.has(a.eventId)) return false
  return conf.arbitres.has(a.auteur) || conf.approuves.has(a.eventId)
    || conf.auteursApprouves.has(a.auteur) || conf.etablis.has(a.auteur)
}

export interface BilanObf { total: number; parNiveau: Record<NiveauObf, number>; villes: string[]; terminees: number }

export function bilanAlertes(alertes: readonly AlerteObf[]): BilanObf {
  const parNiveau: Record<NiveauObf, number> = { critical: 0, warning: 0, info: 0, ok: 0 }
  const villes: string[] = []
  for (const a of [...alertes].sort((x, y) => NIVEAUX.indexOf(x.niveau) - NIVEAUX.indexOf(y.niveau) || y.le - x.le)) {
    parNiveau[a.niveau]++
    const ville = a.lieu.replace(/^(?:à|près de)\s+/, '')
    if (ville && !villes.includes(ville) && villes.length < 4) villes.push(ville)
  }
  return { total: alertes.length, parNiveau, villes, terminees: alertes.filter(a => a.terminee).length }
}

export const SOURCE_BILAN_OBF = "Bilan des alertes publiques sur la carte d'Infinity"

/** Le bilan en une phrase — sans titre, sans description, sans nom : des niveaux et des villes. */
export function bilanEnPhrase(b: BilanObf): string {
  if (b.total === 0) return ''
  const niveaux = NIVEAUX.filter(n => b.parNiveau[n] > 0)
    .map(n => `${b.parNiveau[n]} ${NOM_NIVEAU[n][b.parNiveau[n] > 1 ? 1 : 0]}`)
  const fin = niveaux.length > 1 ? `${niveaux.slice(0, -1).join(', ')} et ${niveaux[niveaux.length - 1]}` : niveaux[0]
  return `Ces ${BILAN_HEURES} dernières heures, ${b.total} alerte${b.total > 1 ? 's' : ''} publique${b.total > 1 ? 's' : ''} OBF sur la carte d'Infinity : ${fin}`
    + `${b.villes.length ? `, notamment près de ${b.villes.join(', ')}` : ''}.`
    + `${b.terminees ? ` ${b.terminees} déjà terminée${b.terminees > 1 ? 's' : ''}.` : ''}`
    + " Les alertes d'OBF durent au plus vingt-quatre heures : pour savoir ce qui est en cours, c'est la carte, en direct."
}

export function bilanVersActualite(b: BilanObf, maintenant: number): NewsItem | null {
  const phrase = bilanEnPhrase(b)
  return phrase ? { title: "Les alertes OBF de ces deux derniers jours", summary: phrase, publishedAt: maintenant, sourceTitle: SOURCE_BILAN_OBF } : null
}

// ── Sujets de fond ───────────────────────────────────────────────────────────────────────────

export const SOURCE_FOND_OBF = "Comprendre et soutenir OBF"

/**
 * Seize sujets de fond : ce qu'est OBF dans le détail, les conflits, et le soutien par des
 * Manifestactions selon la situation. Ce ne sont PAS des événements. Résumés ≤ 180 caractères.
 */
export const FOND_OBF: ReadonlyArray<NewsItem> = [
  { title: "Ce qu'est OBF", summary: "Overwatch Blaze Field : l'alerte communautaire d'Infinity. Prévenir et se coordonner vite face au danger, entre voisins, sans dépendre d'une autorité centrale.", sourceTitle: SOURCE_FOND_OBF },
  { title: 'Les quatre niveaux', summary: "Vert : sans danger vital. Bleu : danger réel mais pas imminent. Orange : danger imminent, potentiellement mortel. Rouge : urgence vitale, quelqu'un est déjà atteint.", sourceTitle: SOURCE_FOND_OBF },
  { title: 'Le doute monte, il ne descend jamais', summary: "Entre deux niveaux, on prend le plus grave : une alerte trop forte fait venir de l'aide pour rien, une alerte trop faible la fait venir trop tard.", sourceTitle: SOURCE_FOND_OBF },
  { title: 'Sécuriser, éteindre, soigner', summary: "Plusieurs dangers à la fois ? D'abord arrêter la violence, puis le feu, puis soigner. On appelle UN service, celui qui prime, au numéro du pays où l'on est.", sourceTitle: SOURCE_FOND_OBF },
  { title: 'Alerter, suivre, veiller', summary: "Trois onglets : Alerter (lancer une alerte, son niveau, sa zone, sa durée), Moniteur (suivre et terminer les siennes), Sentinelle (la veille mondiale).", sourceTitle: SOURCE_FOND_OBF },
  { title: 'Une alerte se signe', summary: "Une alerte affiche le nom, l'alias et l'identifiant public de son auteur : on ne lance pas une fausse alerte quand on se grille, et on peut être recontacté.", sourceTitle: SOURCE_FOND_OBF },
  { title: 'Le règlement', summary: "Pas de fausse alerte, pas d'alerte discriminatoire : une alerte mensongère peut faire révoquer le profil. Orange et rouge demandent le Palier 2.", sourceTitle: SOURCE_FOND_OBF },
  { title: "Une alerte s'éteint", summary: "Chaque alerte a une durée, vingt-quatre heures au plus, puis disparaît de la carte. Elle fonctionne même hors ligne : elle part dès que le réseau revient.", sourceTitle: SOURCE_FOND_OBF },
  { title: 'La Sentinelle', summary: "La veille mondiale en temps réel, à partir de sources ouvertes : séismes, incendies, tempêtes, volcans, inondations, et conflits. Chaque point a sa source et sa gravité.", sourceTitle: SOURCE_FOND_OBF },
  { title: 'Les conflits', summary: "Guerres et violences touchent d'abord les civils. OBF ne prend pas parti : il aide à voir où est le danger, à alerter, à se protéger et à secourir.", sourceTitle: SOURCE_FOND_OBF },
  { title: 'Flash et Ghost', summary: "Deux protections : Flash signale sa position à qui l'on choisit, Ghost masque tous ses contenus publics d'un geste. Utiles à qui pourrait être pisté.", sourceTitle: SOURCE_FOND_OBF },
  { title: 'Soutenir OBF : avant la crise', summary: "Des Manifestactions de prévention : former aux premiers secours, cartographier les points d'eau, débroussailler, préparer des kits d'urgence entre voisins.", sourceTitle: SOURCE_FOND_OBF },
  { title: 'Soutenir OBF : pendant la crise', summary: "Héberger, ravitailler, transporter, garder les enfants des secouristes, relayer les consignes officielles : des Manifestactions d'entraide immédiate.", sourceTitle: SOURCE_FOND_OBF },
  { title: 'Soutenir OBF : après la crise', summary: "Reconstruire, replanter, accompagner ceux qui ont tout perdu : c'est l'esprit de la Quête We are Alive, et des Manifestactions de chantier.", sourceTitle: SOURCE_FOND_OBF },
  { title: 'Des veilleurs de quartier', summary: "Une stratégie : un réseau de veilleurs par quartier ou par village, qui connaissent les personnes isolées et les risques du lieu, et s'exercent ensemble.", sourceTitle: SOURCE_FOND_OBF },
  { title: 'Face aux conflits, agir quand même', summary: "Accueillir des déplacés, collecter du matériel de premiers secours, apprendre l'autodéfense aux plus vulnérables : des Manifestactions loin du front, utiles au front.", sourceTitle: SOURCE_FOND_OBF },
]

/** `n` sujets de fond en tournant (deux jours de suite : aucun en commun, 16 ≥ 2n). */
export function choisirFondObf(n: number, jour: Date | string): NewsItem[] {
  if (n <= 0) return []
  const total = FOND_OBF.length
  const pas = Math.min(n, total)
  const debut = ((numeroDuJour(jour) * pas) % total + total) % total
  return Array.from({ length: pas }, (_, i) => FOND_OBF[(debut + i) % total])
}

/** Section « ligne éditoriale » du prompt système de la station OBF. `bilan` = `bilanEnPhrase` ('' : aucun). */
export function ligneEditorialeObf(bilan: string): string {
  return [
    "Ta station parle d'OBF, Overwatch Blaze Field : l'alerte communautaire d'Infinity face aux urgences (incendies, inondations, agressions, disparitions, catastrophes, conflits). Explique-la DANS LE DÉTAIL à partir des sujets de fond : les quatre niveaux, la doctrine sécuriser-éteindre-soigner, Alerter, Moniteur, Sentinelle, Flash et Ghost, le règlement.",
    "Sur les FAITS (catastrophes, conflits, actualité des sources) : sois neutre et factuel. Dis d'où vient l'information, ne prends parti pour aucun camp dans un conflit, ne donne aucun bilan humain ni aucun chiffre qui ne soit pas dans l'actualité ci-dessous, n'exagère rien.",
    "Sur l'ACTION, sois engagé : explique pourquoi soutenir OBF, et propose des Manifestactions adaptées à la situation (prévention avant la crise, entraide pendant, reconstruction après ; veilleurs de quartier, premiers secours, accueil, collecte) — des idées que l'auditeur peut lancer ou rejoindre dans Infinity.",
    bilan
      ? `Le bilan des alertes OBF est réel mais PASSÉ : dis-le comme un bilan (« ces deux derniers jours »), jamais comme une alerte en cours, et renvoie vers la carte pour le direct. N'invente aucun détail sur ces alertes (ni ce qui s'est passé, ni qui, ni où plus précisément). Le bilan : ${bilan}`
      : "Aucun bilan d'alertes à donner aujourd'hui : n'en invente aucune.",
    "Rappelle quand c'est utile qu'en cas de danger on appelle d'abord les secours (le 112 en Europe) — OBF prévient les voisins, il ne remplace pas les secours. Jamais d'adresse, jamais de nom de personne, jamais de contact.",
  ].join('\n')
}

/** Le fil d'actualité de la station : le bilan (s'il y en a un) et trois sujets de fond, en tête des flux. */
export function actualitesStationObf(bilan: BilanObf, jour: Date | string, maintenant: number): NewsItem[] {
  const b = bilanVersActualite(bilan, maintenant)
  return [...(b ? [b] : []), ...choisirFondObf(3, jour)]
}
