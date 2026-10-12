/**
 * @module InfinityScheduler/Lib/VidageEmissions
 * @description 🧹 Préparer le VIDAGE des vieilles émissions sur les RELAIS (pur, éprouvé sans réseau).
 *
 *   Relevé du 12/10/2026 (lecture seule) : 1 355 événements 30093 sur les relais, dont ~880 pointent un
 *   audio que plus aucune passerelle ne sert — le dépôt data-space applique déjà la rétention de 10 jours
 *   (`purger-emissions.ts`, dépinglage), mais les ÉVÉNEMENTS restent. Ce module choisit lesquels retirer
 *   (plus vieux que N jours, signés par NOTRE clé) et prépare les demandes de suppression NIP-09
 *   (kind 5, tags `a` = `30093:<clé>:<d>`), par paquets.
 *
 *   🔴 RIEN N'EST SUPPRIMÉ SANS L'ACCORD DE MED. Le script (`vider-emissions.ts`) est À BLANC par défaut.
 */
export interface EmissionRelais {
  pubkey: string
  d:      string
}

const D = /^([a-z0-9][a-z0-9-]{0,62}):(\d{4}-\d{2}-\d{2})$/

/** La date d'une émission d'après son d-tag (`station:AAAA-MM-JJ`), ou null. */
export function dateDuD(d: string): string | null {
  return D.exec(d)?.[2] ?? null
}

/**
 * Les émissions à retirer : signées par `notreCle`, datées STRICTEMENT avant `aujourdhui − jours`.
 * Un d-tag illisible est GARDÉ (on ne supprime que ce qu'on reconnaît). Sans doublon.
 */
export function aRetirer(emissions: readonly EmissionRelais[], notreCle: string, aujourdhui: string, jours: number): EmissionRelais[] {
  const [a, m, j] = aujourdhui.split('-').map(x => Number.parseInt(x, 10))
  const limite = new Date(Date.UTC(a, m - 1, j - jours)).toISOString().slice(0, 10)
  const vus = new Set<string>()
  const sortie: EmissionRelais[] = []
  for (const e of emissions) {
    if (e.pubkey !== notreCle) continue
    const date = dateDuD(e.d)
    if (!date || date >= limite || vus.has(e.d)) continue
    vus.add(e.d)
    sortie.push(e)
  }
  return sortie
}

/** Les modèles d'événements de suppression NIP-09 (kind 5), `parPaquet` adresses au plus chacun. */
export function demandesSuppression(liste: readonly EmissionRelais[], createdAt: number, parPaquet = 100) {
  const paquets: Array<{ kind: number; created_at: number; tags: string[][]; content: string }> = []
  for (let i = 0; i < liste.length; i += parPaquet) {
    const tranche = liste.slice(i, i + parPaquet)
    paquets.push({
      kind: 5, created_at: createdAt, content: 'Émissions de plus de 10 jours : audio retiré du dépôt.',
      tags: [...tranche.map(e => ['a', `30093:${e.pubkey}:${e.d}`]), ['k', '30093']],
    })
  }
  return paquets
}
