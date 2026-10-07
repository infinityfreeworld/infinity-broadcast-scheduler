/**
 * @module InfinityScheduler/Lib/Oreille
 * @description 👂 L'OREILLE DE CONTRÔLE : avant publication, chaque réplique dite par une voix de
 *   personnage est RÉÉCOUTÉE par une transcription automatique (Whisper), et ce qui a été entendu
 *   est comparé au texte prévu. Un tour incompréhensible, coupé ou dit dans une autre langue est
 *   refabriqué au lieu d'être diffusé (décision du Bâtisseur, 07/10/2026 : « si elle sonne
 *   robotique ou incompréhensible, elle est refabriquée au lieu d'être diffusée »).
 *
 *   ── LA MESURE (pure, éprouvée sans réseau ni binaire) ──
 *   Deux chiffres, tous deux sur des mots NORMALISÉS (minuscules, sans accents, sans ponctuation) :
 *     · le TAUX D'ERREUR DE MOTS (WER) : distance d'édition mot à mot ÷ nombre de mots prévus.
 *       Il voit l'ordre : une bouillie dite dans le désordre, une autre langue, une hallucination ;
 *     · la PART DE MOTS PERDUS : mots du texte qu'on ne retrouve nulle part dans ce qui a été
 *       entendu — la mesure de l'usine du Journal (usine/journal/voix_jt.py, « au plus un mot
 *       perdu par tranche de dix »), portée ici. Elle voit les mots avalés et les coupes ;
 *     · plus la FIN : l'un des deux derniers mots prévus doit être entendu à la fin — une fin
 *       avalée s'entend comme une réplique coupée.
 *   Pour le chinois et le japonais, les « mots » sont les caractères (pas d'espaces).
 *
 *   ── CE QUI NE COMPTE PAS (leçons de l'usine, 15-16/09/2026) ──
 *     · les NOMBRES : dits en lettres, Whisper les écrit en chiffres (« cent six » → « 106 ») ;
 *     · les NOMS PROPRES et SIGLES (mots à majuscule) : Whisper les orthographie à sa façon
 *       (« NAW » → « Nao ») — ce n'est pas un mot perdu ;
 *     · les HÉSITATIONS (« euh », « bah », « um », « 嗯 »…) : Whisper les efface volontiers, et
 *       la branche « disfluences » en ajoute exprès.
 *
 *   ── L'OUTIL ──
 *   whisper.cpp (`whisper-cli`, `brew install whisper-cpp`) et un modèle ggml (base par défaut,
 *   ~150 Mo) : rapide sur une puce Apple (Metal), sans GPU loué, sans Python. Ni binaire ni
 *   modèle → l'oreille se déclare INDISPONIBLE une fois, et la nuit continue sans elle (le
 *   contrôle du signal de controle-voix.ts reste actif). Elle ne fait jamais échouer une émission.
 *
 *   Réglages (README, « Oreille de contrôle ») :
 *     OREILLE=0                 coupe l'oreille ;
 *     OREILLE_BINAIRE           chemin de whisper-cli (défaut : cherché dans le PATH) ;
 *     OREILLE_MODELE            chemin du modèle ggml (défaut : …/infinity-radio/whisper/ggml-base.bin) ;
 *     OREILLE_SEUIL_WER         WER au-delà duquel le tour est refait (défaut 0,5) ;
 *     OREILLE_SEUIL_PERDUS      part de mots perdus au-delà de laquelle il est refait (défaut 0,25) ;
 *     OREILLE_FIN=0             ne pas exiger que la fin soit entendue ;
 *     OREILLE_ESSAIS            régénérations immédiates d'un tour refusé (défaut 1).
 */
import { execFile } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { delimiter, join } from 'node:path'
import { promisify } from 'node:util'
import type { DecodedWav } from './audio'
import { encodeWav } from './audio'

const exec = promisify(execFile)

// ── Normalisation ──────────────────────────────────────────────────────────────────────────

/** Hésitations de toutes nos langues : jamais comptées (ni prévues, ni entendues). */
const HESITATIONS = new Set([
  'euh', 'heu', 'hum', 'hmm', 'bah', 'ben', 'beh', 'ah', 'oh', 'eh', 'hein', 'pfff', 'bof',
  'uh', 'um', 'erm', 'er', 'mm', 'mhm',
  'pues', 'este', 'em', 'mmm',
  'ну', 'э', 'ээ', 'эээ', 'м', 'мм', 'хм',
])
const HESITATIONS_CJK = new Set(['嗯', '呃', '啊', '哦', '额', '唔', 'えー', 'あの'])

/** Nombres dits en toutes lettres que Whisper écrit en chiffres (fr, en, es, ru). */
const NOMBRES = new Set([
  'zero', 'un', 'une', 'deux', 'trois', 'quatre', 'cinq', 'six', 'sept', 'huit', 'neuf', 'dix', 'onze', 'douze',
  'treize', 'quatorze', 'quinze', 'seize', 'vingt', 'vingts', 'trente', 'quarante', 'cinquante', 'soixante',
  'cent', 'cents', 'mille', 'million', 'millions', 'milliard', 'milliards', 'virgule', 'pourcent',
  'one', 'two', 'three', 'four', 'five', 'seven', 'eight', 'nine', 'ten', 'eleven', 'twelve', 'twenty',
  'thirty', 'forty', 'fifty', 'hundred', 'thousand', 'percent',
  'uno', 'dos', 'tres', 'cuatro', 'cinco', 'seis', 'siete', 'ocho', 'nueve', 'diez', 'veinte', 'treinta',
  'cien', 'ciento', 'mil', 'millones', 'por', 'ciento',
  'один', 'одна', 'два', 'две', 'три', 'четыре', 'пять', 'шесть', 'семь', 'восемь', 'девять', 'десять',
  'двадцать', 'тридцать', 'сто', 'тысяча', 'тысячи', 'тысяч', 'миллион', 'миллиона', 'процентов',
])

/** Langues écrites sans espaces : on compte par caractère. */
export function langueSansEspaces(langue: string): boolean {
  return langue === 'zh' || langue === 'ja'
}

function sansAccents(t: string): string {
  return t.normalize('NFKD').replace(/\p{M}+/gu, '').normalize('NFC')
}

/**
 * Les « mots » d'un texte tels que l'oreille les compare. Pure.
 *
 * `souples` : rend aussi les jetons qui NE COMPTENT PAS (nombres, noms propres, sigles,
 * hésitations), retirés de la comparaison des deux côtés.
 */
export function motsCompares(texte: string, langue: string): string[] {
  if (langueSansEspaces(langue)) {
    // Caractères CJK seulement : le latin et les chiffres glissés dans le chinois sont des noms,
    // des sigles ou des nombres, que Whisper écrit à sa façon.
    const brut = [...texte].filter(c => /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]/u.test(c))
    return brut.filter(c => !HESITATIONS_CJK.has(c))
  }
  const sortie: string[] = []
  // Un mot : lettres (tous alphabets), chiffres, apostrophes et traits d'union internes.
  for (const m of texte.matchAll(/[\p{L}\p{N}]+(?:['’\-][\p{L}\p{N}]+)*/gu)) {
    const brut = m[0]
    // Nom propre ou sigle : une majuscule (ailleurs qu'en début de phrase, on ne le sait pas ici —
    // on les écarte tous, c'est la prudence de l'usine : un faux « mot perdu » coûte une
    // émission refaite, un vrai mot perdu sur un nom se voit aussi sur les mots voisins).
    if (/^\p{Lu}/u.test(brut)) continue
    for (const morceau of sansAccents(brut.toLowerCase()).split(/['’\-]/)) {
      if (!morceau) continue
      if (/\p{N}/u.test(morceau)) continue          // chiffres
      if (NOMBRES.has(morceau)) continue
      if (HESITATIONS.has(morceau)) continue
      sortie.push(morceau)
    }
  }
  return sortie
}

// ── Mesures ────────────────────────────────────────────────────────────────────────────────

/** Distance d'édition mot à mot (insertions, suppressions, substitutions). Pure. */
export function distanceEdition(a: readonly string[], b: readonly string[]): number {
  let prec = Array.from({ length: b.length + 1 }, (_, j) => j)
  for (let i = 1; i <= a.length; i++) {
    const cour = [i]
    for (let j = 1; j <= b.length; j++) {
      cour[j] = Math.min(
        prec[j] + 1,
        cour[j - 1] + 1,
        prec[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1),
      )
    }
    prec = cour
  }
  return prec[b.length]
}

/** Taux d'erreur de mots : distance ÷ mots prévus (0 = parfait ; peut dépasser 1). Pure. */
export function tauxErreurMots(prevus: readonly string[], entendus: readonly string[]): number {
  if (prevus.length === 0) return entendus.length === 0 ? 0 : 1
  return distanceEdition(prevus, entendus) / prevus.length
}

/** Part des mots prévus qu'on ne retrouve nulle part dans ce qui a été entendu. Pure. */
export function partMotsPerdus(prevus: readonly string[], entendus: readonly string[]): number {
  if (prevus.length === 0) return 0
  const reste = new Map<string, number>()
  for (const m of entendus) reste.set(m, (reste.get(m) ?? 0) + 1)
  let perdus = 0
  for (const m of prevus) {
    const n = reste.get(m) ?? 0
    if (n > 0) reste.set(m, n - 1)
    else perdus++
  }
  return perdus / prevus.length
}

/** La fin est-elle entendue ? L'un des deux derniers mots prévus parmi les derniers entendus. Pure. */
export function finEntendue(prevus: readonly string[], entendus: readonly string[]): boolean {
  const fins = prevus.slice(-2)
  if (fins.length === 0) return true
  const queue = entendus.slice(-Math.max(5, fins.length + 3))
  return fins.some(m => queue.includes(m))
}

// ── Verdict ────────────────────────────────────────────────────────────────────────────────

export interface SeuilsOreille {
  /** WER au-delà duquel le tour est refusé. */
  wer:          number
  /** Part de mots perdus au-delà de laquelle le tour est refusé. */
  perdus:       number
  /** Exiger que la fin soit entendue. */
  exigerFin:    boolean
  /** En deçà de ce nombre de mots comparables, on ne juge pas (Whisper est peu fiable sur 2 mots). */
  motsMinimum:  number
}

function nombre(env: string | undefined, defaut: number, min: number, max: number): number {
  const n = Number.parseFloat((env ?? '').replace(',', '.'))
  return Number.isFinite(n) && n >= min && n <= max ? n : defaut
}

/** Seuils lus dans l'environnement ; une valeur absurde retombe sur le défaut. */
export function seuilsOreille(env: NodeJS.ProcessEnv = process.env): SeuilsOreille {
  return {
    wer:         nombre(env.OREILLE_SEUIL_WER, 0.5, 0.05, 5),
    perdus:      nombre(env.OREILLE_SEUIL_PERDUS, 0.25, 0.01, 1),
    exigerFin:   env.OREILLE_FIN !== '0',
    motsMinimum: Math.round(nombre(env.OREILLE_MOTS_MIN, 4, 1, 100)),
  }
}

export type VerdictOreille = 'bon' | 'mauvais' | 'non-juge'

export interface Jugement {
  verdict:   VerdictOreille
  wer:       number
  perdus:    number
  fin:       boolean
  mots:      number
  /** Une ligne lisible pour le journal. */
  motif:     string
}

const pc = (x: number) => `${Math.round(x * 100)} %`

/**
 * Compare le texte prévu à ce que l'oreille a entendu. Pure : c'est ici que tout se décide.
 */
export function jugerEcoute(
  prevu: string, entendu: string, langue: string, seuils: SeuilsOreille = seuilsOreille(),
): Jugement {
  const p = motsCompares(prevu, langue)
  const e = motsCompares(entendu, langue)
  const wer = tauxErreurMots(p, e)
  const perdus = partMotsPerdus(p, e)
  const fin = finEntendue(p, e)
  const base = { wer, perdus, fin, mots: p.length }
  if (p.length < seuils.motsMinimum) {
    return { ...base, verdict: 'non-juge', motif: `trop court pour juger (${p.length} mot(s) comparable(s))` }
  }
  const fautes: string[] = []
  if (e.length === 0) fautes.push('rien entendu')
  if (wer > seuils.wer) fautes.push(`taux d'erreur ${pc(wer)} > ${pc(seuils.wer)}`)
  if (perdus > seuils.perdus) fautes.push(`${pc(perdus)} de mots perdus > ${pc(seuils.perdus)}`)
  if (seuils.exigerFin && !fin) fautes.push('fin non entendue (coupé ?)')
  if (fautes.length > 0) return { ...base, verdict: 'mauvais', motif: fautes.join(' ; ') }
  return { ...base, verdict: 'bon', motif: `compris (erreur ${pc(wer)}, perdus ${pc(perdus)})` }
}

// ── La transcription (whisper.cpp) ─────────────────────────────────────────────────────────

/** Ramène un WAV à 16 kHz (ce qu'attend Whisper), par interpolation linéaire. Pure. */
export function reechantillonner(wav: DecodedWav, cible = 16_000): DecodedWav {
  if (wav.sampleRate === cible) return wav
  const rapport = wav.sampleRate / cible
  const n = Math.max(0, Math.floor(wav.samples.length / rapport))
  const out = new Float32Array(n)
  for (let i = 0; i < n; i++) {
    const x = i * rapport
    const i0 = Math.floor(x)
    const i1 = Math.min(i0 + 1, wav.samples.length - 1)
    const f = x - i0
    out[i] = wav.samples[i0] * (1 - f) + wav.samples[i1] * f
  }
  return { samples: out, sampleRate: cible }
}

export interface Transcripteur {
  /** Rend le texte entendu, ou lève. */
  transcrire(wav: DecodedWav, langue: string): Promise<string>
}

/** Cherche un exécutable dans le PATH (sans `which`, absent de certains PATH launchd). */
function dansLePath(nom: string): string | null {
  for (const d of (process.env.PATH ?? '').split(delimiter)) {
    if (d && existsSync(join(d, nom))) return join(d, nom)
  }
  return null
}

export function modeleParDefaut(): string {
  const base = existsSync(join(homedir(), 'Library'))
    ? join(homedir(), 'Library', 'Application Support', 'infinity-radio')
    : join(process.env.XDG_STATE_HOME ?? join(homedir(), '.local', 'state'), 'infinity-radio')
  return join(base, 'whisper', 'ggml-base.bin')
}

/**
 * Le transcripteur whisper.cpp de cette machine, ou la RAISON de son absence. Ne lève jamais.
 */
export function transcripteurWhisperCpp(env: NodeJS.ProcessEnv = process.env): Transcripteur | { indisponible: string } {
  if (env.OREILLE === '0') return { indisponible: 'coupée (OREILLE=0)' }
  const binaire = env.OREILLE_BINAIRE || dansLePath('whisper-cli') || dansLePath('whisper-cpp')
  if (!binaire || !existsSync(binaire)) {
    return { indisponible: 'whisper-cli introuvable (brew install whisper-cpp)' }
  }
  const modele = env.OREILLE_MODELE || modeleParDefaut()
  if (!existsSync(modele)) return { indisponible: `modèle Whisper absent (${modele})` }
  const delaiMs = nombre(env.OREILLE_DELAI_S, 120, 5, 3600) * 1000
  return {
    async transcrire(wav, langue) {
      const dossier = mkdtempSync(join(tmpdir(), 'oreille-'))
      try {
        const entree = join(dossier, 'tour.wav')
        writeFileSync(entree, encodeWav(reechantillonner(wav)))
        const sortie = join(dossier, 'tour')
        await exec(binaire, [
          '-m', modele, '-f', entree, '-l', langue,
          '-nt', '-np', '-otxt', '-of', sortie,
        ], { timeout: delaiMs, maxBuffer: 8 * 1024 * 1024 })
        return readFileSync(`${sortie}.txt`, 'utf8').trim()
      } finally {
        rmSync(dossier, { recursive: true, force: true })
      }
    },
  }
}

/**
 * L'oreille d'une émission : un transcripteur, des seuils, et un coupe-circuit — trois
 * transcriptions ratées d'affilée et elle se tait pour la suite de l'émission (un binaire cassé ne
 * doit pas coûter 22 délais d'attente).
 */
export class Oreille {
  private echecs = 0
  private coupee: string | null = null

  constructor(
    private readonly t: Transcripteur | { indisponible: string },
    private readonly seuils: SeuilsOreille = seuilsOreille(),
    private readonly log: (l: string) => void = l => console.log(l),
  ) {
    if ('indisponible' in t) this.coupee = t.indisponible
  }

  /** Vide si l'oreille écoute ; sinon pourquoi elle n'écoute pas. */
  indisponible(): string | null { return this.coupee }

  /** Écoute un tour. `null` = pas d'avis (oreille indisponible ou en échec) : on ne bloque rien. */
  async ecouter(wav: DecodedWav, prevu: string, langue: string): Promise<Jugement | null> {
    if (this.coupee || 'indisponible' in this.t) return null
    try {
      const entendu = await this.t.transcrire(wav, langue)
      this.echecs = 0
      return jugerEcoute(prevu, entendu, langue, this.seuils)
    } catch (err) {
      this.echecs++
      this.log(`    👂 transcription en échec (${(err as Error).message.split('\n')[0].slice(0, 100)})`)
      if (this.echecs >= 3) {
        this.coupee = `${this.echecs} transcriptions ratées d'affilée`
        this.log(`    👂 oreille COUPÉE pour cette émission : ${this.coupee}`)
      }
      return null
    }
  }
}
