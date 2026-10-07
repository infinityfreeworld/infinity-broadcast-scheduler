/**
 * @module InfinityScheduler/Lib/SujetsBiogame
 * @description La station Biogame (`bigballs-radio`) — PUR, sans réseau.
 *
 *   Décision du Bâtisseur (07/10/2026) : que la station parle RÉELLEMENT du concept des Biogames, des
 *   différents types, des différentes activités, et que le LANCEMENT OFFICIEL est prévu courant 2027.
 *   Elle peut annoncer les Biogames VALIDÉS publics : le lot 7 sait déjà les lire
 *   (`sujets-carte.ts › retenirSujetsCarte`, famille `biogame` — validé par l'administration DANS
 *   CETTE VERSION, à venir ou récent, ville maximum).
 *
 *   Sources du fond, toutes dans l'application (`src/modules/biogame/`) : les Règles du jeu
 *   (`apropos-view.tsx`), le Hall (`accueil/hall-sections.ts`), les Quêtes « We are »
 *   (`operations-we-are.ts`), les Challenges du mois (`challenges-mensuels.ts`), les preuves (`vpm.ts`),
 *   les échelles des tournois (`biogame-echelles.ts`), la forêt et ses lieux (`foret/dimension-*.ts`,
 *   `foret/disciplines.ts`). Aucun montant de prix : le module n'en fixe pas.
 */
import type { NewsItem } from './types'
import type { SujetCarte } from './sujets-carte'
import { sujetVersActualite } from './sujets-carte'
import { numeroDuJour } from './sujets-abondance'

export const STATION_BIOGAME = 'bigballs-radio'
export const LANCEMENT_OFFICIEL = 'courant 2027'
export const SOURCE_FOND_BIOGAME = 'Les Biogames'

/**
 * Dix-huit sujets de fond (≤ 180 caractères chacun). Ce ne sont PAS des événements : ni date, ni
 * lieu, ni participant à inventer.
 */
export const FOND_BIOGAME: ReadonlyArray<NewsItem> = [
  { title: 'Ce que sont les Biogames', summary: "Des jeux réels, mesurables et géolocalisés : la coopération autour des besoins vitaux et le dépassement de soi deviennent des parties qui produisent de la valeur réelle.", sourceTitle: SOURCE_FOND_BIOGAME },
  { title: 'Jouer pour le vivant', summary: "Pas de divertissement extractif : chaque partie laisse quelque chose — nourriture cultivée, déchets ramassés, chantiers livrés, savoirs transmis. On joue pour le vivant.", sourceTitle: SOURCE_FOND_BIOGAME },
  { title: 'Lancement officiel en 2027', summary: "Le lancement officiel des Biogames est prévu courant 2027. D'ici là, on prépare : on crée ses premiers jeux, on forme sa Tribu, on s'entraîne.", sourceTitle: SOURCE_FOND_BIOGAME },
  { title: 'Les Compétitions', summary: "Trail, course, marche, plogging (courir en ramassant les déchets), seed-run (semer en courant), vélo, orientation, Baston, Fight Wheel Cup : sur parcours ou à distance.", sourceTitle: SOURCE_FOND_BIOGAME },
  { title: 'Les Tournois et les Tribus', summary: "Des équipes locales, les Tribus, rivalisent à qui produira le plus de valeur vitale, mesurée en kilos, mètres carrés, heures, personnes formées.", sourceTitle: SOURCE_FOND_BIOGAME },
  { title: "Le Grand Tournoi de l'Autonomie", summary: "Une fois par an, le GTA réunit toutes les Tribus : autonomie alimentaire, eau, réparation, énergie, savoirs. Chaque épreuve a sa mesure, ses arbitres et ses prix.", sourceTitle: SOURCE_FOND_BIOGAME },
  { title: 'Du quartier au monde', summary: "Un tournoi se joue à l'échelle d'un bassin de vie, d'une région, d'un pays ou du monde entier : on commence en bas, et l'on monte.", sourceTitle: SOURCE_FOND_BIOGAME },
  { title: 'Les Défis', summary: "Des missions d'entraide au quotidien : maraude, compagnie aux aînés, courses et démarches, distribution alimentaire, mentorat, écoute, coup de main, aide aux animaux.", sourceTitle: SOURCE_FOND_BIOGAME },
  { title: 'Les Challenges du mois', summary: "Un challenge par mois, des prix à la clé, des résultats annoncés à la fin du mois. Jamais de tirage au sort : seul compte l'effort mesuré et validé.", sourceTitle: SOURCE_FOND_BIOGAME },
  { title: 'We are Alive', summary: "La grande Quête de régénération : identifier les besoins avec les habitants, cartographier les zones à reboiser, reconstruire après les incendies, replanter local.", sourceTitle: SOURCE_FOND_BIOGAME },
  { title: 'Les autres Quêtes « We are »', summary: "Guardian, Justice, Builder, Human, Finance, Mecalibre, Fighters, Runners : de grandes opérations collectives, chacune avec ses objectifs et ses règles.", sourceTitle: SOURCE_FOND_BIOGAME },
  { title: 'Ligue et Palmarès', summary: "La Ligue additionne les résultats validés de tous les tournois, par saison et par bassin de vie ; le Palmarès garde les trophées et les parcours remarquables.", sourceTitle: SOURCE_FOND_BIOGAME },
  { title: 'Les Paliers 3 votent', summary: "Les humains certifiés de Palier 3 désignent les vainqueurs des épreuves jugées et départagent les égalités : une voix par épreuve, publique et modifiable.", sourceTitle: SOURCE_FOND_BIOGAME },
  { title: 'La preuve de présence', summary: "On ne gagne pas sur parole : la validation de présence mutuelle prouve qu'on était là, ensemble — de 3 à 50 valideurs, selon ce que fixe le créateur du jeu.", sourceTitle: SOURCE_FOND_BIOGAME },
  { title: 'Créer son Biogame', summary: "Tout Bâtisseur peut créer sa compétition, son tournoi ou son défi, avec ses règles et ses prix. L'administration le valide, puis il apparaît pour tous.", sourceTitle: SOURCE_FOND_BIOGAME },
  { title: 'Mille façons de participer', summary: "Jouer, mais aussi arbitrer, organiser, accueillir, filmer, voter, prêter du matériel, soutenir en mécénat — en présentiel comme à distance.", sourceTitle: SOURCE_FOND_BIOGAME },
  { title: 'Financer un Biogame', summary: "Sponsorisé par des professionnels qui offrent leurs produits en prix, soutenu en mécénat (We are Finance), ou subventionné : montants et soutiens sont publiés.", sourceTitle: SOURCE_FOND_BIOGAME },
  { title: 'La forêt des Biogames', summary: "On entre par une forêt, le Teryaum, et ses portails : l'Olympe, les jardins du GTA, Athlos, Brainstorm, Hackers Libres, Mecalibre, le dojo, les six arènes.", sourceTitle: SOURCE_FOND_BIOGAME },
]

/** `n` sujets de fond en tournant (deux jours de suite : aucun en commun, 18 ≥ 2n). */
export function choisirFondBiogame(n: number, jour: Date | string): NewsItem[] {
  if (n <= 0) return []
  const total = FOND_BIOGAME.length
  const pas = Math.min(n, total)
  const debut = ((numeroDuJour(jour) * pas) % total + total) % total
  return Array.from({ length: pas }, (_, i) => FOND_BIOGAME[(debut + i) % total])
}

/** Le fil de la station : les Biogames validés (au plus 3), puis le fond (2 au moins, 4 sans Biogame). */
export function actualitesStationBiogame(sujets: readonly SujetCarte[], jour: Date | string): NewsItem[] {
  const jeux = sujets.filter(s => s.famille === 'biogame').slice(0, 3).map(sujetVersActualite)
  return [...jeux, ...choisirFondBiogame(jeux.length ? 2 : 4, jour)]
}

/** Section « ligne éditoriale » du prompt système de la station Biogame. */
export function ligneEditorialeBiogame(aDesBiogames: boolean): string {
  return [
    `Ta station parle des Biogames : des jeux réels, mesurables et géolocalisés qui transforment la coopération autour des besoins vitaux et le dépassement de soi en parties qui produisent de la valeur réelle. Le lancement officiel des Biogames est prévu ${LANCEMENT_OFFICIEL} : dis-le, et parle de ce qu'on peut préparer d'ici là.`,
    "Fais vivre les DIFFÉRENTS TYPES et leurs activités, à partir des sujets de fond : les Compétitions (trail, course, marche, plogging, seed-run, vélo, orientation, Baston, Fight Wheel Cup), les Tournois des Tribus et le Grand Tournoi de l'Autonomie, les Défis d'entraide, les Challenges du mois, les Quêtes « We are » (We are Alive en tête), la Ligue, le Palmarès, le vote des Paliers 3, la preuve de présence, et la forêt des Biogames avec ses lieux.",
    aDesBiogames
      ? "Les Biogames de l'ACTUALITÉ marqués « Biogame sur la carte d'Infinity » sont réels et validés : pour chacun, dis son nom, sa ville, sa date, ce qu'on y fait et comment s'inscrire, TELS QU'ILS SONT DONNÉS. N'invente ni lieu plus précis, ni participants, ni chiffres, ni prix."
      : "Aujourd'hui, pas de Biogame publié à annoncer : n'en invente aucun. Donne des idées de jeux qu'un auditeur pourrait créer (un concours de potager partagé, un défi zéro déchet entre familles, une course de plogging le long d'une rivière…).",
    "Aucun montant de prix : le module n'en fixe pas. Termine souvent par une invitation : ouvrir Biogame dans Infinity, créer son jeu ou rejoindre une Tribu. Jamais d'adresse, jamais de nom de personne, jamais de contact. Ne parle jamais de modération ni de validation interne d'un jeu précis.",
  ].join('\n')
}
