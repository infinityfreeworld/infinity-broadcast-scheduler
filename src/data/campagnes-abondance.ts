/**
 * @module InfinityScheduler/Data/CampagnesAbondance
 * @description FICHIER FABRIQUÉ par `scripts/fabriquer-campagnes-abondance.mjs` — ne pas éditer à la main.
 *
 *   76 campagnes de soutien qu'Abondance met en avant (choisies par l'équipe d'Infinity, et
 *   l'annuaire KiFaitKoi), copiées du dépôt Infinity (`src/modules/abondance/campagnes-soutien.ts`). Le don
 *   se fait chez l'organisme : ni lien ni montant ici, rien qui ne se dise à l'antenne.
 */
export interface CampagneAbondance {
  id: string
  titre: string
  porteur: string
  resume: string
  description: string
  piliers: string[]
}

export const CAMPAGNES_ABONDANCE: readonly CampagneAbondance[] = [
 {
  "id": "emancipactions",
  "titre": "Émancip'Actions",
  "porteur": "La Rencontre des Nouveaux Mondes",
  "resume": "Les outils concrets de l'émancipation, en replay",
  "description": "Un week-end de formation intensive pour acquérir les outils concrets de son émancipation : spiritualité, numérique libre, autonomie énergétique, alimentaire et en santé. Le festival s'est tenu à Bourges du 24 au 27 septembre 2026 ; ses 36 ateliers filmés se regardent en replay avec le billet virtuel.",
  "piliers": [
   "emancipation"
  ]
 },
 {
  "id": "pompiers-odp",
  "titre": "Soutenir les sapeurs-pompiers",
  "porteur": "Œuvre des Pupilles des Sapeurs-Pompiers",
  "resume": "Aider les orphelins et les familles de sapeurs-pompiers",
  "description": "Accompagne les enfants de pompiers décédés en service et les sapeurs-pompiers en difficulté. Organisme labellisé « Don en Confiance » depuis 2005.",
  "piliers": [
   "besoins-vitaux"
  ]
 },
 {
  "id": "pascal-poot",
  "titre": "Les graines de Pascal Poot",
  "porteur": "Pascal Poot, paysan-semencier",
  "resume": "Préserver les semences paysannes de Pascal Poot",
  "description": "Cagnotte « Nous sommes en difficulté. Aidez-nous à préserver nos semences. » : soutenir le potager et les semences paysannes de Pascal Poot, cultivées sans arrosage ni traitement.",
  "piliers": [
   "vivant"
  ]
 },
 {
  "id": "desobeissance-fertile",
  "titre": "Désobéissance Fertile",
  "porteur": "Mouvement Désobéissance Fertile",
  "resume": "Habiter la nature et régénérer les écosystèmes",
  "description": "Régénérer les écosystèmes en habitant la nature, sans attendre que les lois changent. Les dons financent ses actions juridiques pour l'habitat léger et ses outils pédagogiques.",
  "piliers": [
   "vivant",
   "emancipation"
  ]
 },
 {
  "id": "kokopelli",
  "titre": "Kokopelli",
  "porteur": "Association Kokopelli",
  "resume": "Semences libres, biologiques et reproductibles",
  "description": "Préserve et diffuse des semences libres de droits et reproductibles, issues de l'agriculture biologique. Un don de soutien ou un achat de semences aide l'association à poursuivre son œuvre.",
  "piliers": [
   "vivant",
   "besoins-vitaux"
  ]
 },
 {
  "id": "enfants-phare",
  "titre": "Le Pharandol des Enfants-Phare",
  "porteur": "Association Les Enfants-Phare",
  "resume": "Un magazine bénévole sur les solutions inspirantes",
  "description": "« Âmes d'enfants, et lumière sur les solutions inspirantes » : magazine réalisé bénévolement, gratuit en ligne. Un don, ou l'achat d'un numéro papier ou d'un abonnement (30 à 60 € par an), finance l'association.",
  "piliers": [
   "emancipation"
  ]
 },
 {
  "id": "verity-france",
  "titre": "Verity France",
  "porteur": "Association Verity France",
  "resume": "Des familles en quête de vérité et de justice",
  "description": "Fondée par trois familles endeuillées en quête de vérité et de justice sur les circonstances du décès de leurs enfants. Les dons financent d'abord les procédures juridiques.",
  "piliers": [
   "emancipation"
  ]
 },
 {
  "id": "aaron-korrigan-oak",
  "titre": "F'Aaron of Korrigan Oak",
  "porteur": "Nina Nouvel",
  "resume": "Un toit sur roues pour Nina et son fils",
  "description": "Nina et son fils vivent sans toit fixe. En participant à leur cagnotte, vous contribuez à leur permettre de vivre Libre et voyager.",
  "piliers": [
   "besoins-vitaux"
  ]
 },
 {
  "id": "axiom-team",
  "titre": "Axiom-Team",
  "porteur": "Association Axiom-Team",
  "resume": "Financer les développeurs de la monnaie libre Ğ1",
  "description": "Rémunère les développeurs de Duniter et de la monnaie libre Ğ1, à leur demande. Les dons vont aux « enveloppes » des développeurs ou aux dons libres, avec chaque mouvement publié en toute transparence.",
  "piliers": [
   "emancipation"
  ]
 },
 {
  "id": "nexus",
  "titre": "Nexus",
  "porteur": "Magazine d'information indépendant",
  "resume": "Un magazine d'information indépendant, sans publicité",
  "description": "Nexus publie une information libre et documentée qui revisite les concepts établis en science, santé, énergie, conscience, exologie, géopolitique… 112 pages, sans publicité.",
  "piliers": [
   "emancipation"
  ]
 },
 {
  "id": "crowdbunker",
  "titre": "CrowdBunker",
  "porteur": "Plateforme vidéo indépendante",
  "resume": "Des vidéos à l'abri de la censure",
  "description": "Vidéos, lives et chaînes à l'abri de la censure. CrowdBunker défend la liberté d'expression et le droit à l'information, sur une plateforme financée par ses utilisateurs.",
  "piliers": [
   "emancipation"
  ]
 },
 {
  "id": "holitime",
  "titre": "Holitime",
  "porteur": "Domaine de la santé",
  "resume": "Trouver un praticien parmi plus de 200 disciplines",
  "description": "La première plateforme indépendante qui protège et promeut toutes les pratiques de santé et de bien-être. Trouvez le praticien qui vous correspond parmi plus de 200 disciplines, en France, Belgique, Suisse, Luxembourg et au Canada.",
  "piliers": [
   "besoins-vitaux",
   "emancipation"
  ]
 },
 {
  "id": "innocence-en-danger",
  "titre": "Innocence en danger",
  "porteur": "Associations & collectifs de défense des enfants",
  "resume": "Protéger les enfants contre toutes les violences",
  "description": "Mouvement mondial de protection des enfants contre toutes formes de violences notamment sexuelles, présent dans une dizaine de pays et partenaire d'associations internationales actives dans la lutte contre la pédocriminalité.",
  "piliers": [
   "besoins-vitaux"
  ]
 },
 {
  "id": "justice-pour-lenfance",
  "titre": "Justice pour l'Enfance",
  "porteur": "Associations & collectifs de défense des enfants",
  "resume": "Des avocats engagés pour défendre les enfants",
  "description": "Association à but non lucratif regroupant un collectif d'avocats spécialisés dans la défense des enfants, présent dans toute la France (Dom-Tom compris).",
  "piliers": [
   "besoins-vitaux"
  ]
 },
 {
  "id": "les-mamans-louves",
  "titre": "Les Mamans Louves",
  "porteur": "Associations & collectifs de défense des enfants",
  "resume": "Des mères engagées pour l'accompagnement familial",
  "description": "Collectif de mères engagées dans l'accompagnement familial et le soutien communautaire. Espace d'échange, de ressources et d'actions collectives.",
  "piliers": [
   "besoins-vitaux"
  ]
 },
 {
  "id": "lunion-fait-la-force",
  "titre": "L'union fait la force",
  "porteur": "Associations & collectifs de défense des enfants",
  "resume": "Des soignants engagés pour la défense des enfants",
  "description": "Association créée à partir d'un collectif de soignants suspendus, qui œuvre pour la défense de nos enfants afin de leur éviter, dans l'avenir, la maltraitance qu'ils ont déjà subie, et qu'ils puissent avoir l'avenir serein qui n'aurait jamais dû être occulté.",
  "piliers": [
   "besoins-vitaux",
   "emancipation"
  ]
 },
 {
  "id": "onest",
  "titre": "ONEST : Organisation Nationale Éthique Santé et Transparence",
  "porteur": "Associations & collectifs de défense des enfants",
  "resume": "Éthique, santé, transparence et droits de l'enfant",
  "description": "ONEST a notamment pour but de faire respecter les principes humains, le droit au respect de l'intégrité du corps humain, du psychisme et de la dignité humaine, la protection des droits de l'enfant et des personnes vulnérables, les principes d'éthique et de moralité.",
  "piliers": [
   "besoins-vitaux"
  ]
 },
 {
  "id": "parents-en-colere",
  "titre": "Parents en Colère",
  "porteur": "Associations & collectifs de défense des enfants",
  "resume": "Des parents mobilisés pour les droits des enfants",
  "description": "Collectifs locaux de parents mobilisés en France pour défendre les droits de leurs enfants et porter des revendications communes. Parents en Colère regroupe des collectifs locaux à travers la France. Le mouvement s'organise autour d'une mobilisation citoyenne avec des actions coordonnées au niveau national.",
  "piliers": [
   "besoins-vitaux"
  ]
 },
 {
  "id": "sos-education",
  "titre": "SOS Éducation",
  "porteur": "Associations & collectifs de défense des enfants",
  "resume": "Parents et professeurs pour l'école et l'apprentissage",
  "description": "Association indépendante du champ éducatif qui réunit parents et professeurs pour promouvoir des actions en faveur de l'école et de l'apprentissage.",
  "piliers": [
   "besoins-vitaux"
  ]
 },
 {
  "id": "place-a-lacte",
  "titre": "Place à l'acte",
  "porteur": "Autonomie et Habitat",
  "resume": "Des outils pour passer à l'acte",
  "description": "Plate-forme pour faciliter le passage à l'acte, au travers d'un recensement important d'outils, et de plusieurs propositions pour vous accompagner.",
  "piliers": [
   "vivant",
   "besoins-vitaux",
   "emancipation"
  ]
 },
 {
  "id": "permacool-tour",
  "titre": "PermaCoolTour - cartographie",
  "porteur": "Autonomie et Habitat",
  "resume": "La carte des écolieux et de la permaculture",
  "description": "Tour de France à vélo de trois ans à la découverte des écolieux et de la permaculture, documenté en photos, podcasts et reportages. Le Permacool Tour est un tour de France et de Belgique à vélo entrepris par Alexis Marcotte, Kevin Simon et Kamil Groot pendant le premier confinement.",
  "piliers": [
   "vivant",
   "besoins-vitaux"
  ]
 },
 {
  "id": "transiscope",
  "titre": "Transiscope",
  "porteur": "Autonomie et Habitat",
  "resume": "La carte des alternatives écologiques et sociales",
  "description": "Portail web collaboratif cartographiant les initiatives et organisations qui œuvrent pour la transition écologique et sociale. Transiscope est un portail participatif qui propose une carte interactive des alternatives.",
  "piliers": [
   "vivant",
   "besoins-vitaux",
   "emancipation"
  ]
 },
 {
  "id": "hameaux-legers",
  "titre": "Hameaux légers",
  "porteur": "Autonomie et Habitat",
  "resume": "Des écohameaux accessibles pour une ruralité vivante",
  "description": "Association qui accompagne la création d'écohameaux accessibles : habitats participatifs, écologiques et financièrement abordables pour une ruralité vivante.",
  "piliers": [
   "vivant",
   "besoins-vitaux"
  ]
 },
 {
  "id": "lowtechlab",
  "titre": "LowTechLab",
  "porteur": "Autonomie et Habitat",
  "resume": "Des low-tech utiles, accessibles et durables",
  "description": "Association loi 1901 qui documente et promeut les low-tech : objets et pratiques utiles, accessibles et durables. Wiki collaboratif open source.",
  "piliers": [
   "vivant",
   "besoins-vitaux"
  ]
 },
 {
  "id": "alliance-du-peuple",
  "titre": "Alliance du peuple",
  "porteur": "Domaine politique",
  "resume": "Fédérer les citoyens pour l'avenir des enfants",
  "description": "Association apolitique qui fédère citoyens et groupes autour de projets préservant l'avenir des enfants et de la planète. Alliance du Peuple est une association déclarée qui fédère des citoyens issus de tous horizons autour d'une démarche commune.",
  "piliers": [
   "emancipation"
  ]
 },
 {
  "id": "alliance-pour-la-france",
  "titre": "Alliance pour la France",
  "porteur": "Domaine politique",
  "resume": "Un parti pour rassembler les Français",
  "description": "Parti politique, destiné à représenter une Alliance de tou(te)s les Français(es) qui ne se résignent pas à l'autodestruction de notre Nation.",
  "piliers": [
   "emancipation"
  ]
 },
 {
  "id": "convergence-ric",
  "titre": "Convergence RIC",
  "porteur": "Domaine politique",
  "resume": "Ensemble pour le Référendum d'Initiative Citoyenne",
  "description": "Convergence RIC réunit les personnes physiques et morales œuvrant pour le Référendum d'Initiative Citoyenne afin de travailler ensemble et mutualiser les compétences.",
  "piliers": [
   "emancipation"
  ]
 },
 {
  "id": "envie-dun-notre-monde",
  "titre": "Envie d'Un Nôtre Monde",
  "porteur": "Domaine politique",
  "resume": "Des actions concrètes pour le bien commun",
  "description": "Mouvement citoyen français qui mobilise autour d'actions concrètes pour le bien commun, la démocratie participative et l'engagement collectif.",
  "piliers": [
   "emancipation"
  ]
 },
 {
  "id": "street-act-canal-telegram",
  "titre": "Street Act (Canal Telegram)",
  "porteur": "Domaine artistique",
  "resume": "Reconquérir l'espace public par l'image",
  "description": "Canal telegram qui a pour vocations de reconquérir l'espace public urbain par des moyens graphiques et picturaux, d'exposer la face cachée de la corruption politico-industrielle et les mécanismes de la propagande médiatique, de diffuser des éléments de sagesse pratique et d'espérance, et de fédérer celles et ceux qui veulent agir en ce sens.",
  "piliers": [
   "emancipation"
  ]
 },
 {
  "id": "produits-a-base-de-chanvre",
  "titre": "Produits à base de Chanvre",
  "porteur": "Domaine de la santé",
  "resume": "Produits naturels français à base de chanvre",
  "description": "Spécialiste des produits naturels 100 % Français à base de Chanvre dans sa globalité, notre éthique est de sélectionner drastiquement les meilleurs produits naturel 100 % bio afin de renforcer notre bien être et notre santé générale de manière préventive.",
  "piliers": [
   "besoins-vitaux"
  ]
 },
 {
  "id": "dispensaire-naturel-des-hauts-cantons",
  "titre": "Dispensaire naturel des Hauts-Cantons",
  "porteur": "Domaine de la santé",
  "resume": "Un dispensaire de soins naturels dans l'Hérault",
  "description": "Dispensaire d'éducation à la santé et de soins naturels des Hauts-Cantons de l'Hérault (Saint Etienne d'Albagnan) Un exemple de centres de soins à reproduire partout !",
  "piliers": [
   "besoins-vitaux"
  ]
 },
 {
  "id": "cartographie-des-libres-guerisseurs-mhe",
  "titre": "Cartographie des Libres Guérisseurs (MHE)",
  "porteur": "Domaine de la santé",
  "resume": "La carte des Libres Guérisseurs",
  "description": "Les Libres Guérisseurs sont un ensemble de thérapeutes qui se mettent au service de tous, afin de permettre à chacun de bénéficier d'une prise en charge sanitaire adaptée. Ils organisent régulièrement des « manifestactions ».",
  "piliers": [
   "besoins-vitaux"
  ]
 },
 {
  "id": "les-remedes-du-nouveau-monde",
  "titre": "Les Remèdes du Nouveau Monde",
  "porteur": "Domaine de la santé",
  "resume": "Santé holistique, nutrition et médecine naturelle",
  "description": "Canal Telegram dédié à la santé holistique : prévention, nutrition, sommeil, microbiote et médecine naturelle. Les Remèdes du Nouveau Monde est un canal Telegram proposant des informations sur la santé globale.",
  "piliers": [
   "besoins-vitaux"
  ]
 },
 {
  "id": "rgnr-regenere",
  "titre": "RGNR",
  "porteur": "Domaine de la santé",
  "resume": "Reprendre sa santé en main et vivre libre",
  "description": "Plus qu'un site, un écosystème indépendant de la santé autonome fondé par Thierry Casasnovas. Vidéos, formations, magazine, séjours et communauté : toutes les clés pour comprendre son corps, reprendre sa santé en main et vivre libre — sans publicité, sans dépendance.",
  "piliers": [
   "besoins-vitaux"
  ]
 },
 {
  "id": "strategie-mhe",
  "titre": "Stratégie MHE : organisation des Libres pour les besoins fondamentaux",
  "porteur": "Domaine de la santé",
  "resume": "S'organiser pour les besoins fondamentaux de tous",
  "description": "Fini d'agir contre, les MHE proposent de bâtir le monde en parfaite autonomie. Outils pour la résilience alimentaire et sanitaire, de quoi permettre d'assurer les besoins fondamentaux de tous, par le biais de réseaux d'hommes et femmes Libres.",
  "piliers": [
   "vivant",
   "besoins-vitaux"
  ]
 },
 {
  "id": "une-notre-sante-oasis-pleine-sante",
  "titre": "Une Nôtre Santé - Oasis Pleine Santé",
  "porteur": "Domaine de la santé",
  "resume": "Fédérer des groupes de santé intégrative",
  "description": "Collectif qui fédère et accompagne des groupes de santé intégrative, en mettant en lien pratiques conventionnelles et approches complémentaires.",
  "piliers": [
   "besoins-vitaux"
  ]
 },
 {
  "id": "unchain-academy",
  "titre": "Unchain Academy",
  "porteur": "Domaine éducatif",
  "resume": "Apprendre le Web3 en toute autonomie",
  "description": "L'Unchain Academy aspire à former une communauté mondiale d'apprenants autonomes dans le Web3, favorisant la transparence, l'équité et la prospérité.",
  "piliers": [
   "emancipation"
  ]
 },
 {
  "id": "instruction-ief-micro-ecoles",
  "titre": "Instruction: IEF, Micro-écoles, écoles alternatives",
  "porteur": "Domaine éducatif",
  "resume": "IEF, micro-écoles et écoles alternatives",
  "description": "Parents d'élève : vous estimez vos enfants en danger à l'école ? Il existe des alternatives : l'instruction en famille, les micro-écoles et les écoles alternatives.",
  "piliers": [
   "emancipation"
  ]
 },
 {
  "id": "creer-sa-micro-ecole",
  "titre": "Créer sa micro-école",
  "porteur": "Domaine éducatif",
  "resume": "Un guide pour créer sa micro-école",
  "description": "Un document assez complet pour vous guider dans la création d'une micro-école, à télécharger.",
  "piliers": [
   "emancipation"
  ]
 },
 {
  "id": "instruction-en-famille",
  "titre": "Instruction en famille",
  "porteur": "Domaine éducatif",
  "resume": "Le cadre légal et les ressources de l'IEF",
  "description": "Site de référence sur l'instruction en famille en France : cadre légal, ressources pratiques et actualités pour les familles qui instruisent à la maison.",
  "piliers": [
   "emancipation"
  ]
 },
 {
  "id": "referencement-colibris",
  "titre": "Référencement des colibris près de chez nous",
  "porteur": "Domaine éducatif",
  "resume": "Les acteurs du changement près de chez vous",
  "description": "Cartographie collaborative des acteurs de l'écologie, de l'économie solidaire et des circuits courts, portée par l'association Colibris. Près de chez nous est une plateforme cartographique libre et collaborative fondée par l'association Colibris.",
  "piliers": [
   "vivant",
   "besoins-vitaux",
   "emancipation"
  ]
 },
 {
  "id": "lutter-contre-les-antennes-5g",
  "titre": "Lutter contre les antennes 5G",
  "porteur": "Domaine environnemental",
  "resume": "Ressources pour les collectifs contre la 5G",
  "description": "Ressources et vidéos pour accompagner les collectifs citoyens qui s'opposent à l'installation d'antennes relais 5G près de chez eux. Cette fiche recense des ressources à destination des collectifs citoyens qui cherchent à s'opposer à l'installation d'antennes relais 5G près de chez eux.",
  "piliers": [
   "vivant"
  ]
 },
 {
  "id": "collectif-sortie-de-banque",
  "titre": "Collectif Sortie de Banque",
  "porteur": "Domaine financier / économie",
  "resume": "Des outils légaux pour sortir du système bancaire",
  "description": "Collectif apartisan et bénévole, dont l'objectif est d'offrir des outils légaux, pacifiques et souverains pour sortir du système bancaire traditionnel.",
  "piliers": [
   "emancipation"
  ]
 },
 {
  "id": "monnaie-libre-g1",
  "titre": "Monnaie Libre Ğ1",
  "porteur": "Domaine financier / économie",
  "resume": "Découvrir la monnaie libre Ğ1",
  "description": "La Ğ1 (se prononce June) est une cryptomonnaie non indexée sur l'euro, stablecoin (non spéculative), dont la création monétaire est uniquement liée aux êtres humains qui la font vivre. Elle permet une économie circulaire, et des échanges émancipés du système monétaire sociétal actuel.",
  "piliers": [
   "emancipation"
  ]
 },
 {
  "id": "canal-telegram-je-boycotte",
  "titre": "Canal Telegram Je boycotte",
  "porteur": "Domaine financier / économie",
  "resume": "Boycotts et consommation responsable",
  "description": "Canal d'information sur les boycotts et la consommation responsable : alertes produits, comparatifs de marques et mobilisations citoyennes. Ce canal Telegram publie des contenus relatifs aux mouvements de boycott et à la consommation responsable.",
  "piliers": [
   "emancipation"
  ]
 },
 {
  "id": "le-grand-projet-mocica",
  "titre": "Le Grand Projet : MOCICA",
  "porteur": "Domaine financier / économie",
  "resume": "Une société de partage et de gratuité",
  "description": "Une société réorganisée sans argent résoudrait la plupart des problèmes de l'humanité : tel est le crédo du Grand Projet : un monde de partage et de gratuité.",
  "piliers": [
   "emancipation"
  ]
 },
 {
  "id": "agoratv",
  "titre": "AgoraTV",
  "porteur": "Médias indépendants",
  "resume": "Une web TV indépendante de Suisse romande",
  "description": "Web TV indépendante basée en région lémanique (Suisse romande). Donne la parole à celles et ceux qui n'arrivent pas à trouver un micro ailleurs.",
  "piliers": [
   "emancipation"
  ]
 },
 {
  "id": "bam-news",
  "titre": "BAM! News",
  "porteur": "Médias indépendants",
  "resume": "Un média belge indépendant et pluraliste",
  "description": "Média alternatif belge indépendant, pluraliste et rigoureux, qui traite des crises actuelles sans tabou. 77 000 lecteurs hebdomadaires en Belgique, France et Québec.",
  "piliers": [
   "emancipation"
  ]
 },
 {
  "id": "on-passe-a-lacte",
  "titre": "On passe à l'acte",
  "porteur": "Médias indépendants",
  "resume": "Ressources pour les porteurs de projets positifs",
  "description": "Écosystème d'accompagnement et de ressources pour les porteurs de projets positifs. Depuis 15 ans, il documente et soutient les initiatives citoyennes.",
  "piliers": [
   "emancipation"
  ]
 },
 {
  "id": "les-depeches-citoyennes",
  "titre": "Les Dépêches Citoyennes",
  "porteur": "Médias indépendants",
  "resume": "Un média qui redonne la parole aux citoyens",
  "description": "Média indépendant qui participe à la libre communication des pensées et des opinions et redonne la parole au citoyen, lui permettant d'exercer sa liberté d'expression et la fraternité dans l'échange des idées, le partage des savoirs, la connaissance de l'autre.",
  "piliers": [
   "emancipation"
  ]
 },
 {
  "id": "les-petits-pas-sages",
  "titre": "Les Petits Pas Sages",
  "porteur": "Médias indépendants",
  "resume": "Réflexion, bon sens et conscience en vidéo",
  "description": "Invitation à la réflexion, au bon sens et à la conscience. Le Système a besoin de notre consentement pour exister — reprenons notre Liberté et notre Souveraineté.",
  "piliers": [
   "emancipation"
  ]
 },
 {
  "id": "geev",
  "titre": "Geev - Dons d'objets entre particuliers",
  "porteur": "Outils de mise en lien en local",
  "resume": "Donner et récupérer des objets entre particuliers",
  "description": "Une plate-forme de dons d'objets & nourriture entre particuliers, afin de donner ou récupérer, en quelques clics, des vêtements de seconde main, des meubles d'occasion, des appareils électroménagers, de la décoration, des livres ou encore des jouets pour enfants proches de chez soi ! Gratuit, simple et antigaspi !",
  "piliers": [
   "emancipation"
  ]
 },
 {
  "id": "les-locavores",
  "titre": "LES LOCAVORES",
  "porteur": "Outils de mise en lien en local",
  "resume": "Acheter en circuit court près de chez soi",
  "description": "Plateforme communautaire d'achat en circuit court auprès de producteurs locaux. Commandez en ligne et récupérez vos produits dans un point de distribution près de chez vous.",
  "piliers": [
   "vivant",
   "besoins-vitaux",
   "emancipation"
  ]
 },
 {
  "id": "annuaire-national-amap",
  "titre": "Annuaire national des AMAP",
  "porteur": "Outils de mise en lien en local",
  "resume": "Trouver une AMAP près de chez soi",
  "description": "Associations pour le Maintien d'une Agriculture Paysanne, les AMAP sont un réseau tissé depuis 20 ans sur l'ensemble du territoire français, qui permettent de se ravitailler via des producteurs locaux, sous forme de paniers hebdomadaires. Une organisation gagnant/gagnant pour les producteurs et les consommateurs !",
  "piliers": [
   "vivant",
   "besoins-vitaux",
   "emancipation"
  ]
 },
 {
  "id": "annuaire-reinfo",
  "titre": "Annuaire des professionnels de Reinfo",
  "porteur": "Outils de mise en lien en local",
  "resume": "Les professionnels des collectifs Reinfo",
  "description": "Cartographie des professionnels de Reinfo les collectifs (alimentation, artisans, artistes, astrologie, beauté, bien-être enfants, décoration, imprimeur, informatique, logistique, santé/bien-être, sport, tourisme)",
  "piliers": [
   "emancipation"
  ]
 },
 {
  "id": "fiches-abondance-mhe",
  "titre": "Les fiches d'abondance des MHE",
  "porteur": "Outils de mise en lien en local",
  "resume": "Des fiches pratiques pour l'autonomie alimentaire",
  "description": "Série de fiches pratiques rassemblées par le Mouvement pour l'Humanité et l'Environnement pour accompagner l'autonomie alimentaire au quotidien.",
  "piliers": [
   "emancipation"
  ]
 },
 {
  "id": "monter-une-cooperative",
  "titre": "Monter une coopérative pour consommer local",
  "porteur": "Outils de mise en lien en local",
  "resume": "Monter une épicerie coopérative",
  "description": "Les épiceries coopératives, auto-gérées, basées sur la solidarité, permettent de se regrouper avec d'autres foyers pour acheter en gros chez des producteurs locaux et éthiques, afin de mieux se nourrir, et moins cher.",
  "piliers": [
   "vivant",
   "besoins-vitaux",
   "emancipation"
  ]
 },
 {
  "id": "sinaps",
  "titre": "SINAPS (6-Naps)",
  "porteur": "Outils de mise en lien en local",
  "resume": "Relier les acteurs de l'autonomie alimentaire",
  "description": "Collectif qui relie acteurs et ressources de l'autonomie et de la résilience alimentaire pour favoriser les synergies entre initiatives de terrain.",
  "piliers": [
   "emancipation"
  ]
 },
 {
  "id": "solaris",
  "titre": "SOLARIS - Réseau d'entraide et maillage local",
  "porteur": "Outils de mise en lien en local",
  "resume": "Des cellules locales pour s'organiser en autonomie",
  "description": "Une cartographie, des cellules locales, un réseau avec des outils pour s'organiser, et monter sa propre autonomie – alimentaire, énergétique, et plus encore, avec d'autres acteurs locaux près de chez vous !",
  "piliers": [
   "vivant",
   "besoins-vitaux",
   "emancipation"
  ]
 },
 {
  "id": "vivalisme",
  "titre": "Vivalisme",
  "porteur": "Outils de mise en lien en local",
  "resume": "Artisans et entreprises en harmonie avec la nature",
  "description": "Réseau fédérant artisans et entreprises engagés dans une philosophie de vie en harmonie avec la nature et l'environnement. Le Vivalisme est un mouvement qui promeut un art de vivre en accord avec les lois fondamentales et naturelles. Ses adhérents cherchent à vivre en symbiose avec leur environnement et à respecter les cycles naturels.",
  "piliers": [
   "emancipation"
  ]
 },
 {
  "id": "en-toute-franchise",
  "titre": "En toute franchise",
  "porteur": "Outils et aides juridiques",
  "resume": "Défendre les commerçants indépendants",
  "description": "Association 1901 de franchisés et commerçants indépendants. Depuis 1994, elle défend la liberté commerciale face aux abus de la grande distribution.",
  "piliers": [
   "emancipation"
  ]
 },
 {
  "id": "association-bon-sens",
  "titre": "Association Bon Sens",
  "porteur": "Outils et aides juridiques",
  "resume": "Études scientifiques et soutien social en santé",
  "description": "Association dont les missions se concentrent essentiellement sur la santé, avec deux axes : scientifique (production et financement d'études, CSI…), et social (soutien à la détresse humaine et aux dirigeants d'entreprises en difficulté).",
  "piliers": [
   "emancipation"
  ]
 },
 {
  "id": "lessor-des-resistants",
  "titre": "Canal Telegram L'Essor des Résistants",
  "porteur": "Outils et aides juridiques",
  "resume": "Stratégie d'émancipation collective",
  "description": "Canal Telegram dédié à la stratégie d'émancipation collective, avec discussions et ressources sur la mobilisation et l'organisation citoyenne.",
  "piliers": [
   "emancipation"
  ]
 },
 {
  "id": "wojnicz-emancipation",
  "titre": "Site + canal Wojnicz Emancipation",
  "porteur": "Outils et aides juridiques",
  "resume": "Des pilules courtes pour s'émanciper du système",
  "description": "Au travers de pilules courtes et percutantes, Wojnicz nous explique en quoi le système est illégitime, et comment s'en émanciper afin de ne plus l'alimenter, et ne plus le subir.",
  "piliers": [
   "emancipation"
  ]
 },
 {
  "id": "les-collectifs-reinfo",
  "titre": "Les Collectifs Reinfo",
  "porteur": "Rassemblements et solidarité",
  "resume": "Des antennes locales pour se rassembler",
  "description": "Antennes locales des Collectifs Reinfo : se rassembler, s'informer et agir ensemble près de chez soi.",
  "piliers": [
   "emancipation"
  ]
 },
 {
  "id": "les-marches-fantastiques",
  "titre": "Les Marches Fantastiques",
  "porteur": "Rassemblements et solidarité",
  "resume": "Marcher ensemble et renouer avec le vivant",
  "description": "Initiative citoyenne organisant des marches collectives en France pour créer du lien social, marcher ensemble et renouer avec le vivant. Les Marches Fantastiques sont une initiative participative organisée par des citoyens à travers la France.",
  "piliers": [
   "emancipation"
  ]
 },
 {
  "id": "acheter-a-la-source",
  "titre": "Acheter à la source",
  "porteur": "Résilience alimentaire (et eau)",
  "resume": "Acheter directement aux producteurs",
  "description": "Annuaire des producteurs et fermiers français pour la vente directe sans intermédiaire. Recherche par région ou par type de produit. Acheter à la Source est une plateforme qui référence la majorité des producteurs et fermiers français afin de promouvoir la vente directe du producteur au consommateur.",
  "piliers": [
   "vivant",
   "besoins-vitaux"
  ]
 },
 {
  "id": "blog-pierre1911",
  "titre": "Blog de Pierre1911 : autonomie alimentaire",
  "porteur": "Résilience alimentaire (et eau)",
  "resume": "L'autonomie alimentaire sur moins de 900 m²",
  "description": "Blog d'un couple engagé dans une transition vers l'autonomie alimentaire et énergétique, depuis 2013, sur un terrain de moins de 900 m². Pierre 1911 est un blog qui documente la transition d'un couple vers l'autonomie alimentaire et énergétique, engagée en 2013 à partir d'une maison sur un terrain de moins de 900 m².",
  "piliers": [
   "vivant",
   "besoins-vitaux"
  ]
 },
 {
  "id": "canal-permaculture",
  "titre": "Canal Telegram Un Nôtre Monde Permaculture",
  "porteur": "Résilience alimentaire (et eau)",
  "resume": "Permaculture, entraide et résilience alimentaire",
  "description": "Un canal d'échange sur les pratiques de permaculture, et tout ce qui tourne autour de la résilience alimentaire. Entraide, et solidarité, sont les valeurs maîtresses de ce canal !",
  "piliers": [
   "vivant",
   "besoins-vitaux"
  ]
 },
 {
  "id": "les-incroyables-comestibles",
  "titre": "Les incroyables comestibles",
  "porteur": "Résilience alimentaire (et eau)",
  "resume": "Nourrir l'humanité localement, dans la joie",
  "description": "Mouvement de la co-création joyeuse de l'abondance partagée, animé par l'idéal de nourrir l'humanité de façon saine pour l'homme et pour la planète, localement, en suffisance, dans la joie et la dignité de chacun.",
  "piliers": [
   "vivant",
   "besoins-vitaux"
  ]
 },
 {
  "id": "universite-autonomie-alimentaire",
  "titre": "Université Francophone d'Autonomie Alimentaire",
  "porteur": "Résilience alimentaire (et eau)",
  "resume": "Se former à l'autonomie alimentaire",
  "description": "Université Francophone de l'Autonomie Alimentaire : formations, conférences et ressources pour s'engager dans la résilience alimentaire. L'Université Francophone de l'Autonomie Alimentaire propose des outils concrets pour aider particuliers, collectifs et collectivités à s'engager sur le chemin de l'autonomie alimentaire.",
  "piliers": [
   "vivant",
   "besoins-vitaux"
  ]
 },
 {
  "id": "brigades-dicrim",
  "titre": "Résilience alimentaire territoriale : Brigades DICRIM",
  "porteur": "Résilience alimentaire (et eau)",
  "resume": "Impliquer sa mairie dans la résilience alimentaire",
  "description": "Action citoyenne de résilience alimentaire : tous les documents et informations à connaître pour démarcher vos mairies en vertu des plans DICRIM (Document d'Information Communal sur les Risques Majeurs).",
  "piliers": [
   "vivant",
   "besoins-vitaux"
  ]
 },
 {
  "id": "resilience-alimentaire-sos-maires",
  "titre": "Résilience alimentaire locale : SOS Maires",
  "porteur": "Résilience alimentaire (et eau)",
  "resume": "Des projets alimentaires avec sa commune",
  "description": "Des outils indispensables destinés à la mise en place d'une résilience alimentaire territoriale, par le biais de projets à monter avec sa propre commune – ou comment impliquer nos élus locaux dans la résilience alimentaire.",
  "piliers": [
   "vivant",
   "besoins-vitaux"
  ]
 },
 {
  "id": "colinu",
  "titre": "COllectif de LIberté NUmérique (COLINU)",
  "porteur": "Résilience numérique",
  "resume": "Vie privée, libertés numériques et logiciels libres",
  "description": "Collectif Liberté Numérique : canal dédié à la défense de la vie privée, des libertés numériques et à la promotion des logiciels libres. Le Collectif Liberté Numérique (COLINU) propose des contenus et ressources sur la cybersécurité, la vie privée en ligne et l'émancipation numérique.",
  "piliers": [
   "emancipation"
  ]
 },
 {
  "id": "outils-libres-colibris",
  "titre": "Outils libres des colibris",
  "porteur": "Résilience numérique",
  "resume": "Des services web libres et respectueux",
  "description": "Services web libres, décentralisés et respectueux de la vie privée proposés par le mouvement Colibris en partenariat avec Framasoft.",
  "piliers": [
   "emancipation"
  ]
 },
 {
  "id": "wikilibriste",
  "titre": "Site + canal Telegram Wikilibriste",
  "porteur": "Résilience numérique",
  "resume": "Informatique éthique, libre et souveraine",
  "description": "Informatique éthique, outils résilients, décentralisés, souverains, libres et open source, interopérables, sécurité des appareils et des données…",
  "piliers": [
   "emancipation"
  ]
 }
]
