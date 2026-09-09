/**
 * @module InfinityScheduler/Lib/Retention
 * @description Décide quels fichiers d'un dépôt IPFS doivent disparaître.
 *
 *   Règle du Bâtisseur (07/09/2026) : **les émissions vivent 10 jours,
 *   puis libèrent la place.** Elles sont datées, remplaçables, et
 *   personne ne réécoute une matinale de la semaine dernière.
 *
 *   🔴 CE QUI NE DOIT JAMAIS DISPARAÎTRE
 *   Le même dépôt contient les **voix de référence** (29 fichiers, 133 Mo)
 *   et les **modèles Piper** (9 fichiers, 600 Mo). Ce sont des actifs
 *   permanents : les perdre, c'est perdre les voix de l'antenne, et les
 *   originaux ne se retrouvent pas.
 *
 *   Une purge par ÂGE seul les emporterait tous au bout de dix jours.
 *   D'où une règle qui n'autorise la suppression que de ce qu'elle
 *   RECONNAÎT comme émission — jamais l'inverse. Un fichier inconnu est
 *   gardé : le coût d'un fichier de trop est quelques mégaoctets, celui
 *   d'un fichier de moins est une voix perdue pour toujours.
 */

/** Un fichier tel que data-space le décrit. */
export interface FichierDepot {
  cid:        string
  name:       string
  size:       number
  created_at: string
}

/**
 * Une émission, et rien d'autre : `broadcast-<station>-<AAAA-MM-JJ>.opus`.
 * C'est le nom que `generate-broadcast.ts` donne à ce qu'il dépose.
 */
export const MOTIF_EMISSION = /^broadcast-[a-z0-9-]+-\d{4}-\d{2}-\d{2}\.(opus|wav|mp3)$/

export function estUneEmission(nom: string): boolean {
  return MOTIF_EMISSION.test(nom)
}

/** Âge en jours, d'après l'horodatage du dépôt. */
export function ageEnJours(f: FichierDepot, maintenant = Date.now()): number {
  const t = Date.parse(f.created_at)
  if (!Number.isFinite(t)) return Number.NaN
  return (maintenant - t) / 86_400_000
}

export interface Verdict {
  aSupprimer: FichierDepot[]
  gardes:     FichierDepot[]
  /** Ce qui n'a pas pu être jugé — gardé, et DIT. */
  indecidables: FichierDepot[]
}

/**
 * Trie les fichiers en trois tas.
 *
 * ⚠️ Un horodatage illisible rend le fichier INDÉCIDABLE, jamais
 * supprimable : `NaN > 10` est faux, mais s'en remettre à ce hasard
 * reviendrait à laisser une comparaison flottante décider du sort d'une
 * voix. On le dit explicitement.
 */
export function trier(
  fichiers: readonly FichierDepot[],
  jours = 10,
  maintenant = Date.now(),
): Verdict {
  const aSupprimer: FichierDepot[] = []
  const gardes: FichierDepot[] = []
  const indecidables: FichierDepot[] = []
  for (const f of fichiers) {
    if (!estUneEmission(f.name)) { gardes.push(f); continue }
    const age = ageEnJours(f, maintenant)
    if (!Number.isFinite(age)) { indecidables.push(f); continue }
    if (age > jours) aSupprimer.push(f)
    else gardes.push(f)
  }
  return { aSupprimer, gardes, indecidables }
}
