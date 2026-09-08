/**
 * @module InfinityScheduler/Lib/Coffre
 * @description Chiffrement d'une archive avant dépôt — AES-256-GCM.
 *
 *   ⚠️ Ces fonctions vivent ICI et non dans le script qui les utilise :
 *   un test qui importe un script l'EXÉCUTE. Erreur déjà commise le
 *   07/09 avec `verifier-voix.ts`, refaite le 08/09 avec
 *   `deposer-archive.ts` — dont le `main()` partait sur le réseau et
 *   faisait échouer tout le fichier de test.
 *
 *   ── POURQUOI CHIFFRER ──
 *   Notre archive git déposée en clair était lisible sans jeton : 200,
 *   321 557 octets, clonable, 62 commits. Et data-space annonçait le CID
 *   à la DHT mondiale, deux fournisseurs sur deux continents. Un contenu
 *   publié une fois est public à jamais.
 */
import { randomBytes, createCipheriv, createDecipheriv } from 'node:crypto'

/**
 * `nonce(12) || tag(16) || chiffré`.
 *
 * Le nonce est TIRÉ à chaque fois : sans lui, deux archives identiques
 * donneraient le même bloc, et un observateur saurait que rien n'a changé
 * cette nuit-là. GCM authentifie : une clé fausse LÈVE au lieu de rendre
 * du charabia qu'on restaurerait en croyant avoir récupéré.
 */
export function chiffrer(clair: Buffer, cle: Buffer): Buffer {
  const nonce = randomBytes(12)
  const c = createCipheriv('aes-256-gcm', cle, nonce)
  const chiffre = Buffer.concat([c.update(clair), c.final()])
  return Buffer.concat([nonce, c.getAuthTag(), chiffre])
}

export function dechiffrer(paquet: Buffer, cle: Buffer): Buffer {
  const d = createDecipheriv('aes-256-gcm', cle, paquet.subarray(0, 12))
  d.setAuthTag(paquet.subarray(12, 28))
  return Buffer.concat([d.update(paquet.subarray(28)), d.final()])
}
