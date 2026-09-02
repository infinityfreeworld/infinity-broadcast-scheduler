/**
 * @module InfinityScheduler/Lib/VoixCatalogue
 * @description Le nom de voix réellement envoyé sur le fil, et la lecture
 *   du catalogue distant de data-space.
 *
 *   ⚠️ Ces deux fonctions vivent ici, et non dans le script qui les
 *   utilise, pour une raison concrète : un test qui importe un script
 *   l'EXÉCUTE. La première version de ce garde importait
 *   `scripts/verifier-voix.ts`, dont le `main()` de bas de fichier partait
 *   aussitôt sur le réseau — les cinq assertions passaient, et le fichier
 *   de test échouait quand même, quinze secondes plus tard.
 */

/**
 * Le nom demandé au service — la SEULE chose qui compte.
 *
 * 🔴 Aucune normalisation de notre côté ne peut deviner le nom déclaré du
 * leur : « alain » reste « alain.wav », il ne devient jamais
 * « alain-morale.wav ». C'est pourquoi confronter les deux listes est
 * nécessaire, et pourquoi un suffixe ne rattrape rien.
 */
export function nomDemande(voix: string): string {
  return voix.endsWith('.wav') ? voix : `${voix}.wav`
}

/**
 * Lit le catalogue de data-space.
 *
 * Un catalogue VIDE LÈVE : c'est l'état exact dans lequel toute synthèse
 * échoue par `404 voice_not_found`. Rendre un ensemble vide ferait passer
 * toutes les vérifications au vert précisément là où rien ne marche.
 */
export async function catalogueDistant(): Promise<Set<string>> {
  const base = (process.env.CHATTERBOX_TTS_URL ?? 'https://data-space.world').replace(/\/+$/, '')
  const cle = process.env.DATASPACE_API_KEY ?? ''
  const res = await fetch(`${base}/api/v1/gpu/voix/catalogue`, {
    headers: cle ? { Authorization: `Bearer ${cle}` } : {},
    signal:  AbortSignal.timeout(60_000),
  })
  if (!res.ok) throw new Error(`catalogue HTTP ${res.status}`)
  const j = await res.json() as { voices?: Array<{ nom?: string }> }
  const noms = (j.voices ?? []).map(v => v.nom).filter((n): n is string => !!n)
  if (noms.length === 0) throw new Error('catalogue VIDE — aucune voix déclarée')
  return new Set(noms)
}
