/**
 * @module Infinity/Radio/Musique/SelectionMusique
 * @description LA RÈGLE qui décide quelles musiques une station diffuse (Bâtisseur, 07/10/2026 :
 *   « chaque station doit avoir son propre système qui intègre la musique à la station
 *   sélectionnée »).
 *
 *   ⚠️ CE FICHIER EST IDENTIQUE, OCTET POUR OCTET, DANS L'APPLICATION
 *   (`src/modules/radio/musique/selection-musique.ts`) ET DANS LE GÉNÉRATEUR D'ÉMISSIONS
 *   (`infinity-broadcast-scheduler/src/lib/selection-musique.ts`). Les deux dépôts l'éprouvent
 *   avec le même fichier de cas (`cas-selection-musique.json`). Ne le modifie jamais d'un seul
 *   côté : l'antenne (émissions cuites la nuit) et l'application (musique entre deux émissions)
 *   se mettraient à jouer des listes différentes. Aucun import : il doit compiler tel quel ici
 *   et là-bas.
 *
 *   ── CE QUE PORTE UNE MUSIQUE DE LA BIBLIOTHÈQUE (kind 30108) ──
 *   titre, artiste, genres, ambiances, énergie (1 à 5), langue, et la MENTION DE DROITS :
 *   `{ type: 'libre-de-droits' | 'licence', licence?, auteur? }`. Sans mention de droits
 *   valable, une musique de la bibliothèque n'est JAMAIS diffusée.
 *
 *   ── CE QUE PORTE UNE STATION (kind 30091) ──
 *   - `tracks` : ses choix explicites (format inchangé depuis mai 2026 : les anciens lecteurs
 *     les jouent toujours) ;
 *   - `musique` (nouveau, facultatif) : ses RÈGLES —
 *     `{ etiquettes?: { genres?, ambiances? }, energie?: [min, max], exclure?: string[] }`.
 *
 *   ── LA LISTE D'UNE STATION ──
 *   1. ses choix explicites, sauf ceux qu'elle exclut et sauf une musique de la bibliothèque
 *      dont les droits ne sont pas indiqués ;
 *   2. puis, si elle a au moins un critère (genre, ambiance ou énergie), chaque musique de la
 *      bibliothèque qui a ses droits et qui répond à TOUS ses critères (un genre voulu au
 *      moins, une ambiance voulue au moins, une énergie dans la fourchette), triée par clé.
 *   Une station sans règles garde exactement ses choix explicites.
 */

export const ENERGIE_MIN = 1
export const ENERGIE_MAX = 5
export const TYPES_DROITS = ['libre-de-droits', 'licence'] as const
export type TypeDroits = typeof TYPES_DROITS[number]

/** Bornes (les mêmes à l'écriture et à la lecture). */
export const BORNES_MUSIQUE = {
  etiquettesParPiste:   8,
  etiquettesParRegle:   12,
  longueurEtiquette:    40,
  longueurTexte:        160,
  exclusions:           200,
  longueurCle:          300,
  pistesParStation:     300,
} as const

export interface DroitsMusique {
  type:     TypeDroits
  /** Nom de la licence (ex. « CC BY 4.0 ») — obligatoire si `type` = 'licence'. */
  licence?: string
  /** Auteur, ayant droit ou source (ex. « composée par l'équipe Infinity »). */
  auteur?:  string
}

/** Forme minimale d'une piste jouable (compatible avec `TrackRef` des deux dépôts). */
export interface PisteJouable {
  title:      string
  cid?:       string
  url?:       string
  durationS?: number
}

/** Une musique de la bibliothèque, vue par la règle. */
export interface PisteBibliotheque extends PisteJouable {
  artiste?:   string
  genres?:    string[]
  ambiances?: string[]
  energie?:   number
  langue?:    string
  droits?:    DroitsMusique
}

/** Les règles d'une station (champ `musique` du 30091). */
export interface ReglesMusiqueStation {
  etiquettes?: { genres?: string[]; ambiances?: string[] }
  energie?:    [number, number]
  exclure?:    string[]
}

const estObjet = (x: unknown): x is Record<string, unknown> =>
  typeof x === 'object' && x !== null && !Array.isArray(x)

/** Un texte libre nettoyé et borné ; `undefined` s'il est vide. */
export function lireTexte(x: unknown, max: number = BORNES_MUSIQUE.longueurTexte): string | undefined {
  if (typeof x !== 'string') return undefined
  const v = x.normalize('NFC').replace(/\s+/g, ' ').trim().slice(0, max).trim()
  return v || undefined
}

/** Une étiquette : minuscules, espaces resserrés, bornée. `null` si vide. */
export function normaliserEtiquette(x: unknown): string | null {
  if (typeof x !== 'string') return null
  return lireTexte(x.toLowerCase(), BORNES_MUSIQUE.longueurEtiquette) ?? null
}

/** Une liste d'étiquettes : normalisées, sans doublon, bornée ; `undefined` si vide. */
export function lireEtiquettes(x: unknown, max: number = BORNES_MUSIQUE.etiquettesParPiste): string[] | undefined {
  if (!Array.isArray(x)) return undefined
  const out: string[] = []
  for (const e of x) {
    const v = normaliserEtiquette(e)
    if (v && !out.includes(v)) out.push(v)
    if (out.length >= max) break
  }
  return out.length > 0 ? out : undefined
}

/** Énergie d'une piste : un nombre fini, arrondi et ramené entre 1 et 5 ; sinon `undefined`. */
export function lireEnergie(x: unknown): number | undefined {
  if (typeof x !== 'number' || !Number.isFinite(x)) return undefined
  return Math.max(ENERGIE_MIN, Math.min(ENERGIE_MAX, Math.round(x)))
}

/**
 * La mention de droits, si elle est VALABLE : un type connu, et au moins une licence ou un
 * auteur ; une « licence » sans nom de licence ne vaut rien. Sinon `undefined`.
 */
export function lireDroits(x: unknown): DroitsMusique | undefined {
  if (!estObjet(x)) return undefined
  if (!(TYPES_DROITS as readonly unknown[]).includes(x.type)) return undefined
  const type = x.type as TypeDroits
  const licence = lireTexte(x.licence)
  const auteur = lireTexte(x.auteur)
  if (type === 'licence' && !licence) return undefined
  if (!licence && !auteur) return undefined
  return { type, ...(licence ? { licence } : {}), ...(auteur ? { auteur } : {}) }
}

/** Une musique a-t-elle une mention de droits valable ? */
export function droitsValides(p: { droits?: unknown }): boolean {
  return lireDroits(p.droits) !== undefined
}

/** La clé d'une piste : son CID, sinon son adresse. `null` si elle n'a ni l'un ni l'autre. */
export function cleDePiste(p: { cid?: string; url?: string }): string | null {
  return p.cid || p.url || null
}

/** Le champ `musique` d'un 30091 : objet → règles bornées ; rien d'utile → `undefined`. */
export function lireReglesMusique(x: unknown): ReglesMusiqueStation | undefined {
  if (!estObjet(x)) return undefined
  const out: ReglesMusiqueStation = {}
  const et = estObjet(x.etiquettes) ? x.etiquettes : {}
  const genres = lireEtiquettes(et.genres, BORNES_MUSIQUE.etiquettesParRegle)
  const ambiances = lireEtiquettes(et.ambiances, BORNES_MUSIQUE.etiquettesParRegle)
  if (genres || ambiances) out.etiquettes = { ...(genres ? { genres } : {}), ...(ambiances ? { ambiances } : {}) }
  if (Array.isArray(x.energie) && x.energie.length === 2) {
    const a = lireEnergie(x.energie[0]), b = lireEnergie(x.energie[1])
    if (a !== undefined && b !== undefined) out.energie = [Math.min(a, b), Math.max(a, b)]
  }
  if (Array.isArray(x.exclure)) {
    const ex: string[] = []
    for (const k of x.exclure) {
      if (typeof k !== 'string') continue
      const v = k.trim()
      if (v && v.length <= BORNES_MUSIQUE.longueurCle && !ex.includes(v)) ex.push(v)
      if (ex.length >= BORNES_MUSIQUE.exclusions) break
    }
    if (ex.length > 0) out.exclure = ex
  }
  return out.etiquettes || out.energie || out.exclure ? out : undefined
}

/** La station a-t-elle au moins un critère qui AJOUTE des musiques de la bibliothèque ? */
export function reglesActives(r: ReglesMusiqueStation | undefined): boolean {
  return !!r && (!!r.etiquettes?.genres?.length || !!r.etiquettes?.ambiances?.length || !!r.energie)
}

const croise = (voulues: string[] | undefined, portees: string[] | undefined): boolean =>
  !voulues || voulues.length === 0 || (portees ?? []).some(e => voulues.includes(e))

/** Une musique de la bibliothèque répond-elle à TOUS les critères de la station ? */
export function correspond(p: PisteBibliotheque, r: ReglesMusiqueStation): boolean {
  if (!croise(r.etiquettes?.genres, lireEtiquettes(p.genres))) return false
  if (!croise(r.etiquettes?.ambiances, lireEtiquettes(p.ambiances))) return false
  if (r.energie) {
    const e = lireEnergie(p.energie)
    if (e === undefined || e < r.energie[0] || e > r.energie[1]) return false
  }
  return true
}

/** Une musique de la bibliothèque sous la forme jouée par une station (titre — artiste). */
export function pisteJouable(p: PisteBibliotheque): PisteJouable {
  const artiste = lireTexte(p.artiste)
  return {
    title: artiste ? `${p.title} — ${artiste}` : p.title,
    ...(p.cid ? { cid: p.cid } : {}),
    ...(p.url ? { url: p.url } : {}),
    ...(p.durationS ? { durationS: p.durationS } : {}),
  }
}

/** D'où vient une piste de la liste résultante (pour l'aperçu de l'IHL). */
export type OriginePiste = 'choisie' | 'regle'

/**
 * La liste RÉSULTANTE d'une station, avec l'origine de chaque piste. Pure et déterministe :
 * même station, même bibliothèque → même liste, dans le même ordre, ici et dans le générateur.
 */
export function pistesDeLaStationDetaillees<T extends PisteJouable>(
  station: { tracks?: readonly T[]; musique?: ReglesMusiqueStation },
  bibliotheque: readonly PisteBibliotheque[],
): Array<{ piste: T | PisteJouable; origine: OriginePiste }> {
  const regles = lireReglesMusique(station.musique)
  const exclues = new Set(regles?.exclure ?? [])
  const parCle = new Map<string, PisteBibliotheque>()
  for (const b of bibliotheque) { const k = cleDePiste(b); if (k && !parCle.has(k)) parCle.set(k, b) }

  const out: Array<{ piste: T | PisteJouable; origine: OriginePiste }> = []
  const vues = new Set<string>()
  for (const t of station.tracks ?? []) {
    const k = cleDePiste(t)
    if (k) {
      if (exclues.has(k)) continue
      const b = parCle.get(k)
      if (b && !droitsValides(b)) continue
      vues.add(k)
    }
    out.push({ piste: t, origine: 'choisie' })
  }
  if (regles && reglesActives(regles)) {
    const ajouts = [...parCle.entries()]
      .filter(([k, b]) => !vues.has(k) && !exclues.has(k) && droitsValides(b) && correspond(b, regles))
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    for (const [, b] of ajouts) out.push({ piste: pisteJouable(b), origine: 'regle' })
  }
  return out.slice(0, BORNES_MUSIQUE.pistesParStation)
}

/** La liste résultante d'une station (pistes seules). */
export function pistesDeLaStation<T extends PisteJouable>(
  station: { tracks?: readonly T[]; musique?: ReglesMusiqueStation },
  bibliotheque: readonly PisteBibliotheque[],
): Array<T | PisteJouable> {
  return pistesDeLaStationDetaillees(station, bibliotheque).map(x => x.piste)
}
