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
 *      dont les droits ne sont pas indiqués (une piste COMMUNE, elle, a ses droits) ;
 *   2. puis les MUSIQUES DE TOUTES LES RADIOS (`PISTES_COMMUNES`, décision de Med du
 *      08/10/2026), sauf celles qu'elle exclut et celles déjà présentes — même quand une fiche
 *      30091, ancienne ou récente, remplace `tracks` ;
 *   3. puis, si elle a au moins un critère (genre, ambiance ou énergie), chaque musique de la
 *      bibliothèque qui a ses droits et qui répond à TOUS ses critères (un genre voulu au
 *      moins, une ambiance voulue au moins, une énergie dans la fourchette), triée par clé.
 *   Une station sans règles garde ses choix explicites et les musiques communes.
 *
 *   ── LES JINGLES GARANTIS (décision de Med du 08/10/2026) ──
 *   `JINGLES_GARANTIS` : les jingles qu'une station a TOUJOURS (Radio Pirate : 3 jingles), même
 *   quand une fiche 30091 remplace `jingles`. `jinglesDeLaStation` les ajoute après les siens.
 *
 *   ── LES PISTES RETIRÉES (décision de Med du 07/10/2026) ──
 *   Les 10 « Default Track » de mai 2026 n'ont aucune mention de droits : elles sont RETIRÉES.
 *   Elles ne sont plus dans les stations de départ, mais d'anciennes fiches 30091 publiées par
 *   des admins les citent encore dans `tracks`. Une piste de `PISTES_RETIREES` n'est JAMAIS
 *   sélectionnée : ni comme choix explicite, ni par une règle, ni depuis la bibliothèque, ni
 *   comme musique commune, ni comme jingle garanti. Les pistes retirées passent AVANT tout.
 */

/**
 * Les CID retirés de l'antenne — décision de Med du 07/10/2026 (« Default Track 01 » à « 10 »,
 * ancienne bibliothèque par défaut de mai 2026, sans aucune mention de droits). UN SEUL ENDROIT :
 * toute exclusion de ces pistes, dans l'application comme dans le générateur, passe par ici.
 * La « Chanson festive Russe » (bibliothèque 30108) n'en fait PAS partie : elle reste, et sera
 * diffusée dès que ses droits seront indiqués dans l'IHL.
 */
export const PISTES_RETIREES: readonly string[] = [
  'bafybeibhjj5cyhauwnrrjntrkwncl6y3bhyetzow54jieku47f2igchw7e', // Default Track 01
  'bafybeiey67moux547ib62r5uojwssqz3iu63ro3d2hvr7z62npifw3dlq4', // Default Track 02
  'bafybeiewnkzqs33a4x5oahytej2zhora3tqpgihgaym6fvyp2tqb5gffeu', // Default Track 03
  'bafybeifmfsamtn76ugitlps5vf62uguypp7lxjhusj5piwhglkcavjrjhq', // Default Track 04
  'bafybeieyacqlnv7zk32ejrekmb7f3dljazzxuidk3iostfl4mbbldpnk3q', // Default Track 05
  'bafybeihg4uu22uqrgwdxwdio6te7oukj4zpwumlxpccbu4duah3ml36e5q', // Default Track 06
  'bafybeihqozxwaq4ucefvq3bdqbj6u7as32uadzgngkqtltey646vutdjhu', // Default Track 07
  'bafybeieygru4cmsv4oygx5becnl5qhx5ooms7eavz75asqneo6ts45utam', // Default Track 08
  'bafybeic4zr3xf3kzlbjbaadx6csfesmmkkx57ebfg7erndahhqt47vx4pi', // Default Track 09
  'bafybeiafjpji5ltdmgvhb7mpre6krpftwbsr2pzkdprj36uhyrkcya7trm', // Default Track 10
]

/**
 * Une piste est-elle retirée ? Par son CID, ou par une adresse qui pointe vers un CID retiré
 * (passerelle `…/ipfs/<cid>`, sous-domaine `<cid>.ipfs…`).
 */
export function estPisteRetiree(p: { cid?: unknown; url?: unknown }): boolean {
  const cid = typeof p.cid === 'string' ? p.cid.trim() : ''
  if (cid && PISTES_RETIREES.includes(cid)) return true
  const url = typeof p.url === 'string' ? p.url : ''
  return !!url && PISTES_RETIREES.some(c => url.includes(c))
}

/**
 * LES MUSIQUES DE TOUTES LES RADIOS — décision de Med du 08/10/2026 : musiques de toutes les
 * radios, droits déclarés par l'administration. UN SEUL ENDROIT : chaque station les reçoit,
 * dans l'application comme dans le générateur, même si une fiche 30091 (ancienne ou récente)
 * remplace ses `tracks`. Une station peut seulement en retirer par `musique.exclure` (clé = CID).
 * Elles sont réputées avoir leurs droits (déclaration de Med), y compris la « Chanson festive
 * Russe » même si son 30108 n'en indique pas. `PISTES_RETIREES` reste prioritaire.
 * Titres : les fichiers ne portent aucune étiquette lisible (ID3/Vorbis) — « Musique NN ».
 */
export const PISTES_COMMUNES: readonly PisteJouable[] = [
  { title: 'Musique 01', cid: 'Qmckfwx4DrCGBKi7wEEQMjZ2sJyNcjGJRsLGFzz2ADB6Q2' },
  { title: 'Chanson festive Russe', cid: 'QmU7Htd4J9EQttvs2s2wWm6TyiV3wPY7nxYLLRYvX7j4tE' },
  { title: 'Musique 03', cid: 'Qme5G3bbfoHb3iSo5EFjm9yKYpcWAZs7E4ThEpyTygpcR1' },
  { title: 'Musique 04', cid: 'QmZ3XTXyBdZ5jP2ncVso95FtE4yGz71tEmzf3w3iYU5Zvq' },
  { title: 'Musique 05', cid: 'QmXvAZxepnUXMyH6cJaFKdVVPdySZZvd3fWYTTvh2UhKV3' },
  { title: 'Musique 06', cid: 'QmSW7mxs64EcNEn8dVBhD2wMjpm4XhXV34bP1veEjiGdC1' },
  { title: 'Musique 07', cid: 'QmcRSP1cD1vyV4nRKRCnveQ47WruKEXegPPmGWvEqda5Qg' },
  { title: 'Musique 08', cid: 'QmdtVzZ6zttHGAAS7vrFYwosHeLEgn4xZb53LLoJeyEZ6d' },
  { title: 'Musique 09', cid: 'QmRVsYuoiGWnjaWWhqip8CfZJcFXKfQVUXB2t3YLFwvacy' },
  { title: 'Musique 10', cid: 'QmTFCPmL7tFbAhCAhqMvNTdLsPPV18B3dK8xMhLvh5Mk86' },
  { title: 'Musique 11', cid: 'QmddeAB9ZGctVymCrE26GkMKa4UcsyQbZcfXrfPBVLUfvE' },
  { title: 'Musique 12', cid: 'QmQEJwPgDQKRDiARYVcByy1XVtcHVkMLoW282EPRtKYrsH' },
  { title: 'Musique 13', cid: 'Qmdw16YifvRG4PQE7kvcVeoxnAqKMHrCwqZ82PqkYRZYKS' },
  { title: 'Musique 14', cid: 'QmZyvJ58RxmiQ3vGue9FFoDZQojz7J4jYYKiDeEzLJRNhZ' },
  { title: 'Musique 15', cid: 'QmfZt1PENnsxfLZCAMXtPYRGCF8xFzj2nRkghQMvCpk2hp' },
  { title: 'Musique 16', cid: 'QmTehprkW9Dhp4RnPmDUseAbAQodA6k7yLG7WCfUSCZKLc' },
  { title: 'Musique 17', cid: 'QmXE2RqC9wC78duY145JWUAuMcr5zKUKngcdY1rYWfyXTe' },
  { title: 'Musique 18', cid: 'QmfYTxBM8evfHczJNsSx7Rx9JW6mDzg4TTfdF7We35pGur' },
  { title: 'Musique 19', cid: 'QmeJY3ggivnLnJjNz3V8EFfWqc2RAiQzfDZ89sFBHnYLJU' },
  { title: 'Musique 20', cid: 'QmQ292duCfvK2Wye4VabSoTCZ2NVAovugkzm5YeHtgrb6a' },
  { title: 'Musique 21', cid: 'QmWsNgVYYsUVad7qFnFgsg6PGsxcHBWSyc3TZDGCY5DVLU' },
  { title: 'Musique 22', cid: 'QmcE7zxduMCwpXueNLgiPgTSvLBwKWEy4uDL75CW2p91cV' },
  { title: 'Musique 23', cid: 'QmY2aYYWxGzavVnqao4PNiWXJTQu8ZAWhur1rMmTfa3H2B' },
  { title: 'Musique 24', cid: 'QmShgRDt2fLL1PA2Z1rHZ7pg5AXvPALTGHU7NuUtE4EhQX' },
]

/**
 * Les JINGLES qu'une station a TOUJOURS — décision de Med du 08/10/2026 (Radio Pirate). Ils
 * s'ajoutent à ceux de sa fiche 30091 (même quand elle remplace `jingles`), jamais en double.
 */
export const JINGLES_GARANTIS: Readonly<Record<string, readonly PisteJouable[]>> = {
  'pirate-radio': [
    { title: 'Jingle Pirate 1', cid: 'QmPtEQYerW11BZYGtdELADDS6tudhWH8c2qpsnhCgQtpze' },
    { title: 'Jingle Pirate 2', cid: 'QmPxBqbPCUeXbHXC2dVdVNDiwHCGCYCeby2ky3pCGWMBYV' },
    { title: 'Jingle Pirate 3', cid: 'Qmca2PLnqMng4wyaENirBpgLcsLmsgWkRFDjGdSrbyD3D5' },
  ],
}

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

/** Les clés (CID ou adresse) d'une liste de pistes. */
function clesDe(pistes: readonly PisteJouable[]): Set<string> {
  const out = new Set<string>()
  for (const p of pistes) { const k = cleDePiste(p); if (k) out.add(k) }
  return out
}

/** Une piste fait-elle partie des musiques de toutes les radios ? (par sa clé) */
export function estPisteCommune(p: { cid?: string; url?: string }, communes: readonly PisteJouable[] = PISTES_COMMUNES): boolean {
  const k = cleDePiste(p)
  return !!k && clesDe(communes).has(k)
}

/** Les jingles garantis d'une station (aucun pour la plupart). */
export function jinglesGarantis(id: string): readonly PisteJouable[] {
  return Object.prototype.hasOwnProperty.call(JINGLES_GARANTIS, id) ? JINGLES_GARANTIS[id] : []
}

/**
 * Les jingles d'une station : les siens (fiche ou départ), sauf les pistes retirées, PUIS ses
 * jingles garantis qui n'y sont pas déjà. Pure et déterministe, ici et dans le générateur.
 */
export function jinglesDeLaStation<T extends PisteJouable>(
  station: { id: string; jingles?: readonly T[] },
  garantis: readonly PisteJouable[] = jinglesGarantis(station.id),
): Array<T | PisteJouable> {
  const out: Array<T | PisteJouable> = []
  const vues = new Set<string>()
  for (const j of station.jingles ?? []) {
    if (estPisteRetiree(j)) continue
    const k = cleDePiste(j)
    if (k) vues.add(k)
    out.push(j)
  }
  for (const g of garantis) {
    if (estPisteRetiree(g)) continue
    const k = cleDePiste(g)
    if (!k || vues.has(k)) continue
    vues.add(k)
    out.push(g)
  }
  return out
}

/** D'où vient une piste de la liste résultante (pour l'aperçu de l'IHL). */
export type OriginePiste = 'choisie' | 'commune' | 'regle'

/**
 * La liste RÉSULTANTE d'une station, avec l'origine de chaque piste. Pure et déterministe :
 * même station, même bibliothèque → même liste, dans le même ordre, ici et dans le générateur.
 */
export function pistesDeLaStationDetaillees<T extends PisteJouable>(
  station: { tracks?: readonly T[]; musique?: ReglesMusiqueStation },
  bibliotheque: readonly PisteBibliotheque[],
  communes: readonly PisteJouable[] = PISTES_COMMUNES,
): Array<{ piste: T | PisteJouable; origine: OriginePiste }> {
  const regles = lireReglesMusique(station.musique)
  const exclues = new Set(regles?.exclure ?? [])
  const clesCommunes = clesDe(communes)
  const parCle = new Map<string, PisteBibliotheque>()
  for (const b of bibliotheque) {
    if (estPisteRetiree(b)) continue
    const k = cleDePiste(b)
    if (k && !parCle.has(k)) parCle.set(k, b)
  }

  const out: Array<{ piste: T | PisteJouable; origine: OriginePiste }> = []
  const vues = new Set<string>()
  for (const t of station.tracks ?? []) {
    if (estPisteRetiree(t)) continue
    const k = cleDePiste(t)
    if (k) {
      if (exclues.has(k)) continue
      const b = parCle.get(k)
      if (b && !droitsValides(b) && !clesCommunes.has(k)) continue
      vues.add(k)
    }
    out.push({ piste: t, origine: 'choisie' })
  }
  // Décision de Med du 08/10/2026 : les musiques de toutes les radios, quoi que dise la fiche.
  for (const c of communes) {
    if (estPisteRetiree(c)) continue
    const k = cleDePiste(c)
    if (!k || exclues.has(k) || vues.has(k)) continue
    vues.add(k)
    out.push({ piste: c, origine: 'commune' })
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
  communes: readonly PisteJouable[] = PISTES_COMMUNES,
): Array<T | PisteJouable> {
  return pistesDeLaStationDetaillees(station, bibliotheque, communes).map(x => x.piste)
}
