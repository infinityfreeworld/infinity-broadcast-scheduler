/**
 * @module InfinityScheduler/DataSpace
 * @description Dépôt IPFS chez data-space — épinglage SOUVERAIN des
 *   émissions, en remplacement de Pinata comme dépôt principal.
 *
 *   ── POURQUOI CHANGER DE DÉPÔT ──
 *   Pinata est un service commercial américain, et son offre gratuite
 *   plafonne à 1 Go. Ce plafond avait une conséquence que personne
 *   n'avait choisie : une purge automatique **supprimait nos propres
 *   émissions** pour rester sous le quota. Nous effacions nos archives
 *   pour continuer à diffuser.
 *
 *   data-space rend `storageMax` illimité (473 Mo utilisés, 0 %). Les
 *   émissions peuvent donc être conservées, et l'infrastructure est celle
 *   d'un partenaire de l'écosystème plutôt que d'un tiers commercial.
 *
 *   ── MESURÉ LE 02/09/2026, PAS SUPPOSÉ ──
 *   Un témoin de 64 Kio envoyé aux deux dépôts rend le MÊME CID
 *   (`QmekkPKhY4g4Sq7g6Gn3zUvVttekV7e6g2HFwWwFxJYkg2`) : même découpage,
 *   même multihash. Et les deux passerelles servent les deux encodages —
 *   `Qm…` (v0) comme `bafy…` (v1) — en 206, les quatre combinaisons
 *   vérifiées.
 *
 *   Conséquence : basculer le dépôt ne change RIEN côté application. Le
 *   CID publié reste résoluble partout, et les deux passerelles figurent
 *   déjà dans la liste du client.
 *
 *   ── LE DOUBLE ÉPINGLAGE RESTE ──
 *   Nos 14 premiers CID de voix ne répondaient plus sur AUCUNE passerelle
 *   parce qu'ils avaient été publiés sans jamais être épinglés : sur
 *   IPFS, publier n'est pas conserver. Un seul dépôt reste un point
 *   unique de défaillance — et data-space a rendu 429 sur sa propre
 *   passerelle le 01/09. Pinata continue donc en second, au mieux.
 */

export interface DepotResultat {
  cid:   string
  /** Octets tels que comptés par le dépôt, ou la taille envoyée à défaut. */
  size:  number
  depot: 'data-space' | 'pinata'
}

const URL_ENVOI = 'https://data-space.world/api/v1/upload'

/**
 * Lit le CID dans la réponse de data-space.
 *
 * ⚠️ Leur forme est `{"files":[{"cid":"Qm…","name":…,"size":…}]}`. Une
 * première version ne cherchait le CID qu'à la RACINE : elle a rapporté
 * 29 échecs sur 29 réussites le 02/09/2026, et failli faire renvoyer
 * 133 Mo. On cherche donc à tous les endroits plausibles, et on LÈVE si
 * on ne trouve pas — plutôt que de rendre une chaîne vide qui passerait
 * pour un CID.
 */
export function lireCid(texte: string): string {
  let j: Record<string, unknown>
  try {
    j = JSON.parse(texte) as Record<string, unknown>
  } catch {
    throw new Error(`data-space : réponse illisible — ${texte.slice(0, 200)}`)
  }
  const premier = Array.isArray(j.files) && j.files.length > 0
    ? (j.files[0] as Record<string, unknown>)
    : undefined
  const cid = premier?.cid ?? j.cid ?? j.CID ?? j.Hash
    ?? (j.data as Record<string, unknown> | undefined)?.cid
  if (typeof cid !== 'string' || cid.length === 0) {
    throw new Error(`data-space : réponse sans CID reconnaissable — ${texte.slice(0, 200)}`)
  }
  return cid
}

/** Dépose un fichier chez data-space et rend son CID. */
export async function dataspacePinFile(
  data:     Buffer,
  fileName: string,
  mimeType: string,
  cle:      string,
): Promise<DepotResultat> {
  const corps = new FormData()
  corps.append('file', new Blob([new Uint8Array(data)], { type: mimeType }), fileName)
  const res = await fetch(URL_ENVOI, {
    method:  'POST',
    headers: { Authorization: `Bearer ${cle}` },
    body:    corps,
    signal:  AbortSignal.timeout(300_000),
  })
  const texte = await res.text()
  if (!res.ok) throw new Error(`data-space HTTP ${res.status} : ${texte.slice(0, 200)}`)
  return { cid: lireCid(texte), size: data.length, depot: 'data-space' }
}
