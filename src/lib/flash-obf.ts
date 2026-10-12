/**
 * @module InfinityScheduler/Lib/FlashObf
 * @description ⚡ LE FLASH SPÉCIAL OBF — PUR, sans réseau (la lecture des relais est dans
 *   `stations-thema-relais.ts`, la fabrication dans `scripts/flash-obf.ts`).
 *
 *   Demande validée par le Bâtisseur (12/10/2026) : quand une alerte OBF GRAVE tombe, un court
 *   bulletin (une à deux minutes) est fabriqué dans l'heure et diffusé sur la station OBF.
 *
 *   ── 🔴 INTERRUPTEUR ÉTEINT PAR DÉFAUT ──
 *   Rien ne se fabrique tant que `FLASH_OBF=1` n'est pas posé (variable du dépôt GitHub, lue par le
 *   workflow `flash-obf.yml` ET par le script). Voir `reglagesFlash`.
 *
 *   ── LA PRUDENCE DE LA STATION, EN PLUS STRICT ──
 *   Mêmes filtres que le bilan de la station (sujets-obf.ts) : alertes PUBLIQUES, dernière version,
 *   ni retirées ni supprimées ni échues, pas d'alerte de TEST, comptes bannis et publications masquées
 *   écartés, auteur ÉTABLI (sonde d'ancienneté) ou approuvé. En plus :
 *     · seulement les niveaux GRAVES (rouge par défaut ; orange si on le demande) ;
 *     · seulement une alerte ENCORE EN COURS (ni résolue ni expirée) et lancée depuis peu (90 min) ;
 *     · une alerte n'est annoncée qu'UNE fois (empreintes des alertes déjà annoncées, lues dans nos
 *       flashs des dernières 24 h) ;
 *     · au plus `FLASH_OBF_MAX_JOUR` flashs par 24 h, espacés d'au moins 30 min : une rafale de fausses
 *       alertes ne doit pas transformer la radio en sirène ;
 *     · le TEXTE N'EST PAS ÉCRIT PAR UN MODÈLE : un gabarit fixe, qui ne dit que le niveau, la ville
 *       (jamais plus précis) et l'heure. Jamais un titre, une description, un nom, une adresse. Il
 *       renvoie vers les secours (112) et vers la carte, et demande de NE PAS se rendre sur place.
 *
 *   ── CE QUE L'ON PUBLIE (ÉVÉNEMENT DISTINCT, ADDITIF) ──
 *   Un kind 30093 À PART, `d` = « obf-radio-flash:<AAAA-MM-JJTHH:MM> », dont le contenu porte
 *   `stationId: 'obf-radio-flash'` et `flashDe: 'obf-radio'`, avec une expiration NIP-40 à 24 h.
 *   🔴 Surtout PAS `stationId: 'obf-radio'` : l'application range les émissions par
 *   « station:date » et garderait la plus récente — le flash de 90 s remplacerait l'émission du jour.
 *   L'application actuelle ignore donc ces flashs ; les faire entendre sur la station OBF demande
 *   une petite lecture côté application (décrite dans la PR).
 */
import { createHash } from 'node:crypto'
import type { AlerteObf, NiveauObf } from './sujets-obf'
import type { BroadcastTurn } from './types'

export const STATION_FLASH = 'obf-radio-flash'
export const FLASH_DE = 'obf-radio'
/** Durée de vie d'un flash sur les relais (NIP-40) : une alerte OBF ne dure pas plus. */
export const FLASH_DUREE_VIE_S = 24 * 3600

export interface ReglagesFlash {
  /** L'interrupteur. Éteint par défaut. */
  actif:            boolean
  /** Niveaux qui déclenchent un flash. */
  niveaux:          NiveauObf[]
  /** Une alerte lancée depuis plus longtemps n'est plus « qui vient de tomber ». */
  fenetreMin:       number
  /** Au plus tant de flashs par 24 h. */
  maxParJour:       number
  /** Au moins tant de minutes entre deux flashs. */
  intervalleMin:    number
  /** Au plus tant d'alertes citées dans un même flash. */
  maxAlertes:       number
}

function nombre(v: string | undefined, d: number, min: number, max: number): number {
  const n = Number.parseInt(v ?? '', 10)
  return Number.isFinite(n) && n >= min && n <= max ? n : d
}

/**
 * Les réglages lus dans l'environnement. Éteint sauf `FLASH_OBF=1` (exactement).
 *   FLASH_OBF_NIVEAUX       « critical » (défaut) ou « critical,warning » ;
 *   FLASH_OBF_FENETRE_MIN   défaut 90 (15 à 360) ;
 *   FLASH_OBF_MAX_JOUR      défaut 6 (1 à 24) ;
 *   FLASH_OBF_INTERVALLE_MIN défaut 30 (10 à 240).
 */
export function reglagesFlash(env: NodeJS.ProcessEnv = process.env): ReglagesFlash {
  const demandes = (env.FLASH_OBF_NIVEAUX ?? 'critical').split(',').map(x => x.trim())
  const niveaux = (['critical', 'warning'] as NiveauObf[]).filter(n => demandes.includes(n))
  return {
    actif:         env.FLASH_OBF === '1',
    niveaux:       niveaux.length ? niveaux : ['critical'],
    fenetreMin:    nombre(env.FLASH_OBF_FENETRE_MIN, 90, 15, 360),
    maxParJour:    nombre(env.FLASH_OBF_MAX_JOUR, 6, 1, 24),
    intervalleMin: nombre(env.FLASH_OBF_INTERVALLE_MIN, 30, 10, 240),
    maxAlertes:    3,
  }
}

/** Empreinte OPAQUE d'une alerte (on ne republie pas son identifiant). Pure. */
export function empreinteAlerte(a: Pick<AlerteObf, 'cle'>): string {
  return createHash('sha256').update(`flash-obf:${a.cle}`).digest('hex').slice(0, 16)
}

/** Les alertes qui méritent un flash MAINTENANT, les plus graves puis les plus récentes d'abord. Pure. */
export function alertesPourFlash(
  retenues: readonly AlerteObf[], maintenant: number, dejaAnnoncees: ReadonlySet<string>, r: ReglagesFlash,
): AlerteObf[] {
  const ordre: NiveauObf[] = ['critical', 'warning', 'info', 'ok']
  return retenues
    .filter(a => r.niveaux.includes(a.niveau))
    .filter(a => !a.terminee)
    .filter(a => a.le <= maintenant + 5 * 60_000 && maintenant - a.le <= r.fenetreMin * 60_000)
    .filter(a => !dejaAnnoncees.has(empreinteAlerte(a)))
    .sort((x, y) => ordre.indexOf(x.niveau) - ordre.indexOf(y.niveau) || y.le - x.le)
    .slice(0, r.maxAlertes)
}

/** Un flash est-il permis maintenant (plafond par 24 h, intervalle) ? `precedents` en ms. Pure. */
export function flashPermis(precedents: readonly number[], maintenant: number, r: ReglagesFlash): { permis: boolean; raison: string } {
  const jour = precedents.filter(t => maintenant - t < 24 * 3_600_000 && t <= maintenant + 60_000)
  if (jour.length >= r.maxParJour) return { permis: false, raison: `déjà ${jour.length} flash(s) en 24 h (plafond ${r.maxParJour})` }
  const dernier = Math.max(-Infinity, ...jour)
  if (maintenant - dernier < r.intervalleMin * 60_000) {
    return { permis: false, raison: `dernier flash il y a ${Math.round((maintenant - dernier) / 60_000)} min (intervalle ${r.intervalleMin} min)` }
  }
  return { permis: true, raison: '' }
}

const NIVEAU_DIT: Record<NiveauObf, string> = {
  critical: 'une alerte rouge, urgence vitale,',
  warning:  'une alerte orange, danger imminent,',
  info:     'une alerte bleue',
  ok:       'une alerte verte',
}

const SENS_NIVEAU: Partial<Record<NiveauObf, string>> = {
  critical: "Une alerte rouge, sur OBF, veut dire urgence vitale : quelqu'un est peut-être déjà atteint.",
  warning:  "Une alerte orange, sur OBF, veut dire danger imminent, potentiellement grave.",
}

/** « 14 h 05 », heure de Paris. Pure. */
export function heureDite(ms: number): string {
  const p = new Intl.DateTimeFormat('fr-FR', { hour: 'numeric', minute: '2-digit', hour12: false, timeZone: 'Europe/Paris' })
    .formatToParts(new Date(ms))
  const h = p.find(x => x.type === 'hour')?.value ?? '0'
  const m = p.find(x => x.type === 'minute')?.value ?? '00'
  return m === '00' ? `${Number(h)} heures` : `${Number(h)} h ${m}`
}

function ilYA(minutes: number): string {
  if (minutes < 2) return "à l'instant"
  if (minutes < 60) return `il y a ${minutes} minutes`
  const h = Math.floor(minutes / 60), m = minutes % 60
  return `il y a ${h === 1 ? 'une heure' : `${h} heures`}${m >= 5 ? ` ${m}` : ''}`
}

/**
 * Le texte du flash (français : la station OBF est francophone). GABARIT FIXE — pas de modèle de
 * langue, rien d'inventé : niveau, ville, heure. Une à deux minutes à l'oral. Pure.
 */
export function texteFlash(alertes: readonly AlerteObf[], maintenant: number): string {
  if (alertes.length === 0) return ''
  const lignes: string[] = [
    `Flash spécial OBF. Il est ${heureDite(maintenant)}.`,
  ]
  alertes.forEach((a, i) => {
    const ou = a.lieu ? a.lieu : 'quelque part sur la carte'
    const debut = i === 0 ? (alertes.length > 1 ? `${alertes.length} alertes graves viennent d'être lancées sur la carte d'Infinity. D'abord, ` : '') : 'Ensuite, '
    const phrase = `${debut}${NIVEAU_DIT[a.niveau]} lancée ${ou}, ${ilYA(Math.round((maintenant - a.le) / 60_000))}${alertes.length === 1 ? ", sur la carte d'Infinity" : ''}.`
    lignes.push(phrase.charAt(0).toUpperCase() + phrase.slice(1))
  })
  // Ce que veut dire le niveau (les sujets de fond de la station, sujets-obf.ts) — rien de plus.
  for (const n of (['critical', 'warning'] as NiveauObf[]).filter(n => alertes.some(a => a.niveau === n))) {
    const sens = SENS_NIVEAU[n]
    if (sens) lignes.push(sens)
  }
  lignes.push(
    "Nous n'en savons pas davantage : ni ce qui se passe, ni qui est concerné. Nous ne vous dirons rien de plus que ce que la carte affiche.",
    'Si vous êtes sur place et en danger, appelez d\'abord les secours : le cent douze, partout en Europe. OBF prévient les voisins, il ne remplace pas les secours.',
    "Si vous êtes à proximité et en sécurité, ouvrez la carte d'Infinity, onglet OBF, pour suivre l'alerte en direct, et relayez les consignes officielles. Ne vous rendez pas sur les lieux sans y être appelé : laissez la place aux secours.",
    "Une alerte OBF dure au plus vingt-quatre heures : ce flash ne vaudra plus rien demain, la carte, elle, est toujours à jour.",
    "C'était un flash spécial OBF. Veillez les uns sur les autres.",
  )
  return lignes.join(' ')
}

/** Le `d` d'un flash : un par minute au plus. Pur. */
export function dTagFlash(maintenant: number): string {
  return `${STATION_FLASH}:${new Date(maintenant).toISOString().slice(0, 16)}`
}

/** Le contenu JSON du flash (forme d'une émission 30093, plus `flash`, `flashDe`, `alertes`). Pur. */
export function contenuFlash(o: {
  maintenant: number; texte: string; durationSec: number; audioCid: string; audioMime: string
  animateur: { id: string; name: string; color: string; avatar: string }; alertes: readonly AlerteObf[]
}): string {
  const tour: BroadcastTurn = {
    id: 'flash-1', hostId: o.animateur.id, hostName: o.animateur.name, color: o.animateur.color, avatar: o.animateur.avatar,
    text: o.texte, tStart: 0, tEnd: Math.round(o.durationSec * 1000) / 1000,
  }
  return JSON.stringify({
    stationId:   STATION_FLASH,
    flashDe:     FLASH_DE,
    flash:       true,
    date:        new Date(o.maintenant).toISOString().slice(0, 10),
    language:    'fr',
    durationSec: o.durationSec,
    audioCid:    o.audioCid,
    audioMime:   o.audioMime,
    turns:       [tour],
    newsRefs:    [],
    model:       'gabarit-flash-obf',
    generatedAt: Math.floor(o.maintenant / 1000),
    // Empreintes opaques des alertes annoncées : sert à ne jamais annoncer deux fois la même.
    alertes:     o.alertes.map(empreinteAlerte),
  })
}

/** Les tags d'un flash (expiration NIP-40 comprise). Pur. */
export function tagsFlash(maintenant: number, producteur = 'github-flash'): string[][] {
  const s = Math.floor(maintenant / 1000)
  return [
    ['d', dTagFlash(maintenant)],
    ['t', 'infinity-radio'],
    ['t', 'flash-obf'],
    ['station', STATION_FLASH],
    ['expiration', String(s + FLASH_DUREE_VIE_S)],
    ['producteur', producteur],
  ]
}

/** Nos flashs des dernières 24 h (contenus JSON) → instants et empreintes déjà annoncées. Pur. */
export function lireFlashsPrecedents(contenus: ReadonlyArray<{ content: string; created_at: number }>): { instants: number[]; empreintes: Set<string> } {
  const instants: number[] = []
  const empreintes = new Set<string>()
  for (const e of contenus) {
    let c: Record<string, unknown>
    try { c = JSON.parse(e.content) as Record<string, unknown> } catch { continue }
    if (c?.stationId !== STATION_FLASH) continue
    instants.push(e.created_at * 1000)
    if (Array.isArray(c.alertes)) for (const x of c.alertes) if (typeof x === 'string') empreintes.add(x)
  }
  return { instants, empreintes }
}
