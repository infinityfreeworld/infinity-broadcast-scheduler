/**
 * @module InfinityScheduler/TV/SujetsEcosysteme
 * @description Quand l'application n'a encore rien de RÉEL à raconter, la télévision la
 *   PRÉSENTE — elle ne remplit plus avec l'actualité d'ailleurs.
 *
 *   🚨 POURQUOI. Retour du Bâtisseur (09/09/2026) : « les thèmes doivent ABSOLUMENT concerner les
 *   sujets de l'application, comme les DAV, les Manifestactions, les projets proposés dans
 *   Abondance ». Mesuré le 10/09 au soir : aucune activité réelle récente sur les relais (27 events
 *   étrangers et une Manifestaction de test). Le JT a donc été rempli avec Reporterre et Mr
 *   Mondialisation — exactement ce qui était refusé.
 *
 *   Avant l'ouverture publique (23/09/2026), c'est l'état NORMAL, pas une panne : il n'y a pas
 *   encore d'utilisateurs pour agir. Une télévision d'écosystème peut alors faire ce qu'aucune
 *   autre ne fait : expliquer comment ça marche.
 *
 *   ⚠️ UNE SEULE VÉRITÉ. Ces textes reprennent les fiches d'aide de l'application
 *   (`infinity/src/components/module-help/module-help-content.ts`). Si une fiche change, celle-ci
 *   doit suivre — le test de contrat les compare quand les deux dépôts sont sur la même machine.
 *   ⚠️ Ce ne sont PAS des événements : le conducteur est instruit de ne leur inventer ni
 *   participants, ni chiffres, ni lieu.
 */
import type { NewsItem } from '../lib/types'

export const SOURCE_PRESENTATION = "Présentation d'Infinity"

/**
 * ⚠️ CHAQUE RÉSUMÉ TIENT EN 180 CARACTÈRES : `formatNewsForPrompt` coupe au-delà, et la première
 * version perdait ainsi sa dernière phrase — celle qui dit À QUOI sert le module.
 */
export const SUJETS_ECOSYSTEME: ReadonlyArray<NewsItem> = [
  {
    title: "Les Manifestactions Hors de l'Enclos (MHE)",
    summary:
      "Des actions d'entraide communautaire concrètes : on les crée, on les suit dans le Moniteur, "
      + "on les explore sur la carte. Pour passer de l'écran à l'action, près de chez soi.",
    sourceTitle: SOURCE_PRESENTATION,
  },
  {
    title: 'Abondance',
    summary:
      "L'économie d'entraide et le financement participatif du collectif : projets, concours, "
      + 'marché, contributions. Pour financer ensemble ce qui sert le vivant.',
    sourceTitle: SOURCE_PRESENTATION,
  },
  {
    title: 'Palatine et la DAV',
    summary:
      "L'espace de gouvernance biocratique : motions de la DAV, propositions et votes de "
      + "l'Assemblée, constitution. Pour décider ensemble, de façon transparente.",
    sourceTitle: SOURCE_PRESENTATION,
  },
]

/**
 * Choisit `n` présentations, en tournant chaque jour : trois soirées de suite ne commencent pas
 * par le même module. Déterministe (même jour → même choix), donc rejouable.
 */
export function choisirSujetsEcosysteme(n: number, jour = new Date()): NewsItem[] {
  if (n <= 0) return []
  const debut = Math.floor(jour.getTime() / 86400_000) % SUJETS_ECOSYSTEME.length
  return Array.from({ length: Math.min(n, SUJETS_ECOSYSTEME.length) },
    (_, i) => SUJETS_ECOSYSTEME[(debut + i) % SUJETS_ECOSYSTEME.length])
}
