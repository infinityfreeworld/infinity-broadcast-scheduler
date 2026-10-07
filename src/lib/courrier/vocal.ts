/**
 * @module InfinityScheduler/Courrier/Vocal
 * @description Le message VOCAL d'un auditeur : récupéré CHIFFRÉ (data-space / Blossom), vérifié
 *   (SHA-256 du chiffré annoncé dans le message), déchiffré (AES-256-GCM, la clé ne voyage que
 *   dans le message chiffré NIP-59), puis décodé en WAV mono pour la transcription et le montage.
 *
 *   Format du chiffré : celui de l'app (`encryptMedia` de `@infinity/core-messaging`, « one-shot »
 *   pour tout fichier de moins de 8 Mo — un vocal de 60 s en fait moins d'un). Le format par
 *   morceaux (« IENC2 ») n'est pas accepté ici : un vocal n'y arrive jamais.
 */
import { createHash, webcrypto } from 'node:crypto'
import type { DecodedWav } from '../audio'
import { decoderEnWavMono, telechargerPiste } from '../musique'
import { VOCAL_MAX_OCTETS, VOCAL_MAX_S, type VocalChiffre } from './protocole'

const enOctets = (hex: string): Uint8Array => Uint8Array.from(hex.match(/../g)!.map(h => Number.parseInt(h, 16)))

/** Vérifie l'empreinte puis déchiffre. Lève sur tout écart (jamais de charabia rendu). */
export async function dechiffrerVocal(chiffre: Uint8Array, v: Pick<VocalChiffre, 'cleHex' | 'ivHex' | 'sha256'>): Promise<Uint8Array> {
  const empreinte = createHash('sha256').update(chiffre).digest('hex')
  if (empreinte !== v.sha256) throw new Error('empreinte du vocal différente de celle annoncée')
  if (chiffre.length > VOCAL_MAX_OCTETS + 64) throw new Error('vocal trop gros')
  if (chiffre.length >= 5 && chiffre[0] === 0x49 && chiffre[1] === 0x45 && chiffre[2] === 0x4e && chiffre[3] === 0x43 && chiffre[4] === 0x32) {
    throw new Error('format par morceaux (IENC2) inattendu pour un vocal')
  }
  const cle = await webcrypto.subtle.importKey('raw', enOctets(v.cleHex), 'AES-GCM', false, ['decrypt'])
  const clair = await webcrypto.subtle.decrypt({ name: 'AES-GCM', iv: enOctets(v.ivHex) }, cle, chiffre)
  return new Uint8Array(clair)
}

/** Récupère, vérifie, déchiffre et décode le vocal (WAV mono au taux demandé, ≤ 60 s). */
export async function recupererVocal(
  v: VocalChiffre, sampleRate: number,
  deps: { telecharger?: (ref: { title: string; cid?: string; url?: string }) => Promise<Buffer> } = {},
): Promise<DecodedWav> {
  const telecharger = deps.telecharger ?? telechargerPiste
  let chiffre: Buffer | null = null
  let derniere: unknown = null
  // CID d'abord (passerelle data-space), puis l'adresse annoncée.
  for (const ref of [v.cid ? { title: 'vocal', cid: v.cid } : null, v.url ? { title: 'vocal', url: v.url } : null]) {
    if (!ref) continue
    try { chiffre = await telecharger(ref); break } catch (err) { derniere = err }
  }
  if (!chiffre) throw new Error(`vocal introuvable : ${(derniere as Error | null)?.message?.slice(0, 100) ?? 'aucune adresse'}`)
  const clair = await dechiffrerVocal(new Uint8Array(chiffre), v)
  return decoderEnWavMono(Buffer.from(clair), sampleRate, VOCAL_MAX_S)
}
