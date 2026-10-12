/**
 * @module InfinityScheduler/Lib/StationsDemandees
 * @description 🎯 La relance DEMANDÉE depuis l'IHL (Pirate › Radio › « Relancer ») : quelles stations
 *   lancer. Pure, éprouvée sans réseau.
 *
 *   La demande arrive par `workflow_dispatch` (entrée `stations`, liste séparée par des virgules), posée
 *   par le Worker `infinity-moderate` après vérification de la signature d'un administrateur radio. On
 *   ne lui fait pas confiance pour autant : seuls des identifiants de station CONNUS passent, dans
 *   l'ordre de la nuit (stations à voix clonée d'abord, cf. lister-stations.ts), sans doublon.
 *   Un identifiant inconnu est ignoré (et signalé), jamais interpolé dans une commande.
 */
const FORME_ID = /^[a-z0-9][a-z0-9-]{0,62}$/

export interface StationsDemandees {
  ids:       string[]
  inconnues: string[]
}

/** `brut` vide = pas de restriction (toutes les stations de `ordre`). */
export function stationsDemandees(ordre: readonly string[], brut: string | undefined): StationsDemandees {
  const demande = (brut ?? '').split(/[\s,]+/).map(s => s.trim().toLowerCase()).filter(Boolean)
  if (demande.length === 0) return { ids: [...ordre], inconnues: [] }
  const connues = new Set(ordre)
  const voulues = new Set<string>()
  const inconnues: string[] = []
  for (const d of demande) {
    if (FORME_ID.test(d) && connues.has(d)) voulues.add(d)
    else if (!inconnues.includes(d)) inconnues.push(d)
  }
  return { ids: ordre.filter(i => voulues.has(i)), inconnues }
}
