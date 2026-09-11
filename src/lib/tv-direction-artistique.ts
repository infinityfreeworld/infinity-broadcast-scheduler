/**
 * @module InfinityScheduler/TV/DirectionArtistique
 * @description L'IMAGE de la télévision parle comme Infinity — pas comme un JT ordinaire.
 *
 *   🚨 POURQUOI. Retour du Bâtisseur (11/09/2026) : « quand le journal parle des assemblées, on
 *   voit des assemblées conventionnelles dans des bâtiments conventionnels, alors que les
 *   assemblées dans Infinity ont lieu dans un cadre naturel ou dans des bâtiments écologiques
 *   futuristes. Pareil pour les Manifestactions : les images devraient montrer des actions
 *   massives en faveur du vivant et des besoins vitaux. »
 *
 *   Le conducteur écrivait ses consignes d'image SANS aucune direction : « cinématique, 16:9 ».
 *   Le modèle d'image a donc dessiné le monde par défaut — un hémicycle, une salle de presse
 *   (« Modern newsroom studio », « democratic assembly, hands raised », relevés le 10/09).
 *
 *   ⚠️ DEUX COUCHES, PARCE QU'UNE SEULE NE TIENT PAS.
 *     1. la CHARTE est donnée au conducteur, sujet par sujet, pour qu'il écrive la bonne scène ;
 *     2. le STYLE est ajouté à CHAQUE consigne au moment de l'envoi, quoi qu'ait écrit le
 *        conducteur : un modèle de langage suit une consigne « la plupart du temps », et c'est
 *        l'image ratée qui passe à l'antenne.
 *   Le modèle d'image (FLUX.1-schnell) n'a pas de consigne négative : ce qu'on ne veut pas voir
 *   doit être évité dans les MOTS, pas interdit après coup.
 *
 *   Les mots de l'application sont repris tels quels (fiches d'aide, base de Luciole) :
 *   Palatine est la « place biocratique » ; les Manifestactions Hors de l'Enclos sont « des
 *   actions massives et coordonnées qui œuvrent en faveur du vivant, répondent aux besoins vitaux
 *   et génèrent l'abondance ».
 */

/** Ajouté à chaque consigne d'image : l'esprit commun, en anglais (langue du modèle d'image). */
export const STYLE_INFINITY =
  'biophilic eco-futurist world in harmony with living nature, lush vegetation, natural golden light, '
  + 'warm hopeful atmosphere, cinematic wide shot, 16:9, no text, no logos'

/** Au-delà, la consigne perd en netteté et coûte plus cher à interpréter. */
export const LONGUEUR_MAX_CONSIGNE = 700

/**
 * Ce que le conducteur doit savoir pour écrire la bonne image — sujet par sujet.
 * En français pour le raisonnement, avec le lexique anglais que le modèle d'image comprend.
 */
export const CHARTE_VISUELLE = `CHARTE VISUELLE D'INFINITY — l'imagePrompt DOIT la respecter.

Infinity est un monde « probiotique » : des humains en harmonie avec le vivant, une technologie
discrète au service de la vie, une architecture écologique. Chaque image montre CE monde-là,
jamais le monde conventionnel.

Selon le sujet :
- ASSEMBLÉE, VOTE, PALATINE, DAV (Droits de l'Âme et du Vivant) : des personnes réunies EN
  CERCLE, à hauteur égale, sans tribune ni pupitre — dans une clairière, une prairie, autour d'un
  grand arbre, ou dans une halle ouverte d'architecture écologique futuriste (bois, terre, toits
  végétalisés, lumière naturelle). Lexique : "people gathered in a wide circle in a forest
  clearing", "open biophilic timber hall with living green walls", "no podium".
- MANIFESTACTION (Hors de l'Enclos) : une ACTION MASSIVE ET COORDONNÉE POUR LE VIVANT et les
  besoins vitaux — des centaines de personnes qui plantent une forêt, restaurent une rivière,
  nettoient un littoral, cultivent, partagent l'eau et la nourriture ; joyeuse, pacifique,
  montrée en plan large ou aérien pour dire l'ampleur. Ce n'est PAS une manifestation de rue :
  ni pancartes, ni défilé, ni police. Lexique : "hundreds of people planting trees together,
  aerial wide shot", "community restoring a river".
- ABONDANCE : la coopération et le partage — jardins partagés débordant de récoltes,
  grainothèques, ateliers coopératifs, communs solaires, échanges de biens.
- PRÉSENTATION D'INFINITY (un module expliqué) : une scène symbolique — des personnes dans un
  paysage vivant, reliées par un fin réseau de lumière douce entre les arbres ; pas d'écran.
- PLATEAU, OUVERTURE : un plateau ouvert dans un jardin, ou un studio en bois clair plein de
  plantes, à la lumière du jour — jamais une salle de presse vitrée.

À ne JAMAIS décrire (le modèle d'image ne connaît pas la négation : n'écris pas ces mots) :
hémicycle, parlement, salle de conférence, bureau, costume-cravate, tribune, pupitre, béton,
circulation automobile, écrans géants, foule en colère, pancartes, police.`

/**
 * Scènes conventionnelles → leur équivalent Infinity. Appliqué AVANT le style.
 *
 * 🚨 POURQUOI UNE TABLE, ET PAS SEULEMENT LE STYLE. La 1re version n'ajoutait que le style en fin
 * de consigne. Rejouée sur les consignes réelles du 10/09, elle envoyait encore « Diverse group of
 * people in democratic assembly, hands raised, biophilic… » : la SCÈNE restait en tête, et le
 * modèle dessine la scène d'abord — une assemblée classique, simplement plus verte. Le style colore
 * une image, il ne la déplace pas. Seul un recadrage de la scène elle-même le fait.
 *
 * Chaque motif est cherché sans tenir compte de la casse ; l'ordre compte (le plus précis d'abord).
 */
const RECADRAGES: ReadonlyArray<[RegExp, string]> = [
  // Le mot « studio » qui suit est avalé avec la salle de presse — sinon « a lush garden studio ».
  [/\b(?:modern\s+)?(?:newsroom(?:\s+studio)?|news studio|tv studio|television studio|broadcast studio)\b/gi,
    'open-air broadcast set in a lush garden'],
  // L'article est avalé avec l'assemblée ; le remplacement se glisse aussi bien après « in » qu'en
  // tête : « people in a circle gathering… », « a circle gathering…, hands raised ».
  [/\b(?:an?\s+|the\s+)?(?:(?:democratic|political|public|general|citizens'?|national)\s+)?(?:assembly|assemblies|parliament|hemicycle|congress|senate|town hall meeting|council chamber)\b/gi,
    'a circle gathering in a sunlit forest clearing'],
  [/\b(?:an?\s+|the\s+)?(?:conference room|meeting room|boardroom|offices?)\b/gi,
    'an open biophilic timber hall with living green walls'],
  // Les pancartes partent avec leur préposition, d'un bloc.
  [/\s*\b(?:with|holding|carrying)\s+(?:placards?|signs?|banners?)\b/gi, ''],
  // Toute une suite de mots de manifestation devient UNE seule foule (pas trois à la file).
  [/\b(?:protesters?|protests?|demonstrators?|demonstrations?|rally|rallies|marchers?)(?:\s+(?:marching|rallying|protesting))*\b/gi,
    'a joyful crowd acting together for the living'],
  [/\b(?:placards?|picket lines?)\b/gi, ''],
  [/\b(?:ballot box(?:es)?|voting booths?)\b/gi, 'hands raised together in the circle'],
  [/\b(?:skyscrapers?|highways?|traffic)\b/gi, 'green eco-futurist architecture with living roofs'],
  [/\b(?:business suits?|suits and ties|suit and tie)\b/gi, 'simple natural clothing'],
  [/\b(?:riot police|police|riots?|podiums?|lecterns?)\b/gi, ''],
]

/** Mots qui trahissent une scène conventionnelle ; les écrire suffit à la faire dessiner. */
const INDICES_CONVENTIONNELS = [
  'parliament', 'hemicycle', 'assembly', 'conference room', 'office', 'boardroom', 'newsroom',
  'suit and tie', 'podium', 'lectern', 'protest', 'demonstration', 'placard', 'riot', 'police',
  'traffic', 'skyscraper',
]

/** Remplace les scènes conventionnelles par leur équivalent Infinity, puis nettoie la ponctuation. */
export function recadrerScene(consigne: string): string {
  let c = consigne
  for (const [motif, remplacement] of RECADRAGES) c = c.replace(motif, remplacement)
  // Deux indices voisins donnaient deux fois la même scène à la file : on n'en garde qu'une.
  for (const [, r] of RECADRAGES) {
    if (!r) continue
    const double = new RegExp(`(${r.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})(?:[\\s,]+\\1)+`, 'gi')
    c = c.replace(double, '$1')
  }
  return c
    .replace(/\s+,/g, ',')
    .replace(/,(\s*,)+/g, ',')
    .replace(/\s{2,}/g, ' ')
    .replace(/^[\s,]+|[\s,]+$/g, '')
}

/** Les indices conventionnels présents dans une consigne (pour le journal d'exécution). */
export function indicesConventionnels(consigne: string): string[] {
  const c = consigne.toLowerCase()
  return INDICES_CONVENTIONNELS.filter((m) => c.includes(m))
}

/**
 * Habille une consigne d'image avec le style d'Infinity, au moment de l'envoyer.
 *
 * Idempotent : une consigne déjà habillée n'est pas habillée deux fois (un nouvel essai ne doit
 * pas empiler le style). La consigne du conducteur passe EN TÊTE — c'est la scène — et le style
 * vient après ; la longueur est bornée en retirant de la consigne, jamais du style.
 */
export function habillerPrompt(consigne: string): string {
  const base = recadrerScene(consigne.trim()).replace(/[\s,.;]+$/, '')
  if (base.includes(STYLE_INFINITY)) return base.slice(0, LONGUEUR_MAX_CONSIGNE)
  const place = LONGUEUR_MAX_CONSIGNE - STYLE_INFINITY.length - 2
  return `${base.slice(0, Math.max(0, place))}, ${STYLE_INFINITY}`
}
