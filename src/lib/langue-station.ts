/**
 * @module InfinityScheduler/Lib/LangueStation
 * @description RÈGLE D'OR (Bâtisseur, 04/10/2026) : tout ce qui se dit sur une station se dit
 *   dans la LANGUE DE LA STATION, quels que soient l'animateur, la persona ou l'invité.
 *
 *   ── LE DÉFAUT MESURÉ (émissions 30093 réellement publiées, Free Press FM, station `en`) ──
 *   02/10 : 13 tours sur 22 en français · 03/10 : 13/22 · 04/10 : 12/22. Les DEUX animateurs
 *   (Sarah ET Malik) basculent, souvent dès le 2ᵉ ou le 3ᵉ tour, et ne reviennent plus.
 *   La voix, elle, restait anglaise (Piper `en_GB-alba` / `en_GB-northern_english_male`, ou la
 *   voix clonée avec `language: 'en'`) : du texte FRANÇAIS lu par une voix ANGLAISE — « du
 *   français avec un accent anglais ». Cause : le prompt est rédigé en français à 90 % (titres,
 *   consignes de tour, exemples « De retour sur… », « un auditeur nous écrit »…), la consigne de
 *   langue n'y tenait qu'en UNE ligne, et chaque tour français repassé dans l'historique
 *   entraînait le suivant.
 *
 *   Ce module donne trois garanties, pures et testables :
 *     1. `consigneLangueTour` — la consigne de langue, rappelée à CHAQUE tour (pas seulement au
 *        début), écrite dans la langue de la station ;
 *     2. `horsLangue` — une détection simple (mots-outils, écritures) du texte produit ;
 *     3. `demandeReecriture` — la demande de réécriture quand le modèle a répondu ailleurs.
 *
 *   ⚠️ COPIE IDENTIQUE dans les deux dépôts — à modifier ensemble :
 *     - app Infinity                 : src/modules/radio/ai/langue-station.ts
 *     - infinity-broadcast-scheduler : src/lib/langue-station.ts
 */

export type LangueStation = 'fr' | 'en' | 'es' | 'it' | 'pt' | 'hi' | 'ja' | 'zh' | 'ru'

/** Nom de la langue, dans la langue elle-même (pour la consigne) et en anglais (pour le modèle). */
const NOMS: Record<LangueStation, { natif: string; anglais: string }> = {
  fr: { natif: 'français',   anglais: 'French' },
  en: { natif: 'English',    anglais: 'English' },
  es: { natif: 'español',    anglais: 'Spanish' },
  it: { natif: 'italiano',   anglais: 'Italian' },
  pt: { natif: 'português',  anglais: 'Portuguese' },
  hi: { natif: 'हिन्दी',       anglais: 'Hindi' },
  ja: { natif: '日本語',      anglais: 'Japanese' },
  zh: { natif: '中文',        anglais: 'Chinese' },
  ru: { natif: 'русский',    anglais: 'Russian' },
}

export function nomLangue(langue: LangueStation): string {
  return NOMS[langue]?.anglais ?? langue
}

// ── 1. La consigne, à chaque tour ─────────────────────────────────────────────────────

const CONSIGNE_NATIVE: Record<LangueStation, string> = {
  fr: 'LANGUE : cette station parle français. Dis TOUT en français, chaque phrase, même si des tours précédents, les consignes ou l\'actualité sont dans une autre langue.',
  en: 'LANGUAGE: this station broadcasts in English. Say EVERYTHING in English — every sentence of your turn — even if earlier turns, the instructions or the news are in another language. Never speak French.',
  es: 'IDIOMA: esta emisora habla en español. Di TODO en español, cada frase, aunque los turnos anteriores, las consignas o las noticias estén en otro idioma.',
  it: 'LINGUA: questa stazione parla italiano. Di\' TUTTO in italiano, ogni frase, anche se i turni precedenti, le istruzioni o le notizie sono in un\'altra lingua.',
  pt: 'IDIOMA: esta estação fala português. Diga TUDO em português, cada frase, mesmo que os turnos anteriores, as instruções ou as notícias estejam em outra língua.',
  hi: 'भाषा: यह स्टेशन हिन्दी में प्रसारित होता है। हर वाक्य हिन्दी में बोलें, भले ही पिछली बातें, निर्देश या समाचार किसी और भाषा में हों।',
  ja: '言語：この局は日本語で放送します。前の発言や指示やニュースが他の言語でも、すべての文を日本語で話してください。',
  zh: '语言：本台用中文广播。即使之前的发言、指示或新闻是其他语言，你的每一句话都必须用中文说。',
  ru: 'ЯЗЫК: эта станция вещает на русском. Говорите ВСЁ по-русски, каждую фразу, даже если предыдущие реплики, инструкции или новости на другом языке.',
}

/**
 * La consigne de langue à ajouter à la fin du message de CHAQUE tour. Hors français et anglais,
 * on double en anglais : les consignes de structure sont en anglais pour ces langues.
 */
export function consigneLangueTour(langue: LangueStation): string {
  const natif = CONSIGNE_NATIVE[langue] ?? CONSIGNE_NATIVE.en
  if (langue === 'fr' || langue === 'en') return natif
  return `${natif} (LANGUAGE: speak ONLY ${NOMS[langue].anglais} on this station — never French, never English.)`
}

/**
 * Bloc de tête du prompt système pour une station NON française : le prompt est rédigé en
 * français, il faut dire d'emblée que la sortie, elle, ne l'est pas. Vide en français.
 */
export function enteteLangueSysteme(langue: LangueStation): string {
  if (langue === 'fr') return ''
  return `# LANGUAGE OF THE STATION: ${NOMS[langue].anglais.toUpperCase()}
The instructions below are partly written in French for the production team. IGNORE their language: everything you SAY on air is in ${NOMS[langue].anglais} (${NOMS[langue].natif}), every sentence, for the whole show. ${CONSIGNE_NATIVE[langue]}

`
}

// ── 2. La détection ───────────────────────────────────────────────────────────────────

/**
 * Mots-outils DISTINCTIFS de chaque langue à alphabet latin. Les mots partagés par deux langues
 * (« de », « la », « que », « no », « on », « mais », « como »…) sont VOLONTAIREMENT absents : ils
 * ne départagent rien et feraient prendre de l'anglais pour du français.
 */
const MOTS: Record<'fr' | 'en' | 'es' | 'it' | 'pt', ReadonlySet<string>> = {
  fr: new Set(['le', 'les', 'des', 'du', 'une', 'est', 'et', 'je', 'elle', 'nous', 'vous', 'ils', 'pas',
    'ce', 'cette', 'ces', 'qui', 'dans', 'pour', 'avec', 'sur', 'où', 'ça', 'très', 'aussi', 'tout', 'tous',
    'sont', 'être', 'avoir', 'fait', 'comme', 'moi', 'toi', 'leur', 'eux', 'là', 'ouais', 'hein', 'bon',
    'alors', 'oui', 'au', 'aux', 'mon', 'mes', 'tes', 'ses', 'notre', 'votre', 'quand', 'parce',
    'même', 'déjà', 'encore', 'rien', 'quoi', 'chez', 'sans', 'entre', 'aujourd', 'hui', 'demain', 'merci', 'voilà',
    'ai', 'était', 'faut', 'peut', 'veut', 'dit', 'parle', 'parler', 'écoute', 'retour', 'auditeur', 'tu']),
  en: new Set(['the', 'and', 'is', 'are', 'you', 'we', 'they', 'that', 'this', 'with', 'of', 'to', 'what',
    'not', 'but', 'for', 'just', 'like', 'so', 'have', 'has', 'was', 'were', 'be', 'i', 'my', 'your', 'our', 'their',
    'don', 'can', 'it', 'at', 'from', 'about', 'there', 'here', 'yes', 'right', 'well', 'let', 'gonna',
    'who', 'when', 'why', 'how', 'all', 'more', 'today', 'tomorrow', 'back', 'thanks', 'he', 'she', 'them', 'him', 'her',
    'been', 'will', 'would', 'should', 'could', 'does', 'did', 'an', 'or', 'if', 'than', 'then', 'into', 'over',
    'because', 'even', 'still', 'only', 'really', 'which', 'these', 'those', 'listener', 'listeners', 'welcome']),
  es: new Set(['el', 'los', 'las', 'es', 'y', 'pero', 'muy', 'está', 'están',
    'también', 'porque', 'sí', 'yo', 'eso', 'esto', 'hay', 'nosotros', 'ustedes', 'qué', 'cómo', 'más', 'ya', 'hoy',
    'mañana', 'gracias', 'aquí', 'ahora', 'bueno', 'pues', 'oyentes']),
  it: new Set(['gli', 'della', 'delle', 'dei', 'che', 'sono', 'è', 'per', 'questo', 'questa', 'quello', 'anche',
    'molto', 'perché', 'io', 'noi', 'voi', 'siamo', 'essere', 'ci', 'oggi', 'domani', 'grazie', 'ascoltatori',
    'nel', 'nella', 'sul', 'sulla', 'alla', 'allo', 'degli', 'ancora', 'già', 'adesso', 'allora', 'però']),
  pt: new Set(['os', 'uma', 'é', 'não', 'com', 'muito', 'também', 'você', 'vocês', 'eu', 'nós', 'isso',
    'isto', 'são', 'mas', 'hoje', 'amanhã', 'obrigado', 'obrigada', 'ouvintes', 'aqui', 'agora', 'então', 'já', 'nossa',
    'nosso', 'pelo', 'pela', 'na', 'ao', 'às', 'das', 'foi', 'tem']),
}

const LATINES = ['fr', 'en', 'es', 'it', 'pt'] as const
type Latine = typeof LATINES[number]

/** Lettres par écriture (une lettre latine accentuée reste latine). */
function compterEcritures(texte: string): { latin: number; cyrillique: number; han: number; kana: number; devanagari: number } {
  const c = { latin: 0, cyrillique: 0, han: 0, kana: 0, devanagari: 0 }
  for (const ch of texte) {
    if (/\p{Script=Latin}/u.test(ch)) c.latin++
    else if (/\p{Script=Cyrillic}/u.test(ch)) c.cyrillique++
    else if (/\p{Script=Han}/u.test(ch)) c.han++
    else if (/[\p{Script=Hiragana}\p{Script=Katakana}]/u.test(ch)) c.kana++
    else if (/\p{Script=Devanagari}/u.test(ch)) c.devanagari++
  }
  return c
}

function mots(texte: string): string[] {
  return texte
    .toLowerCase()
    .replace(/[’`´]/g, "'")
    .split(/[^\p{L}]+/u)
    .filter(Boolean)
}

function scoresLatins(m: string[]): Record<Latine, number> {
  const s = { fr: 0, en: 0, es: 0, it: 0, pt: 0 } as Record<Latine, number>
  for (const w of m) for (const l of LATINES) if (MOTS[l].has(w)) s[l]++
  return s
}

/** Langue latine d'un segment, ou null si rien ne la distingue nettement. */
function langueLatine(m: string[]): { langue: Latine; score: number; scores: Record<Latine, number> } | null {
  const scores = scoresLatins(m)
  const tri = [...LATINES].sort((a, b) => scores[b] - scores[a])
  const [premiere, seconde] = tri
  if (scores[premiere] < 2) return null
  if (scores[premiere] < 2 * scores[seconde] + 1) return null
  return { langue: premiere, score: scores[premiere], scores }
}

/**
 * La langue d'un texte, ou null quand on ne peut pas trancher (texte trop court, mélange).
 * Détection SIMPLE et prudente : elle ne sert qu'à écarter un tour franchement dans une autre
 * langue, pas à étiqueter du texte.
 */
export function detecterLangue(texte: string): LangueStation | null {
  const e = compterEcritures(texte)
  const total = e.latin + e.cyrillique + e.han + e.kana + e.devanagari
  if (total === 0) return null
  if (e.kana / total > 0.2) return 'ja'
  if (e.han / total > 0.4) return 'zh'
  if (e.cyrillique / total > 0.4) return 'ru'
  if (e.devanagari / total > 0.4) return 'hi'
  if (e.latin / total < 0.6) return null
  return langueLatine(mots(texte))?.langue ?? null
}

const ECRITURE_DE: Partial<Record<LangueStation, (e: ReturnType<typeof compterEcritures>) => number>> = {
  ru: e => e.cyrillique,
  zh: e => e.han,
  ja: e => e.han + e.kana,
  hi: e => e.devanagari,
}

/**
 * Le texte est-il (en bonne partie) dans une AUTRE langue que celle de la station ?
 * Rend la langue détectée, ou null si le texte est dans la langue de la station (ou indécidable).
 *
 * Phrase par phrase : un tour anglais qui finit en français (« …and that's it. Bon, on
 * s'écoute un morceau ») est attrapé dès que la partie étrangère pèse ≥ 25 % des mots, ou dès
 * qu'une phrase entière de 3 mots ou plus est étrangère sans un seul mot de la station. Une
 * expression isolée (« c'est la vie ») dans une phrase anglaise ne déclenche rien.
 */
export function horsLangue(texte: string, langue: LangueStation): LangueStation | null {
  const propre = texte.replace(/\[[^\]\n]*\]/g, ' ')   // « [Sarah] » n'est pas du texte
  const e = compterEcritures(propre)
  const total = e.latin + e.cyrillique + e.han + e.kana + e.devanagari
  if (total === 0) return null

  // Langues à écriture propre : la part de cette écriture tranche, PUIS les intrusions latines.
  const ecriture = ECRITURE_DE[langue]
  if (ecriture) {
    if (ecriture(e) / total >= 0.5) {
      const intrus = intrusionsLatines(propre, langue)
      if (intrus.length === 0) return null
      return langueLatine(mots(intrus.join(' ')))?.langue ?? 'en'
    }
    const autre = detecterLangue(propre)
    if (autre && autre !== langue) return autre
    // Majoritairement latin SANS mots-outils reconnaissables : du PINYIN (« Dajia hao, zheli shi
    // ziyou zhi sheng ») ou une transcription — aucune voix de la langue ne le lira. Étranger.
    return e.latin / total > 0.5 ? (langueLatine(mots(propre))?.langue ?? 'en') : null
  }

  // Station à alphabet latin : un texte majoritairement cyrillique, chinois… est étranger.
  if (e.latin / total < 0.5) {
    const autre = detecterLangue(propre)
    return autre && autre !== langue ? autre : null
  }

  const lat = langue as Latine
  const tous = mots(propre)
  if (tous.length === 0) return null

  // Texte entier, puis phrase par phrase.
  const global = langueLatine(tous)
  if (global && global.langue !== lat && global.scores[lat] * 2 < global.score) return global.langue

  const phrases = propre.split(/[.!?…;:«»"“”\n—–]+/u).map(mots).filter(p => p.length > 0)
  let motsEtrangers = 0
  let etrangere: Latine | null = null
  for (const p of phrases) {
    const l = langueLatine(p)
    if (!l || l.langue === lat) continue
    if (l.scores[lat] > 0 && p.length < 3) continue
    if (p.length >= 3 && l.scores[lat] === 0) {
      motsEtrangers += p.length
      etrangere = etrangere ?? l.langue
    } else if (l.scores[lat] * 2 < l.score) {
      motsEtrangers += p.length
      etrangere = etrangere ?? l.langue
    }
  }
  if (etrangere && motsEtrangers / tous.length >= 0.25) return etrangere
  return null
}

/**
 * Mots ou bouts de phrase en LETTRES LATINES glissés dans un tour d'une station à écriture propre
 * (chinois, japonais, russe, hindi), qu'aucune voix de la langue ne sait dire.
 *
 * 🔴 04/10/2026 — 自由之声, émissions publiées du 22/09 au 04/10 : chaque retour de pause musicale
 * commençait par « De retour sur 自由之声 » (consigne française recopiée), et l'on relève
 * « commitment to chaos », « silicon intelligence », « say I love you », « care », « alemana »,
 * « ezzel »… Le texte restait à 80 % en caractères chinois : la proportion d'écriture laissait tout
 * passer. Kokoro SUPPRIME ces mots sans rien dire (« lettres latines ignorées », journaux des nuits
 * du 27/09, 28/09 et 02/10) ; la voix clonée en `zh` les lit avec une phonétique chinoise. D'où
 * « les animateurs parlent étrangement, mais pas chinois ».
 *
 * Restent admis, parce qu'ils se disent (ou sont convertis par la prononciation chinoise) : les
 * SIGLES en capitales (AI, FBI, GPS), les jetons avec chiffres (5G, G2), un nom propre isolé ou
 * deux (« Kimi », « Jakob Coxon »). Sont rejetés : un mot en minuscules de 3 lettres ou plus, un
 * groupe de 2 mots dont un en minuscules, tout groupe de 3 mots ou plus.
 */
export function intrusionsLatines(texte: string, langue: LangueStation): string[] {
  if (!ECRITURE_DE[langue]) return []
  const propre = texte.replace(/\[[^\]\n]*\]/g, ' ')
  const groupes = propre.match(/[A-Za-zÀ-ÿ][A-Za-zÀ-ÿ'’]*(?:[ \-]+[A-Za-zÀ-ÿ][A-Za-zÀ-ÿ'’]*)*/g) ?? []
  const intrus: string[] = []
  for (const g of groupes) {
    const m = g.split(/[ \-]+/).filter(Boolean)
    const sigle = (w: string) => /^[A-Z]{1,6}s?$/.test(w)
    const minuscule = (w: string) => /^[a-zà-ÿ]/.test(w)
    const utiles = m.filter(w => !sigle(w))
    if (utiles.length === 0) continue
    if (utiles.length >= 3) { intrus.push(g); continue }
    if (utiles.length === 2 && utiles.some(minuscule)) { intrus.push(g); continue }
    if (utiles.length === 1 && minuscule(utiles[0]) && utiles[0].length >= 3) intrus.push(g)
  }
  return intrus
}

// ── 3. La réécriture ──────────────────────────────────────────────────────────────────

/**
 * Message à renvoyer au modèle quand il a répondu dans une autre langue : réécrire LE MÊME tour,
 * en entier, dans la langue de la station.
 */
export function demandeReecriture(langue: LangueStation, detectee: LangueStation | null, intrus: string[] = []): string {
  const ailleurs = detectee ? ` (it was in ${NOMS[detectee].anglais})` : ''
  if (intrus.length > 0 && langue !== 'fr') {
    const liste = intrus.slice(0, 6).map(m => `"${m}"`).join(', ')
    return `Your answer contains words in Latin letters that a ${NOMS[langue].anglais} voice cannot say: ${liste}. Rewrite EXACTLY the same turn ENTIRELY in ${NOMS[langue].anglais} (${NOMS[langue].natif}) script: translate these words, write numbers and names the way a ${NOMS[langue].anglais} radio host says them, and do not quote music titles in a foreign language. Same ideas, same length, same tone. Reply ONLY with the rewritten turn. ${CONSIGNE_NATIVE[langue]}`
  }
  if (langue === 'fr') {
    return `Ta réponse n'était pas en français${detectee ? ` (elle était en ${detectee === 'en' ? 'anglais' : NOMS[detectee].natif})` : ''}. Réécris EXACTEMENT ce même tour, ENTIÈREMENT en français : mêmes idées, même longueur, même ton. Réponds UNIQUEMENT avec le tour réécrit.`
  }
  return `Your answer was not in ${NOMS[langue].anglais}${ailleurs}. Rewrite EXACTLY the same turn ENTIRELY in ${NOMS[langue].anglais} (${NOMS[langue].natif}): same ideas, same length, same tone. Reply ONLY with the rewritten turn. ${CONSIGNE_NATIVE[langue]}`
}

/** Nombre de réécritures tentées avant d'écarter un tour resté dans une autre langue. */
export const MAX_REECRITURES_LANGUE = 2

/**
 * L'historique est passé au modèle sous la forme « [Sarah] texte » : le modèle recopie parfois
 * l'étiquette en tête de sa réponse (relevé dans les émissions publiées). Elle n'est pas dite
 * (le nettoyage des moteurs retire les crochets) mais pollue le transcript.
 */
export function retirerEtiquetteLocuteur(texte: string): string {
  return texte.replace(/^\s*\[[^\]\n]{1,40}\]\s*/u, '').trim()
}

/** Ce que rend `garantirLangue`. */
export interface TexteGaranti {
  /** Le texte retenu (réécrit le cas échéant), étiquette de locuteur retirée. */
  texte:        string
  /** La langue étrangère détectée sur le DERNIER essai, ou null : le texte est dans la langue
   *  de la station (ou indécidable). Non null = le tour doit être ÉCARTÉ, jamais diffusé. */
  horsLangue:   LangueStation | null
  /** Nombre de réécritures demandées au modèle. */
  reecritures:  number
}

/**
 * Le contrôle complet d'un tour : détection, puis jusqu'à `max` réécritures demandées au modèle
 * (`reecrire` reçoit le texte fautif et la demande à lui adresser, et rend le nouveau texte).
 * Le même chemin dans l'app et dans le générateur.
 */
export async function garantirLangue(
  texteBrut: string,
  langue: LangueStation,
  reecrire: (texteFautif: string, demande: string) => Promise<string>,
  max = MAX_REECRITURES_LANGUE,
): Promise<TexteGaranti> {
  let texte = retirerEtiquetteLocuteur(texteBrut)
  let ailleurs = horsLangue(texte, langue)
  let reecritures = 0
  while (ailleurs && reecritures < max) {
    reecritures++
    const demande = demandeReecriture(langue, ailleurs, intrusionsLatines(texte, langue))
    const candidat = retirerEtiquetteLocuteur((await reecrire(texte, demande)).trim())
    if (candidat) texte = candidat
    ailleurs = horsLangue(texte, langue)
  }
  return { texte, horsLangue: ailleurs, reecritures }
}
