/**
 * @module InfinityScheduler/Lib/FenetreNuit
 * @description 🌙 La FENÊTRE de fabrication et les REPRISES de la nuit (pur, éprouvé sans réseau).
 *
 *   ── CE QUI NE MARCHAIT PAS (journaux du 21/09 au 06/10/2026) ──
 *   generate-all posait `CHATTERBOX_FIN_NUIT = départ + 150 min`. Le GPU de data-space calcule à
 *   peu près en temps réel : 15 à 60 minutes par station, ~32 en moyenne quand toutes les voix
 *   passent. Quatorze stations demandent donc ~7 h de GPU ; 150 minutes en servaient 3 à 5. Les
 *   autres partaient ENTIÈRES en Piper — 88 % des tours perdus l'ont été sur cette échéance —
 *   alors que la machine restait allumée jusqu'à 1 h, 4 h, parfois 9 h du matin.
 *
 *   ── CE QUI LE REMPLACE ──
 *     · une FENÊTRE longue : jusqu'à `RADIO_FIN_FENETRE` (heure locale, défaut 07:00), bornée à
 *       `RADIO_FENETRE_MAX_H` heures après le départ (défaut 11). L'application joue la plus
 *       récente émission tant que celle du jour n'est pas publiée : une émission publiée à 3 h
 *       avec ses vraies voix vaut mieux qu'une émission robotique publiée à 22 h ;
 *     · les voix clonées sont permises jusqu'à la fin de la fenêtre, moins la marge de montage
 *       (`RADIO_MARGE_MONTAGE_MIN`, 15) — sauf si `CHATTERBOX_NUIT_MINUTES` est posé à la main
 *       (ancien comportement, gardé pour le dépannage) ;
 *     · une station dont des tours manquent est REPORTÉE (code 75) et reprise à un passage
 *       suivant (`RADIO_MAX_PASSES`, 4), après une pause (`RADIO_PAUSE_REPRISE_MIN`, 10) qui
 *       laisse passer une coupure réseau ou un encombrement ;
 *     · la DERNIÈRE CHANCE d'une station (dernier passage, ou moins de
 *       `RADIO_MARGE_DERNIERE_CHANCE_MIN` = 45 min avant la fin) applique la règle de
 *       publication finale (regle-publication.ts).
 */
import { CODE_A_REPRENDRE, CODE_VEILLE_GARDEE } from './regle-publication'

function entier(env: string | undefined, defaut: number, min = 0): number {
  const n = Number.parseInt(env ?? '', 10)
  return Number.isFinite(n) && n >= min ? n : defaut
}

export interface ReglagesFenetre {
  /** « HH:MM », heure locale de fin. */
  finHeure:            string
  maxHeures:           number
  margeMontageMs:      number
  margeDerniereChanceMs: number
  maxPasses:           number
  pauseRepriseMs:      number
  /** Ancien budget de voix clonée (minutes depuis le départ), si posé à la main. */
  nuitMinutes:         number | null
}

export function reglagesFenetre(env: NodeJS.ProcessEnv = process.env): ReglagesFenetre {
  const fin = /^(\d{1,2}):?(\d{2})?$/.exec((env.RADIO_FIN_FENETRE ?? '').trim())
  const h = fin ? Number.parseInt(fin[1], 10) : NaN
  const m = fin?.[2] ? Number.parseInt(fin[2], 10) : 0
  const finHeure = Number.isFinite(h) && h >= 0 && h <= 23 && m >= 0 && m <= 59
    ? `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}` : '07:00'
  const nuit = Number.parseInt(env.CHATTERBOX_NUIT_MINUTES ?? '', 10)
  return {
    finHeure,
    maxHeures:             entier(env.RADIO_FENETRE_MAX_H, 11, 1),
    margeMontageMs:        entier(env.RADIO_MARGE_MONTAGE_MIN, 15) * 60_000,
    margeDerniereChanceMs: entier(env.RADIO_MARGE_DERNIERE_CHANCE_MIN, 45) * 60_000,
    maxPasses:             entier(env.RADIO_MAX_PASSES, 4, 1),
    pauseRepriseMs:        entier(env.RADIO_PAUSE_REPRISE_MIN, 10) * 60_000,
    nuitMinutes:           Number.isFinite(nuit) && nuit > 0 ? nuit : null,
  }
}

/**
 * Fin de la fenêtre : la PROCHAINE occurrence de `finHeure` (heure locale) après le départ,
 * bornée à `maxHeures`. Pure (le fuseau est celui de la machine, comme l'heure de lancement).
 */
export function finDeFenetre(debutMs: number, finHeure: string, maxHeures: number): number {
  const [h, m] = finHeure.split(':').map(x => Number.parseInt(x, 10))
  const d = new Date(debutMs)
  const fin = new Date(d.getFullYear(), d.getMonth(), d.getDate(), h, m, 0, 0)
  if (fin.getTime() <= debutMs) fin.setDate(fin.getDate() + 1)
  return Math.min(fin.getTime(), debutMs + maxHeures * 3_600_000)
}

/** Instant au-delà duquel plus aucune voix clonée n'est demandée (`CHATTERBOX_FIN_NUIT`). Pure. */
export function echeanceVoixClonees(debutMs: number, finFenetreMs: number, r: ReglagesFenetre): number {
  if (r.nuitMinutes !== null) return debutMs + r.nuitMinutes * 60_000
  return Math.max(debutMs, finFenetreMs - r.margeMontageMs)
}

/** Ce passage est-il la dernière chance de la station ? Pure. */
export function derniereChance(maintenantMs: number, finFenetreMs: number, passe: number, r: ReglagesFenetre): boolean {
  return passe >= r.maxPasses || finFenetreMs - maintenantMs < r.margeDerniereChanceMs
}

/**
 * Pause avant un passage de reprise : on laisse passer une coupure ou un encombrement, mais
 * jamais au point d'entamer la dernière chance. Pure.
 */
export function pauseAvantReprise(maintenantMs: number, debutPasseMs: number, finFenetreMs: number, r: ReglagesFenetre): number {
  const dejaEcoule = maintenantMs - debutPasseMs
  const voulue = Math.max(0, r.pauseRepriseMs - dejaEcoule)
  const permise = Math.max(0, finFenetreMs - r.margeDerniereChanceMs - maintenantMs)
  return Math.min(voulue, permise)
}

export type IssueStation = 'publiee' | 'a-reprendre' | 'veille-gardee' | 'echec' | 'suspendue'

/** Ce que dit le code de sortie d'une station (0 = publiée ou déjà à l'antenne). Pure. */
export function classerSortie(code: unknown, tuee = false): IssueStation {
  if (tuee) return 'suspendue'
  if (code === 0) return 'publiee'
  if (code === CODE_A_REPRENDRE) return 'a-reprendre'
  if (code === CODE_VEILLE_GARDEE) return 'veille-gardee'
  return 'echec'
}

/** L'heure locale, lisible (« 03:41 »). */
export function heureLisible(ms: number): string {
  const d = new Date(ms)
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}
