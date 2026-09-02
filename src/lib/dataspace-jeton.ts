/**
 * @module InfinityScheduler/DataSpaceJeton
 * @description Dérive le jeton data-space d'une clé NOSTR, par preuve
 *   NIP-98 (kind 27235).
 *
 *   ── POURQUOI CE MODULE EXISTE ──
 *   Le jeton `ds_live_…` EXPIRE. Le poser en secret de CI oblige à le
 *   rafraîchir à la main, et le jour où il expire, la nuit se déroule
 *   « normalement » : le dépôt principal refuse, Pinata prend le relais,
 *   et personne ne voit qu'on a cessé d'être souverain.
 *
 *   La CLÉ, elle, ne périme pas. Un secret stable remplace donc un secret
 *   périssable, et c'est le seul geste qui rende la souveraineté durable
 *   sans intervention mensuelle.
 *
 *   ── ⚠️ L'HEURE, PAS LA SIGNATURE ──
 *   La fenêtre NIP-98 est de ± 60 s. Ce Mac retarde de ~124 s : signer sur
 *   l'horloge locale rend un 401 qu'on impute naturellement à la clé,
 *   alors que la clé est bonne. On prend donc `created_at` sur l'en-tête
 *   `Date` du SERVEUR, et l'horloge locale seulement en dernier recours.
 *
 *   ── ⚠️ LA MARQUE ──
 *   Le mot « Infinity » ne doit apparaître ni dans l'URL ni dans les
 *   en-têtes (docs/dataspace-provisioning.md §2). Vérifié avant l'envoi.
 */

import { finalizeEvent, getPublicKey } from 'nostr-tools/pure'

const URL_PROVISION = 'https://data-space.world/api/pinning/provision'

/** Heure du serveur en secondes — la seule référence qui compte. */
async function horlogeServeur(): Promise<{ t: number; source: 'serveur' | 'locale' }> {
  try {
    const r = await fetch('https://data-space.world/', {
      method: 'HEAD', signal: AbortSignal.timeout(15_000),
    })
    const d = r.headers.get('date')
    if (d) {
      const t = Math.floor(new Date(d).getTime() / 1000)
      if (Number.isFinite(t) && t > 0) return { t, source: 'serveur' }
    }
  } catch { /* on retombe sur l'horloge locale */ }
  return { t: Math.floor(Date.now() / 1000), source: 'locale' }
}

/**
 * La marque ne doit pas fuiter dans la requête de provisionnement.
 * Exportée pour être éprouvée : un garde qu'on ne peut pas tester est un
 * commentaire.
 */
export function marqueAbsente(entetes: Record<string, string>, url: string): boolean {
  return !(JSON.stringify(entetes) + ' ' + url).toLowerCase().includes('infinity')
}

/**
 * Rend un jeton data-space utilisable, ou lève en disant POURQUOI.
 *
 * 🔴 Ne rend JAMAIS de chaîne vide : un jeton vide ferait un 401 plus
 * loin, imputé au service alors que la cause est ici.
 */
export async function deriverJeton(cleHex: string): Promise<string> {
  if (!/^[0-9a-f]{64}$/i.test(cleHex)) {
    throw new Error('DATASPACE_NOSTR_KEY : 64 caractères hexadécimaux attendus')
  }
  const sk = Uint8Array.from(Buffer.from(cleHex, 'hex'))
  const { t, source } = await horlogeServeur()
  const derive = t - Math.floor(Date.now() / 1000)
  console.log(`  [data-space] horloge ${source}${source === 'serveur'
    ? ` — dérive de ce poste ${derive >= 0 ? '+' : ''}${derive} s, compensée (fenêtre ±60 s)`
    : ' — ⚠️ un 401 sera probablement un problème d\'HEURE, pas de clé'}`)

  // Le tag `u` doit correspondre EXACTEMENT à l'URL appelée.
  const event = finalizeEvent(
    { kind: 27235, created_at: t, tags: [['u', URL_PROVISION], ['method', 'POST']], content: '' },
    sk,
  )
  const entetes = {
    Authorization: `Nostr ${Buffer.from(JSON.stringify(event)).toString('base64')}`,
  }
  if (!marqueAbsente(entetes, URL_PROVISION)) {
    throw new Error('La marque apparaît dans la requête de provisionnement — interdit.')
  }

  const resp = await fetch(URL_PROVISION, {
    method: 'POST', headers: entetes, signal: AbortSignal.timeout(30_000),
  })
  const brut = await resp.text()
  if (!resp.ok) {
    const indice = resp.status === 401
      ? ' (401 = preuve absente, invalide ou EXPIRÉE — vérifier l\'heure avant la clé)'
      : resp.status === 429 ? ' (429 = trop de demandes pour cette clé)' : ''
    throw new Error(`provision HTTP ${resp.status}${indice} : ${brut.slice(0, 200)}`)
  }
  let data: { token?: string }
  try {
    data = JSON.parse(brut) as { token?: string }
  } catch {
    throw new Error(`provision : 200 mais réponse illisible — ${brut.slice(0, 200)}`)
  }
  if (!data.token) throw new Error(`provision : 200 sans jeton — ${brut.slice(0, 200)}`)
  console.log(`  [data-space] jeton dérivé pour ${getPublicKey(sk).slice(0, 12)}…`)
  return data.token
}

/**
 * Le jeton à utiliser : celui donné, sinon dérivé de la clé.
 *
 * Rend '' si aucun des deux n'est configuré — l'appelant décide alors de
 * se replier sur Pinata, en le DISANT.
 */
export async function jetonDataspace(): Promise<string> {
  const direct = process.env.DATASPACE_API_KEY ?? ''
  if (direct) return direct
  const cle = process.env.DATASPACE_NOSTR_KEY ?? ''
  if (!cle) return ''
  return deriverJeton(cle)
}
