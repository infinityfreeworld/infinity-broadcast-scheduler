/**
 * @module InfinityScheduler/Data/VoixInventees
 * @description Voix INVENTÉES par défaut des animateurs — décision du fondateur du 14/09/2026.
 *
 *   Chaque voix est CONÇUE à partir d'une description (Qwen3-TTS VoiceDesign / VoxCPM2, Apache-2.0),
 *   puis reprise chaque nuit par Chatterbox (data-space). Aucune n'imite une personne réelle.
 *
 *   Clé `station:animateur`, valeur = nom de la voix au catalogue data-space.
 *
 *   ⚠️ Un choix fait dans l'admin (onglet « Voix Animateurs », kind 30095) passe TOUJOURS devant
 *   cette table : le fondateur doit « pouvoir remplacer les voix à tout moment ».
 *
 *   ⚠️ La table reste VIDE tant que les voix ne sont pas créées ET déposées au catalogue : une voix
 *   absente du catalogue rendrait `404 voice_not_found`, puis Piper — un échec qui ressemble à un
 *   réglage.
 */
export const VOIX_INVENTEES: Readonly<Record<string, string>> = Object.freeze({})

export function voixInventee(stationId: string, hostId: string): string | undefined {
  return VOIX_INVENTEES[`${stationId}:${hostId}`]
}
