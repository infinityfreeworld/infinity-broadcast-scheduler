/**
 * @module InfinityScheduler/Courrier/Enveloppes
 * @description La clé « courrier radio » et les enveloppes NIP-59 (gift-wrap 1059) du courrier
 *   des auditeurs : ouvrir celles qui nous sont adressées, en fabriquer pour les admins radio et
 *   pour notre propre registre. Même forme de « rumor » que la visibilité de l'app
 *   (`shared/visibility/rumor.ts`) : l'app sait les lire sans rien de neuf.
 *
 *   🔐 La clé secrète vient de `RADIO_COURRIER_NSEC` (nsec1… ou 64 hex), posée par le Bâtisseur.
 *   Elle n'est JAMAIS écrite, ni journalisée. Sans elle, le courrier est éteint (`cleCourrier`
 *   rend `null`) et l'émission se fait exactement comme avant.
 */
import { getPublicKey, verifyEvent } from 'nostr-tools/pure'
import type { Event as NostrEvent } from 'nostr-tools/core'
import * as nip44 from 'nostr-tools/nip44'
import * as nip59 from 'nostr-tools/nip59'
import { decode as nip19Decode } from 'nostr-tools/nip19'
import { hexToBytes } from '@noble/hashes/utils'

export const KIND_GIFT_WRAP = 1059
export const KIND_SEAL = 13
export const KIND_RUMOR = 14

export interface CleCourrier {
  priv: Uint8Array
  pub:  string
}

/** La clé du courrier, ou `null` (courrier éteint). Ne lève jamais, n'affiche jamais la clé. */
export function cleCourrier(env: NodeJS.ProcessEnv = process.env): CleCourrier | null {
  const brut = (env.RADIO_COURRIER_NSEC ?? '').trim()
  if (!brut) return null
  try {
    let priv: Uint8Array
    if (brut.startsWith('nsec1')) {
      const d = nip19Decode(brut)
      if (d.type !== 'nsec') return null
      priv = d.data as Uint8Array
    } else if (/^[0-9a-fA-F]{64}$/.test(brut)) {
      priv = hexToBytes(brut.toLowerCase())
    } else {
      return null
    }
    return { priv, pub: getPublicKey(priv) }
  } catch {
    return null
  }
}

/** Un « rumor » ouvert : son auteur PROUVÉ (signataire du sceau) et ses tags de visibilité. */
export interface Ouvert {
  auteur:   string
  creeLe:   number
  module:   string
  type:     string
  d:        string
  payload:  unknown
}

const tag = (tags: string[][], k: string): string | undefined => tags.find(t => t[0] === k)?.[1]

/**
 * Ouvre un gift-wrap adressé à `priv`. Règle stricte, comme l'app : le sceau doit être SIGNÉ, et
 * l'auteur du rumor doit être le signataire du sceau (sinon n'importe qui se ferait passer pour
 * un admin). `null` pour tout ce qui n'est pas un contenu de visibilité valide.
 */
export function ouvrir(wrap: NostrEvent, priv: Uint8Array): Ouvert | null {
  try {
    if (wrap.kind !== KIND_GIFT_WRAP) return null
    const seal = JSON.parse(nip44.decrypt(wrap.content, nip44.getConversationKey(priv, wrap.pubkey))) as NostrEvent
    if (!seal || seal.kind !== KIND_SEAL || !verifyEvent(seal)) return null
    const rumor = JSON.parse(nip44.decrypt(seal.content, nip44.getConversationKey(priv, seal.pubkey))) as {
      pubkey: string; created_at: number; tags: string[][]; content: string; kind: number
    }
    if (!rumor || rumor.pubkey !== seal.pubkey || !Array.isArray(rumor.tags)) return null
    const module = tag(rumor.tags, 'infinity_module')
    const type = tag(rumor.tags, 'infinity_type')
    const d = tag(rumor.tags, 'd')
    if (!module || !type || !d) return null
    if (tag(rumor.tags, 'infinity_op') === 'retract') return null
    return {
      auteur: rumor.pubkey.toLowerCase(),
      creeLe: Number(rumor.created_at) || 0,
      module, type, d,
      payload: JSON.parse(rumor.content),
    }
  } catch {
    return null
  }
}

/**
 * Fabrique les gift-wraps d'un contenu de visibilité, de `cle` vers chaque destinataire. Le
 * contenu est CHIFFRÉ : rien de `payload` n'apparaît en clair dans les événements rendus.
 */
export function envelopper(
  cle: CleCourrier, destinataires: readonly string[],
  meta: { module: string; type: string; d: string }, payload: unknown, maintenantS = Math.floor(Date.now() / 1000),
): NostrEvent[] {
  const uniques = [...new Set(destinataires.map(p => p.toLowerCase()).filter(p => /^[0-9a-f]{64}$/.test(p)))]
  const rumor = nip59.createRumor({
    kind: KIND_RUMOR,
    content: JSON.stringify(payload),
    tags: [
      ['infinity_module', meta.module],
      ['infinity_type', meta.type],
      ['d', meta.d],
      ...uniques.map(p => ['p', p]),
    ],
    created_at: maintenantS,
  }, cle.priv)
  return uniques.map(p => nip59.createWrap(nip59.createSeal(rumor, cle.priv, p), p))
}
