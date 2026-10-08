/**
 * @module InfinityScheduler/Courrier/Protocole
 * @description Le CONTRAT du courrier des auditeurs entre l'app Infinity et ce générateur
 *   (décision du Bâtisseur, 07/10/2026). Référence complète : `docs/radio-courrier-auditeurs.md`
 *   dans l'app. Zone PURE : formes de données et validation, aucun réseau.
 *
 *   Tout voyage en gift-wrap NIP-59 (kind 1059, déjà accepté partout — AUCUN kind nouveau). Le
 *   « rumor » scellé est celui de la visibilité de l'app (`shared/visibility/rumor.ts`) :
 *     ['infinity_module', module] · ['infinity_type', type] · ['d', id] · ['p', destinataire]…
 *   et son contenu est le JSON du payload.
 *
 *   ┌─────────────────────────────┬──────────────────────┬──────────────────────────────────┐
 *   │ module / type               │ de → vers            │ payload                          │
 *   ├─────────────────────────────┼──────────────────────┼──────────────────────────────────┤
 *   │ radio-courrier / message    │ Bâtisseur → courrier │ MessageAuditeur                  │
 *   │ radio-courrier-moderation   │ courrier → admins    │ ItemModeration (douteux SEULS)   │
 *   │   / a-moderer               │                      │                                  │
 *   │ radio-courrier-decision     │ admin → courrier     │ DecisionAdmin                    │
 *   │   / decision                │                      │                                  │
 *   │ radio-courrier-registre     │ courrier → courrier  │ EtatRegistre (sans contenu)      │
 *   │   / etat                    │                      │                                  │
 *   └─────────────────────────────┴──────────────────────┴──────────────────────────────────┘
 */
import { createHash } from 'node:crypto'

export const MODULE_COURRIER   = 'radio-courrier'
export const TYPE_MESSAGE      = 'message'
export const MODULE_MODERATION = 'radio-courrier-moderation'
export const TYPE_A_MODERER    = 'a-moderer'
export const MODULE_DECISION   = 'radio-courrier-decision'
export const TYPE_DECISION     = 'decision'
export const MODULE_REGISTRE   = 'radio-courrier-registre'
export const TYPE_REGISTRE     = 'etat'

/** Bornes — les MÊMES que l'app (`src/modules/radio/courrier/protocole.ts`). */
export const TEXTE_MAX        = 500
export const DEDICATAIRE_MAX  = 60
export const PSEUDO_MAX       = 40
export const VOCAL_MAX_S      = 60
export const VOCAL_MAX_OCTETS = 2 * 1024 * 1024

export type GenreMessage = 'message' | 'dedicace' | 'vocal'

/** Le fichier vocal : CHIFFRÉ (AES-256-GCM, clé aléatoire) et déposé sur data-space / Blossom. */
export interface VocalChiffre {
  cid?:    string
  url?:    string
  /** Clé AES-256 (64 hex) — ne voyage QUE dans le message chiffré. */
  cleHex:  string
  /** IV GCM (24 hex = 12 octets). */
  ivHex:   string
  /** SHA-256 du CHIFFRÉ déposé (64 hex) : on ne déchiffre pas un fichier substitué. */
  sha256:  string
  mime:    string
  dureeS:  number
  octets:  number
}

export interface MessageAuditeur {
  v:          1
  stationId:  string
  /** Jour d'antenne demandé (YYYY-MM-DD) : le lendemain de l'envoi. */
  pourLe:     string
  genre:      GenreMessage
  /** Le message écrit (vide permis pour un vocal). */
  texte:      string
  /** Dédicace : à qui. */
  dedicataire?: string
  anonyme:    boolean
  /** Pseudo PUBLIC de l'auteur (sa fiche d'annuaire), seulement s'il n'est pas anonyme. */
  pseudo?:    string
  vocal?:     VocalChiffre
  /** Case obligatoire pour un vocal : « j'accepte que ma voix passe à l'antenne ». */
  consentementVoix?: true
}

const HEX64 = /^[0-9a-f]{64}$/
const HEX24 = /^[0-9a-f]{24}$/
const DATE = /^\d{4}-\d{2}-\d{2}$/
const STATION = /^[a-z0-9][a-z0-9_-]{0,99}$/
const FORME_CID = /^(Qm[1-9A-HJ-NP-Za-km-z]{44}|b[a-z2-7]{20,})$/

const texteBorne = (x: unknown, max: number): string =>
  typeof x === 'string' ? x.replace(/[\u0000-\u0008\u000B-\u001F\u007F]/g, ' ').trim().slice(0, max) : ''

function lireVocal(x: unknown): VocalChiffre | null {
  if (!x || typeof x !== 'object') return null
  const v = x as Record<string, unknown>
  const cid = typeof v.cid === 'string' && FORME_CID.test(v.cid) ? v.cid : undefined
  const url = typeof v.url === 'string' && /^https:\/\/[^\s]+$/.test(v.url) ? v.url.slice(0, 500) : undefined
  if (!cid && !url) return null
  const cleHex = typeof v.cleHex === 'string' ? v.cleHex.toLowerCase() : ''
  const ivHex = typeof v.ivHex === 'string' ? v.ivHex.toLowerCase() : ''
  const sha256 = typeof v.sha256 === 'string' ? v.sha256.toLowerCase() : ''
  if (!HEX64.test(cleHex) || !HEX24.test(ivHex) || !HEX64.test(sha256)) return null
  const dureeS = typeof v.dureeS === 'number' && Number.isFinite(v.dureeS) ? v.dureeS : NaN
  const octets = typeof v.octets === 'number' && Number.isInteger(v.octets) ? v.octets : NaN
  if (!(dureeS > 0 && dureeS <= VOCAL_MAX_S + 1) || !(octets > 0 && octets <= VOCAL_MAX_OCTETS)) return null
  const mime = typeof v.mime === 'string' && /^audio\/[\w.+-]+(;.*)?$/.test(v.mime) ? v.mime.slice(0, 80) : 'audio/webm'
  return { ...(cid ? { cid } : {}), ...(url ? { url } : {}), cleHex, ivHex, sha256, mime, dureeS, octets }
}

/**
 * Lit un message d'auditeur déchiffré — écrit par n'importe qui, donc jamais cru sur parole.
 * `null` si ce n'est pas un message recevable (forme, bornes, vocal sans consentement…).
 */
export function lireMessage(brut: unknown): MessageAuditeur | null {
  if (!brut || typeof brut !== 'object' || Array.isArray(brut)) return null
  const b = brut as Record<string, unknown>
  if (b.v !== 1) return null
  const stationId = typeof b.stationId === 'string' && STATION.test(b.stationId) ? b.stationId : null
  const pourLe = typeof b.pourLe === 'string' && DATE.test(b.pourLe) ? b.pourLe : null
  const genre = b.genre === 'message' || b.genre === 'dedicace' || b.genre === 'vocal' ? b.genre : null
  if (!stationId || !pourLe || !genre) return null
  const texte = texteBorne(b.texte, TEXTE_MAX)
  const anonyme = b.anonyme !== false
  const pseudo = anonyme ? '' : texteBorne(b.pseudo, PSEUDO_MAX)
  const dedicataire = texteBorne(b.dedicataire, DEDICATAIRE_MAX)
  const msg: MessageAuditeur = {
    v: 1, stationId, pourLe, genre, texte, anonyme: anonyme || !pseudo,
    ...(pseudo ? { pseudo } : {}),
  }
  if (genre === 'dedicace') {
    if (!dedicataire) return null
    msg.dedicataire = dedicataire
  }
  if (genre === 'vocal') {
    if (b.consentementVoix !== true) return null
    const vocal = lireVocal(b.vocal)
    if (!vocal) return null
    msg.vocal = vocal
    msg.consentementVoix = true
  } else if (!texte) {
    return null
  }
  return msg
}

/** Ce que reçoivent les admins radio dans l'IHL — les messages DOUTEUX seulement. */
export interface ItemModeration {
  v:          1
  statut:     'en-attente' | 'acceptee' | 'refusee'
  /** Référence opaque du message (jamais la clé de l'auteur). */
  ref:        string
  stationId:  string
  pourLe:     string
  genre:      GenreMessage
  texte:      string
  dedicataire?: string
  anonyme:    boolean
  pseudo?:    string
  /** Ce que la transcription a entendu (vocal). */
  transcription?: string
  /** Pour écouter le vocal dans l'IHL (la clé ne voyage que chiffrée, vers les admins). */
  vocal?:     VocalChiffre
  /** Pourquoi le message est douteux (phrase courte du modérateur). */
  raison:     string
}

export interface DecisionAdmin {
  v:        1
  ref:      string
  decision: 'acceptee' | 'refusee'
}

export function lireDecision(brut: unknown): DecisionAdmin | null {
  if (!brut || typeof brut !== 'object') return null
  const b = brut as Record<string, unknown>
  if (b.v !== 1 || typeof b.ref !== 'string' || !/^[0-9a-f]{24}$/.test(b.ref)) return null
  if (b.decision !== 'acceptee' && b.decision !== 'refusee') return null
  return { v: 1, ref: b.ref, decision: b.decision }
}

/** Mémoire du générateur, qu'il s'adresse à lui-même (chiffrée) : JAMAIS de contenu. */
export interface EtatRegistre {
  v:      1
  ref:    string
  statut: 'ecarte' | 'transmis-ihl' | 'diffuse'
  /** Jour concerné (diffusion) ou de l'écriture. */
  le:     string
}

export function lireEtat(brut: unknown): EtatRegistre | null {
  if (!brut || typeof brut !== 'object') return null
  const b = brut as Record<string, unknown>
  if (b.v !== 1 || typeof b.ref !== 'string' || !/^[0-9a-f]{24}$/.test(b.ref)) return null
  if (b.statut !== 'ecarte' && b.statut !== 'transmis-ihl' && b.statut !== 'diffuse') return null
  const le = typeof b.le === 'string' && DATE.test(b.le) ? b.le : ''
  return { v: 1, ref: b.ref, statut: b.statut, le }
}

/**
 * Référence OPAQUE d'un message : dérivée de l'auteur et de l'identifiant qu'il a choisi.
 * Deux auteurs ne peuvent pas s'écraser (l'auteur entre dans le calcul) et l'IHL ne voit jamais
 * la clé de l'auteur.
 */
export function refMessage(auteurPubkey: string, d: string): string {
  return createHash('sha256').update(`${auteurPubkey.toLowerCase()}:${d}`).digest('hex').slice(0, 24)
}

/** Jour civil ± n jours (YYYY-MM-DD, UTC). Pure. */
export function decalerJour(date: string, n: number): string {
  const [a, m, j] = date.split('-').map(Number)
  const t = Date.UTC(a, m - 1, j) + n * 86_400_000
  return new Date(t).toISOString().slice(0, 10)
}

/** Jour civil (UTC) d'un horodatage en secondes. Pure. */
export function jourDe(secondes: number): string {
  return new Date(secondes * 1000).toISOString().slice(0, 10)
}
