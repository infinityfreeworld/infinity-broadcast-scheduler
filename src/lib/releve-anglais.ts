/**
 * @module InfinityScheduler/Lib/ReleveAnglais
 * @description La ligne du journal de la nuit qui liste, en fin d'émission, les
 *   mots probablement anglais que le dictionnaire de `frenchify-english.ts` ne
 *   couvre pas encore (04/10/2026 — « le système a du mal à détecter les mots
 *   anglais pour les voix françaises », Bâtisseur). On les écoute, puis on les
 *   ajoute au dictionnaire — dans l'app ET ici, les deux copies restent identiques.
 *
 *   Le relevé porte sur ce que la voix reçoit (texte nettoyé), stations
 *   françaises seulement. Pur, sans effet.
 */
import { releverMotsAnglaisInconnus } from './frenchify-english'
import { sanitizeForSpeech } from './tts-sanitize'

/** `null` hors station française ; sinon une ligne lisible, « aucun » compris. */
export function ligneMotsAnglaisNonCouverts(textes: readonly string[], langue: string): string | null {
  if (langue !== 'fr') return null
  const mots = releverMotsAnglaisInconnus(textes.map(sanitizeForSpeech).join('\n'))
  return `Mots anglais non couverts : ${mots.length > 0 ? mots.join(', ') : 'aucun'}`
}
