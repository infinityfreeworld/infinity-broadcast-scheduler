/**
 * @module InfinityScheduler/Lib/VoixLicences
 * @description Quelles voix de synthèse ont le droit de sortir sur l'antenne
 *   d'un produit COMMERCIAL — et lesquelles n'en ont pas le droit.
 *
 *   ⚠️ MIROIR d'une décision prise ailleurs. La source de vérité est
 *   `infinity/src/modules/radio/ai/voix-licences.ts` (audit du 04/08/2026,
 *   révision du 21/08/2026). Toute évolution se décide LÀ-BAS, et se
 *   recopie ici. Ce fichier n'existe que parce que le scheduler est un
 *   dépôt séparé, sans accès au module PWA.
 *
 *   ── POURQUOI CE FICHIER ARRIVE SI TARD ──
 *   L'audit de licence n'avait été appliqué qu'à la PWA. Le scheduler, lui,
 *   a continué à publier des émissions synthétisées avec
 *   `fr_FR-tom-medium` (AGPLv3, copyleft fort) sur toutes les stations
 *   françaises. Constaté le 2026-09-01.
 *
 *   Le défaut par défaut est le REFUS : une voix inconnue de ce registre
 *   n'est pas commercialisable. Sinon une voix ajoutée sans déclarer sa
 *   licence se retrouverait à l'antenne parce que personne n'y a pensé.
 */

export interface LicenceVoix {
  /** Intitulé exact figurant sur la fiche du modèle HuggingFace. */
  licence:      string
  /** Utilisable dans un produit propriétaire vendu ? */
  commercial:   boolean
  /** Crédit OBLIGATOIRE (licences CC BY / CC BY-SA). */
  attribution?: string
  /** Pourquoi c'est refusé, quand ça l'est. */
  motifRefus?:  string
}

/**
 * Les refusées figurent délibérément dans ce registre : les retirer ferait
 * oublier POURQUOI elles ont été écartées, et quelqu'un les rebrancherait
 * de bonne foi.
 */
export const LICENCES_PIPER: Record<string, LicenceVoix> = {
  // ── Autorisées ─────────────────────────────────────────────────────
  'fr_FR-siwis-medium': {
    licence: 'CC BY 4.0', commercial: true,
    attribution: 'Voix française « siwis » — corpus SIWIS (Université d\'Édimbourg), CC BY 4.0',
  },
  'fr_FR-gilles-low': {
    licence: 'CC0', commercial: true,
  },
  'es_ES-davefx-medium': {
    licence: 'CC0', commercial: true,
  },
  'es_ES-sharvard-medium': {
    licence: 'CC BY 3.0', commercial: true,
    attribution: 'Voix espagnole « sharvard » — corpus Sharvard, CC BY 3.0',
  },
  'ru_RU-dmitri-medium': {
    licence: 'CC0', commercial: true,
  },
  'ru_RU-denis-medium': {
    licence: 'CC0', commercial: true,
  },
  // ── EN, audité le 2026-09-01 sur les MODEL_CARD HuggingFace ────────
  // La PWA sert l'anglais par Kokoro, qui vit dans le navigateur ; le
  // scheduler n'a que Piper, d'où cet audit propre à lui.
  'en_GB-cori-medium': {
    licence: 'domaine public', commercial: true,
  },
  'en_GB-alba-medium': {
    licence: 'CC BY 4.0', commercial: true,
    attribution: 'Voix anglaise « alba » — corpus CC BY 4.0',
  },
  'en_GB-northern_english_male-medium': {
    licence: 'CC BY-SA 4.0', commercial: true,
    attribution: 'Voix anglaise « northern english male » — CC BY-SA 4.0',
  },

  // ── REFUSÉES — ne pas rebrancher ───────────────────────────────────
  'fr_FR-tom-medium': {
    licence: 'AGPLv3', commercial: false,
    motifRefus: 'Copyleft fort : contamine un produit propriétaire. Écartée '
      + 'côté PWA le 04/08/2026 ; le scheduler l\'utilisait encore le '
      + '01/09/2026 pour TOUS les animateurs masculins francophones.',
  },
  'ru_RU-irina-medium': {
    licence: 'inconnue', commercial: false,
    motifRefus: 'Aucune licence déclarée. Absence de licence = absence de '
      + 'permission, jamais permission implicite.',
  },
  'ru_RU-ruslan-medium': {
    licence: 'CC BY-NC-SA 4.0', commercial: false,
    motifRefus: 'NonCommercial — exclusion explicite, sans ambiguïté.',
  },
  'en_US-ryan-medium': {
    licence: 'CC BY-NC-SA 4.0', commercial: false,
    motifRefus: 'NonCommercial — exclusion explicite (corpus RyanSpeech).',
  },
  'en_US-lessac-medium': {
    licence: 'Blizzard Challenge 2013', commercial: false,
    motifRefus: 'Licence de recherche propre au Blizzard Challenge, pas une '
      + 'licence libre. Non vérifiée comme commercialisable : refus par défaut.',
  },
  'zh_CN-huayan-medium': {
    licence: 'inconnue', commercial: false,
    motifRefus: 'Aucune licence déclarée, et c\'est la SEULE voix chinoise. '
      + 'Le chinois n\'a donc AUCUNE voix : on le refuse franchement plutôt '
      + 'que de le servir avec une voix étrangère sur des sinogrammes.',
  },
}

/**
 * Cette voix peut-elle sortir sur une antenne vendue ?
 * Une voix inconnue du registre rend `false` — le refus est le défaut.
 */
export function voixCommercialisable(voix: string): boolean {
  return LICENCES_PIPER[voix]?.commercial === true
}

export function licenceDe(voix: string): LicenceVoix | undefined {
  return LICENCES_PIPER[voix]
}

/**
 * Crédits réellement exigés. CC0 n'impose rien ; le citer noierait les
 * mentions qui, elles, sont obligatoires.
 */
export function attributionsRequises(): string[] {
  return Object.values(LICENCES_PIPER)
    .filter(l => l.commercial && l.attribution)
    .map(l => l.attribution as string)
    .sort()
}
