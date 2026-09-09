/**
 * @module InfinityScheduler/Lib/Voix
 * @description Choix de la voix Piper pour un animateur — **par LANGUE**
 *   d'abord, par animateur ensuite.
 *
 *   ── LE DÉFAUT QUE CE MODULE CORRIGE (constaté le 2026-09-01) ──
 *
 *   Le scheduler ne connaissait que deux voix, toutes deux françaises, et
 *   les distribuait par GENRE sans jamais regarder la langue de la
 *   station. Les stations non francophones étaient donc synthétisées par
 *   une voix française. Mesuré sur les émissions réellement publiées le
 *   29/08/2026, en secondes de son par caractère de texte :
 *
 *     fr  0,055  ×1,0      (référence)
 *     en  0,064  ×1,2
 *     es  0,066  ×1,2
 *     ru  0,487  ×8,8   ← svoboda-fm : 2 h 44 pour 22 tours
 *     zh  0,622  ×11,2  ← zi-you-zhi-sheng : 1 h 20 pour 22 tours
 *
 *   Le facteur ×9 à ×11 n'est pas un accent : espeak-ng, à qui l'on donne
 *   du cyrillique ou des sinogrammes avec une voix française, ÉPELLE les
 *   caractères un par un. Ces deux stations diffusaient des heures de
 *   caractères épelés.
 *
 *   ── LANGUES SANS VOIX ──
 *   Toutes les langues n'ont pas de voix commercialisable. Le refus est
 *   FRANC : `voixPourLangue` rend null, et l'appelant renonce à générer
 *   la station. Une voix étrangère produirait du son — donc aucune
 *   alerte — et de l'incompréhensible. Voir `voix-licences.ts`.
 */

import type { StationLanguage } from './types'
import { voixCommercialisable } from './voix-licences'

export type Genre = 'male' | 'female' | 'androgyn'

/**
 * Voix françaises par animateur — timbres choisis pour chaque personnage.
 *
 * ⚠️ Ces animateurs pointaient tous vers `fr_FR-tom-medium` (AGPLv3) ou
 * `fr_FR-siwis-medium`. `tom` a été écartée par l'audit de licence :
 * les voix masculines passent désormais par `fr_FR-gilles-low` (CC0).
 * C'est un CHANGEMENT DE TIMBRE audible, à valider à l'oreille.
 */
const VOIX_FR_PAR_ANIMATEUR: Record<string, string> = {
  'wtf-cyril':   'fr_FR-gilles-low',
  'wtf-marina':  'fr_FR-siwis-medium',
  'wtf-diogene': 'fr_FR-gilles-low',
  'fw-aurelien': 'fr_FR-gilles-low',
  'fw-leila':    'fr_FR-siwis-medium',
  'bb-rocco':    'fr_FR-gilles-low',
  'bb-vince':    'fr_FR-gilles-low',
  'mc-anonyme':  'fr_FR-siwis-medium',
  'h2-henri':    'fr_FR-gilles-low',
  'h2-camille':  'fr_FR-siwis-medium',
  'g1-bernard':  'fr_FR-gilles-low',
  'g1-marie':    'fr_FR-siwis-medium',
  'dg-doudou':   'fr_FR-gilles-low',
  'dg-pat':      'fr_FR-siwis-medium',
  'dg-leboss':   'fr_FR-siwis-medium',
  'dn-salome':   'fr_FR-siwis-medium',
  'dn-karim':    'fr_FR-gilles-low',
  'tk-iris':     'fr_FR-siwis-medium',
  'tk-said':     'fr_FR-gilles-low',
  'pi-hex':      'fr_FR-siwis-medium',
  'pi-gnu':      'fr_FR-gilles-low',
  'pi-zero':     'fr_FR-siwis-medium',
  'oa-lea':      'fr_FR-siwis-medium',
  'oa-theo':     'fr_FR-gilles-low',
  'oa-aicha':    'fr_FR-siwis-medium',
}

const VOIX_FR_PAR_GENRE: Record<Genre, string> = {
  male:     'fr_FR-gilles-low',
  female:   'fr_FR-siwis-medium',
  androgyn: 'fr_FR-siwis-medium',
}

/**
 * Voix natives par langue. Une langue ABSENTE de cette table n'a pas de
 * voix : c'est le cas de `en`, `zh`, `it`, `pt`, `hi`, `ja`.
 *
 * `en` a été audité à part le 01/09/2026 : la PWA le sert par Kokoro, qui
 * vit dans le navigateur et n'existe pas ici. Les voix américaines usuelles
 * sont inutilisables (`ryan` NonCommercial, `lessac` sous licence de
 * recherche) ; trois voix britanniques passent.
 */
const VOIX_PAR_LANGUE: Partial<Record<StationLanguage, Record<Genre, string>>> = {
  // ⚠️ Les LICENCES de ces voix sont vérifiées (fiches HuggingFace lues le
  // 01/09/2026). Leur TIMBRE, lui, n'a été écouté par personne : le genre
  // attribué ci-dessous vient du nom et de la fiche, pas de l'oreille.
  // À valider en écoutant une première émission.
  en: {
    male:     'en_GB-northern_english_male-medium',
    female:   'en_GB-alba-medium',
    androgyn: 'en_GB-cori-medium',
  },
  es: {
    male:     'es_ES-davefx-medium',
    female:   'es_ES-sharvard-medium',
    androgyn: 'es_ES-davefx-medium',
  },
  ru: {
    // Pas de voix féminine commercialisable en russe (irina sans licence,
    // ruslan NonCommercial). Le timbre féminin retombe sur une voix
    // masculine — pis-aller assumé, pas un défaut technique.
    male:     'ru_RU-dmitri-medium',
    female:   'ru_RU-denis-medium',
    androgyn: 'ru_RU-dmitri-medium',
  },
}

/**
 * Le timbre demandé peut-il être honoré dans cette langue ? `false` doit
 * être DIT dans les journaux, jamais subi en silence.
 */
export function timbreHonore(language: StationLanguage, genre: Genre): boolean {
  if (language === 'ru' && genre === 'female') return false
  return true
}

/**
 * Voix Piper pour cet animateur, ou `null` si la langue n'a aucune voix
 * commercialisable. Un `null` doit faire RENONCER à la station, pas
 * déclencher un repli sur une autre langue.
 */
export function voixPourLangue(
  language: StationLanguage,
  genre: Genre,
  hostId?: string,
): string | null {
  const parGenre = language === 'fr'
    ? VOIX_FR_PAR_GENRE[genre]
    : VOIX_PAR_LANGUE[language]?.[genre]

  const nommee = language === 'fr' && hostId ? VOIX_FR_PAR_ANIMATEUR[hostId] : undefined

  // Ceinture ET bretelles : même inscrite dans une table ci-dessus, une
  // voix non commercialisable ne sort pas — les deux tables peuvent
  // diverger, et c'est la licence qui tranche.
  //
  // Une voix d'animateur refusée retombe sur le repli PAR GENRE, elle ne
  // fait pas disparaître la voix : sans ce repli, l'animateur se
  // retrouverait sans voix du tout et la station planterait APRÈS la
  // dépense LLM, ce qui est le pire des deux mondes.
  if (nommee && voixCommercialisable(nommee)) return nommee
  if (parGenre && voixCommercialisable(parGenre)) return parGenre
  return null
}

/** Cette langue a-t-elle au moins une voix utilisable ? */
export function langueSynthetisable(language: StationLanguage): boolean {
  return voixPourLangue(language, 'male') !== null
}

/** Toutes les langues actuellement diffusables. */
export function languesDiffusables(): StationLanguage[] {
  const toutes: StationLanguage[] = ['fr', 'en', 'es', 'it', 'pt', 'hi', 'ja', 'zh', 'ru']
  return toutes.filter(langueSynthetisable)
}
