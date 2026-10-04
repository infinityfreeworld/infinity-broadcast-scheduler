/**
 * @module InfinityScheduler/Lib/SloganRadio
 * @description PORT du module de l'app Infinity (`src/modules/radio/ai/slogan-radio.ts`,
 *   commit 62fafcd2b du 04/10/2026) : les émissions automatiques sont fabriquées
 *   ICI (`scripts/generate-broadcast.ts`), pas dans l'app. Seule différence : la
 *   forme parlée française est écrite déjà francisée (« Infiniti tiret Friwourld
 *   point com ») — c'est exactement ce que la voix de l'app prononce après son
 *   étape `frenchify-english`. Depuis le 04/10/2026 ce dépôt a cette étape aussi
 *   (à l'entrée de Piper et Chatterbox) : elle laisse cette forme intacte, sans
 *   la franciser une seconde fois (testé dans slogan-radio.test.ts).
 *
 *   La phrase d'appel de chaque émission :
 *   « Rejoignez <nom de la radio> sur Infinity-freeworld.com ».
 *
 *   Demande du Bâtisseur (04/10/2026) : dans TOUTES les émissions, un animateur
 *   la dit une ou deux fois — jamais plus.
 *
 *   ## Pourquoi pas seulement le modèle
 *   On le lui demande (consigne du tour d'ouverture et de clôture), mais un
 *   modèle oublie, ou la répète à chaque tour. La garantie est donc
 *   DÉTERMINISTE, ici, en fonctions pures :
 *     - `appliquerSlogan` compte ce qui a déjà été dit dans l'émission ;
 *     - au tour d'OUVERTURE, si le modèle ne l'a pas dite, la phrase est
 *       ajoutée à la fin de sa réplique ;
 *     - au tour de CLÔTURE, elle est ajoutée si elle n'a été dite qu'une fois
 *       (ou jamais) ;
 *     - à tout moment, une phrase qui contient l'adresse au-delà de la 2ᵉ
 *       mention est RETIRÉE de la réplique.
 *
 *   ## Ce qui est écrit, ce qui est dit
 *   Le transcript garde la forme écrite « Infinity-freeworld.com ». La voix,
 *   elle, reçoit une forme parlée (`prononcerDomaine`), appelée dans
 *   `generate-broadcast` (texte des voix) AVANT le nettoyage des moteurs : sinon le moteur lirait le tiret
 *   et le point au petit bonheur (ou le nettoyage les prendrait pour des
 *   symboles). Le tiret est DIT (« tiret ») : sans lui, un auditeur qui tape
 *   « infinityfreeworld.com » n'arrive nulle part.
 *
 *   ## Langue
 *   La phrase suit la langue de la STATION (pas celle de l'interface du
 *   Bâtisseur qui écoute) : c'est ce que l'animateur prononce à l'antenne, au
 *   même titre que les consignes de `radio-host-personas.ts`. Elle n'est donc
 *   pas une macro Lingui — la traduire selon l'interface ferait dire une phrase
 *   anglaise à une animatrice d'une station russe. Le nom de domaine, lui, ne
 *   change jamais.
 *
 *   PUR — aucune dépendance, aucun effet.
 */

import type { StationLanguage } from './types'

/** Le nom de domaine tel qu'il s'ÉCRIT (transcripts, écran). */
export const DOMAINE_INFINITY = 'Infinity-freeworld.com'

/** Nombre maximal de mentions par émission (demande du Bâtisseur). */
export const MAX_SLOGANS_PAR_EMISSION = 2

/** La phrase d'appel, écrite, dans la langue de la station. */
const PHRASES: Record<StationLanguage, (nom: string) => string> = {
  fr: n => `Rejoignez ${n} sur ${DOMAINE_INFINITY}.`,
  en: n => `Join ${n} on ${DOMAINE_INFINITY}.`,
  es: n => `Únete a ${n} en ${DOMAINE_INFINITY}.`,
  it: n => `Unisciti a ${n} su ${DOMAINE_INFINITY}.`,
  pt: n => `Junte-se a ${n} em ${DOMAINE_INFINITY}.`,
  hi: n => `${DOMAINE_INFINITY} पर ${n} से जुड़िए।`,
  ja: n => `${DOMAINE_INFINITY} で ${n} に参加しよう。`,
  zh: n => `在 ${DOMAINE_INFINITY} 加入 ${n}。`,
  ru: n => `Присоединяйтесь к ${n} на ${DOMAINE_INFINITY}.`,
}

/**
 * Forme PARLÉE du domaine, pour la synthèse. Le tiret et le point sont dits
 * en toutes lettres, dans la langue de la station. En français, la forme est
 * DÉJÀ francisée, identique à la sortie de `frenchify-english` dans l'app ;
 * l'étape `frenchify-english` des moteurs de ce dépôt la laisse intacte.
 */
const DOMAINE_PARLE: Record<StationLanguage, string> = {
  fr: 'Infiniti tiret Friwourld point com',
  en: 'Infinity dash Freeworld dot com',
  es: 'Infinity guion Freeworld punto com',
  it: 'Infinity trattino Freeworld punto com',
  pt: 'Infinity hífen Freeworld ponto com',
  hi: 'इन्फिनिटी डैश फ्रीवर्ल्ड डॉट कॉम',
  ja: 'インフィニティ ハイフン フリーワールド ドット コム',
  zh: 'Infinity 横杠 Freeworld 点 com',
  ru: 'Инфинити дефис Фриуорлд точка ком',
}

/**
 * Reconnaît une mention de l'adresse, sous ses formes écrites courantes :
 * « Infinity-freeworld.com », « infinity freeworld point com »,
 * « https://www.infinity-freeworld.com/ »…
 */
const MOTIF_DOMAINE =
  /(?:https?:\/\/)?(?:www\.)?infinity[\s-]?free[\s-]?world\s*(?:\.|point|dot|punto|ponto|точка|点)\s*com\b\/?/giu

function motif(): RegExp { return new RegExp(MOTIF_DOMAINE.source, MOTIF_DOMAINE.flags) }

/** Nom de la station prêt à être dit (repli si vide). */
function nomPropre(nomStation: string): string {
  const n = nomStation.trim()
  return n.length > 0 ? n : 'Infinity Radio'
}

/** « Rejoignez <station> sur Infinity-freeworld.com. » dans la langue de la station. */
export function phraseSlogan(nomStation: string, langue: StationLanguage = 'fr'): string {
  return (PHRASES[langue] ?? PHRASES.fr)(nomPropre(nomStation))
}

/** Forme parlée du domaine pour la synthèse. */
export function domaineParle(langue: StationLanguage = 'fr'): string {
  return DOMAINE_PARLE[langue] ?? DOMAINE_PARLE.fr
}

/**
 * Remplace toute mention ÉCRITE de l'adresse par sa forme parlée.
 * À n'appliquer QU'au texte envoyé à la synthèse — jamais au transcript.
 */
export function prononcerDomaine(texte: string, langue: StationLanguage = 'fr'): string {
  const parle = domaineParle(langue)
  return texte.replace(motif(), parle)
}

/** Nombre de mentions de l'adresse dans un texte. */
export function compterSlogans(texte: string): number {
  return (texte.match(motif()) ?? []).length
}

/** Découpe en phrases en gardant la ponctuation finale (et l'espace qui suit). */
function decouperPhrases(texte: string): string[] {
  return texte.match(/[^.!?…。！？।]+(?:[.!?…。！？।]+|$)\s*/gu) ?? [texte]
}

/** Repère interne qui remplace une mention le temps du découpage. */
const REPERE = /\uE002(\d+)\uE003/g

/**
 * Retire les phrases qui mentionnent l'adresse au-delà des `garder` premières.
 * Si retirer laisserait la réplique VIDE, on la laisse telle quelle : un tour
 * muet serait pire qu'une mention de trop (cas d'un modèle qui ne répond QUE
 * la phrase d'appel).
 */
export function retirerSlogansEnTrop(texte: string, garder: number): string {
  const limite = Math.max(0, garder)
  if (compterSlogans(texte) <= limite) return texte
  // Le point de « freeworld.com » couperait la phrase en deux : on remplace
  // chaque mention par un repère sans ponctuation avant de découper.
  const mentions: string[] = []
  const masque = texte.replace(motif(), m => `\uE002${mentions.push(m) - 1}\uE003`)
  let vues = 0
  const restes = decouperPhrases(masque).filter(p => {
    const n = (p.match(REPERE) ?? []).length
    if (n === 0) return true
    if (vues + n <= limite) { vues += n; return true }
    return false
  })
  const resultat = restes.join('')
    .replace(REPERE, (_m, i: string) => mentions[Number(i)] ?? '')
    .replace(/\s{2,}/g, ' ')
    .trim()
  return /[\p{L}\p{N}]/u.test(resultat) ? resultat : texte
}

/** Place de la réplique dans l'émission. */
export type PositionTour =
  /** Premier tour d'une émission qui en a plusieurs. */
  | 'ouverture'
  /** Dernier tour (ou, en direct, l'annonce de la première pause musicale). */
  | 'cloture'
  /** Émission d'UN seul tour : ouverture et clôture à la fois. */
  | 'unique'
  /** Tout autre tour. */
  | 'milieu'

export interface ResultatSlogan {
  /** La réplique, éventuellement complétée ou allégée. */
  texte: string
  /** Total des mentions dans l'émission APRÈS ce tour. */
  dits:  number
  /** true si la phrase a été AJOUTÉE (le modèle ne l'avait pas dite). */
  ajoute: boolean
}

/** Ajoute la phrase d'appel à la fin d'une réplique. */
function ajouterSlogan(texte: string, nomStation: string, langue: StationLanguage): string {
  const base = texte.trim()
  const phrase = phraseSlogan(nomStation, langue)
  if (!base) return phrase
  const ponctue = /[.!?…。！？।»"”)]$/u.test(base)
  return `${base}${ponctue ? '' : '.'} ${phrase}`
}

/**
 * Garantie déterministe de la phrase d'appel pour UN tour.
 *
 * @param texte       la réplique produite par le modèle
 * @param dejaDits    mentions déjà faites dans CETTE émission avant ce tour
 * @param position    place du tour dans l'émission
 */
export function appliquerSlogan(opts: {
  texte:      string
  nomStation: string
  langue:     StationLanguage
  dejaDits:   number
  position:   PositionTour
}): ResultatSlogan {
  const { nomStation, langue, position } = opts
  const dejaDits = Math.max(0, opts.dejaDits)
  const budget = Math.max(0, MAX_SLOGANS_PAR_EMISSION - dejaDits)

  let texte = retirerSlogansEnTrop(opts.texte, budget)
  let dits = dejaDits + Math.min(compterSlogans(texte), budget)
  let ajoute = false

  const doitOuvrir = (position === 'ouverture' || position === 'unique') && dits === 0
  const doitClore = position === 'cloture' && dits < MAX_SLOGANS_PAR_EMISSION
  if (doitOuvrir || doitClore) {
    texte = ajouterSlogan(texte, nomStation, langue)
    dits += 1
    ajoute = true
  }
  return { texte, dits, ajoute }
}

/**
 * Consigne à joindre au message du tour, pour que le modèle dise lui-même la
 * phrase (plus naturel qu'un ajout). Prompt de modèle : jamais affiché.
 */
export function consigneSloganPourTour(
  nomStation: string,
  langue: StationLanguage,
  position: PositionTour,
): string {
  const phrase = phraseSlogan(nomStation, langue)
  // Hors français, la consigne est en ANGLAIS : une consigne française poussait le modèle vers le
  // français sur les stations étrangères (Free Press FM, 04/10/2026 — cf. langue-station.ts).
  if (langue !== 'fr') {
    return position === 'milieu'
      ? `Do NOT say the sentence « ${phrase} » in this turn: it is reserved for the opening and the closing.`
      : `End your turn by saying, word for word: « ${phrase} »`
  }
  if (position === 'milieu') {
    return `Ne dis PAS la phrase « ${phrase} » dans ce tour : elle est réservée à l'ouverture et à la clôture.`
  }
  return `Termine ta réplique en disant, mot pour mot : « ${phrase} »`
}

/**
 * Directive permanente du prompt système : la phrase d'appel existe, et elle
 * ne se dit QUE quand la consigne du tour le demande.
 */
export function directiveSloganSysteme(nomStation: string, langue: StationLanguage): string {
  return `La phrase d'appel de la station est « ${phraseSlogan(nomStation, langue)} ». Tu ne la dis QUE si la consigne de ton tour te le demande, mot pour mot, une seule fois ; sinon tu ne mentionnes pas cette adresse.`
}

// ── Propre au générateur (scheduler) ────────────────────────────────────

/**
 * Place d'un tour dans l'émission, comme dans la fabrique de l'app
 * (broadcast-generator) : l'ouverture est le premier tour PRODUIT (un tour vide
 * écarté ne compte pas), la clôture le dernier tour PRÉVU.
 */
export function positionDuTour(premierProduit: boolean, dernierPrevu: boolean): PositionTour {
  if (premierProduit && dernierPrevu) return 'unique'
  if (premierProduit) return 'ouverture'
  if (dernierPrevu) return 'cloture'
  return 'milieu'
}

/** À la clôture, si la phrase a déjà été dite deux fois, rien à demander au modèle. */
export function positionPourConsigne(position: PositionTour, dejaDits: number): PositionTour {
  return position === 'cloture' && dejaDits >= MAX_SLOGANS_PAR_EMISSION ? 'milieu' : position
}
