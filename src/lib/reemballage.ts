/**
 * @module InfinityScheduler/Reemballage
 * @description Logique PURE de la republication des émissions en WebM —
 *   séparée du script parce qu'importer un script l'exécute.
 *
 *   Une republication remplace l'événement (même d-tag, `created_at` plus
 *   récent). Elle ne doit donc RIEN perdre : un événement que
 *   `publishBroadcast` ne saurait pas reconstruire à l'identique — clé de
 *   contenu inconnue, balise en plus, valeur divergente — est refusé, et
 *   dit pourquoi.
 */

import { FORMAT_EMISSION } from './opus'

export interface EvenementNostr {
  kind:       number
  pubkey:     string
  created_at: number
  tags:       string[][]
  content:    string
}

/** Exactement ce que `publishBroadcast` écrit dans le contenu. */
export const CLES_CONTENU = [
  'stationId', 'date', 'language', 'durationSec', 'audioCid',
  'audioMime', 'turns', 'newsRefs', 'model', 'generatedAt',
] as const

/**
 * La dernière émission de chaque station, et uniquement les NÔTRES.
 * « Dernière » = date la plus récente, puis publication la plus récente.
 */
export function choisirDernieres(
  evenements: EvenementNostr[],
  nous: string,
  kind = 30093,
): Map<string, EvenementNostr> {
  const garde = new Map<string, { date: string; e: EvenementNostr }>()
  for (const e of evenements) {
    if (e.kind !== kind || e.pubkey !== nous) continue
    const station = e.tags.find(t => t[0] === 'station')?.[1]
    const date = e.tags.find(t => t[0] === 'date')?.[1]
    if (!station || !date) continue
    const p = garde.get(station)
    if (!p || date > p.date || (date === p.date && e.created_at > p.e.created_at)) {
      garde.set(station, { date, e })
    }
  }
  return new Map([...garde].map(([s, { e }]) => [s, e]))
}

/** Les balises que `publishBroadcast` reconstruira à partir du contenu. */
function balisesAttendues(c: Record<string, unknown>): Record<string, string> {
  return {
    d:          `${c.stationId}:${c.date}`,
    station:    String(c.stationId),
    date:       String(c.date),
    lang:       String(c.language),
    duration:   String(Math.round(Number(c.durationSec))),
    t:          'radio-broadcast',
    visibility: 'public',
  }
}

/** `null` si l'événement se reconstruit à l'identique, sinon la raison. */
export function pourquoiNonReconstructible(e: EvenementNostr): string | null {
  let c: Record<string, unknown>
  try { c = JSON.parse(e.content) } catch { return 'contenu illisible (JSON invalide)' }
  if (!c || typeof c !== 'object') return 'contenu qui n\'est pas un objet'

  for (const k of Object.keys(c)) {
    if (!(CLES_CONTENU as readonly string[]).includes(k)) return `clé de contenu inconnue « ${k} » — elle serait perdue`
  }
  if (typeof c.audioCid !== 'string' || !c.audioCid) return 'aucun audioCid'

  const attendues = balisesAttendues(c)
  const vues = new Set<string>()
  for (const t of e.tags) {
    const [nom, valeur, ...reste] = t
    if (reste.length) return `balise « ${nom} » à plusieurs valeurs — elles seraient perdues`
    if (vues.has(nom)) return `balise « ${nom} » en double`
    vues.add(nom)
    if (!(nom in attendues)) return `balise inconnue « ${nom} » — elle serait perdue`
    if (attendues[nom] !== valeur) return `balise « ${nom} » : « ${valeur} » deviendrait « ${attendues[nom]} »`
  }
  for (const nom of Object.keys(attendues)) {
    if (!vues.has(nom)) return `balise « ${nom} » absente — la republication l'ajouterait`
  }
  return null
}

/** Faut-il republier ? Oui tant que l'émission n'est pas au format publié. */
export function aReemballer(contenu: Record<string, unknown>): boolean {
  return contenu.audioMime !== FORMAT_EMISSION.mime
}

/**
 * `generatedAt` d'une republication : STRICTEMENT plus récent que l'ancien.
 *
 * 🔴 L'application départage deux versions d'une émission sur `generatedAt`
 * — le contenu — et non sur `created_at` :
 *
 *   if (existing && existing.generatedAt >= parsed.generatedAt) return
 *   (infinity, src/modules/radio/broadcast/broadcast-store-nostr.ts)
 *
 * À valeur ÉGALE, la première version reçue gagne. Or les relais que la
 * republication n'a pas atteints servent encore l'ancienne, en Ogg : garder
 * l'horodatage d'origine laissait l'application choisir l'émission muette
 * selon l'ordre d'arrivée des relais.
 */
export function horodatageDeRepublication(ancien: unknown, maintenant: number): number {
  const a = Number(ancien)
  return Number.isFinite(a) ? Math.max(maintenant, a + 1) : maintenant
}

/**
 * Déjà en WebM, mais republiée avec son horodatage d'origine — avant que ce
 * défaut ne soit vu. Une émission produite par la nuit a `generatedAt` et
 * `created_at` à quelques secondes l'un de l'autre ; un écart de plus d'une
 * heure trahit une republication à rehorodater.
 */
export function aRehorodater(e: EvenementNostr): boolean {
  let c: Record<string, unknown>
  try { c = JSON.parse(e.content) } catch { return false }
  const g = Number(c.generatedAt)
  return c.audioMime === FORMAT_EMISSION.mime && Number.isFinite(g) && e.created_at - g > 3600
}
