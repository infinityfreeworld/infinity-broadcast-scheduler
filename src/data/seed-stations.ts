/**
 * @module Infinity/Radio/SeedStations
 * @description 4 stations de base livrées avec le module Radio.
 *
 * Phase R.0 : données mock, aucun audio. Les fréquences sont symboliques
 * (87.5–144.0 MHz) et figées pour éviter toute collision avec les stations
 * créées par les Bâtisseurs (qui devront publier des kind:30090 avec une
 * fréquence libre — Phase R.2).
 */

import type { RadioStation } from '../lib/types'

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
    tracks: [
      { title: 'Track 1', cid: 'bafybeihqozxwaq4ucefvq3bdqbj6u7as32uadzgngkqtltey646vutdjhu' },
      { title: 'Track 2', cid: 'bafybeihg4uu22uqrgwdxwdio6te7oukj4zpwumlxpccbu4duah3ml36e5q' },
    ],
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
    tracks: [
      { title: 'Track 3', cid: 'bafybeieyacqlnv7zk32ejrekmb7f3dljazzxuidk3iostfl4mbbldpnk3q' },
      { title: 'Track 4', cid: 'bafybeifmfsamtn76ugitlps5vf62uguypp7lxjhusj5piwhglkcavjrjhq' },
    ],
    live: false,
    creatorPubkey: null,
  },
  {
    id: 'bigballs-radio',
    kind: 'bigballs',
    language: 'fr',
    frequency: 108.5,
    name: 'Big Balls Radio',
    tagline: 'Action ou silence.',
    color: '#ffb320',
    hosts: [
      { id: 'bb-rocco', name: 'Rocco', gender: 'male',   trait: 'punch / motivation, ex-coach',         color: '#ffb320', avatar: '🥊' },
      { id: 'bb-vince', name: 'Vince', gender: 'male',   trait: 'tacticien stratégique, références cinéma de boxe et arts martiaux', color: '#ffd76a', avatar: '🎬' },
    ],
    sources: [
      { type: 'rss', url: 'https://www.numerama.com/feed/',                  title: 'Numerama' },
      { type: 'rss', url: 'https://korben.info/feed',                        title: 'Korben' },
      { type: 'rss', url: 'https://www.lemonde.fr/rss/une.xml',              title: 'Le Monde' },
    ],
    tracks: [
      { title: 'Track 5', cid: 'bafybeiewnkzqs33a4x5oahytej2zhora3tqpgihgaym6fvyp2tqb5gffeu' },
    ],
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
    tracks: [
      { title: 'Track 6', cid: 'bafybeih54zuvvdeyzpjuyygmff7uok7mxmayqcracid5rkp2phc7xzindm' },
    ],
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
    skipMusic: true,    // demande user — éducative pure, pas de musique pour l'instant
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
    skipMusic: true,    // demande user — pas de musique pour l'instant
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
    skipMusic: true,    // demande user — chaîne d'humour pure, pas de musique
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
    tracks: [
      { title: 'Track 7', cid: 'bafybeifbh4yvz6wuydwfvrc6dbnoxg5q4iof6q4otcnzy7lh5lsqfs35fa' },
    ],
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
    tracks: [
      { title: 'Track 8', cid: 'bafybeidjdzqdgmktpjzumkybvgnzhvhejp7qcftggoa6gs7cyfzzmoofpi' },
    ],
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
