/**
 * @module InfinityScheduler/Courrier/Selection
 * @description Ce que le générateur fait du courrier relevé, pour UNE station et UN jour
 *   d'antenne. Pur : la décision se teste sans réseau ni modèle.
 *
 *   Règles (décision du Bâtisseur, 07/10/2026 — détail dans le protocole de l'app) :
 *     · un message par auteur, par station et par jour d'antenne (le PREMIER envoyé compte) ;
 *     · un message passe à l'antenne de son jour (`pourLe`), ou dans les 6 jours qui suivent s'il
 *       n'a pas pu passer (nuit sans émission, trop de courrier ce jour-là) — jamais deux fois ;
 *     · un message DOUTEUX transmis à l'IHL attend la décision d'un admin radio ; accepté, il
 *       passe dès l'émission qui suit le jour de la décision (dans les 6 jours) ; refusé, jamais ;
 *     · une insulte est écartée pour toujours (registre « ecarte ») : jamais diffusée, jamais
 *       montrée, seulement comptée.
 */
import {
  MODULE_COURRIER, MODULE_DECISION, MODULE_REGISTRE, TYPE_MESSAGE, TYPE_DECISION, TYPE_REGISTRE,
  lireMessage, lireDecision, lireEtat, refMessage, decalerJour, jourDe,
  type MessageAuditeur, type EtatRegistre,
} from './protocole'
import type { Ouvert } from './enveloppes'

/** Fenêtre de rattrapage : un message peut encore passer jusqu'à 6 jours après son jour. */
export const JOURS_DE_GRACE = 6
/** Plafonds par émission (le reste attend le lendemain, dans la fenêtre). */
export const MAX_TEXTES_PAR_EMISSION = 3
export const MAX_VOCAUX_PAR_EMISSION = 3

export interface MessageRecu {
  ref:     string
  auteur:  string
  creeLe:  number
  message: MessageAuditeur
}

export interface CourrierTrie {
  messages:  MessageRecu[]
  /** Décision la plus récente d'un ADMIN par référence. */
  decisions: Map<string, { decision: 'acceptee' | 'refusee'; le: number }>
  /** État le plus récent du registre (écrit par NOUS) par référence. */
  registre:  Map<string, EtatRegistre & { creeLe: number }>
}

/**
 * Trie les enveloppes ouvertes : messages d'auditeurs, décisions des admins radio, registre du
 * générateur. Une décision d'un non-admin et un registre qui ne vient pas de notre clé sont
 * IGNORÉS (n'importe qui peut nous écrire).
 */
export function trierCourrier(
  ouverts: readonly Ouvert[], cleCourrierPub: string, admins: ReadonlySet<string> | null,
): CourrierTrie {
  const premiers = new Map<string, MessageRecu>()
  const decisions = new Map<string, { decision: 'acceptee' | 'refusee'; le: number }>()
  const registre = new Map<string, EtatRegistre & { creeLe: number }>()
  const moi = cleCourrierPub.toLowerCase()
  for (const o of ouverts) {
    if (o.module === MODULE_COURRIER && o.type === TYPE_MESSAGE) {
      const message = lireMessage(o.payload)
      if (!message) continue
      // Un message par auteur, station et jour d'antenne : le PREMIER envoyé.
      const cle = `${o.auteur}|${message.stationId}|${message.pourLe}`
      const deja = premiers.get(cle)
      if (!deja || o.creeLe < deja.creeLe) premiers.set(cle, { ref: refMessage(o.auteur, o.d), auteur: o.auteur, creeLe: o.creeLe, message })
    } else if (o.module === MODULE_DECISION && o.type === TYPE_DECISION) {
      if (admins && !admins.has(o.auteur)) continue
      const dec = lireDecision(o.payload)
      if (!dec) continue
      const deja = decisions.get(dec.ref)
      if (!deja || o.creeLe > deja.le) decisions.set(dec.ref, { decision: dec.decision, le: o.creeLe })
    } else if (o.module === MODULE_REGISTRE && o.type === TYPE_REGISTRE) {
      if (o.auteur !== moi) continue
      const etat = lireEtat(o.payload)
      if (!etat) continue
      const deja = registre.get(etat.ref)
      // « ecarte » et « diffuse » sont DÉFINITIFS : un état plus récent ne les annule pas.
      if (deja && (deja.statut === 'ecarte' || deja.statut === 'diffuse')) continue
      const definitif = etat.statut !== 'transmis-ihl'
      if (!deja || definitif || o.creeLe >= deja.creeLe) registre.set(etat.ref, { ...etat, creeLe: o.creeLe })
    }
  }
  return { messages: [...premiers.values()].sort((a, b) => a.creeLe - b.creeLe), decisions, registre }
}

export interface ChoixDuJour {
  /** À faire juger maintenant (jamais vus, ou vus sans verdict définitif). */
  aJuger:    MessageRecu[]
  /** Acceptés par un admin, à diffuser aujourd'hui sans nouveau jugement. */
  acceptes:  MessageRecu[]
  /** En attente d'un admin (déjà transmis à l'IHL). */
  enAttente: number
}

const dansLaFenetre = (date: string, depuis: string): boolean =>
  date >= depuis && date <= decalerJour(depuis, JOURS_DE_GRACE)

/** Ce qu'il y a à faire, pour cette station, pour l'émission du jour `date`. Pur. */
export function choisirPourLeJour(trie: CourrierTrie, stationId: string, date: string): ChoixDuJour {
  const aJuger: MessageRecu[] = []
  const acceptes: MessageRecu[] = []
  let enAttente = 0
  for (const m of trie.messages) {
    if (m.message.stationId !== stationId) continue
    const etat = trie.registre.get(m.ref)
    if (etat?.statut === 'ecarte' || etat?.statut === 'diffuse') continue
    const dec = trie.decisions.get(m.ref)
    if (dec?.decision === 'refusee') continue
    if (dec?.decision === 'acceptee') {
      const lendemainDecision = decalerJour(jourDe(dec.le), 1)
      const depuis = m.message.pourLe > lendemainDecision ? m.message.pourLe : lendemainDecision
      if (dansLaFenetre(date, depuis)) acceptes.push(m)
      continue
    }
    if (etat?.statut === 'transmis-ihl') { enAttente++; continue }
    if (dansLaFenetre(date, m.message.pourLe)) aJuger.push(m)
  }
  return { aJuger, acceptes, enAttente }
}

/**
 * Parmi les messages propres et acceptés, ceux qui passent dans CETTE émission : les plus
 * anciens d'abord, au plus 3 écrits et 3 vocaux. Pur.
 */
export function retenirPourAntenne<T extends MessageRecu>(propres: readonly T[]): { textes: T[]; vocaux: T[] } {
  const tri = [...propres].sort((a, b) => a.message.pourLe.localeCompare(b.message.pourLe) || a.creeLe - b.creeLe)
  return {
    textes: tri.filter(m => m.message.genre !== 'vocal').slice(0, MAX_TEXTES_PAR_EMISSION),
    vocaux: tri.filter(m => m.message.genre === 'vocal').slice(0, MAX_VOCAUX_PAR_EMISSION),
  }
}
