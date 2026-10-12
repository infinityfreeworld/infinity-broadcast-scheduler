/**
 * @module InfinityScheduler/Lib/VoixZh
 * @description 🇨🇳 自由之声 : la voix PRINCIPALE du chinois est Kokoro zh (12/10/2026, validé par Med).
 *
 *   Constat (transcriptions whisper -l zh des émissions publiées) : 03/10, 07/10 et 11/10 en chinois
 *   clair ; 05/10 en charabia. La voix clonée chinoise de data-space (inv-zy-mei, inv-zy-jian) est
 *   INSTABLE d'une nuit à l'autre, surtout file pleine ; le 11/10, 19 tours sur 21 sont sortis
 *   défectueux (blanc 8, chuchotement 12) et c'est la voix de secours Kokoro zh qui a sauvé
 *   l'émission. Kokoro donne la même voix par animateur, chaque nuit.
 *
 *   ── LE RÉGLAGE ──
 *     ZH_VOIX_CLONEE=1   tente la voix clonée pour le chinois (ÉTEINT par défaut). Même alors, un tour
 *                        cloné n'est gardé que si l'oreille de contrôle CONFIRME le texte (verdict
 *                        « bon ») ; sinon — oreille absente, doute, défaut audio — il est dit en Kokoro,
 *                        qui est la voix voulue : ce n'est pas un « repli » et la règle de publication
 *                        ne le compte pas comme tel.
 */

/** Langues dont la voix locale (Kokoro) est la voix VOULUE, pas un repli. */
export function voixLocalePrincipale(langue: string): boolean {
  return langue === 'zh'
}

/** La voix clonée est-elle demandée pour le chinois ? (ZH_VOIX_CLONEE=1, exactement) */
export function cloneZhDemande(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.ZH_VOIX_CLONEE === '1'
}

/**
 * La voix clonée à demander pour un tour, ou `null` (voix locale). Pour le chinois : `null` sauf si
 * ZH_VOIX_CLONEE=1. Pour les autres langues : inchangé. Pure.
 */
export function voixPersonnagePourLangue(langue: string, voix: string | null | undefined, env: NodeJS.ProcessEnv = process.env): string | null {
  if (!voix) return null
  if (voixLocalePrincipale(langue) && !cloneZhDemande(env)) return null
  return voix
}
