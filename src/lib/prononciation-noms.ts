/**
 * @module InfinityScheduler/PrononciationNoms
 * @description Les NOMS d'Infinity dits correctement par une voix FRANÇAISE (12/10/2026, Med).
 *
 *   « OBF est prononcé "obeuf" alors que ça devrait être prononcé O.B.F (sans dire les points) ;
 *   Biogame doit être prononcé en anglais, comme game. »
 *
 *   Le sigle est réécrit en lettres PHONÉTIQUES (« Ô Bé Èf ») : avec des points ou des tirets, une voix
 *   neuronale peut lire « point » / « tiret », ou recoller les lettres en un mot. « Biogame » garde
 *   « bio » à la française et prend « game » à l'anglaise, comme le dictionnaire des mots anglais
 *   (`frenchify-english.ts` : game → guéïme).
 *
 *   À n'appliquer QU'au texte envoyé à la synthèse — jamais au transcript (les sous-titres gardent « OBF »).
 */

/** Sigle → lettres dites. Majuscules seulement : « obf » en minuscules n'est pas le sigle. */
const SIGLES: Record<string, string> = {
  OBF: 'Ô Bé Èf',
}

const RE_SIGLES = new RegExp(`(?<![\\p{L}\\p{N}])(${Object.keys(SIGLES).join('|')})(?![\\p{L}\\p{N}])`, 'gu')
const RE_BIOGAME = /(?<![\p{L}\p{N}])([Bb])io[- ]?[Gg]ame(s?)(?![\p{L}\p{N}])/gu

/** Le texte pour une voix française : sigles épelés, Biogame à l'anglaise. Idempotent. */
export function prononcerNomsInfinity(texte: string): string {
  return texte
    .replace(RE_SIGLES, s => SIGLES[s] ?? s)
    .replace(RE_BIOGAME, (_m, b: string, s: string) => `${b}io-guéïme${s}`)
}
