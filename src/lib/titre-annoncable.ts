/**
 * @module InfinityScheduler/TitreAnnoncable
 * @description LA RÈGLE qui dit si un titre de morceau peut être annoncé à l'antenne (14/10/2026).
 *
 *   Demande de Med : « JAMAIS de titre annoncé si le titre n'est qu'un numéro » (« 01 »,
 *   « Piste 3 », « track_12 »…). L'application applique la même règle à la lecture
 *   (`titreAnnoncable()` de `src/modules/radio/broadcast/interventions.ts`) : le générateur ne
 *   fabrique donc jamais une annonce que l'app refuserait de jouer.
 *
 *   ⚠️ La fonction et `MOTS_GENERIQUES` sont RECOPIÉS À L'IDENTIQUE depuis l'app. Les deux dépôts
 *   l'éprouvent avec le même fichier de cas (`__tests__/cas-titre-annoncable.json`, à recopier
 *   dans l'app). Ne la modifie jamais d'un seul côté. Aucun import.
 */

/**
 * Un titre peut-il être annoncé à l'antenne ? Jamais un simple numéro : « 01 », « Piste 3 »,
 * « track_12 », « Audio-0003.mp3 », « 7. », « #4 »… — dire « voici 01 » sonne faux.
 */
export function titreAnnoncable(titre: string | undefined | null): boolean {
  if (!titre) return false
  const t = titre.trim().replace(/\.(mp3|ogg|opus|wav|flac|m4a|aac|webm)$/i, '')
  // Les mots qui restent une fois retirés chiffres, séparateurs et mots « génériques ».
  const mots = t.split(/[\d\s_\-#.,:;()[\]/\\|+*'"«»°]+/).filter(Boolean)
  const significatifs = mots.filter(m => /\p{L}/u.test(m) && !MOTS_GENERIQUES.test(m))
  return significatifs.some(m => m.replace(/[^\p{L}]/gu, '').length >= 2 || /[\u3400-\u9fff\uac00-\ud7af]/.test(m))
}

/** Ce qui ne fait pas un titre : « Piste », « Track », « Audio », « Untitled »… (+ « n », « no »). */
const MOTS_GENERIQUES = /^(pistes?|tracks?|titres?|morceaux?|audio|songs?|chansons?|sons?|sounds?|music|musiques?|untitled|sans|unknown|inconnu|no|n|nr|num|numero|numéro|file|fichier|rec|take|clip)$/i
