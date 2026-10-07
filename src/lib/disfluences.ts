/**
 * @module InfinityScheduler/Disfluences
 * @description Les HÉSITATIONS d'une vraie antenne : « euh… », « bah », « enfin », « tu vois »,
 *   faux départs (« je… enfin, je veux dire »), petites répétitions (« c'est, c'est vrai »).
 *
 *   Demande du Bâtisseur, jamais faite jusqu'ici (07/10/2026) : l'ancienne consigne d'oralité ne
 *   demandait que des interjections (« bon », « ah », « ouais ») et « une hésitation de temps en
 *   temps » — le modèle n'en écrivait presque jamais, et les animateurs parlaient comme un texte lu.
 *
 *   Deux étages :
 *   1. `directiveDisfluences(langue)` : la consigne d'écriture, avec les disfluences NATURELLES de
 *      chaque langue et une fréquence cible (un tour sur deux ou trois, jamais plus de deux par tour).
 *   2. `rattraperDisfluences(...)` : si le modèle en a écrit trop peu, on en ajoute aux endroits où un
 *      humain hésite (début de réponse, après une virgule, première syllabe répétée), DÉTERMINISTE
 *      par graine (station, date), sans jamais toucher l'ouverture, la conclusion, le lancement
 *      d'une musique ni le courrier lu à l'antenne (c'est l'appelant qui dit quels tours sont permis).
 *
 *   ── ÉCRITURE CHOISIE (mesurée avec espeak-ng, le phonétiseur de Piper, 07/10/2026) ──
 *   « euh » → /œ/ ; « hum » → /ɔm/ (faux) mais « hmm » → /hœm/ ; « ben » → /bɛn/ (faux, on évite) ;
 *   « mmh », « mmm », « ммм » sont ÉPELÉS lettre par lettre → bannis. Les points de suspension « … »
 *   gardent la petite pause : ni `sanitizeForSpeech`, ni `frenchifyEnglishWords`, ni
 *   `prononcerDomaine`, ni `textePourVoixChinoise` ne les retirent (tests à l'appui).
 *
 *   Pur, sans dépendance au réseau ; seul `prng` (musique.ts) est importé.
 */
import type { StationLanguage } from './types'
import { prng } from './musique'

interface Lexique {
  /** Ce qu'on met en DÉBUT de réponse (« Euh… »). Écrit avec majuscule, sans ponctuation finale. */
  debut:   string[]
  /** Ce qu'on glisse APRÈS une virgule, avant une idée plus difficile (« euh… »). */
  milieu:  string[]
  /** Petits mots qu'on peut répéter en début de phrase (« c'est, c'est »). Vide = pas de répétition. */
  repetables: string[]
  /** Reconnaît une disfluence DÉJÀ présente (pour ne pas en rajouter). Drapeaux `giu`. */
  reconnaitre: RegExp
  /** Mots-outils dont on peut baisser la majuscule après une hésitation (« Euh… je pense »). */
  minuscules: string[]
  /** La consigne lisible par le modèle. */
  consigne: string
}

/** Lettre (toutes écritures) — `\b` ne connaît que l'ASCII. */
const L = '\\p{L}'
const avant = `(?<![${L}])`
const apres = `(?![${L}])`
/** Une forme qui ne compte comme hésitation QUE suivie d'une virgule ou de points de suspension
 *  (« genre, » oui ; « le genre humain » non). */
const suivi = (m: string) => `${avant}${m}(?=\\s*(?:,|…|\\.\\.\\.|，|……))`
const mot = (m: string) => `${avant}${m}${apres}`
/** Répétition immédiate d'un mot (« c'est, c'est », « je… je »). */
const REPETITION = `${avant}([${L}]+(?:['’][${L}]+)?)(?:,|…|\\.\\.\\.)?\\s+\\1${apres}`

function re(parties: string[]): RegExp {
  return new RegExp(parties.join('|'), 'giu')
}

const LEXIQUES: Record<StationLanguage, Lexique> = {
  fr: {
    debut: ['Euh…', 'Euh…', 'Bah…', 'Hmm…', 'Enfin…'],
    milieu: ['euh…', 'euh…', 'enfin…', 'tu vois…', 'hmm…'],
    repetables: ["c'est", 'je', 'on', 'il', 'elle', 'mais', 'et', 'ça', 'le', 'la', 'les', 'moi', 'tu', "j'ai", "il y a"],
    reconnaitre: re([mot('euh'), mot('heu'), mot('hum'), mot('hmm+'), mot('ben'), mot('bah'), mot('bref'),
      suivi('enfin'), suivi('genre'), mot('tu vois'), mot('vous voyez'), mot('je veux dire'), mot('comment dire'), REPETITION]),
    minuscules: ['je', "j'", 'tu', 'il', 'elle', 'on', 'nous', 'vous', 'ils', 'elles', "c'", 'ce', 'ça', 'ca', 'le', 'la', 'les',
      "l'", 'un', 'une', 'des', 'du', 'de', "d'", 'mais', 'et', 'ou', 'donc', 'alors', 'pour', 'parce', 'quand', 'si', 'moi',
      'toi', 'oui', 'non', 'bon', 'ah', 'oh', 'là', 'en', 'y', "qu'", 'que', 'qui', 'ces', 'cette', 'cet', 'mon', 'ma', 'mes',
      'ton', 'ta', 'tes', 'son', 'sa', 'ses', 'notre', 'votre', 'leur', 'tout', 'tous', 'toute', 'franchement', 'honnêtement'],
    consigne: `HÉSITE COMME UN HUMAIN : environ un tour sur deux ou trois contient UNE (au plus DEUX) vraie hésitation, placée là où l'on hésite vraiment — au début d'une réponse, juste avant une idée difficile, après une question qu'on vient de te poser. Formes à utiliser : « euh… » (avec les points de suspension, pour la petite pause), « bah », « hmm… », « enfin », « tu vois », « je veux dire », « genre » (rarement) ; un faux départ (« je… enfin, je veux dire que… ») ; une petite répétition (« c'est, c'est vrai que… »). Jamais deux hésitations collées, jamais à chaque phrase. N'écris JAMAIS « mmh » ni « mmm » (la voix les épelle). Aucune hésitation quand tu annonces le titre d'une musique, ni dans un message d'auditeur que tu lis mot pour mot, ni dans la phrase d'ouverture ou de conclusion.`,
  },
  en: {
    debut: ['Uh…', 'Well…', 'Hmm…', 'Uh…', 'Um…'],  // « Um » est très bref chez en_GB-alba (+0,09 s mesuré)
    milieu: ['uh…', 'um…', 'you know…', 'I mean…', 'like,'],
    repetables: ['I', "it's", 'we', 'you', 'the', 'and', 'but', 'so', 'that', "that's", "I'm", 'there', 'they'],
    reconnaitre: re([mot('uh'), mot('um+'), mot('erm'), mot('hmm+'), mot('you know'), mot('I mean'), mot('kind of'), mot('sort of'),
      suivi('well'), suivi('like'), suivi('so'), REPETITION]),
    minuscules: ['the', 'a', 'an', 'it', "it's", 'we', 'you', 'they', 'he', 'she', 'that', "that's", 'this', 'there', "there's",
      'and', 'but', 'so', 'or', 'if', 'when', 'because', 'my', 'our', 'your', 'their', 'what', 'how', 'yes', 'no', 'well', 'oh', 'to', 'in', 'on'],
    consigne: `HESITATE LIKE A HUMAN: roughly one turn in two or three contains ONE (at most TWO) real hesitation, where people actually hesitate — at the start of an answer, right before a harder idea, after a question you were just asked. Natural forms: "uh…", "um…" (with the dots, for the little pause), "well…", "hmm…", "you know", "I mean", "like" (sparingly); a false start ("I… I mean, what I'm saying is…"); a small repetition ("it's, it's true that…"). Never two hesitations in a row, never in every sentence. Never write "mmm" (the voice spells it). No hesitation when you announce a music title, inside a listener message you read word for word, or in the opening or closing sentence.`,
  },
  es: {
    debut: ['Eh…', 'Pues…', 'Bueno…', 'Eh…'],
    milieu: ['eh…', 'este…', 'o sea,', 'pues…'],
    repetables: ['es', 'yo', 'el', 'la', 'los', 'las', 'y', 'pero', 'que', 'no', 'lo', 'eso', 'hay'],
    reconnaitre: re([mot('eh+'), mot('em+'), mot('o sea'), mot('pues'), mot('digamos'), mot('es decir'), mot('sabes'), suivi('este'),
      suivi('bueno'), suivi('vamos'), REPETITION]),
    minuscules: ['el', 'la', 'los', 'las', 'un', 'una', 'yo', 'tú', 'es', 'eso', 'esto', 'esta', 'este', 'hay', 'y', 'pero', 'que',
      'no', 'sí', 'lo', 'mi', 'tu', 'su', 'nuestro', 'creo', 'bueno', 'en', 'de', 'con', 'si', 'cuando', 'porque'],
    consigne: `HESITATE LIKE A HUMAN, with the natural Spanish fillers: roughly one turn in two or three contains ONE (at most TWO) hesitation, at the start of an answer, before a harder idea or after a question — « eh… » (with the dots for the little pause), « pues », « este… », « o sea », « bueno… », « digamos »; a false start (« yo… o sea, lo que quiero decir es… »); a small repetition (« es, es verdad que… »). Never two in a row, never in every sentence. Never write « mmm » (the voice spells it). No hesitation when announcing a music title, inside a listener message read word for word, or in the opening or closing sentence.`,
  },
  ru: {
    debut: ['Ну…', 'Э-э…', 'Ну…', 'Хм…'],
    milieu: ['э-э…', 'как бы,', 'ну…', 'в общем,'],
    repetables: ['это', 'я', 'мы', 'он', 'она', 'и', 'но', 'вот', 'так', 'что'],
    reconnaitre: re([mot('ну'), mot('э+(?:-э+)*'), mot('эм+'), mot('хм+'), mot('как бы'), mot('в общем'), mot('то есть'),
      mot('короче'), mot('это самое'), mot('знаешь'), suivi('вот'), suivi('значит'), REPETITION]),
    minuscules: ['это', 'я', 'мы', 'ты', 'вы', 'он', 'она', 'они', 'и', 'но', 'а', 'вот', 'так', 'что', 'как', 'в', 'на', 'не', 'да', 'нет', 'мне', 'мой', 'наш'],
    consigne: `HESITATE LIKE A HUMAN, with the natural Russian fillers: roughly one turn in two or three contains ONE (at most TWO) hesitation, at the start of an answer, before a harder idea or after a question — « ну… », « э-э… » (with the dots for the little pause), « как бы », « в общем », « то есть », « хм… »; a false start (« я… то есть, я хочу сказать… »); a small repetition (« это, это правда… »). Never two in a row, never in every sentence. Never write « ммм » (the voice spells it). No hesitation when announcing a music title, inside a listener message read word for word, or in the opening or closing sentence.`,
  },
  zh: {
    debut: ['嗯……', '那个……', '嗯……', '呃……'],
    milieu: ['嗯……', '就是……', '那个……', '怎么说呢，'],
    repetables: [],
    reconnaitre: re(['嗯', '呃', '额', '怎么说呢', '我是说', '你知道', suivi('那个'), suivi('就是'), suivi('这个'), suivi('然后')]),
    minuscules: [],
    consigne: `HESITATE LIKE A HUMAN, with natural Chinese fillers: roughly one turn in two or three contains ONE (at most TWO) hesitation, at the start of an answer, before a harder idea or after a question — 「嗯……」, 「呃……」, 「那个……」, 「就是……」, 「怎么说呢」, 「我是说」; a false start (「我……我是说……」); a small repetition (「这个，这个确实……」). Never two in a row, never in every sentence. No hesitation when announcing a music title, inside a listener message read word for word, or in the opening or closing sentence.`,
  },
  it: {
    debut: ['Ehm…', 'Beh…', 'Allora…'],
    milieu: ['ehm…', 'cioè,', 'insomma,'],
    repetables: ['è', 'io', 'il', 'la', 'e', 'ma', 'che', 'non'],
    reconnaitre: re([mot('ehm+'), mot('eh+'), mot('beh'), mot('cioè'), mot('insomma'), mot('diciamo'), suivi('tipo'), suivi('allora'), REPETITION]),
    minuscules: ['il', 'la', 'lo', 'i', 'le', 'un', 'una', 'io', 'tu', 'noi', 'è', 'e', 'ma', 'che', 'non', 'sì', 'questo', 'quello'],
    consigne: `HESITATE LIKE A HUMAN, with natural Italian fillers (« ehm… », « beh », « cioè », « insomma », « diciamo », « tipo » sparingly): roughly one turn in two or three, at most TWO per turn, at the start of an answer or before a harder idea; never when announcing a music title, inside a listener message read word for word, or in the opening or closing sentence.`,
  },
  pt: {
    debut: ['Hã…', 'Bom…', 'Então…'],
    milieu: ['hã…', 'tipo,', 'quer dizer,'],
    repetables: ['é', 'eu', 'o', 'a', 'e', 'mas', 'que', 'não'],
    reconnaitre: re([mot('hã+'), mot('ah+'), mot('quer dizer'), mot('sabe'), mot('digamos'), suivi('tipo'), suivi('então'), suivi('bom'), REPETITION]),
    minuscules: ['o', 'a', 'os', 'as', 'um', 'uma', 'eu', 'tu', 'você', 'nós', 'é', 'e', 'mas', 'que', 'não', 'sim', 'isso', 'isto'],
    consigne: `HESITATE LIKE A HUMAN, with natural Portuguese fillers (« hã… », « bom », « então », « quer dizer », « sabe », « tipo » sparingly): roughly one turn in two or three, at most TWO per turn, at the start of an answer or before a harder idea; never when announcing a music title, inside a listener message read word for word, or in the opening or closing sentence.`,
  },
  ja: {
    debut: ['えーと……', 'あの……', 'えー……'],
    milieu: ['えーと……', 'なんか、', 'その……'],
    repetables: [],
    reconnaitre: re(['えーと', 'えっと', 'えー', 'あのー', 'うーん', 'なんか', suivi('あの'), suivi('その'), suivi('まあ')]),
    minuscules: [],
    consigne: `HESITATE LIKE A HUMAN, with natural Japanese fillers (「えーと……」, 「あの……」, 「うーん」, 「なんか」, 「まあ」): roughly one turn in two or three, at most TWO per turn, at the start of an answer or before a harder idea; never when announcing a music title, inside a listener message read word for word, or in the opening or closing sentence.`,
  },
  hi: {
    debut: ['अं…', 'मतलब…', 'देखिए…'],
    milieu: ['अं…', 'मतलब,', 'यानी,'],
    repetables: [],
    reconnaitre: re([mot('अं'), mot('मतलब'), mot('यानी'), mot('देखिए'), mot('वो क्या है')]),
    minuscules: [],
    consigne: `HESITATE LIKE A HUMAN, with natural Hindi fillers (« अं… », « मतलब », « यानी », « देखिए », « वो क्या है »): roughly one turn in two or three, at most TWO per turn, at the start of an answer or before a harder idea; never when announcing a music title, inside a listener message read word for word, or in the opening or closing sentence.`,
  },
}

/** Jamais plus de deux hésitations par tour (consigne ET rattrapage). */
export const MAX_PAR_TOUR = 2
/** Part par défaut des tours permis qui portent au moins une hésitation (« un sur deux ou trois »). */
export const TAUX_PAR_DEFAUT = 0.4

/** La consigne d'écriture, dans la langue de la consigne (français pour fr, anglais sinon). */
export function directiveDisfluences(langue: StationLanguage): string {
  return (LEXIQUES[langue] ?? LEXIQUES.en).consigne
}

/** Nombre de disfluences déjà présentes dans un texte. */
export function compterDisfluences(texte: string, langue: StationLanguage): number {
  const r = (LEXIQUES[langue] ?? LEXIQUES.en).reconnaitre
  return [...texte.matchAll(new RegExp(r.source, r.flags))].length
}

/**
 * Lit `HABILLAGE_DISFLUENCES` : un taux entre 0 et 1 (« 0.4 »), ou un pourcentage (« 40 »).
 * Absent ou illisible → `TAUX_PAR_DEFAUT` ; « 0 », « off », « false », « non » → 0 (désactivé).
 */
export function tauxDisfluences(env: NodeJS.ProcessEnv = process.env): number {
  const v = (env.HABILLAGE_DISFLUENCES ?? '').trim().toLowerCase().replace(',', '.').replace(/%$/, '')
  if (v === '') return TAUX_PAR_DEFAUT
  if (v === 'off' || v === 'false' || v === 'non' || v === 'no') return 0
  const n = Number(v)
  if (!Number.isFinite(n) || n < 0) return TAUX_PAR_DEFAUT
  return Math.min(1, n > 1 ? n / 100 : n)
}

const echapper = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

/** « Je pense » → « je pense » après une hésitation, si le premier mot est un mot-outil. */
function baisser(texte: string, lex: Lexique): string {
  const m = /^([\p{L}]+['’]?)/u.exec(texte)
  if (!m) return texte
  const premier = m[1].toLowerCase().replace('’', "'")
  if (!lex.minuscules.includes(premier)) return texte
  return texte.charAt(0).toLowerCase() + texte.slice(1)
}

type Maniere = 'debut' | 'virgule' | 'repetition'

/** Une seule hésitation ajoutée à `texte`, de la manière demandée ; null si impossible ici. */
function inserer(texte: string, maniere: Maniere, lex: Lexique, rand: () => number, langue: StationLanguage): string | null {
  const choisir = (l: string[]) => l[Math.floor(rand() * l.length)]
  const cjk = langue === 'zh' || langue === 'ja'
  if (maniere === 'debut') {
    const forme = choisir(lex.debut)
    // « Bon, c'est… » : l'hésitation vient APRÈS une courte interjection d'attaque.
    const attaque = /^([\p{L}]{1,6}),\s+(?=\p{L})/u.exec(texte)
    if (attaque && !cjk) {
      return `${attaque[0]}${forme.toLowerCase()} ${baisser(texte.slice(attaque[0].length), lex)}`
    }
    return cjk ? `${forme}${texte}` : `${forme} ${baisser(texte, lex)}`
  }
  if (maniere === 'virgule') {
    // Une virgule au milieu de la phrase (ni dans les 12 premiers caractères, ni dans les 8
    // derniers), suivie d'un blanc (« 3,5 » n'est pas une virgule de phrase) ou pleine largeur.
    const virgules: number[] = []
    const r = cjk ? /，/g : /(?<=\p{L}),\s+(?=\p{L})/gu
    for (let m = r.exec(texte); m; m = r.exec(texte)) {
      const fin = m.index + m[0].length
      if (m.index >= 12 && fin <= texte.length - 8) virgules.push(fin)
    }
    if (virgules.length === 0) return null
    const ici = virgules[Math.floor(rand() * virgules.length)]
    const forme = choisir(lex.milieu)
    if (cjk) return `${texte.slice(0, ici)}${forme}${texte.slice(ici)}`
    return `${texte.slice(0, ici)}${forme} ${texte.slice(ici)}`
  }
  // répétition du premier petit mot : « C'est vrai » → « C'est, c'est vrai »
  if (lex.repetables.length === 0) return null
  for (const petit of [...lex.repetables].sort((a, b) => b.length - a.length)) {
    const m = new RegExp(`^(${echapper(petit)})(?![\\p{L}'’])`, 'iu').exec(texte)
    if (!m) continue
    const reste = texte.slice(m[0].length)
    if (!/^\s+\p{L}/u.test(reste)) return null
    const second = petit === 'I' ? 'I' : m[1].charAt(0).toLowerCase() + m[1].slice(1)
    return `${m[1]}, ${second}${reste}`
  }
  return null
}

export interface TourDisfluence {
  texte:  string
  /** Faux pour l'ouverture, la conclusion, le lancement d'une musique, le retour de pause,
   *  le courrier lu à l'antenne, les réactions courtes. */
  permis: boolean
}

export interface ResultatRattrapage {
  textes:  string[]
  /** Indices des tours modifiés. */
  ajouts:  number[]
  /** Tours permis qui portaient une hésitation AVANT le rattrapage. */
  avant:   number
  /** Combien il en fallait (taux × tours permis). */
  cible:   number
}

/**
 * Le rattrapage : si moins de `taux` des tours permis portent une hésitation, on en ajoute UNE
 * dans des tours permis qui n'en ont aucune, jusqu'à la cible. Jamais deux tours modifiés de
 * suite (le procédé s'entendrait), jamais au-delà de `MAX_PAR_TOUR`. Même graine → même résultat.
 */
export function rattraperDisfluences(tours: TourDisfluence[], langue: StationLanguage, graine: string, taux = TAUX_PAR_DEFAUT): ResultatRattrapage {
  const lex = LEXIQUES[langue] ?? LEXIQUES.en
  const textes = tours.map(t => t.texte)
  const permis = tours.map((t, i) => (t.permis ? i : -1)).filter(i => i >= 0)
  const avecHesitation = (i: number) => compterDisfluences(textes[i], langue) > 0
  const avant = permis.filter(avecHesitation).length
  const cible = Math.round(Math.max(0, Math.min(1, taux)) * permis.length)
  const ajouts: number[] = []
  if (taux <= 0 || avant >= cible) return { textes, ajouts, avant, cible }

  const rand = prng(graine)
  // Ordre de visite tiré au sort (Fisher-Yates), pour que ce ne soient pas toujours les premiers.
  const ordre = permis.filter(i => !avecHesitation(i))
  for (let k = ordre.length - 1; k > 0; k--) { const j = Math.floor(rand() * (k + 1)); [ordre[k], ordre[j]] = [ordre[j], ordre[k]] }

  let manque = cible - avant
  const touches = new Set<number>()
  for (const passe of [true, false]) {          // 1ʳᵉ passe : jamais deux voisins ; 2ᵉ : si vraiment il faut
    for (const i of ordre) {
      if (manque <= 0) break
      if (touches.has(i)) continue
      if (passe && (touches.has(i - 1) || touches.has(i + 1))) continue
      // Les mots trop courts pour hésiter (« Ah ouais ! ») restent tels quels.
      if (textes[i].trim().split(/\s+/).length < 5 && !/[　-鿿]/.test(textes[i])) continue
      const r = rand()
      const manieres: Maniere[] = r < 0.55 ? ['debut', 'virgule', 'repetition']
        : r < 0.85 ? ['virgule', 'debut', 'repetition']
        : ['repetition', 'debut', 'virgule']
      let nouveau: string | null = null
      for (const m of manieres) {
        nouveau = inserer(textes[i], m, lex, rand, langue)
        if (nouveau !== null && compterDisfluences(nouveau, langue) <= MAX_PAR_TOUR) break
        nouveau = null
      }
      if (nouveau === null) continue
      textes[i] = nouveau
      touches.add(i)
      ajouts.push(i)
      manque--
    }
  }
  ajouts.sort((a, b) => a - b)
  return { textes, ajouts, avant, cible }
}

/**
 * PIPER SEULEMENT — « euh… » devient « euh, » pour la voix. Mesuré le 07/10/2026 (WAV synthétisés,
 * jamais joués) : la voix Piper française principale (fr_FR-siwis-medium) NE marque AUCUNE pause sur
 * « … » (« Euh… je pense » : plus long silence interne 0,02 s), alors qu'elle en marque une sur la
 * virgule (« Euh, je pense » : 0,40 s) ; l'anglaise (en_GB-alba) non plus (0,05 s). Le transcript
 * garde « euh… » ; seule la voix Piper reçoit la virgule. Limité aux hésitations : les autres « … »
 * ne changent pas.
 */
const HESITATION_SUSPENDUE = new RegExp(
  `${avant}(euh|heu|hmm+|hum|bah|ben|enfin|uh|um+|erm|well|hmm|eh+|pues|este|bueno|ну|э+(?:-э+)*|эм+|хм+|ehm+|beh|hã+|bom|então)(?:…|\\.\\.\\.)(?=\\s)`,
  'giu',
)

export function pausePiper(texte: string): string {
  return texte.replace(HESITATION_SUSPENDUE, '$1,')
}
