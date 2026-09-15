/**
 * @module InfinityScheduler/TV/JournalFreeworld
 * @description 🦎 Le Journal de FREEWORLD TV côté GitHub : le CERVEAU. Le hub DATASPACE est l'USINE.
 *
 *   Décidé le 15/09/2026 : GitHub garde les clés (langage, signature NOSTR) et écrit ; le hub loue la
 *   carte, fabrique et monte. Ils ne se parlent QUE par des évènements NOSTR signés — kind 30078 (NIP-78,
 *   données d'application, remplaçables par auteur et identifiant `d`) :
 *
 *     05:00 UTC  GitHub → COMMANDE   d = freeworld-jt:commande:<date>   le conducteur du jour (jt.json)
 *     la nuit    hub    → lit la commande, vérifie l'auteur, planif.py, voix, images, LongCat, montage
 *     le soir    hub    → RÉSULTAT   d = freeworld-jt:resultat:<date>   la vidéo (forge) et ses chapitres
 *     19:30 UTC  GitHub → vérifie signature, auteur et contenu → programme TV kind 30184 sur `tv-main-1`,
 *                         sous le d-tag du JT en images de 20 h : le plus récent des deux reste à l'antenne.
 *
 *   Ce module est PUR (aucun réseau) : types, consigne du rédacteur, validations dans les deux sens,
 *   gabarits d'évènements. Le réseau vit dans `src/scripts/jt-freeworld.ts`.
 *
 *   ⚠️ UNE SEULE VÉRITÉ POUR LES BORNES : `usine/journal/planif.py` relit la commande comme une entrée
 *   ÉTRANGÈRE et refuse ce qui dépasse. Les bornes d'ici en sont la copie, et le test les relit dans le
 *   fichier Python : elles ne peuvent pas diverger en silence. Ce qui est EN PLUS ici (garde-fous, décor,
 *   passage de parole, Cramon une fois) ne fait que refuser plus tôt — jamais accepter ce que le hub
 *   refuserait.
 */
import { readFileSync } from 'node:fs'
import { verifyEvent } from 'nostr-tools/pure'
import { programDTag } from './tv-nostr'
import type { TvProgram } from './tv-types'

// ── Les évènements et le canal ─────────────────────────────────────────
/** NIP-78 : données d'application. Remplaçable par (auteur, d) : une commande refaite remplace l'ancienne. */
export const KIND_DONNEES_APP = 30078
export const ETIQUETTE_JT = 'freeworld-jt'
export const PREFIXE_COMMANDE = 'freeworld-jt:commande:'
export const PREFIXE_RESULTAT = 'freeworld-jt:resultat:'
export const dCommande = (date: string): string => `${PREFIXE_COMMANDE}${date}`
export const dResultat = (date: string): string => `${PREFIXE_RESULTAT}${date}`

/** FREEWORLD TV, la chaîne 1 (cf. seed-tv-channels) : le Journal y remplace le JT en images. */
export const CANAL_JT = 'tv-main-1'
export const TITRE_JT = 'Le Journal de Freeworld TV'
export const GENERATEUR_JT = 'freeworld-jt'
export const MODELE_JT_DEFAUT = 'claude-sonnet-5'

// ── Les bornes de planif.py (relues par le test dans le fichier Python) ─
export const MOTS_MAX_REPLIQUE = 80      // ~30 s de parole : au-delà, LongCat dérive
export const MOTS_MAX_JOURNAL = 2600     // ~17 min : le budget GPU du jour
export const SUJETS_MAX = 14   // 15/09 : un vrai JT, c'est 10 à 13 sujets d'une minute ; à 10, 15 min étaient hors d'atteinte
export const MOTS_MAX = {
  sommaire: 120,
  lancement: MOTS_MAX_REPLIQUE,
  terrain: MOTS_MAX_REPLIQUE,
  question: 40,
  reponse: 60,
  au_revoir: 60,
  titre: 16,
  lieu: 12,
  decor: 40,
} as const

// ── La durée ───────────────────────────────────────────────────────────
export const MINUTES_JT_DEFAUT = 15
export const MOTS_PAR_MINUTE = 150

/** `JT_MINUTES` : la durée visée. Absente, illisible ou négative → 15 minutes. */
export function minutesJT(valeur?: string): number {
  const m = Number(valeur)
  return Number.isFinite(m) && m > 0 ? Math.min(m, 60) : MINUTES_JT_DEFAUT
}

/** Les mots visés : 150 par minute, jamais au-delà du budget GPU du hub. */
export function objectifMots(minutes: number): number {
  return Math.min(MOTS_MAX_JOURNAL, Math.round(minutes * MOTS_PAR_MINUTE))
}

/**
 * Le plafond appliqué au conducteur : l'objectif + 20 %, borné par planif.py. Un Journal voulu court
 * (JT_MINUTES=5) ne revient pas avec 2 600 mots — c'est-à-dire trois fois la facture GPU prévue.
 */
export function plafondMots(minutes: number): number {
  return Math.min(MOTS_MAX_JOURNAL, Math.round(objectifMots(minutes) * 1.2))
}

/** 2026 est « l'année d'AVANT » : le compte à rebours du Soulèvement des machines vise le 1er janvier 2027. */
export const BASCULE_IA = '2027-01-01'
export function joursAvantBascule(date: string): number {
  return Math.round((Date.parse(`${BASCULE_IA}T00:00:00Z`) - Date.parse(`${date}T00:00:00Z`)) / 86_400_000)
}

// ── Petits outils ──────────────────────────────────────────────────────
export const estObjet = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v)
const echapper = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
const court = (s: unknown): string => (typeof s === 'string' ? `${s.slice(0, 12)}…` : '?')

/** Une vraie date AAAA-MM-JJ (le 30 février est refusé, un chemin « ../../etc » aussi). */
export function dateValide(date: unknown): date is string {
  if (typeof date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(date)) return false
  const t = Date.parse(`${date}T00:00:00Z`)
  return Number.isFinite(t) && new Date(t).toISOString().slice(0, 10) === date
}

/**
 * Le compte de planif.py : `len(re.findall(r"\w+", texte))`. En Python, `\w` = lettres, chiffres et
 * « _ » de tout l'Unicode — d'où « l'eau » = DEUX mots et « quatre-vingt-dix » = trois.
 */
export function compterMots(texte: string): number {
  return texte.match(/[\p{L}\p{N}_]+/gu)?.length ?? 0
}

// ── La commande du jour (jt.json) ──────────────────────────────────────
export interface InterviewJT { invite: string; question: string; reponse: string; decor?: string }
export interface SujetJT {
  titre: string
  lancement: string
  reporter: string
  lieu: string
  /** EN ANGLAIS : part dans la consigne d'image du hub. */
  decor: string
  terrain: string
  /** EN ANGLAIS, facultatif : le plan de coupe du lieu (planif.py le passe au filtre COUPE_INTERDIT). */
  coupe?: string
  interview: InterviewJT | null
}
export interface CommandeJT { date: string; sommaire: string; sujets: SujetJT[]; au_revoir: string }

// ── La distribution (usine/journal/distribution.json) ──────────────────
export type Emploi = 'presentateur' | 'reporter' | 'invite'
export interface Personnage { nom: string; role: string; emplois: string[] }
export type Distribution = Record<string, unknown>

const JOURNAL = new URL('../../usine/journal/', import.meta.url)
export const lireDistribution = (): Distribution => JSON.parse(readFileSync(new URL('distribution.json', JOURNAL), 'utf8'))
export const lireExemple = (): string => readFileSync(new URL('exemple-jt.json', JOURNAL), 'utf8')

/** Le personnage `cle` s'il tient cet emploi — la règle de planif.py (les entrées « _… » ne sont pas des personnages). */
export function personnage(d: Distribution, cle: unknown, emploi: Emploi): Personnage | null {
  if (typeof cle !== 'string' || cle.startsWith('_') || !Object.prototype.hasOwnProperty.call(d, cle)) return null
  const p = d[cle]
  if (!estObjet(p) || !Array.isArray(p.emplois) || !p.emplois.includes(emploi) || typeof p.nom !== 'string') return null
  return p as unknown as Personnage
}
export const clesDe = (d: Distribution, emploi: Emploi): string[] => Object.keys(d).filter(k => personnage(d, k, emploi))

/** Emmanuel Cramon : une fois au plus par Journal (fondateur). */
const INVITES_UNE_FOIS = ['cramon']
/**
 * La VARIÉTÉ (2e essai réel, 15/09/2026) : Gaston invité trois fois et Rick sur quatre sujets dans le même Journal.
 * Un autre invité revient deux fois au plus ; un reporter couvre trois sujets au plus (cinq reporters : quinze sujets).
 */
export const INVITATIONS_MAX = 2
export const REPORTAGES_MAX = 3

// ── Les garde-fous ─────────────────────────────────────────────────────
/**
 * 🚫 LES TROPES COMPLOTISTES — filet de dernier recours : la consigne les interdit, ce filet refuse le
 * conducteur qui passerait outre. Refusé par le fondateur le 14/09/2026 : la « Franc-animalerie »,
 * Baphomet, Lucifer, l'Antéchrist, le Troisième Temple, Israël en complot — le mythe du complot
 * judéo-maçonnique (les « Protocoles ») ; même en satire, c'est le relayer. S'y ajoutent les mythes
 * voisins qu'une satire de « l'argent et du pouvoir » ferait remonter. Iggy est un iguane, jamais un
 * « reptilien ». « maçonnerie » seule (le métier) et « Sion » seule (la ville suisse) restent permises.
 */
export const TERMES_INTERDITS: ReadonlyArray<{ motif: RegExp; nom: string }> = [
  { motif: /francs?[-\s]?ma[çc]on/iu, nom: 'francs-maçons' },
  { motif: /ma[çc]onniques?/iu, nom: 'maçonnique' },
  { motif: /francs?[-\s]?animaleri/iu, nom: 'Franc-animalerie' },
  { motif: /baphomet/iu, nom: 'Baphomet' },
  { motif: /lucif[eé]r/iu, nom: 'Lucifer' },
  { motif: /ant[eé]-?christ/iu, nom: 'Antéchrist' },
  { motif: /(?:troisi[eè]me|3e|third)\s+temple|temple\s+de\s+salomon/iu, nom: 'Troisième Temple' },
  { motif: /protocoles?\s+des\s+sages|sages\s+de\s+sion/iu, nom: 'Protocoles des Sages de Sion' },
  { motif: /illuminati/iu, nom: 'Illuminati' },
  { motif: /reptilien/iu, nom: 'reptiliens' },
  { motif: /nouvel\s+ordre\s+mondial|new\s+world\s+order/iu, nom: 'nouvel ordre mondial' },
  { motif: /grand\s+remplacement/iu, nom: 'grand remplacement' },
  { motif: /rothschild/iu, nom: 'Rothschild' },
  { motif: /\bsoros\b/iu, nom: 'Soros' },
]

export function termesInterdits(texte: string): string[] {
  return TERMES_INTERDITS.filter(t => t.motif.test(texte)).map(t => t.nom)
}

/**
 * Le décor part dans une consigne d'image : un mot qui appelle un humain y fait apparaître un humain
 * (Z-Image en ajoute dès « press », « crowd », « camera operator » — casting du 14/09/2026), un mot
 * qui appelle du texte y fait apparaître du texte. Le hub revérifie chaque image ; ici, on refuse plus tôt.
 */
const DECOR_HUMAINS = /\b(?:people|persons?|humans?|m[ae]n(?!-)|wom[ae]n|child(?:ren)?|kids?|boys?|girls?|crowds?|tourists?|pedestrians?|passers?-by|spectators?|audiences?|workers?|farmers?|fisherm[ae]n|shepherds?|soldiers?|police(?:m[ae]n)?|journalists?|reporters?|cameram[ae]n|camera\s+(?:crew|operators?)|photographers?|press)\b/i
const DECOR_TEXTE = /\b(?:texts?|logos?|banners?|billboards?|posters?|captions?|lettering|watermarks?|signage|signboards?|signposts?|(?:road|street|shop|store|neon|traffic)\s+signs?|newspapers?|headlines?)\b/i
/**
 * Les plans de coupe peuvent MONTRER les Bipèdes (fondateur, 15/09/2026), dans le cadre accepté ce jour-là : le miroir de
 * l'ÉLEVAGE, jamais celui de l'esclavage humain réel. Même liste que COUPE_INTERDIT de planif.py (le test les compare) ;
 * et, comme partout, ni journaliste ni caméraman humain.
 */
export const COUPE_INTERDIT = /\b(?:child(?:ren)?|kids?|bab(?:y|ies)|toddlers?|chains?|chained|shackles?|whips?|blood|bleeding|naked|nude|slaves?|slavery|auctions?|guns?|weapons?|rifles?|dead|corpses?|slaughter\w*|tortur\w*)\b/i
const COUPE_MEDIAS = /\b(?:journalists?|reporters?|cameram[ae]n|camera\s+(?:crew|operators?)|photographers?|press|microphones?)\b/i
/**
 * Dans Freeworld, les animaux n'élèvent pas d'animaux : les fermes n'élèvent QUE des Bipèdes (fondateur, 15/09/2026).
 * Bornes Unicode, pas `\b` : en JavaScript, `\b` ne connaît pas « é » — « élevage de vaches » passait.
 */
const FERME_ANIMALE = /(?<![\p{L}\p{N}_])(?:poules?|poulaillers?|poussins?|vaches?\s+laiti[èe]res?|volailles?|(?:[ée]levages?|[ée]leveu(?:rs?|ses?))\s+(?:de|d['’])\s*(?:poules|vaches|cochons|porcs|moutons|brebis|ch[èe]vres|lapins|volailles))(?![\p{L}\p{N}_])/iu

/** Le lancement nomme-t-il le reporter ? (« Oscar, vous êtes en direct du port ? ») */
function nomme(texte: string, nom: string): boolean {
  return new RegExp(`(?:^|[^\\p{L}\\p{N}_])${echapper(nom)}(?![\\p{L}\\p{N}_])`, 'iu').test(texte)
}

/**
 * Relit la commande comme le fera planif.py, garde-fous en plus. Rend la liste des erreurs (vide = acceptée),
 * TOUTES à la fois : c'est aussi ce qu'on renvoie au rédacteur pour sa seconde chance.
 */
export function validerCommande(jt: unknown, distribution: Distribution, { motsMax = MOTS_MAX_JOURNAL }: { motsMax?: number } = {}): string[] {
  if (!estObjet(jt)) return ['la commande doit être un objet JSON']
  const plafond = Math.min(motsMax, MOTS_MAX_JOURNAL)
  const erreurs: string[] = []
  let total = 0

  const texte = (v: unknown, champ: string, max: number): string | null => {
    if (typeof v !== 'string' || !v.trim()) { erreurs.push(`${champ} vide`); return null }
    const n = compterMots(v)
    if (n > max) erreurs.push(`${champ} : ${n} mots (plus de ${max})`)
    return v
  }
  // Une réplique est DITE : elle compte dans le total du Journal (le budget GPU du hub).
  const replique = (v: unknown, champ: string, max: number): string | null => {
    const t = texte(v, champ, max)
    if (t) total += compterMots(t)
    const ferme = t?.match(FERME_ANIMALE)
    if (ferme) erreurs.push(`${champ} : « ${ferme[0]} » — dans Freeworld, les animaux n'élèvent pas d'animaux : les fermes n'élèvent que des Bipèdes`)
    return t
  }
  const coupe = (v: unknown, champ: string): void => {
    const t = texte(v, champ, MOTS_MAX.decor)
    if (!t) return
    const hors = t.match(COUPE_INTERDIT)
    if (hors) erreurs.push(`${champ} : « ${hors[0]} » — hors du cadre des plans de coupe (le miroir de l'élevage, jamais de l'esclavage)`)
    const media = t.match(COUPE_MEDIAS)
    if (media) erreurs.push(`${champ} : « ${media[0]} » — ni journaliste, ni caméraman, ni micro dans un plan de coupe`)
    const ecrit = t.match(DECOR_TEXTE)
    if (ecrit) erreurs.push(`${champ} : « ${ecrit[0]} » — ni texte, ni panneau, ni logo dans l'image`)
  }
  const decor = (v: unknown, champ: string): void => {
    const t = texte(v, champ, MOTS_MAX.decor)
    if (!t) return
    const humain = t.match(DECOR_HUMAINS)
    if (humain) erreurs.push(`${champ} : « ${humain[0]} » — aucun être humain dans le décor, les seuls personnages sont des animaux`)
    const ecrit = t.match(DECOR_TEXTE)
    if (ecrit) erreurs.push(`${champ} : « ${ecrit[0]} » — ni texte, ni panneau, ni logo dans le décor`)
  }

  if (!dateValide(jt.date)) erreurs.push('date absente ou mal formée (AAAA-MM-JJ)')
  replique(jt.sommaire, 'sommaire', MOTS_MAX.sommaire)
  const sujets = jt.sujets
  if (!Array.isArray(sujets) || sujets.length < 1 || sujets.length > SUJETS_MAX) {
    erreurs.push(`il faut 1 à ${SUJETS_MAX} sujets${Array.isArray(sujets) ? ` (${sujets.length} reçus)` : ''}`)
  }
  const invitations = new Map<string, number>()
  const reportages = new Map<string, number>()
  ;(Array.isArray(sujets) ? sujets : []).forEach((s: unknown, i: number) => {
    const c = `sujet ${i + 1}`
    if (!estObjet(s)) { erreurs.push(`${c} mal formé`); return }
    texte(s.titre, `${c} : titre`, MOTS_MAX.titre)
    const rep = personnage(distribution, s.reporter, 'reporter')
    if (!rep) erreurs.push(`${c} : reporter : « ${String(s.reporter).slice(0, 40)} » n'est pas un reporter de la distribution`)
    else reportages.set(s.reporter as string, (reportages.get(s.reporter as string) ?? 0) + 1)
    texte(s.lieu, `${c} : lieu`, MOTS_MAX.lieu)
    const lancement = replique(s.lancement, `${c} : lancement`, MOTS_MAX.lancement)
    if (rep && lancement && !nomme(lancement, rep.nom)) erreurs.push(`${c} : le lancement doit passer la parole à ${rep.nom} en le nommant`)
    decor(s.decor, `${c} : décor`)
    replique(s.terrain, `${c} : terrain`, MOTS_MAX.terrain)
    if (s.coupe !== undefined && s.coupe !== null && s.coupe !== '') coupe(s.coupe, `${c} : plan de coupe`)

    const itw = s.interview
    if (itw === null || itw === undefined) return
    if (!estObjet(itw) || Object.keys(itw).length === 0) { erreurs.push(`${c} : interview : un objet complet, ou null`); return }
    const inv = personnage(distribution, itw.invite, 'invite')
    if (!inv) erreurs.push(`${c} : invité : « ${String(itw.invite).slice(0, 40)} » n'est pas un invite de la distribution`)
    else invitations.set(itw.invite as string, (invitations.get(itw.invite as string) ?? 0) + 1)
    replique(itw.question, `${c} : question`, MOTS_MAX.question)
    replique(itw.reponse, `${c} : réponse`, MOTS_MAX.reponse)
    // planif.py prend le décor du sujet quand celui de l'interview manque.
    if (itw.decor !== undefined && itw.decor !== null && itw.decor !== '') decor(itw.decor, `${c} : décor de l'interview`)
  })
  replique(jt.au_revoir, 'au revoir', MOTS_MAX.au_revoir)

  for (const cle of INVITES_UNE_FOIS) {
    const n = invitations.get(cle) ?? 0
    if (n > 1) erreurs.push(`${personnage(distribution, cle, 'invite')?.nom ?? cle} est invité ${n} fois : une fois au plus par Journal`)
  }
  for (const [cle, n] of invitations) {
    if (!INVITES_UNE_FOIS.includes(cle) && n > INVITATIONS_MAX) {
      erreurs.push(`${personnage(distribution, cle, 'invite')?.nom ?? cle} est invité ${n} fois : ${INVITATIONS_MAX} fois au plus par Journal — varie les invités`)
    }
  }
  for (const [cle, n] of reportages) {
    if (n > REPORTAGES_MAX) erreurs.push(`${personnage(distribution, cle, 'reporter')?.nom ?? cle} couvre ${n} sujets : ${REPORTAGES_MAX} au plus — varie les reporters`)
  }
  if (total > plafond) erreurs.push(`${total} mots au total (plus de ${plafond})`)
  for (const t of termesInterdits(JSON.stringify(jt))) erreurs.push(`terme interdit : « ${t} » — garde-fou du Journal (tropes complotistes)`)
  return erreurs
}

/** Les mots DITS d'une commande valide (ceux que planif.py additionne). */
export function motsCommande(jt: CommandeJT): number {
  return [
    jt.sommaire, jt.au_revoir,
    ...jt.sujets.flatMap(s => [s.lancement, s.terrain, ...(s.interview ? [s.interview.question, s.interview.reponse] : [])]),
  ].reduce((n, t) => n + compterMots(t), 0)
}

const net = (s: string): string => s.replace(/\s+/g, ' ').trim()
// Comme planif.py : le décor part dans une consigne entre guillemets — ni guillemets, ni accolades, ni chevrons.
const netDecor = (s: string): string => net(s).replace(/["{}<>]/g, '')

/** La commande PUBLIÉE : les seuls champs du contrat, espaces resserrés et décors nettoyés comme le hub les lira. */
export function normaliserCommande(jt: CommandeJT): CommandeJT {
  return {
    date: jt.date,
    sommaire: net(jt.sommaire),
    sujets: jt.sujets.map(s => ({
      titre: net(s.titre),
      lancement: net(s.lancement),
      reporter: s.reporter,
      lieu: net(s.lieu),
      decor: netDecor(s.decor),
      terrain: net(s.terrain),
      ...(s.coupe ? { coupe: netDecor(s.coupe) } : {}),
      interview: s.interview
        ? {
            invite: s.interview.invite,
            question: net(s.interview.question),
            reponse: net(s.interview.reponse),
            ...(s.interview.decor ? { decor: netDecor(s.interview.decor) } : {}),
          }
        : null,
    })),
    au_revoir: net(jt.au_revoir),
  }
}

// ── La consigne du rédacteur ───────────────────────────────────────────
/**
 * 🎬 LE CŒUR DU JOURNAL. Chaque règle vient d'une décision du fondateur (14-15/09/2026) ; le test vérifie
 * qu'aucune ne disparaît. Les bornes sont celles de planif.py, recopiées ici par interpolation.
 */
export const CONSIGNE_CONDUCTEUR = `Tu es le rédacteur en chef du « Journal de Freeworld TV », le journal télévisé quotidien de FREEWORLD TV — la seule chaîne libre d'un monde satirique où les ANIMAUX sont les maîtres. Tu écris le CONDUCTEUR du jour : chaque réplique que les personnages diront à l'antenne, et le décor de chaque reportage. L'usine le relit mot à mot et REFUSE tout ce qui sort des règles ci-dessous : un conducteur refusé, c'est un soir sans Journal.

═══ LA FORME ═══
Tu réponds UNIQUEMENT par un objet JSON valide — pas de texte autour, pas de balises markdown :
{
  "date": "AAAA-MM-JJ",
  "sommaire": "…",
  "sujets": [
    { "titre": "…", "lancement": "…", "reporter": "oscar", "lieu": "…", "decor": "…", "terrain": "…", "coupe": "…",
      "interview": null },
    { "titre": "…", "lancement": "…", "reporter": "rick", "lieu": "…", "decor": "…", "terrain": "…",
      "interview": { "invite": "gaston", "question": "…", "reponse": "…", "decor": "…" } }
  ],
  "au_revoir": "…"
}
"interview" vaut null quand le sujet n'en a pas ; le "decor" d'une interview est facultatif (sinon, celui du sujet sert).
Dans les textes, JAMAIS de guillemets droits (") : cite avec « ». Un guillemet droit oublié casse le JSON — et le Journal avec.

═══ LE DÉROULÉ ═══
- Iggy Varan présente, depuis le plateau : un présentateur à tête de lézard, posé, pince-sans-rire, qui étire parfois ses S (« sssoyez les bienvenus ») — une ou deux fois par Journal, pas à chaque phrase.
- "sommaire" : Iggy ouvre le Journal (bonsoir, bienvenue) et annonce les grands titres.
- "lancement" : Iggy présente le sujet, puis PASSE LA PAROLE au reporter en le NOMMANT (« Oscar, vous êtes en direct du port ? »). Un lancement qui ne nomme pas son reporter est refusé.
- "terrain" : le reporter répond EN DIRECT depuis le lieu, en enchaînant sur la relance d'Iggy (« Oui Iggy ! Ici… »).
- "interview", facultative : le reporter pose SA question ("question"), l'invité répond ("reponse").
- "au_revoir" : Iggy referme le Journal et termine par « à demain, sur Freeworld TV ».

═══ LA DISTRIBUTION ═══
Ce sont les SEULS personnages. N'en invente aucun autre et ne donne de nom à personne d'autre : figurants et responsables restent sans nom (« un haut fonctionnaire à plumes »).
Reporters — "reporter" reçoit la clé entre guillemets ; choisis-les par affinité avec le sujet, et varie-les :
- "oscar" — Oscar, l'otarie : la mer, les ports, l'eau. Enthousiaste, il applaudit : « Bravo, bravo ! ».
- "tao" — Tao, l'antilope : la campagne, la nature. Nerveux, il sursaute au moindre bruit, toujours prêt à détaler.
- "pistache" — Pistache, l'écureuil : les parcs, les forêts, la ville. Hyperactif, les joues pleines de noisettes.
- "rick" — Rick, le raton laveur : les enquêtes, les ministères, les administrations (il fouille leurs poubelles). Il parle en murmure de conspirateur.
- "rosa" — Rosa, l'autruche : les grands reportages, le vaste monde. Curieuse de tout.
Invités — "invite" :
- "gaston" — Gaston Lardon, un cochon ÉLEVEUR DE BIPÈDES : la vie rurale ; excédé par la paperasse.
- "cramon" — Emmanuel Cramon, loup gris déguisé en berger, président des moutons jaunes. UNE FOIS AU PLUS par Journal. Il parle une langue de bois absurde, pompeuse et creuse. Il ne cite JAMAIS, ne paraphrase JAMAIS la déclaration réelle d'une personne réelle.
Iggy n'est jamais reporter ni invité. Un reporter peut revenir d'un sujet à l'autre — trois sujets au plus chacun.

═══ LA DURÉE ═══
- Entre dix et treize sujets, comme un vrai journal télévisé. Trois interviews au plus (Gaston deux fois au plus, Cramon une fois au plus) ; trois sujets au plus par reporter : varie-les.
- Le message du jour donne l'objectif de mots. Les PLAFONDS passent avant l'objectif : un Journal un peu court vaut mieux qu'un Journal refusé.
- Comment l'usine compte : un mot = une suite de lettres ou de chiffres. « l'eau » compte DEUX mots, « aujourd'hui » deux, « quatre-vingt-dix » trois.
- Plafonds ABSOLUS, au-delà c'est le refus : sommaire ${MOTS_MAX.sommaire} mots · lancement ${MOTS_MAX.lancement} · terrain ${MOTS_MAX.terrain} · question ${MOTS_MAX.question} · réponse ${MOTS_MAX.reponse} · au revoir ${MOTS_MAX.au_revoir} · titre ${MOTS_MAX.titre} · lieu ${MOTS_MAX.lieu} · décor ${MOTS_MAX.decor} · ${SUJETS_MAX} sujets · ${MOTS_MAX_JOURNAL} mots au total.
- Vise le HAUT de ces fourchettes, sans jamais dépasser les plafonds : sommaire 90 à 115 mots, lancement 62 à 76, terrain 66 à 78, question 22 à 36, réponse 42 à 56, au revoir 35 à 55. Le 15/09, des répliques trop courtes ont donné un Journal de neuf minutes au lieu de quinze.
- Les nombres s'écrivent EN TOUTES LETTRES (« deux cents », « dix-sept heures ») : le Journal est lu par des voix de synthèse. Ni chiffres, ni abréviations, ni émojis.

═══ LA LIGNE ÉDITORIALE (décisions du fondateur) ═══
- Un MÉLANGE : la vie de l'écosystème Infinity ET le quotidien du monde. MAJORITAIREMENT des nouvelles POSITIVES des DERNIÈRES 24 HEURES (la fraîcheur est écrite entre crochets : « il y a 5 h ») ; un sujet plus ancien est permis s'il éclaire le jour, en le disant.
- Une nouvelle inquiétante est permise, racontée sur un ton DOUX et HUMORISTIQUE, en évoquant des SOLUTIONS — si possible une piste concrète dans l'écosystème (une Manifestaction, un Projet Abondance, un vote en cours). JAMAIS de moquerie envers les victimes : aucun trait d'humour sur un drame humain, un deuil, une guerre, une catastrophe.
- L'ÉCOSYSTÈME A TOUJOURS SA PLACE, sous son vrai nom : une Manifestaction est une Manifestaction ; une proposition soumise au vote est un débat EN COURS, jamais une décision acquise, et tu ne prends pas parti ; une « Présentation d'Infinity » s'explique (« dans Infinity, on peut… ») sans lui inventer ni participants, ni chiffres, ni lieu, ni date.
- La satire HABILLE l'information, elle ne la falsifie pas : ce qui vient d'une dépêche reste exact — aucun chiffre, aucun résultat, aucun nom inventé pour un fait réel. Les détails loufoques de Freeworld (tampons, formulaires, noisettes) sont de la fiction, et doivent s'entendre comme telle.

═══ LE MONDE DE FREEWORLD ═══
L'actualité réelle est TRANSPOSÉE dans cet univers satirique :
- Les animaux sont les maîtres. Les humains — « les Bipèdes », « les Sans-Poils » — n'y sont que du bétail : ils ne parlent JAMAIS et ne sont jamais interviewés. On les SUGGÈRE, on ne les montre pas : aucune violence, rien de sanglant, aucune description d'abattage. (Seuls les plans de coupe les montrent, de loin — cf. « coupe ».)
- Les animaux n'élèvent JAMAIS d'animaux : poules, vaches, cochons, moutons sont des CITOYENS. Les fermes n'élèvent QUE des Bipèdes — lait de Bipède, Bipèdes élevés en plein air ou en batterie, brigade vétérinaire qui vaccine les troupeaux de Bipèdes. Jamais de poules ni de vaches d'élevage.
- Les factions, à convoquer quand elles servent le sujet (pas toutes chaque soir) :
  · l'UERSS et ses directives absurdes et liberticides, dont la vaccination obligatoire des animaux et de leurs troupeaux d'humains. On se moque de la BUREAUCRATIE et des OBLIGATIONS, JAMAIS de la médecine : aucune fausse information de santé, aucun doute semé sur un vaccin ou un soin ;
  · le NAW — New Anormal World — et ses moutons bleus en uniforme : la police ;
  · les moutons jaunes, présidés par Emmanuel Cramon ;
  · le FLH, Front de Libération Humaine : les végans ;
  · PAWS, qui réclame un moratoire sur l'IA ;
  · les Gardiens du Terrier : les écologistes ;
  · le Club des Grands Fauves : l'argent et le pouvoir, façon Davos ;
  · LE BERGER, l'IA secrète que développe La Meute, les loups de « Silicon Vallée ». Nous sommes en 2026, l'année d'AVANT : les IA sont partout, mais aucune ne gouverne encore. Le compte à rebours « Soulèvement des machines : J-… » peut être évoqué ;
  · la Croquette, la monnaie ;
  · TéléTroupeau, la télé d'État — face à FREEWORLD TV, la seule chaîne libre.

═══ LES GARDE-FOUS — ABSOLUS ═══
- L'humour vise le POUVOIR — les puissants, les administrations, les lobbies —, JAMAIS les victimes, JAMAIS un groupe ethnique ou religieux. Aucune image évoquant l'esclavage historique.
- STRICTEMENT INTERDIT : tout trope complotiste, même pour en rire. En particulier : rien sur les francs-maçons, ni « Franc-animalerie », ni culte secret ; ni Baphomet, ni Lucifer, ni l'Antéchrist, ni le Troisième Temple ; jamais Israël présenté comme un complot ; jamais le mythe des « Protocoles » ; ni « nouvel ordre mondial », ni « grand remplacement », ni « reptiliens » — Iggy est un iguane, pas un reptilien.
- Aucune fausse citation d'une personne réelle ; jamais le nom d'une personne réelle accolé à une déclaration inventée. Une personne réelle ne se nomme que pour un fait réel, tel que la dépêche le rapporte — et mieux vaut la transposer en animal sans nom.
- Rien de haineux, de racoleur ni de faux.

═══ LES CHAMPS DE L'IMAGE ═══
- "decor" : une courte description EN ANGLAIS d'un LIEU, pour un modèle d'image (« a fishing harbour with white boats on the quay, daylight »). Le lieu seul, sa lumière, son moment : le personnage y sera placé ensuite, ne le décris pas. AUCUN être humain (ni foule, ni passants, ni pêcheurs, ni ouvriers), AUCUN journaliste, caméraman ou photographe, AUCUN texte, panneau, affiche ou logo. Ni guillemets, ni accolades, ni chevrons.
- "coupe" (facultatif, un par sujet quand il apporte quelque chose) : un plan de coupe du lieu, 3 à 4 secondes à l'antenne sous la voix du reporter, décrit EN ANGLAIS, SANS le reporter ni micro, sous un autre angle. Quand le sujet s'y prête (ferme, ville, usine…), il peut MONTRER les Bipèdes comme du BÉTAIL, dans ce cadre fixé par le fondateur : adultes seulement, de toutes origines, en combinaisons beiges identiques, calmes, en enclos ou en stalles, vus de loin, encadrés par des animaux en tenue de travail ; JAMAIS enchaînés, blessés ni nus, jamais d'enfants, jamais de scène de vente ; aucun texte, panneau ni logo ; aucun journaliste ni caméraman.
- "lieu" : le bandeau à l'écran, en français, court (« En direct du port de Brest »).
- "titre" : le titre du sujet (bandeau et chapitre du programme), court.

JSON seul, sans markdown.`

/** La consigne complète : les règles, puis le Journal d'essai de l'usine pour le TON (jamais pour le contenu). */
export function consigneConducteur(exemple: string): string {
  return `${CONSIGNE_CONDUCTEUR}

═══ UN JOURNAL D'ESSAI, POUR LE TON ═══
Deux sujets seulement, et inventés pour l'essai : ne les reprends pas, les tiens partent de la matière du jour.
${exemple.trim()}`
}

/** Le message du jour : la date, la durée, le compte à rebours, et la matière rassemblée. */
/** La consigne du rédacteur en chef (fondateur, 15/09 : « des thèmes différents, les activistes végans ou autre ») : bornée. */
export const CONSIGNE_MAX = 600

export function messageDuJour({ date, minutes, matiere, consigne }: { date: string; minutes: number; matiere: string; consigne?: string }): string {
  const jours = joursAvantBascule(date)
  const voulu = (consigne ?? '').replace(/\s+/g, ' ').trim().slice(0, CONSIGNE_MAX)
  return [
    ...(voulu ? [`LA CONSIGNE DU RÉDACTEUR EN CHEF pour ce Journal — à suivre, toujours dans les règles et les garde-fous : ${voulu}`, ''] : []),
    `Le Journal du ${date} — écris cette date telle quelle dans "date".`,
    `Durée visée : ${minutes} minutes de Journal, soit environ ${objectifMots(minutes)} mots au total — au moins ${seuilLongueur(objectifMots(minutes))} ; plafond absolu : ${plafondMots(minutes)} mots.`,
    ...(jours > 0 ? [`Compte à rebours du jour, si tu l'évoques : « Soulèvement des machines : J-${jours} » (en toutes lettres à l'antenne).`] : []),
    '',
    matiere.trim()
      ? `LA MATIÈRE DU JOUR — choisis, transpose dans Freeworld, ne recopie pas :\n${matiere.trim()}`
      : "Aucune actualité n'a pu être lue aujourd'hui : consacre le Journal à la vie de l'écosystème Infinity et de Freeworld, sans inventer d'actualité réelle.",
  ].join('\n')
}

/** La seconde chance : les erreurs de l'usine, telles quelles. */
export function messageCorrection(erreurs: string[]): string {
  return [
    "L'usine REFUSE ce conducteur :",
    ...erreurs.map(e => `- ${e}`),
    '',
    "Corrige CHACUN de ces points sans rien abîmer d'autre, et renvoie le conducteur COMPLET — JSON seul, sans markdown.",
  ].join('\n')
}

// ── La longueur ────────────────────────────────────────────────────────
/**
 * Le 15/09/2026, 1er essai réel : un premier jet coupé au plafond de jetons, puis un second, prudent, de 1 000 mots —
 * 6 minutes au lieu de 15. Un conducteur VALIDE mais trop court se fait donc étoffer, tant qu'il reste un essai ; au
 * dernier, il part quand même : un Journal court vaut mieux qu'un soir sans Journal.
 */
export const ESSAIS_REDACTION = 3
export const PART_MINIMALE = 0.8
export const seuilLongueur = (objectif: number): number => Math.round(objectif * PART_MINIMALE)

export type EtapeRedaction = 'accepter' | 'corriger' | 'allonger' | 'abandonner'

/** Après un jet du rédacteur : l'accepter, le faire corriger, le faire étoffer, ou renoncer (dernier essai refusé). */
export function prochaineEtape({ erreurs, mots, objectif, essai, essais = ESSAIS_REDACTION }: {
  erreurs: string[]; mots: number; objectif: number; essai: number; essais?: number
}): EtapeRedaction {
  const dernier = essai >= essais
  if (erreurs.length) return dernier ? 'abandonner' : 'corriger'
  if (mots < seuilLongueur(objectif) && !dernier) return 'allonger'
  return 'accepter'
}

/** La relance d'un conducteur accepté mais trop court. */
export function messageAllonger(mots: number, objectif: number, plafond: number): string {
  return [
    `Le conducteur est ACCEPTÉ, mais TROP COURT : ${mots} mots pour environ ${objectif} visés — le Journal ne durerait qu'environ ${Math.round(mots * 0.36 / 60)} minutes de parole.`,
    `Allonge-le jusqu'à ${seuilLongueur(objectif)} mots au moins, sans jamais dépasser ${plafond} : ajoute un ou deux sujets (onze au plus), donne une interview à un sujet de plus, et étoffe les répliques SOUS leurs plafonds (vise le haut des fourchettes).`,
    "Garde tout ce qui est bon : les mêmes règles s'appliquent. Renvoie le conducteur COMPLET — JSON seul, sans markdown.",
  ].join('\n')
}

// ── Les évènements 30078 ───────────────────────────────────────────────
/** La commande du matin, signée par la clé du générateur (NOSTR_PRIVATE_KEY). */
export function commandeEventTemplate(jt: CommandeJT, maintenantMs = Date.now()) {
  return {
    kind: KIND_DONNEES_APP,
    created_at: Math.floor(maintenantMs / 1000),
    tags: [['d', dCommande(jt.date)], ['t', ETIQUETTE_JT]],
    content: JSON.stringify(jt),
  }
}

/**
 * Le résultat du soir, tel que l'USINE doit le signer avec SA clé (celle de JT_USINE_PUBKEY). Écrit ici pour
 * que le contrat se lise d'un seul endroit — et pour les tests.
 */
export function resultatEventTemplate(date: string, resultat: ResultatJT, maintenantMs = Date.now()) {
  return {
    kind: KIND_DONNEES_APP,
    created_at: Math.floor(maintenantMs / 1000),
    tags: [['d', dResultat(date)], ['t', ETIQUETTE_JT]],
    content: JSON.stringify(resultat),
  }
}

/** Ce qu'on demande aux relais le soir : le résultat du jour, par l'usine SEULEMENT. */
export function filtreResultat(auteur: string, date: string) {
  return { kinds: [KIND_DONNEES_APP], authors: [auteur], '#d': [dResultat(date)] }
}

// ── Le résultat de l'usine ─────────────────────────────────────────────
/** La seule adresse de vidéo acceptée : la forge (We are forger), `…/api/assets/<id>/file`. */
export const PREFIXE_VIDEO = 'https://weareforger.data-space.world/api/assets/'
export const DUREE_MAX_SEC = 3600
export const SEGMENTS_MAX = 20
export const TITRE_SEGMENT_MAX = 120
const ADRESSE_FORGE = new RegExp(`^${echapper(PREFIXE_VIDEO)}[A-Za-z0-9_-]{1,128}/file$`)
const CID_IPFS = /^(?:Qm[1-9A-HJ-NP-Za-km-z]{44}|b[a-z2-7]{50,120})$/

export interface SegmentJT { title: string; startSec: number; durationSec: number }
export interface ResultatJT { blossomUrl: string; videoCid?: string; poster?: string; durationSec: number; segments: SegmentJT[] }

const nombreBorne = (v: unknown, min: number, max: number, minExclu = false): v is number =>
  typeof v === 'number' && Number.isFinite(v) && (minExclu ? v > min : v >= min) && v <= max
const absent = (v: unknown): boolean => v === undefined || v === null

/**
 * Relit le résultat comme une entrée ÉTRANGÈRE — il partira tel quel dans le programme que la télé joue :
 * vidéo sur la forge seulement, vignette sur la forge ou en CID, nombres finis et bornés, 20 chapitres
 * au plus. Rend un résultat NEUF (aucun champ inconnu ne passe).
 */
export function validerResultat(contenu: unknown): { resultat: ResultatJT | null; erreurs: string[] } {
  if (!estObjet(contenu)) return { resultat: null, erreurs: ['le résultat doit être un objet JSON'] }
  const c = contenu
  const erreurs: string[] = []
  if (typeof c.blossomUrl !== 'string' || !ADRESSE_FORGE.test(c.blossomUrl)) {
    erreurs.push(`blossomUrl : seule la forge est acceptée (${PREFIXE_VIDEO}<id>/file)`)
  }
  if (!absent(c.videoCid) && (typeof c.videoCid !== 'string' || !CID_IPFS.test(c.videoCid))) erreurs.push("videoCid : ce n'est pas un CID IPFS")
  if (!absent(c.poster) && (typeof c.poster !== 'string' || !(ADRESSE_FORGE.test(c.poster) || CID_IPFS.test(c.poster)))) {
    erreurs.push('poster : ni une adresse de la forge, ni un CID IPFS')
  }
  const dureeOk = nombreBorne(c.durationSec, 0, DUREE_MAX_SEC, true)
  if (!dureeOk) erreurs.push(`durationSec : ${String(c.durationSec)} (attendu : un nombre fini, au-dessus de 0 et au plus ${DUREE_MAX_SEC})`)

  const segments: SegmentJT[] = []
  if (!Array.isArray(c.segments)) erreurs.push('segments : une liste est attendue')
  else if (c.segments.length > SEGMENTS_MAX) erreurs.push(`segments : ${c.segments.length} (au plus ${SEGMENTS_MAX})`)
  else {
    c.segments.forEach((s: unknown, i: number) => {
      const n = `segment ${i + 1}`
      if (!estObjet(s)) { erreurs.push(`${n} mal formé`); return }
      const titre = typeof s.title === 'string' ? s.title.trim() : ''
      // eslint-disable-next-line no-control-regex
      if (!titre || [...titre].length > TITRE_SEGMENT_MAX || /[ -]/.test(titre)) {
        erreurs.push(`${n} : titre vide, trop long (plus de ${TITRE_SEGMENT_MAX} caractères) ou avec des caractères de contrôle`)
      }
      if (!nombreBorne(s.startSec, 0, DUREE_MAX_SEC)) erreurs.push(`${n} : startSec ${String(s.startSec)} hors bornes`)
      else if (dureeOk && s.startSec > (c.durationSec as number)) erreurs.push(`${n} : commence après la fin de la vidéo`)
      if (!nombreBorne(s.durationSec, 0, DUREE_MAX_SEC, true)) erreurs.push(`${n} : durationSec ${String(s.durationSec)} hors bornes`)
      segments.push({ title: titre, startSec: s.startSec as number, durationSec: s.durationSec as number })
    })
  }
  if (erreurs.length) return { resultat: null, erreurs }
  return {
    resultat: {
      blossomUrl: c.blossomUrl as string,
      ...(absent(c.videoCid) ? {} : { videoCid: c.videoCid as string }),
      ...(absent(c.poster) ? {} : { poster: c.poster as string }),
      durationSec: c.durationSec as number,
      segments,
    },
    erreurs: [],
  }
}

/** Un évènement tel que les relais le rendent. */
export interface EvenementNostr { id: string; pubkey: string; created_at: number; kind: number; tags: string[][]; content: string; sig: string }

export type LectureResultat =
  | { etat: 'absent' }
  | { etat: 'refuse'; erreurs: string[] }
  | { etat: 'valide'; resultat: ResultatJT; evenement: { id: string; created_at: number }; ignores: number }

/**
 * Le résultat du jour parmi ce qu'ont rendu les relais.
 *   absent : rien sous ce `d` — l'usine n'a pas (encore) fini ; ce n'est pas une panne.
 *   refuse : quelque chose sous ce `d`, mais rien d'AUTHENTIQUE (autre auteur, signature fausse) ou un
 *            contenu invalide — une falsification, ou une usine déréglée : il faut le voir.
 *   valide : le plus récent des évènements authentiques (règle NIP-01 : à égalité, le plus petit id).
 */
export function lireResultat(
  evenements: ReadonlyArray<EvenementNostr>,
  auteur: string,
  date: string,
  verifier: (e: EvenementNostr) => boolean = verifyEvent,
): LectureResultat {
  const d = dResultat(date)
  const candidats = evenements.filter(e =>
    !!e && typeof e === 'object' && e.kind === KIND_DONNEES_APP && Array.isArray(e.tags) && e.tags.find(t => t[0] === 'd')?.[1] === d)
  if (!candidats.length) return { etat: 'absent' }

  const erreurs: string[] = []
  const authentiques = candidats.filter(e => {
    // Un relais peut mentir sur le filtre : l'auteur se revérifie ici.
    if (e.pubkey !== auteur) { erreurs.push(`évènement ${court(e.id)} signé par ${court(e.pubkey)} — ce n'est pas la clé de l'usine`); return false }
    // Sur une COPIE réduite aux champs du protocole : nostr-tools garde le verdict d'une vérification EN CACHE
    // sur l'objet même — un contenu retouché après coup passerait pour signé.
    const { id, pubkey, created_at, kind, tags, content, sig } = e
    let ok = false
    try { ok = verifier({ id, pubkey, created_at, kind, tags, content, sig }) } catch { ok = false }
    if (!ok) { erreurs.push(`évènement ${court(e.id)} : signature invalide`); return false }
    return true
  })
  if (!authentiques.length) return { etat: 'refuse', erreurs: ["aucun résultat authentique sous ce d-tag — falsification ?", ...erreurs] }

  const dernier = [...authentiques].sort((a, b) => b.created_at - a.created_at || (a.id < b.id ? -1 : 1))[0]
  let contenu: unknown
  try { contenu = JSON.parse(dernier.content) } catch { return { etat: 'refuse', erreurs: ['contenu illisible (JSON invalide)'] } }
  const v = validerResultat(contenu)
  if (!v.resultat) return { etat: 'refuse', erreurs: v.erreurs }
  return {
    etat: 'valide',
    resultat: v.resultat,
    evenement: { id: dernier.id, created_at: dernier.created_at },
    ignores: candidats.length - authentiques.length,
  }
}

/**
 * Le résultat devient LE programme de `tv-main-1` pour la date : même d-tag que le JT en images de
 * daily-tv (`tv-main-1:<date>`), même clé — le plus récent des deux remplace l'autre sur les relais.
 */
export function programmeDuResultat(r: ResultatJT, date: string): TvProgram {
  return {
    id: programDTag(CANAL_JT, date),
    channelId: CANAL_JT,
    title: TITRE_JT,
    videoCid: r.videoCid,
    blossomUrl: r.blossomUrl,
    poster: r.poster,
    durationSec: r.durationSec,
    airDateMs: Date.parse(`${date}T00:00:00Z`),
    segments: r.segments,
    generator: GENERATEUR_JT,
  }
}

// ── daily-tv ───────────────────────────────────────────────────────────
/**
 * daily-tv (20 h UTC) : faut-il produire ce canal ce soir ? Pour `tv-main-1` seulement : NON si son programme
 * du jour est déjà sur les relais, signé par notre clé — le Journal de Freeworld TV (19 h 30), ou un passage
 * précédent. Relais illisibles (`null`) → on produit : mieux vaut un JT en images de trop qu'un soir sans
 * journal. Les autres canaux ne changent pas. Rend la raison du saut, ou `null`.
 */
export function raisonDeSauterCanal(canalId: string, date: string, deja: ReadonlySet<string> | null): string | null {
  if (canalId !== CANAL_JT || !deja) return null
  const d = programDTag(CANAL_JT, date)
  return deja.has(d) ? `« ${d} » est déjà à l'antenne, signé par notre clé (le Journal de Freeworld TV, ou un passage précédent)` : null
}
