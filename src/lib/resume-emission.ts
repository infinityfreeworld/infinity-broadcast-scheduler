/**
 * @module InfinityScheduler/Lib/ResumeEmission
 * @description Titre et résumé d'une émission, pour la liste « Émissions précédentes » de la
 *   radio (Bâtisseur, 04/10/2026). Publiés en champs OPTIONNELS `titre` et `resume` du contenu
 *   du kind 30093 : les lecteurs actuels les ignorent.
 *
 *   ── RÈGLES ──
 *   - `titre`  : ≤ 70 caractères, sans guillemets, sans emoji, sans le nom de la station.
 *   - `resume` : une ou deux phrases, ≤ 220 caractères, factuel (les sujets abordés), sans
 *     slogan, sans « dans cette émission ».
 *   - Les deux dans la LANGUE DE LA STATION (même contrôle que les tours : `garantirLangue`).
 *   - UN seul appel court au modèle (plus les réécritures de langue, rares).
 *
 *   ── 🔴 LE RÉSUMÉ NE FAIT JAMAIS ÉCHOUER L'ÉMISSION ──
 *   Modèle indisponible, JSON illisible, langue restée fausse : repli DÉTERMINISTE — le résumé
 *   est tiré des premières répliques de fond (ouverture rituelle et slogan sautés), sans titre.
 */

import type { BroadcastTurn, StationLanguage } from './types'
import type { LLMMessage } from './anthropic'
import { garantirLangue, horsLangue, nomLangue, retirerEtiquetteLocuteur } from './langue-station'
import { compterSlogans } from './slogan-radio'

export const MAX_TITRE = 70
export const MAX_RESUME = 220
/** Au-delà, le texte des tours est tronqué avant d'être envoyé au modèle (~2 000 jetons). */
export const MAX_ENTREE = 7000
/** Un résumé plus court que ça n'apprend rien à l'auditeur : on prend le repli. */
const MIN_RESUME = 25

/** L'appel au modèle, injectable (tests) ; en production : `appelerLLM`. */
export type AppelResume = (a: {
  systemPrompt: string
  messages:     LLMMessage[]
  maxTokens?:   number
  temperature?: number
}) => Promise<{ text: string; inputTokens: number; outputTokens: number; maillon?: string }>

export interface ResumeEmission {
  titre?:  string
  resume?: string
  /** `modele` : écrit par le modèle et validé ; `repli` : tiré des répliques. */
  source:  'modele' | 'repli'
  /** Pourquoi le repli (vide quand le modèle a servi). */
  raison?: string
  maillon?: string
  inputTokens:  number
  outputTokens: number
}

// ── Le prompt ─────────────────────────────────────────────────────────────────────────

export function promptSystemeResume(langue: StationLanguage, nomStation: string): string {
  const L = nomLangue(langue)
  return `You write the entry of a radio show in the archive list "Previous shows".
Read the transcript and reply ONLY with one JSON object, nothing before or after, no markdown:
{"titre": "...", "resume": "..."}

LANGUAGE: both fields MUST be written in ${L}, the language of the station, whatever the language of these instructions or of the transcript.
- "titre": a short title for the show, at most ${MAX_TITRE} characters. No quotation marks, no emoji, never the station name (${nomStation}).
- "resume": one or two factual sentences, at most ${MAX_RESUME} characters, saying which subjects the show covers (the actual topics, names, places). No slogan, no invitation to join or listen, no URL, no website, no hashtag. Never start with "In this show", "In this episode", "Today" or their translation in ${L}: go straight to the subjects.`
}

/** Le texte des tours, « Nom : texte », tronqué à `max` caractères (à une fin de tour si possible). */
export function texteDesTours(turns: readonly BroadcastTurn[], max = MAX_ENTREE): string {
  const lignes: string[] = []
  let total = 0
  for (const t of turns) {
    const ligne = `${t.hostName}: ${retirerEtiquetteLocuteur(t.text)}`
    if (total + ligne.length + 1 > max) {
      if (lignes.length === 0) lignes.push(ligne.slice(0, max))
      break
    }
    lignes.push(ligne)
    total += ligne.length + 1
  }
  return lignes.join('\n')
}

// ── Nettoyage ─────────────────────────────────────────────────────────────────────────

const URL = /\b(?:https?:\/\/|www\.)\S+/giu
/** Un nom de domaine nu (« infinity-freeworld.com », « exemple.org/page »). */
const DOMAINE_NU = /\b[\p{L}\p{N}-]+(?:\.[\p{L}\p{N}-]+)*\.(?:com|org|net|fr|io|world|info|eu|xyz)\b\S*/giu
const EMOJI = /[\p{Extended_Pictographic}\u{1F1E6}-\u{1F1FF}\u{FE0F}\u{200D}]/gu
const GUILLEMETS = /["“”«»„‟‹›「」『』]/gu

/** Ouvertures creuses à retirer en tête de résumé (« Dans cette émission, … »). */
const OUVERTURES_CREUSES = [
  /^(?:dans|au cours de|pendant) (?:cette|l'|l’)\s*(?:émission|épisode|édition)\s*(?:d'aujourd'hui|du jour)?\s*[,:–—-]?\s*/iu,
  /^(?:cette émission|l'émission|l’émission)\s+(?:aborde|parle de|évoque|traite de|revient sur)\s+/iu,
  /^(?:in|during) (?:this|today's|today’s) (?:show|episode|broadcast|programme|program|edition)\s*[,:–—-]?\s*/iu,
  /^(?:this|today's|today’s) (?:show|episode|broadcast)\s+(?:covers|discusses|looks at|explores|talks about)\s+/iu,
  /^en (?:este|el) (?:programa|episodio)\s*[,:–—-]?\s*/iu,
  /^in (?:questa|questo) (?:puntata|trasmissione|episodio)\s*[,:–—-]?\s*/iu,
  /^neste (?:programa|episódio)\s*[,:–—-]?\s*/iu,
  /^в (?:этом|этой) (?:выпуске|передаче|эфире)\s*[,:–—-]?\s*/iu,
]

function majusculeInitiale(s: string): string {
  return s.length > 0 ? s[0].toLocaleUpperCase() + s.slice(1) : s
}

/** Retire le markdown, les URL, les emoji ; replie les espaces. */
function nettoyerBase(s: string): string {
  return s
    .replace(URL, ' ')
    .replace(DOMAINE_NU, ' ')
    .replace(EMOJI, '')
    .replace(/\[([^\]\n]*)\]\([^)]*\)/g, '$1')   // [texte](lien)
    .replace(/[*_`#>~|]+/g, '')
    .replace(/^\s*[-•]\s+/gm, '')
    .replace(/\s+/g, ' ')
    .replace(/\s+([,.;:!?])/g, '$1')
    .replace(/\(\s*\)/g, '')
    .trim()
}

/**
 * Coupe proprement à `max` caractères : à une fin de phrase si elle garde au moins la moitié du
 * texte, sinon à un espace, avec « … ».
 */
export function couperProprement(s: string, max: number): string {
  const t = s.trim()
  if ([...t].length <= max) return t
  const tete = [...t].slice(0, max).join('')
  const finPhrase = Math.max(...['. ', '! ', '? ', '。', '！', '？', '। '].map(f => tete.lastIndexOf(f)))
  if (finPhrase >= max / 2) return tete.slice(0, finPhrase + 1).trim()
  const espace = tete.slice(0, max - 1).lastIndexOf(' ')
  const coupe = espace >= max / 3 ? tete.slice(0, espace) : [...t].slice(0, max - 1).join('')
  return `${coupe.replace(/[\s,;:–—-]+$/u, '')}…`
}

function echapperRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/** Titre validé, ou undefined s'il ne reste rien d'utile. */
export function nettoyerTitre(brut: unknown, nomStation: string): string | undefined {
  if (typeof brut !== 'string') return undefined
  let t = nettoyerBase(brut).replace(GUILLEMETS, '').replace(/['’]{2,}/g, '')
  const nom = nomStation.trim()
  if (nom) t = t.replace(new RegExp(echapperRegex(nom), 'giu'), ' ')
  t = t.replace(/\s+/g, ' ').replace(/^[\s,;:–—|-]+|[\s,;:–—|-]+$/gu, '').replace(/[.。]+$/u, '').trim()
  if ([...t].length < 3 || !/[\p{L}\p{N}]/u.test(t)) return undefined
  return couperProprement(t, MAX_TITRE)
}

/** Retire les phrases qui portent le slogan ou l'adresse (« Rejoignez … Infinity-freeworld.com »). */
function sansSlogan(s: string): string {
  // Le point de « freeworld.com » couperait la phrase en deux : chaque adresse est d'abord
  // remplacée par un repère sans ponctuation, puis toute phrase qui en porte un est retirée.
  const masque = s.replace(URL, '\uE002').replace(DOMAINE_NU, '\uE002')
  const phrases = masque.match(/[^.!?…。！？।]+(?:[.!?…。！？।]+|$)\s*/gu) ?? [masque]
  return phrases
    .filter(p => !p.includes('\uE002') && compterSlogans(p) === 0
      && !/\b(?:rejoignez|rejoins|join|únete|unisciti|junte-se|присоединяйтесь)\b[^.!?]*\binfinity\b/iu.test(p))
    .join('')
    .trim()
}

/** Résumé validé, ou undefined s'il ne reste rien d'utile. */
export function nettoyerResume(brut: unknown): string | undefined {
  if (typeof brut !== 'string') return undefined
  let r = sansSlogan(brut)
  r = nettoyerBase(r).replace(/^["“«„]+|["”»]+$/gu, '').trim()
  for (const o of OUVERTURES_CREUSES) r = r.replace(o, '')
  r = majusculeInitiale(r.trim())
  if ([...r].length < MIN_RESUME || !/[\p{L}]/u.test(r)) return undefined
  return couperProprement(r, MAX_RESUME)
}

/** Lit l'objet JSON rendu par le modèle (tolère un bloc ```json``` ou du texte autour). */
export function lireReponseResume(texte: string): { titre?: unknown; resume?: unknown } | null {
  const sansBloc = texte.replace(/```(?:json)?/gi, '')
  const debut = sansBloc.indexOf('{')
  const fin = sansBloc.lastIndexOf('}')
  if (debut < 0 || fin <= debut) return null
  try {
    const o = JSON.parse(sansBloc.slice(debut, fin + 1)) as unknown
    if (!o || typeof o !== 'object' || Array.isArray(o)) return null
    const r = o as Record<string, unknown>
    return { titre: r.titre ?? r.title, resume: r.resume ?? r['résumé'] ?? r.summary }
  } catch {
    return null
  }
}

// ── Le repli déterministe ────────────────────────────────────────────────────────────

/**
 * Résumé tiré des répliques : on saute l'ouverture rituelle (1ᵉʳ tour) et les phrases de
 * slogan, puis on prend la première réplique de fond (≥ 40 caractères), complétée par la
 * suivante tant qu'on reste sous la limite. Jamais d'exception ; undefined si rien d'utile.
 */
export function resumeDeRepli(turns: readonly BroadcastTurn[], langue: StationLanguage): string | undefined {
  const candidats = turns.length > 1 ? turns.slice(1) : turns
  const fonds: string[] = []
  for (const t of candidats) {
    const propre = nettoyerBase(sansSlogan(retirerEtiquetteLocuteur(t.text)))
    if ([...propre].length < 40) continue
    if (horsLangue(propre, langue)) continue
    fonds.push(propre)
    if (fonds.length >= 2) break
  }
  if (fonds.length === 0) return undefined
  let r = fonds[0]
  if (fonds[1] && [...r].length + 1 + [...fonds[1]].length <= MAX_RESUME) r = `${r} ${fonds[1]}`
  r = majusculeInitiale(r.replace(/^["“«„]+|["”»]+$/gu, '').trim())
  return [...r].length >= MIN_RESUME ? couperProprement(r, MAX_RESUME) : undefined
}

// ── L'appel complet ──────────────────────────────────────────────────────────────────

/**
 * Titre + résumé de l'émission. NE LÈVE JAMAIS : en cas d'échec, repli déterministe.
 */
export async function resumerEmission(opts: {
  turns:      readonly BroadcastTurn[]
  langue:     StationLanguage
  nomStation: string
  appeler:    AppelResume
}): Promise<ResumeEmission> {
  const { turns, langue, nomStation, appeler } = opts
  let inputTokens = 0
  let outputTokens = 0
  let maillon: string | undefined

  const repli = (raison: string): ResumeEmission => {
    let resume: string | undefined
    try { resume = resumeDeRepli(turns, langue) } catch { resume = undefined }
    return { ...(resume ? { resume } : {}), source: 'repli', raison, inputTokens, outputTokens }
  }

  try {
    const systemPrompt = promptSystemeResume(langue, nomStation)
    const user: LLMMessage = {
      role: 'user',
      content: `Transcript of the show (station language: ${nomLangue(langue)}):\n\n${texteDesTours(turns)}\n\nReply with the JSON object only, in ${nomLangue(langue)}.`,
    }
    const demander = async (messages: LLMMessage[]): Promise<string> => {
      const r = await appeler({ systemPrompt, messages, maxTokens: 300, temperature: 0.3 })
      inputTokens += r.inputTokens
      outputTokens += r.outputTokens
      maillon = r.maillon ?? maillon
      return r.text
    }

    const brut = await demander([user])
    let lu = lireReponseResume(brut)
    if (!lu) return repli('JSON illisible')
    let dernierBrut = brut

    // Même contrôle de langue qu'un tour : le titre et le résumé sont jugés ensemble, réécrits
    // au plus MAX_REECRITURES_LANGUE fois, puis rejetés.
    const ensemble = (o: { titre?: unknown; resume?: unknown }): string =>
      [typeof o.titre === 'string' ? o.titre : '', typeof o.resume === 'string' ? o.resume : '']
        .filter(Boolean).join('. ')
    const garanti = await garantirLangue(ensemble(lu), langue, async (_fautif, demande) => {
      const nouveau = await demander([user,
        { role: 'assistant', content: dernierBrut },
        { role: 'user', content: `${demande} Reply ONLY with the same JSON object {"titre": "...", "resume": "..."}, both fields in ${nomLangue(langue)}.` }])
      const relu = lireReponseResume(nouveau)
      if (!relu) return ''          // illisible : garantirLangue garde l'ancien texte, toujours fautif
      lu = relu
      dernierBrut = nouveau
      return ensemble(relu)
    })
    if (garanti.horsLangue) return repli(`langue ${garanti.horsLangue} après ${garanti.reecritures} réécriture(s)`)

    const resume = nettoyerResume(lu.resume)
    if (!resume) return repli('résumé vide ou trop court après nettoyage')
    const titre = nettoyerTitre(lu.titre, nomStation)
    return { ...(titre ? { titre } : {}), resume, source: 'modele', maillon, inputTokens, outputTokens }
  } catch (err) {
    return repli(`modèle indisponible : ${(err as Error)?.message?.split('\n')[0]?.slice(0, 120) ?? String(err)}`)
  }
}

/** La ligne de journal : « 📝 résumé : modèle (mistral) — … » ou « 📝 résumé : repli (raison) — … ». */
export function ligneJournalResume(r: ResumeEmission): string {
  const quoi = r.source === 'modele' ? `modèle${r.maillon ? ` (${r.maillon})` : ''}` : `repli (${r.raison ?? '?'})`
  const titre = r.titre ? `« ${r.titre} » — ` : ''
  return `📝 résumé : ${quoi} — ${titre}${r.resume ?? '(aucun résumé)'}`
}
