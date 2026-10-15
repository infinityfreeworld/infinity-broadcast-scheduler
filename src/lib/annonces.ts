/**
 * @module InfinityScheduler/Annonces
 * @description Les ANNONCES D'ANIMATEUR entre deux morceaux du direct (demande de Med, 14/10/2026) :
 *   « Vous écoutez Diginomad, rejoignez-nous sur infinity-freeworld.com », « Et voici… »,
 *   « C'était… ». JAMAIS de titre annoncé si le titre n'est qu'un numéro.
 *
 *   ── LE FORMAT (fixé par l'application, `broadcast/interventions.ts`, PR infinity #4906) ──
 *   Champ ADDITIF `annonces` du `content` JSON du kind 30093 (l'émission du jour). Chaque annonce :
 *   `type` (`ident` / `voici` / `cetait`), `cid` (court fichier audio), `mime`, `dureeSec`
 *   (0,3 à 15 s), `texte`, `piste` (CID de la piste nommée, obligatoire pour voici / cetait),
 *   `animateur`. L'app en lit au plus 400 et ignore le champ tant qu'il n'existe pas ; les
 *   anciennes versions de l'app l'ignorent tout court. On y ajoute `empreinte` (ignorée par l'app)
 *   qui sert de cache d'une nuit à l'autre, même sur une autre machine.
 *
 *   ── RÈGLES ──
 *   · voix = le PREMIER animateur de la station (comme les idents), voix clonée data-space ;
 *     voix clonée en échec → PAS d'annonce (jamais de repli Piper : une annonce robotique fait pire
 *     que pas d'annonce). Le chinois garde sa voix d'antenne Kokoro (lib/voix-zh.ts), qui est la
 *     voix voulue de la station, pas un repli ;
 *   · seulement les pistes du DIRECT (lib/bibliotheque-musique.ts `musiqueDuDirect`) qui ont un
 *     CID et un vrai titre (lib/titre-annoncable.ts, identique à l'app) ;
 *   · phrases courtes (2 à 6 s), dans la langue de la station, plusieurs tournures ; la tournure
 *     d'une piste est tirée de son CID : la même chaque nuit, donc le même texte, donc le cache ;
 *   · même texte + même voix (+ même réglage de sonie) = même empreinte = même fichier = même CID.
 *
 *   Ce module est PUR (aucun réseau). La fabrication est dans lib/annonces-fabrique.ts.
 */

import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import { titreAnnoncable } from './titre-annoncable'
import { DOMAINE_INFINITY, prononcerDomaine } from './slogan-radio'
import type { StationLanguage } from './types'

export type TypeAnnonce = 'ident' | 'voici' | 'cetait'

/** Une annonce publiée (forme de `AnnonceAntenne` dans l'app, + `empreinte`). */
export interface AnnonceAntenne {
  type:       TypeAnnonce
  cid:        string
  mime?:      string
  dureeSec:   number
  texte:      string
  piste?:     string
  animateur?: string
  /** Empreinte texte + voix + réglages (cache) ; ignorée par l'app. */
  empreinte?: string
}

/** Opus mono emballé en WebM (WebKit refuse l'Ogg/Opus, cf. lib/opus.ts). */
export const MIME_ANNONCE = 'audio/webm; codecs=opus'
/** À changer si le traitement du son change (rognage, sonie, débit) : toutes les empreintes changent. */
export const VERSION_ANNONCES = 1
/** Bornes de l'app (`lireAnnoncesPubliees`). */
export const DUREE_MIN_ANNONCE_S = 0.3
export const DUREE_MAX_ANNONCE_S = 15
export const ANNONCES_MAX_APP = 400
export const TEXTE_MAX_APP = 240
/** Taille maximale de l'événement 30093 complet (demande : < 60 Ko). */
export const TAILLE_MAX_EVENEMENT = 60 * 1024
/** Ce qui entoure le `content` dans l'événement signé : id, pubkey, sig, tags, clés JSON. */
export const SURCOUT_EVENEMENT = 1200
/** Un titre plus long ne tient pas en 6 s : pas d'annonce. */
const TITRE_MAX = 90

// ── Réglages ─────────────────────────────────────────────────────────────

export interface ReglagesAnnonces {
  /** `ANNONCES=false` coupe tout pour une nuit. */
  actif:          boolean
  /** Nouvelles annonces fabriquées au plus par nuit et par station (le cache fait le reste). */
  nouvellesMax:   number
  /** Nombre d'idents génériques par station (2 à 4). */
  idents:         number
  /** Annonces au plus par émission (en plus de la borne de taille). */
  maxParEmission: number
  /** Temps accordé à la voix clonée pour les annonces d'une station (secondes). */
  echeanceS:      number
}

export function reglagesAnnonces(env: NodeJS.ProcessEnv = process.env): ReglagesAnnonces {
  const entier = (v: string | undefined, d: number, min: number, max: number) => {
    const x = Number.parseInt(v ?? '', 10)
    return Number.isFinite(x) ? Math.max(min, Math.min(max, x)) : d
  }
  return {
    actif:          env.ANNONCES !== 'false' && env.ANNONCES !== '0',
    nouvellesMax:   entier(env.ANNONCES_NOUVELLES_MAX, 8, 0, 200),
    idents:         entier(env.ANNONCES_IDENTS, 3, 0, 4),
    maxParEmission: entier(env.ANNONCES_MAX_EMISSION, 160, 0, ANNONCES_MAX_APP),
    echeanceS:      entier(env.ANNONCES_ECHEANCE_S, 600, 30, 3600),
  }
}

// ── Titres ───────────────────────────────────────────────────────────────

/**
 * Le titre d'une piste tel qu'il se dit à l'antenne, ou `null` s'il ne s'annonce pas.
 * `pisteJouable` écrit « Titre — Artiste » : on sépare. On retire l'extension, la numérotation de
 * tête (« 03 - », « 7. »), les soulignés. Le résultat repasse la règle de l'app. Pure.
 */
export function titrePourAntenne(titreBrut: string | undefined | null): { titre: string; artiste?: string } | null {
  if (!titreAnnoncable(titreBrut)) return null
  const brut = String(titreBrut).normalize('NFC').trim()
  const i = brut.lastIndexOf(' — ')
  const nettoyer = (s: string) => s
    .replace(/\.(mp3|ogg|opus|wav|flac|m4a|aac|webm)$/i, '')
    .replace(/_/g, ' ')
    .replace(/^\s*(?:#\s*)?\d{1,3}\s*(?:[-–.)]\s*|\s+(?=\p{L}))/u, '')
    .replace(/\s+/g, ' ')
    .trim()
  const titre = nettoyer(i > 0 ? brut.slice(0, i) : brut)
  const artiste = i > 0 ? nettoyer(brut.slice(i + 3)) : ''
  if (!titreAnnoncable(titre) || titre.length > TITRE_MAX) return null
  return artiste && artiste.length <= 50 && titre.length + artiste.length <= TITRE_MAX ? { titre, artiste } : { titre }
}

// ── Phrases ──────────────────────────────────────────────────────────────

interface PhrasesLangue {
  idents:     Array<(n: string, d: string) => string>
  /** Ident avec le slogan de la station. */
  slogan:     (n: string, s: string) => string
  /** Le titre cité, avec ou sans artiste. */
  cite:       (t: string, a?: string) => string
  voici:      Array<(x: string) => string>
  cetait:     Array<(x: string) => string>
}

const D = DOMAINE_INFINITY

export const PHRASES_ANNONCES: Record<StationLanguage, PhrasesLangue> = {
  fr: {
    idents: [(n, d) => `Vous écoutez ${n}. Rejoignez-nous sur ${d}.`, (n, d) => `${n}, toujours avec vous. Retrouvez-nous sur ${d}.`],
    slogan: (n, s) => `Vous écoutez ${n}. ${s}`,
    cite: (t, a) => (a ? `« ${t} », de ${a}` : `« ${t} »`),
    voici: [x => `Et voici ${x}.`, x => `Tout de suite, ${x}.`, x => `On enchaîne avec ${x}.`],
    cetait: [x => `C'était ${x}.`, x => `Vous venez d'écouter ${x}.`],
  },
  en: {
    idents: [(n, d) => `You're listening to ${n}. Join us on ${d}.`, (n, d) => `${n}, right here with you. Find us on ${d}.`],
    slogan: (n, s) => `You're listening to ${n}. ${s}`,
    cite: (t, a) => (a ? `"${t}" by ${a}` : `"${t}"`),
    voici: [x => `And here's ${x}.`, x => `Coming up now, ${x}.`, x => `Next up, ${x}.`],
    cetait: [x => `That was ${x}.`, x => `You just heard ${x}.`],
  },
  es: {
    idents: [(n, d) => `Estás escuchando ${n}. Únete a nosotros en ${d}.`, (n, d) => `${n}, siempre contigo. Encuéntranos en ${d}.`],
    slogan: (n, s) => `Estás escuchando ${n}. ${s}`,
    cite: (t, a) => (a ? `«${t}», de ${a}` : `«${t}»`),
    voici: [x => `Y ahora, ${x}.`, x => `Suena ${x}.`, x => `Seguimos con ${x}.`],
    cetait: [x => `Eso fue ${x}.`, x => `Acabas de escuchar ${x}.`],
  },
  it: {
    idents: [(n, d) => `State ascoltando ${n}. Unitevi a noi su ${d}.`, (n, d) => `${n}, sempre con voi. Trovateci su ${d}.`],
    slogan: (n, s) => `State ascoltando ${n}. ${s}`,
    cite: (t, a) => (a ? `«${t}» di ${a}` : `«${t}»`),
    voici: [x => `Ed ecco ${x}.`, x => `Adesso, ${x}.`, x => `Continuiamo con ${x}.`],
    cetait: [x => `Era ${x}.`, x => `Avete appena ascoltato ${x}.`],
  },
  pt: {
    idents: [(n, d) => `Você está ouvindo ${n}. Junte-se a nós em ${d}.`, (n, d) => `${n}, sempre com você. Encontre-nos em ${d}.`],
    slogan: (n, s) => `Você está ouvindo ${n}. ${s}`,
    cite: (t, a) => (a ? `“${t}”, de ${a}` : `“${t}”`),
    voici: [x => `E agora, ${x}.`, x => `A seguir, ${x}.`, x => `Continuamos com ${x}.`],
    cetait: [x => `Essa foi ${x}.`, x => `Você acabou de ouvir ${x}.`],
  },
  ru: {
    idents: [(n, d) => `Вы слушаете ${n}. Присоединяйтесь к нам на ${d}.`, (n, d) => `${n} — мы с вами. Ищите нас на ${d}.`],
    slogan: (n, s) => `Вы слушаете ${n}. ${s}`,
    cite: (t, a) => (a ? `«${t}», ${a}` : `«${t}»`),
    voici: [x => `А теперь — ${x}.`, x => `Слушаем ${x}.`, x => `Дальше — ${x}.`],
    cetait: [x => `Вы слушали ${x}.`, x => `Прозвучала композиция ${x}.`],
  },
  zh: {
    idents: [(n, d) => `您正在收听${n}。欢迎来 ${d} 加入我们。`, (n, d) => `${n}，一直陪着您。在 ${d} 找到我们。`],
    slogan: (n, s) => `您正在收听${n}。${s}`,
    cite: (t, a) => (a ? `${a}的《${t}》` : `《${t}》`),
    voici: [x => `接下来请欣赏${x}。`, x => `下面这首是${x}。`],
    cetait: [x => `刚才您听到的是${x}。`, x => `刚才播放的是${x}。`],
  },
  hi: {
    idents: [(n, d) => `आप सुन रहे हैं ${n}। ${d} पर हमसे जुड़िए।`, (n, d) => `${n}, हमेशा आपके साथ। हमें ${d} पर पाइए।`],
    slogan: (n, s) => `आप सुन रहे हैं ${n}। ${s}`,
    cite: (t, a) => (a ? `${a} का "${t}"` : `"${t}"`),
    voici: [x => `अब सुनिए ${x}।`, x => `आगे है ${x}।`],
    cetait: [x => `यह था ${x}।`, x => `आपने अभी सुना ${x}।`],
  },
  ja: {
    idents: [(n, d) => `お聴きの放送は${n}です。${d} でお待ちしています。`, (n, d) => `${n}、いつもあなたのそばに。${d} でお会いしましょう。`],
    slogan: (n, s) => `お聴きの放送は${n}です。${s}`,
    cite: (t, a) => (a ? `${a}の「${t}」` : `「${t}」`),
    voici: [x => `続いては${x}。`, x => `お送りするのは${x}です。`],
    cetait: [x => `お聴きいただいたのは${x}でした。`, x => `${x}でした。`],
  },
}

/** Hachage FNV-1a 32 bits (tirage stable d'une tournure). Pure. */
export function hacher(s: string): number {
  let h = 0x811c9dc5
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0 }
  return h >>> 0
}

/** Le texte envoyé à la voix : guillemets retirés, adresse dite en toutes lettres. Pure. */
export function texteParle(texte: string, langue: StationLanguage): string {
  return prononcerDomaine(texte.replace(/[«»“”"「」《》]/g, '').replace(/\s+([,.!?])/g, '$1').replace(/\s{2,}/g, ' ').trim(), langue)
}

/** Une annonce à fabriquer (ou à reprendre du cache). */
export interface AnnoncePrevue {
  type:   TypeAnnonce
  texte:  string
  parle:  string
  piste?: string
}

/** Forme minimale d'une piste du direct. */
export interface PisteDuDirect { title: string; cid?: string }

/**
 * Les annonces d'une station : ses idents d'abord, puis, pour chaque piste du direct qui a un CID
 * et un vrai titre, « voici » puis « c'était ». Déterministe : même station, mêmes pistes → mêmes
 * textes, chaque nuit. Une langue sans phrases → aucune annonce (jamais du français sur une
 * station hindie). Pure.
 */
export function planAnnonces(
  station: { name: string; language?: string; tagline?: string },
  pistes: readonly PisteDuDirect[],
  nbIdents: number,
): AnnoncePrevue[] {
  const langue = (station.language ?? 'fr') as StationLanguage
  const p = PHRASES_ANNONCES[langue]
  if (!p) return []
  const nom = station.name.trim() || 'Infinity Radio'
  const borne = (t: string) => t.slice(0, TEXTE_MAX_APP)
  const out: AnnoncePrevue[] = []
  const idents = p.idents.map(f => f(nom, D))
  const slogan = (station.tagline ?? '').trim()
  if (slogan && slogan.length <= 70) idents.splice(1, 0, p.slogan(nom, /[.!?。！？।]$/.test(slogan) ? slogan : `${slogan}.`))
  for (const texte of idents.slice(0, Math.max(0, nbIdents))) out.push({ type: 'ident', texte: borne(texte), parle: texteParle(borne(texte), langue) })
  const vues = new Set<string>()
  for (const piste of pistes) {
    const cid = piste.cid?.trim()
    if (!cid || vues.has(cid)) continue
    const t = titrePourAntenne(piste.title)
    if (!t) continue
    vues.add(cid)
    const x = p.cite(t.titre, t.artiste)
    for (const type of ['voici', 'cetait'] as const) {
      const tournures = p[type]
      const texte = borne(tournures[hacher(`${type}:${cid}`) % tournures.length](x))
      out.push({ type, texte, parle: texteParle(texte, langue), piste: cid })
    }
  }
  return out
}

/**
 * L'empreinte d'une annonce : texte dit + voix + langue + sonie + version du traitement. Même
 * empreinte = même fichier attendu = on reprend le CID déjà déposé. Pure.
 */
export function empreinteAnnonce(parle: string, voix: string, langue: string, sonie: { cible: number; crete: number }): string {
  return createHash('sha256')
    .update(`v${VERSION_ANNONCES}|${langue}|${voix}|${sonie.cible}|${sonie.crete}|${parle.normalize('NFC')}`)
    .digest('hex').slice(0, 24)
}

// ── Cache ────────────────────────────────────────────────────────────────

export interface EntreeCache {
  cid:      string
  dureeSec: number
  mime:     string
  /** Dernière nuit où l'annonce a servi (YYYY-MM-DD) : le ménage garde les plus récentes. */
  vu:       string
}

export type CacheAnnonces = Record<string, EntreeCache>

const CID_VALIDE = /^[A-Za-z0-9]{20,100}$/
const CACHE_MAX = 20_000

/** Où vit le cache sur la machine de nuit (`RADIO_ANNONCES_CACHE` pour le déplacer). */
export function fichierCacheAnnonces(env: NodeJS.ProcessEnv = process.env): string {
  if (env.RADIO_ANNONCES_CACHE) return env.RADIO_ANNONCES_CACHE
  const base = existsSync(join(homedir(), 'Library'))
    ? join(homedir(), 'Library', 'Application Support', 'infinity-radio')
    : join(env.XDG_STATE_HOME ?? join(homedir(), '.local', 'state'), 'infinity-radio')
  return join(base, 'annonces-cache.json')
}

function entreeValide(x: unknown): x is EntreeCache {
  if (!x || typeof x !== 'object') return false
  const e = x as Record<string, unknown>
  return typeof e.cid === 'string' && CID_VALIDE.test(e.cid)
    && typeof e.dureeSec === 'number' && e.dureeSec >= DUREE_MIN_ANNONCE_S && e.dureeSec <= DUREE_MAX_ANNONCE_S
    && typeof e.mime === 'string' && typeof e.vu === 'string'
}

/** Lit le cache ; fichier absent ou abîmé → cache vide (jamais d'erreur). */
export function lireCacheAnnonces(chemin: string): CacheAnnonces {
  try {
    const brut = JSON.parse(readFileSync(chemin, 'utf8')) as unknown
    if (!brut || typeof brut !== 'object') return {}
    const out: CacheAnnonces = {}
    for (const [k, v] of Object.entries(brut as Record<string, unknown>)) if (entreeValide(v)) out[k] = v
    return out
  } catch {
    return {}
  }
}

/** Écrit le cache (fichier temporaire puis renommage : jamais à moitié écrit), borné. */
export function ecrireCacheAnnonces(chemin: string, cache: CacheAnnonces): void {
  const entrees = Object.entries(cache).sort(([, a], [, b]) => (a.vu < b.vu ? 1 : a.vu > b.vu ? -1 : 0)).slice(0, CACHE_MAX)
  mkdirSync(dirname(chemin), { recursive: true })
  const tmp = `${chemin}.${process.pid}.tmp`
  writeFileSync(tmp, JSON.stringify(Object.fromEntries(entrees)))
  renameSync(tmp, chemin)
}

/**
 * Reprend dans le cache les annonces d'une émission déjà publiée (celles qui portent leur
 * empreinte) : le cache survit à un changement de machine. Rend le nombre d'entrées ajoutées.
 */
export function importerAnnoncesPubliees(cache: CacheAnnonces, annonces: unknown, vu: string): number {
  if (!Array.isArray(annonces)) return 0
  let n = 0
  for (const a of annonces.slice(0, ANNONCES_MAX_APP)) {
    if (!a || typeof a !== 'object') continue
    const x = a as Record<string, unknown>
    if (typeof x.empreinte !== 'string' || !/^[0-9a-f]{24}$/.test(x.empreinte) || cache[x.empreinte]) continue
    const e = { cid: x.cid, dureeSec: Number(x.dureeSec), mime: typeof x.mime === 'string' ? x.mime : MIME_ANNONCE, vu }
    if (!entreeValide(e)) continue
    cache[x.empreinte] = e
    n++
  }
  return n
}

// ── Taille de l'événement ────────────────────────────────────────────────

/** Octets qu'un objet ajoute à l'événement signé (le `content` y est une chaîne JSON échappée). */
export function octetsDansEvenement(objet: unknown): number {
  return Buffer.byteLength(JSON.stringify(JSON.stringify(objet))) - 2
}

/**
 * Garde les annonces, dans l'ordre (idents d'abord), tant que l'événement complet reste sous
 * `TAILLE_MAX_EVENEMENT` et sous `max`. Une paire voici / c'était d'une même piste n'est jamais
 * coupée en deux. `contenuSansAnnonces` = le `content` JSON (chaîne) de l'émission sans annonces.
 * Pure.
 */
export function bornerAnnonces(
  annonces: readonly AnnonceAntenne[], contenuSansAnnonces: string,
  max = ANNONCES_MAX_APP, tailleMax = TAILLE_MAX_EVENEMENT,
): AnnonceAntenne[] {
  const plafond = Math.min(max, ANNONCES_MAX_APP)
  let taille = Buffer.byteLength(JSON.stringify(contenuSansAnnonces)) + SURCOUT_EVENEMENT
    + octetsDansEvenement({ annonces: [] }) - 2
  const out: AnnonceAntenne[] = []
  for (let i = 0; i < annonces.length; i++) {
    const a = annonces[i]
    const groupe = [a]
    const suivante = annonces[i + 1]
    if (a.type === 'voici' && suivante?.type === 'cetait' && suivante.piste === a.piste) groupe.push(suivante)
    const ajout = groupe.reduce((s, x) => s + octetsDansEvenement(x) + 1, 0)
    if (out.length + groupe.length > plafond || taille + ajout > tailleMax) break
    out.push(...groupe)
    taille += ajout
    i += groupe.length - 1
  }
  return out
}

/** Taille de l'événement 30093 que donnera ce `content` (octets, estimation par excès). */
export function tailleEvenement(contenu: string): number {
  return Buffer.byteLength(JSON.stringify(contenu)) + SURCOUT_EVENEMENT
}
