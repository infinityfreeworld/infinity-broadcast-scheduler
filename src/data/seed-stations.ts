/**
 * @module Infinity/Radio/SeedStations
 * @description Les stations de départ du générateur — 18 au 07/10/2026 : 14 en français
 *   (dont Manifestactions, Abondance et OBF, ajoutées le 07/10/2026, et Biogame, qui a remplacé
 *   Big Balls Radio le 16/09/2026 sous le même identifiant `bigballs-radio`) et une par langue en
 *   anglais, espagnol, russe et chinois.
 *
 * ⚠️ CONTRAT avec l'application (`infinity/src/modules/radio/stations/seed-stations.ts`) : même
 *   identifiant, même fréquence, même langue, mêmes animateurs pour chaque station présente des
 *   deux côtés — les émissions (kind 30093) référencent ces identifiants. Les fréquences sont
 *   symboliques (87.5–144.0 MHz), figées, et ne se chevauchent pas. La radio se règle ensuite
 *   UNIQUEMENT depuis l'IHL (fiche kind 30091 des administrateurs radio).
 */

import type { RadioStation } from '../lib/types'
import { JINGLES_GARANTIS } from '../lib/selection-musique'

/*
 * Plus de bibliothèque musicale par défaut — décision de Med du 07/10/2026 : les 10
 * « Default Track » (Pinata, mai 2026) n'avaient aucune mention de droits ; elles sont
 * RETIRÉES. Leurs CID restent listés dans `PISTES_RETIREES` (lib/selection-musique.ts, même
 * fichier que l'app) pour qu'aucune ancienne fiche 30091 ne les remette à l'antenne. La musique
 * d'une station vient désormais de l'IHL (bibliothèque 30108, droits obligatoires) ; sans
 * musique, l'émission sort sans pause musicale ni lit (lib/musique.ts).
 */

export const SEED_STATIONS: RadioStation[] = [
  {
    id: 'wtf-radio',
    kind: 'wtf',
    language: 'fr',
    frequency: 91.3,
    name: 'WTF Radio',
    tagline: 'Si tout va bien, c\'est qu\'on t\'a menti.',
    color: '#ff3344',
    hosts: [
      { id: 'wtf-cyril',   name: 'Cyril',   gender: 'male',   trait: 'sarcasme nihiliste',     color: '#ff5050', avatar: '🥃' },
      { id: 'wtf-marina',  name: 'Marina',  gender: 'female', trait: 'rage froide',            color: '#ff8866', avatar: '🔥' },
      { id: 'wtf-diogene', name: 'Diogène', gender: 'male',   trait: 'cynisme philosophique',  color: '#ffaa44', avatar: '🪔' },
    ],
    sources: [
      { type: 'rss', url: 'https://www.mediapart.fr/articles/feed',          title: 'Mediapart' },
      { type: 'rss', url: 'https://reporterre.net/spip.php?page=backend',    title: 'Reporterre' },
      { type: 'rss', url: 'https://www.monde-diplomatique.fr/recents.xml',   title: 'Le Monde Diplomatique' },
    ],
    tracks: [],
    live: false,
    creatorPubkey: null,
  },
  {
    id: 'freeworld-radio',
    kind: 'freeworld',
    language: 'fr',
    frequency: 102.7,
    name: 'Freeworld Radio',
    tagline: 'Construire, pas attendre.',
    color: '#33d18a',
    hosts: [
      { id: 'fw-aurelien', name: 'Aurélien', gender: 'male',   trait: 'espoir lucide',         color: '#33d18a', avatar: '🌱' },
      { id: 'fw-leila',    name: 'Leïla',    gender: 'female', trait: 'pragmatisme bienveillant', color: '#7af0c8', avatar: '🌅' },
    ],
    sources: [
      { type: 'rss', url: 'https://reporterre.net/spip.php?page=backend',    title: 'Reporterre' },
      { type: 'rss', url: 'https://basta.media/spip.php?page=backend',       title: 'Bastamag' },
      { type: 'rss', url: 'https://positivr.fr/feed/',                        title: 'Positivr' },
    ],
    tracks: [],
    live: false,
    creatorPubkey: null,
  },
  // Big Balls Radio (108.5) supprimée le 14/09/2026 avec ses deux animateurs (Rocco, Vince).
  // 16/09/2026 — le fondateur la REMPLACE : « une nouvelle radio du nom de Biogame, sur le thème
  // des Biogames organisées ». ⚠️ L'identifiant `bigballs-radio` et le kind `bigballs` restent :
  // c'est le contrat avec l'application (seed-stations.ts côté Infinity), qui porte déjà ce nom.
  // Les animateurs, eux, sont NEUFS (identifiants `bg-*`) : rien des anciens n'est repris.
  {
    id: 'bigballs-radio',
    kind: 'bigballs',
    language: 'fr',
    frequency: 108.5,
    name: 'Biogame',
    tagline: 'On ne joue pas contre les autres, on joue pour le vivant.',
    // 07/10/2026 — raison d'être enrichie (demande du Bâtisseur) : le concept, les types, les activités,
    // la forêt des Biogames, et le lancement officiel courant 2027. Sujets de fond : lib/sujets-biogame.ts.
    description: "La station des Biogames : des jeux réels, mesurables et géolocalisés qui transforment la coopération autour des besoins vitaux et le dépassement de soi en parties qui produisent de la valeur réelle — nourriture cultivée, déchets ramassés, chantiers livrés, savoirs transmis. Compétitions, Tournois des Tribus et Grand Tournoi de l'Autonomie, Défis, Challenges du mois, Quêtes « We are » comme We are Alive, la Ligue, le Palmarès et le vote des Paliers 3. Lancement officiel prévu courant 2027.",
    color: '#ffb320',
    hosts: [
      { id: 'bg-nora',  name: 'Nora',  gender: 'female', trait: 'coach de terrain, organise les défis, énergie communicative', color: '#ffb320', avatar: '🏃' },
      { id: 'bg-malik', name: 'Malik', gender: 'male',   trait: 'arbitre et conteur des tournois, précis et chaleureux',      color: '#ffd76a', avatar: '🏆' },
    ],
    sources: [
      { type: 'rss', url: 'https://positivr.fr/feed/',                        title: 'Positivr (initiatives)' },
      { type: 'rss', url: 'https://www.kaizen-magazine.com/feed/',            title: 'Kaizen (faire soi-même, ensemble)' },
      { type: 'rss', url: 'https://www.colibris-lemouvement.org/rss.xml',     title: 'Colibris (agir localement)' },
    ],
    tracks: [],
    live: false,
    creatorPubkey: null,
  },
  {
    id: 'mindctrl-radio',
    kind: 'mindctrl',
    language: 'fr',
    frequency: 117.4,
    name: 'Mind Control Radio',
    tagline: 'Une voix dans ta tête. La tienne ?',
    color: '#a070ff',
    hosts: [
      { id: 'mc-anonyme', name: 'Anonyme', gender: 'androgyn', trait: 'méta-ironique', color: '#a070ff', avatar: '🌀' },
    ],
    sources: [
      { type: 'rss', url: 'https://www.acrimed.org/spip.php?page=backend',   title: 'Acrimed (critique des médias)' },
      { type: 'rss', url: 'https://www.monde-diplomatique.fr/recents.xml',   title: 'Le Monde Diplomatique' },
      { type: 'rss', url: 'https://korben.info/feed',                        title: 'Korben (décryptage tech)' },
    ],
    tracks: [],
    live: false,
    creatorPubkey: null,
  },
  // ── R.4 — 5 nouvelles stations seed ────────────────────────────────────
  {
    id: 'hydrogene-radio',
    kind: 'hydrogene',
    language: 'fr',
    frequency: 88.5,
    name: 'H₂ Radio',
    tagline: 'L\'hydrogène expliqué — santé, énergie, mobilité.',
    description: "Chaîne éducative dédiée à l'hydrogène sous tous ses aspects : production verte, mobilité (voitures, trains, bateaux), pile à combustible, hydrogène thérapeutique (eau hydrogénée, inhalation), industrie lourde, stockage saisonnier des renouvelables.",
    color: '#0aa3d8',
    hosts: [
      { id: 'h2-henri',   name: 'Henri',   gender: 'male',   trait: 'ingénieur passionné, vulgarisateur Jamy-style', color: '#0aa3d8', avatar: '⚙️' },
      { id: 'h2-camille', name: 'Camille', gender: 'female', trait: 'médecin chercheuse, applications cliniques',     color: '#5fd5ff', avatar: '🩺' },
    ],
    sources: [
      { type: 'rss', url: 'https://www.h2-mobile.fr/feed/',                       title: 'H2 Mobile' },
      { type: 'rss', url: 'https://www.connaissancedesenergies.org/rss.xml',      title: 'Connaissance des Énergies' },
      { type: 'rss', url: 'https://reporterre.net/spip.php?page=backend',         title: 'Reporterre' },
    ],
    tracks: [],
    live: false,
    creatorPubkey: null,
  },
  {
    id: 'g1-radio',
    kind: 'g1',
    language: 'fr',
    frequency: 96.0,
    name: 'Ğ1 Libre',
    tagline: 'La monnaie libre, du dividende universel à la TRM.',
    description: "Chaîne dédiée à la Ğ1 (June), monnaie libre fondée sur la Théorie Relative de la Monnaie de Stéphane Laborde. Web of trust Cesium/Sakia, Duniter, écosystème Ğmarché, communautés vivantes, dividende universel concret.",
    color: '#dba23a',
    hosts: [
      { id: 'g1-bernard', name: 'Bernard', gender: 'male',   trait: 'pédagogue passionné de monnaie libre',                          color: '#dba23a', avatar: '🪙' },
      { id: 'g1-marie',   name: 'Marie',   gender: 'female', trait: 'économiste curieuse, sceptique constructive sur la TRM',         color: '#f0c97a', avatar: '📊' },
    ],
    sources: [
      { type: 'rss', url: 'https://forum.duniter.org/latest.rss',                 title: 'Forum Duniter' },
      { type: 'rss', url: 'https://reporterre.net/spip.php?page=backend',         title: 'Reporterre (alternatives)' },
      { type: 'rss', url: 'https://basta.media/spip.php?page=backend',            title: 'Bastamag (luttes sociales)' },
    ],
    tracks: [],
    live: false,
    creatorPubkey: null,
  },
  {
    id: 'deglingos-radio',
    kind: 'deglingos',
    language: 'fr',
    frequency: 130.2,
    name: 'Les Déglingos',
    tagline: 'Trois zoulous, zéro filtre.',
    description: "Chaîne d'humour assumé : 3 présentateurs qui passent leur temps à raconter des blagues, déconner, faire des vannes sur l'actualité. Pas de sujet sérieux — juste du fun et de la dérision.",
    color: '#ff8e2c',
    hosts: [
      { id: 'dg-doudou',  name: 'Doudou',  gender: 'male',     trait: 'blagues lourdes assumées, vanneur né',           color: '#ff8e2c', avatar: '🤡' },
      { id: 'dg-pat',     name: 'Pat',     gender: 'female',   trait: 'ironie rapide, punchlines tranchantes',          color: '#ffb763', avatar: '😏' },
      { id: 'dg-leboss',  name: 'Le Boss', gender: 'androgyn', trait: 'absurde total, références weird',                color: '#fdd58a', avatar: '🎭' },
    ],
    sources: [
      { type: 'rss', url: 'https://www.francetvinfo.fr/titres.rss', title: 'France Info (pour rebondir)' },
      { type: 'rss', url: 'https://www.legorafi.fr/feed/',          title: 'Le Gorafi (inspi humour)' },
    ],
    tracks: [],
    live: false,
    creatorPubkey: null,
  },
  {
    id: 'diginomad-radio',
    kind: 'diginomad',
    language: 'fr',
    frequency: 99.7,
    name: 'Diginomad',
    tagline: 'Voyage. Travail. Liberté.',
    description: "Chaîne dédiée au digital nomadisme, à l'expatriation et au remote work. Visas spécifiques (Bali, Lisbonne, Tbilissi, Mexique), fiscalité multi-pays, coworkings, langues, cultures, échecs et réussites de la vie de baroudeur connecté.",
    color: '#22c1a3',
    hosts: [
      { id: 'dn-salome', name: 'Salomé', gender: 'female', trait: 'ex-corporate devenue baroudeuse, pragmatique',                       color: '#22c1a3', avatar: '🌍' },
      { id: 'dn-karim',  name: 'Karim',  gender: 'male',   trait: 'questionne le modèle nomade : impact social, gentrification, soutenabilité', color: '#5fd9bf', avatar: '🧭' },
    ],
    sources: [
      { type: 'rss', url: 'https://nomadcapitalist.com/feed/',                   title: 'Nomad Capitalist' },
      { type: 'rss', url: 'https://www.lemonde.fr/rss/une.xml',                  title: 'Le Monde (actualité internationale)' },
      { type: 'rss', url: 'https://reporterre.net/spip.php?page=backend',        title: 'Reporterre' },
    ],
    tracks: [],
    live: false,
    creatorPubkey: null,
  },
  {
    id: 'tech-radio',
    kind: 'tech',
    language: 'fr',
    frequency: 122.5,
    name: 'Cryptozor',
    tagline: 'Sortir du cloud propriétaire.',
    description: "Chaîne éducative sur les technologies décentralisées : IPFS, libp2p, NOSTR, Holochain, Bluesky/ATProto, ActivityPub, Ceramic, Hypercore. Comment elles marchent, ce qu'elles changent, projets réels qui s'en servent.",
    color: '#7a5fff',
    hosts: [
      { id: 'tk-iris', name: 'Iris', gender: 'female', trait: 'dev cypherpunk, références Bitcoin/IPFS/NOSTR',                     color: '#7a5fff', avatar: '🛰️' },
      { id: 'tk-said', name: 'Saïd', gender: 'male',   trait: 'vétéran sécurité réseau, pragmatique sur Web3, allergique au hype', color: '#9a7fff', avatar: '🛡️' },
    ],
    sources: [
      { type: 'rss', url: 'https://blog.ipfs.tech/index.xml',                   title: 'IPFS Blog' },
      { type: 'rss', url: 'https://korben.info/feed',                            title: 'Korben (tech)' },
      { type: 'rss', url: 'https://www.numerama.com/feed/',                      title: 'Numerama' },
    ],
    tracks: [],
    live: false,
    creatorPubkey: null,
  },
  // ── Spring 2026 — Radio Pirate (open source / hacking / sensibilisation) ──
  {
    id: 'pirate-radio',
    kind: 'pirate',
    language: 'fr',
    frequency: 87.7,
    name: 'Radio Pirate',
    tagline: 'Le code est libre, l\'humain aussi.',
    description: "Chaîne dédiée au logiciel libre, à l'open source et à la culture hacker éthique. Histoire du mouvement (FSF, GNU, Linux, Debian), licences (GPL, MIT, AGPL, copyleft vs permissif), sécurité offensive et défensive, vie privée numérique (Tor, Tails, Signal), souveraineté logicielle. Sensibilise les auditeurs à reprendre le contrôle de leurs outils numériques.",
    color: '#0bd35d',
    hosts: [
      { id: 'pi-hex',  name: 'Hex',  gender: 'female',   trait: 'hackeuse éthique pragmatique, ancienne pentesteuse',                color: '#0bd35d', avatar: '🐍' },
      { id: 'pi-gnu',  name: 'Gnu',  gender: 'male',     trait: 'militant libriste historique, références Stallman/Torvalds/Lessig',  color: '#5fef9d', avatar: '🦬' },
      { id: 'pi-zero', name: 'Zero', gender: 'androgyn', trait: 'crypto-anarchiste génération Tor/Signal, allergique aux GAFAM',      color: '#9ffac3', avatar: '👁️' },
    ],
    sources: [
      { type: 'rss', url: 'https://korben.info/feed',                              title: 'Korben (open source / hacking FR)' },
      { type: 'rss', url: 'https://feeds.feedburner.com/TheHackersNews',           title: 'The Hacker News (cybersécu)' },
      { type: 'rss', url: 'https://www.numerama.com/feed/',                        title: 'Numerama' },
      { type: 'rss', url: 'https://opensource.org/blog/feed',                      title: 'Open Source Initiative' },
    ],
    tracks: [],
    // Décision de Med du 08/10/2026 : les 3 jingles de la Radio Pirate (un seul endroit :
    // JINGLES_GARANTIS, lib/selection-musique.ts — ils reviennent même si une fiche remplace `jingles`).
    jingles: JINGLES_GARANTIS['pirate-radio'].map(j => ({ ...j })),
    live: false,
    creatorPubkey: null,
  },
  // ── Spring 2026 — Oasis FM (eau, hydropolitique, accès) ────────────────────
  {
    id: 'oasis-fm',
    kind: 'oasis',
    language: 'fr',
    frequency: 105.3,
    name: 'Oasis FM',
    tagline: 'L\'eau, source de tout.',
    description: "Chaîne dédiée à l'eau sous tous ses angles : hydrologie et nappes phréatiques, guerre de l'eau (Israël/Palestine, Maroc, Sahel), privatisation vs régies publiques, sécheresse et adaptation climatique, eaux souterraines profondes, hydrogène vert depuis l'eau, médecines de l'eau (eau hydrogénée, balnéothérapie, eaux minérales), récits de fleuves et lacs.",
    color: '#1e9adb',
    hosts: [
      { id: 'oa-lea',   name: 'Léa',   gender: 'female', trait: 'hydrogéologue terrain, vulgarisatrice nappes/cycles/sécheresse',     color: '#1e9adb', avatar: '💧' },
      { id: 'oa-theo',  name: 'Théo',  gender: 'male',   trait: 'journaliste géopolitique de l\'eau (Sahel, Levant, Asie centrale)', color: '#5fbdec', avatar: '🌊' },
      { id: 'oa-aicha', name: 'Aïcha', gender: 'female', trait: 'militante équité accès eau, expérience terrain Maroc/Mauritanie',   color: '#a3d8f3', avatar: '🏜️' },
    ],
    sources: [
      { type: 'rss', url: 'https://reporterre.net/spip.php?page=backend',          title: 'Reporterre (eau, écologie)' },
      { type: 'rss', url: 'https://basta.media/spip.php?page=backend',             title: 'Bastamag (luttes, eau)' },
      { type: 'rss', url: 'https://www.monde-diplomatique.fr/recents.xml',         title: 'Le Monde Diplomatique' },
    ],
    tracks: [],
    live: false,
    creatorPubkey: null,
  },

  // ── 07/10/2026 — Manifestactions (décision du Bâtisseur) ───────────────
  // Parle des Manifestactions publiées sur la carte (lib/sujets-carte.ts) ; sans nouveauté, de leur
  // raison d'être. Pas de flux RSS : son actualité, c'est la carte. Voix Piper sous licence permise
  // (lib/voix.ts) ; pas encore de voix inventée déposée (data/voix-inventees.ts).
  {
    id: 'manifestactions-radio',
    kind: 'manifestactions',
    language: 'fr',
    frequency: 113.7,
    name: 'Manifestactions',
    tagline: 'De l\'écran à l\'action.',
    description: "Chaîne des Manifestactions : les actions concrètes que les Bâtisseurs proposent sur la carte d'Infinity — où, quand, ce qu'on y fait, comment rejoindre. Et quand rien de neuf n'est publié, leur raison d'être : œuvrer en faveur du vivant, des besoins vitaux et de l'émancipation. From Screen To Action.",
    color: '#f25f8c',
    hosts: [
      { id: 'ma-ines',   name: 'Inès',   gender: 'female', trait: 'organisatrice de terrain, concrète et entraînante, donne envie d\'y aller', color: '#f25f8c', avatar: '📣' },
      { id: 'ma-bastien', name: 'Bastien', gender: 'male',  trait: 'naturaliste et conteur du vivant, relie chaque action aux besoins vitaux', color: '#ff9ab8', avatar: '🌿' },
    ],
    sources: [],
    tracks: [],
    live: false,
    creatorPubkey: null,
  },

  // ── 07/10/2026 — Abondance et OBF (décisions du Bâtisseur) ─────────────
  // Abondance : TOUS les projets d'Abondance — un projet nouvellement validé est raconté en détail, les
  // autres tournent chaque jour, les campagnes de soutien aussi ; sans projet, la raison d'être
  // (lib/sujets-abondance.ts). Pas de flux RSS : son actualité, c'est Abondance.
  // OBF : le système d'alerte expliqué en détail, les conflits, et le soutien par des Manifestactions ;
  // l'actualité des crises par des sources factuelles, réglables ensuite dans l'IHL (lib/sujets-obf.ts).
  // Voix Piper sous licence permise (lib/voix.ts) ; pas encore de voix inventée (data/voix-inventees.ts).
  {
    id: 'abondance-radio',
    kind: 'abondance',
    language: 'fr',
    frequency: 93.6,
    name: 'Abondance',
    tagline: 'Chaque projet mérite d\'être porté.',
    description: "La station d'Abondance, l'économie d'entraide d'Infinity : elle met en avant tous les projets qui y figurent — ce qu'ils font, où, ce dont ils ont besoin (financement, bénévolat, matériel, compétences, un lieu…) et comment les soutenir — et raconte en détail chaque nouveau projet dès qu'il apparaît. Sa raison d'être : faire circuler les ressources et financer ensemble ce qui sert le vivant, les besoins vitaux et l'émancipation.",
    color: '#e8b730',
    hosts: [
      { id: 'ab-solene', name: 'Solène', gender: 'female', trait: 'chercheuse de pépites, raconte les projets et ceux qui les portent avec chaleur', color: '#e8b730', avatar: '🌻' },
      { id: 'ab-yann',   name: 'Yann',   gender: 'male',   trait: 'artisan de l\'entraide, concret sur les besoins et la façon d\'aider',            color: '#f4d06f', avatar: '🤲' },
    ],
    sources: [],
    tracks: [],
    live: false,
    creatorPubkey: null,
  },
  {
    id: 'obf-radio',
    kind: 'obf',
    language: 'fr',
    frequency: 112.0,
    name: 'OBF',
    tagline: 'Veiller, alerter, se relever ensemble.',
    description: "La station d'OBF — Overwatch Blaze Field, l'alerte communautaire d'Infinity face aux urgences : comment elle marche dans le détail (quatre niveaux, Alerter, Moniteur, Sentinelle, protection Flash et Ghost), ce que la veille mondiale montre des catastrophes et des conflits, et pourquoi la soutenir — en organisant des Manifestactions adaptées à chaque situation, avant, pendant et après la crise. Neutre et factuelle sur les faits, engagée sur l'action.",
    color: '#e85555',
    hosts: [
      { id: 'obf-maya',     name: 'Maya',     gender: 'female', trait: 'ancienne secouriste, calme et précise, transforme chaque crise en gestes concrets', color: '#e85555', avatar: '🛟' },
      { id: 'obf-gregoire', name: 'Grégoire', gender: 'male',   trait: 'veilleur de la Sentinelle, factuel sur les conflits et les catastrophes, sans sensationnalisme', color: '#f4c842', avatar: '🔭' },
    ],
    sources: [
      { type: 'rss', url: 'https://news.un.org/feed/subscribe/fr/news/topic/humanitarian-aid/feed/rss.xml', title: 'ONU Info — aide humanitaire' },
      { type: 'rss', url: 'https://news.un.org/feed/subscribe/fr/news/topic/climate-change/feed/rss.xml',   title: 'ONU Info — climat et catastrophes' },
      { type: 'rss', url: 'https://www.msf.fr/rss.xml',                                                      title: 'Médecins Sans Frontières' },
      { type: 'rss', url: 'https://www.gdacs.org/xml/rss.xml',                                               title: 'GDACS (alertes de catastrophes, ONU et Commission européenne)' },
    ],
    tracks: [],
    live: false,
    creatorPubkey: null,
  },

  // ──────────────────────────────────────────────────────────────────────
  // Phase E (2026-05-20) — Stations multilangues internationales.
  // 1 station par langue (EN, ES, RU, ZH) pour amorcer. L'admin peut
  // créer d'autres stations dans ces langues depuis l'IHL → onglet
  // « 📻 Stations ». Distribution conditionnelle côté Infinity main :
  // les utilisateurs non-francophones (region != France/Suisse/Belgique/
  // Québec/Maghreb/Afrique de l'Ouest francophone) voient les stations
  // dans la langue de leur région — sprint E.2.
  // ──────────────────────────────────────────────────────────────────────

  {
    id: 'free-press-fm',
    kind: 'wtf',
    language: 'en',
    frequency: 110.5,
    name: 'Free Press FM',
    tagline: 'Independent voices on world news.',
    description: 'Independent international news station — covers world events with a critical, non-corporate angle. Hosts dig into geopolitics, war coverage, media ownership, and grassroots resistance worldwide. Sources include BBC World, Al Jazeera English, and Reuters.',
    color: '#3b82f6',
    hosts: [
      { id: 'fp-sarah',  name: 'Sarah',  gender: 'female', trait: 'investigative journalist, sharp on geopolitics',     color: '#3b82f6', avatar: '🎤' },
      { id: 'fp-malik',  name: 'Malik',  gender: 'male',   trait: 'former war correspondent, blunt on power dynamics',  color: '#60a5fa', avatar: '📰' },
    ],
    sources: [
      { type: 'rss', url: 'https://feeds.bbci.co.uk/news/world/rss.xml',           title: 'BBC World News' },
      { type: 'rss', url: 'https://www.aljazeera.com/xml/rss/all.xml',             title: 'Al Jazeera English' },
      { type: 'rss', url: 'https://feeds.reuters.com/reuters/topNews',             title: 'Reuters Top News' },
    ],
    tracks: [],
    live: false,
    creatorPubkey: null,
  },

  {
    id: 'voces-libres',
    kind: 'wtf',
    language: 'es',
    frequency: 119.8,
    name: 'Voces Libres',
    tagline: 'Voces de Latinoamérica y del mundo hispano.',
    description: 'Estación independiente de noticias e ideas en español. Cubre América Latina, España y la diáspora hispana. Los locutores abordan política, movimientos sociales, economía, cultura y resistencias populares con perspectiva crítica.',
    color: '#f59e0b',
    hosts: [
      { id: 'vl-carmen',  name: 'Carmen',  gender: 'female', trait: 'periodista madrileña, dura en política española',       color: '#f59e0b', avatar: '🌹' },
      { id: 'vl-rafael',  name: 'Rafael',  gender: 'male',   trait: 'analista mexicano, conoce América Latina al detalle',   color: '#fbbf24', avatar: '🌶️' },
    ],
    sources: [
      { type: 'rss', url: 'https://feeds.elpais.com/mrss-s/pages/ep/site/elpais.com/portada',  title: 'El País (Portada)' },
      { type: 'rss', url: 'https://www.efe.com/efe/espana/portada/rss.xml',                    title: 'EFE Portada España' },
      { type: 'rss', url: 'https://www.bbc.com/mundo/index.xml',                               title: 'BBC Mundo' },
    ],
    tracks: [],
    live: false,
    creatorPubkey: null,
  },

  {
    id: 'svoboda-fm',
    kind: 'wtf',
    language: 'ru',
    frequency: 127.1,
    name: 'Свобода FM',
    tagline: 'Свободные голоса о мире и России.',
    description: 'Независимая радиостанция на русском языке. Журналисты обсуждают политику России и мира, права человека, экономику, культуру и сопротивление. Источники включают независимые издания и международные новостные ленты.',
    color: '#dc2626',
    hosts: [
      { id: 'sv-anna',    name: 'Анна',    gender: 'female', trait: 'журналистка-расследователь, эмигрировала из РФ',     color: '#dc2626', avatar: '🕊️' },
      { id: 'sv-dmitri',  name: 'Дмитрий', gender: 'male',   trait: 'политический аналитик, специалист по постсоветскому пространству', color: '#ef4444', avatar: '🌍' },
    ],
    sources: [
      { type: 'rss', url: 'https://meduza.io/rss/all',                            title: 'Meduza (все)' },
      { type: 'rss', url: 'https://www.svoboda.org/api/zppopomtemt',              title: 'Радио Свобода' },
    ],
    tracks: [],
    live: false,
    creatorPubkey: null,
  },

  {
    id: 'zi-you-zhi-sheng',
    kind: 'wtf',
    language: 'zh',
    frequency: 135.9,
    name: '自由之声',
    tagline: '世界与中国，独立的声音。',
    description: '中文独立新闻台，关注全球事件和中文世界。主持人讨论地缘政治、人权、科技、文化与社会变革。素材来源包括BBC中文、自由亚洲电台和独立媒体。',
    color: '#eab308',
    hosts: [
      { id: 'zy-mei',   name: '美琳', gender: 'female', trait: '资深记者，专注国际政治与中国话题',              color: '#eab308', avatar: '🏮' },
      { id: 'zy-jian',  name: '建国', gender: 'male',   trait: '科技与人权评论员，前媒体编辑',                  color: '#fcd34d', avatar: '🎋' },
    ],
    sources: [
      { type: 'rss', url: 'https://www.bbc.com/zhongwen/simp/index.xml',          title: 'BBC 中文' },
      { type: 'rss', url: 'https://www.rfa.org/chinese/rss/news/news_news_rss.xml', title: 'Radio Free Asia 中文' },
    ],
    tracks: [],
    live: false,
    creatorPubkey: null,
  },
]

/** Bornes du dial — 87.5 à 144.0 MHz, comme une vraie radio FM étendue. */
export const FREQ_MIN = 87.5
export const FREQ_MAX = 144.0
export const FREQ_STEP = 0.1
/** Tolérance d'accroche : si |freq - station.frequency| ≤ tolerance, station verrouillée. */
export const LOCK_TOLERANCE = 0.05
