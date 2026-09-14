/**
 * @module InfinityScheduler/Lib/DejaDiffuse
 * @description 🛡️ Anti-doublon de la diffusion (14/09/2026).
 *
 *   Plusieurs producteurs peuvent fabriquer la même nuit : le Mac, le secours GitHub, bientôt
 *   l'usine de nuit. Avant de dépenser un seul jeton, on regarde sur les relais si l'émission de
 *   (station, date) est DÉJÀ publiée — et signée par NOTRE clé : une émission du même identifiant
 *   signée par quelqu'un d'autre ne compte pas.
 *
 *   ⚠️ Un relais muet ne prouve rien. Si la lecture échoue, on rend `null` et l'appelant PRODUIT :
 *   mieux vaut payer deux fois qu'un soir sans émission — et l'évènement remplaçable (même `d`)
 *   écrase le doublon côté relais.
 */
import { SimplePool } from 'nostr-tools/pool'

export interface EvenementLu { pubkey: string; tags: string[][] }
export type Requete = (relais: string[], filtre: Record<string, unknown>, maxWaitMs: number) => Promise<EvenementLu[]>

const requeteParDefaut: Requete = async (relais, filtre, maxWaitMs) => {
  const pool = new SimplePool()
  try {
    return await pool.querySync(relais, filtre as never, { maxWait: maxWaitMs })
  } finally {
    pool.close(relais)
  }
}

/**
 * Les identifiants `d` (parmi ceux demandés) déjà publiés par `auteur`. `null` = lecture impossible.
 */
export async function dTagsPublies(
  kind: number,
  dTags: string[],
  auteur: string,
  relais: string[],
  requete: Requete = requeteParDefaut,
  maxWaitMs = 8000,
): Promise<Set<string> | null> {
  if (dTags.length === 0) return new Set()
  try {
    const evts = await requete(relais, { kinds: [kind], authors: [auteur], '#d': dTags }, maxWaitMs)
    const vus = new Set<string>()
    for (const e of evts) {
      if (e.pubkey !== auteur) continue   // un relais peut mentir sur le filtre : on revérifie
      const d = e.tags.find(t => t[0] === 'd')?.[1]
      if (d && dTags.includes(d)) vus.add(d)
    }
    return vus
  } catch {
    return null
  }
}
