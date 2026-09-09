#!/usr/bin/env tsx
/**
 * @module InfinityScheduler/Scripts/MesurerGroupage
 * @description Mesure ce que coûterait de produire PLUSIEURS tours par
 *   appel au lieu d'un seul — sans rien changer à la génération.
 *
 *   ── LE PROBLÈME MESURÉ ──
 *   Un tour = un appel. Chaque appel renvoie l'INTÉGRALITÉ du prompt
 *   système (identité, personnalité, base de connaissances, actualité du
 *   jour, structure de l'émission) plus l'historique. Sur 22 tours, le
 *   même contexte est donc payé 22 fois. Relevé sur les diffusions du
 *   29/08/2026 : ~78 000 jetons d'entrée par émission.
 *
 *   La mise en cache des prompts ne peut PAS régler ça ici : le préfixe
 *   minimum cachable de Claude Haiku 4.5 est de 4 096 jetons, et notre
 *   prompt système stable en fait ~1 775. Sous le seuil, le cache ne se
 *   crée pas — sans erreur, sans trace.
 *
 *   ── CE QUE CE SCRIPT FAIT, ET NE FAIT PAS ──
 *   Il construit les DEUX formes de prompt sur une vraie station, avec la
 *   vraie actualité du jour, et compte les caractères. Il ne génère
 *   rien, n'appelle aucun modèle, ne coûte rien.
 *
 *   ⚠️ Il mesure une TAILLE D'ENTRÉE, pas une qualité de dialogue. Rien
 *   ici ne dit si une scène de 4 tours écrite d'un bloc vaut 4 répliques
 *   écrites l'une après l'autre. Cela ne se saura qu'à l'écoute.
 *
 *   Usage :
 *     tsx src/scripts/mesurer-groupage.ts [stationId] [toursParAppel]
 */

import 'dotenv/config'
import { SEED_STATIONS } from '../data/seed-stations'
import { SEED_HOST_KBS } from '../data/seed-host-kbs'
import { buildHostSystemPrompt, retrieveTopEntries } from '../lib/personas'
import { fetchNewsForStation, formatNewsForPrompt } from '../lib/news'
import type { HostKB, RadioStation, RadioHost, StationLanguage } from '../lib/types'

/** Rapport observé sur les diffusions du 29/08/2026 : 206 932 car. ⇒ 78 056 jetons. */
const CAR_PAR_JETON = 2.65

const KB_TOP_K = 5
const HISTORY_DEPTH = 6
/** Longueur moyenne d'un tour, mesurée : 15 070 car. pour 22 tours (wtf-radio). */
const LONGUEUR_TOUR = 15070 / 22

function kbDe(host: RadioHost, station: RadioStation): HostKB {
  return SEED_HOST_KBS[host.id]
    ?? ({ hostId: host.id, stationId: station.id, personality: '', entries: [], updatedAt: 0 } as HostKB)
}

/**
 * Prompt de SCÈNE : le modèle n'incarne plus un animateur, il écrit un
 * échange entre plusieurs. Le prompt porte donc les personnalités de tous
 * les animateurs de la station — il est plus gros, mais envoyé bien moins
 * souvent.
 *
 * Prototype de MESURE : il donne la bonne taille et la bonne forme, il
 * n'est pas le prompt qu'on expédierait tel quel.
 */
function construireScene(opts: {
  station:      RadioStation
  newsBlock:    string
  toursParAppel: number
  premierTour:  number
  totalTours:   number
}): string {
  const { station, newsBlock, toursParAppel, premierTour, totalTours } = opts
  const language: StationLanguage = station.language ?? 'fr'

  const personnages = station.hosts.map(h => {
    const kb = kbDe(h, station)
    const extraits = retrieveTopEntries(kb.entries, '', KB_TOP_K)
      .map((e, i) => `  [${i + 1}] ${e.title} — ${e.body}`).join('\n')
    return `### ${h.name} (${h.gender === 'female' ? 'voix féminine' : h.gender === 'male' ? 'voix masculine' : 'voix androgyne'})
- Trait dominant : ${h.trait}
- Personnalité : ${kb.personality || '(non renseignée)'}
- Ce qu'il/elle sait :
${extraits || '  (rien de particulier)'}`
  }).join('\n\n')

  return `Tu écris le dialogue de ${station.name}${station.description ? ` — ${station.description}` : ''}.

# LES VOIX À L'ANTENNE
${personnages}

# ACTUALITÉ DU JOUR (sources réelles)
${newsBlock}

# CE QU'ON TE DEMANDE MAINTENANT
Écris les tours ${premierTour} à ${premierTour + toursParAppel - 1} sur ${totalTours} de l'émission.

Format EXACT, une ligne par tour, rien d'autre :
[Nom de l'animateur] son texte

Règles :
1. ${language === 'fr' ? 'Tu écris en français, à l\'oral.' : `Tu écris en ${language}, à l'oral.`} Pas de Markdown, pas de listes.
2. Maximum 3 phrases courtes par tour. C'est de la radio en flux.
3. Les animateurs se répondent, se contredisent, rebondissent — ils ne récitent pas chacun leur tour.
4. Appuie-toi sur ce que chacun SAIT ; tu peux le déformer selon son tempérament.
5. Ce ne sont pas des assistants IA. Pas de méta-commentaire, pas d'avertissement moralisateur.`
}

async function main() {
  const stationId = process.argv[2] || 'wtf-radio'
  const toursParAppel = Number.parseInt(process.argv[3] ?? '4', 10)
  const totalTours = Number.parseInt(process.env.NUM_TURNS ?? '22', 10)

  const station = SEED_STATIONS.find(s => s.id === stationId)
  if (!station) throw new Error(`Station inconnue : ${stationId}`)

  const news = await fetchNewsForStation(station, 8)
  const newsBlock = formatNewsForPrompt(news)

  // ── Forme ACTUELLE : un tour, un appel ────────────────────────────
  let carActuel = 0
  for (let i = 0; i < totalTours; i++) {
    const host = station.hosts[i % station.hosts.length]
    const kb = kbDe(host, station)
    const sys = buildHostSystemPrompt({
      host, kb,
      selectedEntries: retrieveTopEntries(kb.entries, '', KB_TOP_K),
      topic: '', stationName: station.name, stationDescription: station.description,
      newsBlock, language: station.language ?? 'fr',
      otherHosts: station.hosts.filter(h => h.id !== host.id),
      currentTurn: i + 1, totalTurns: totalTours,
    })
    const historique = Math.min(i, HISTORY_DEPTH) * LONGUEUR_TOUR
    carActuel += sys.length + historique
  }

  // ── Forme GROUPÉE : N tours, un appel ─────────────────────────────
  const nbAppels = Math.ceil(totalTours / toursParAppel)
  let carGroupe = 0
  let exemple = ''
  for (let appel = 0; appel < nbAppels; appel++) {
    const premierTour = appel * toursParAppel + 1
    const sys = construireScene({
      station, newsBlock, toursParAppel,
      premierTour, totalTours,
    })
    if (appel === 1) exemple = sys
    const historique = Math.min(appel * toursParAppel, HISTORY_DEPTH) * LONGUEUR_TOUR
    carGroupe += sys.length + historique
  }

  const jetons = (car: number) => Math.round(car / CAR_PAR_JETON)
  const gain = (1 - carGroupe / carActuel) * 100

  console.log(`\n╔═══════════════════════════════════════════════════════════════╗`)
  console.log(`║  ${station.name} · ${station.hosts.length} animateur(s) · ${news.length} actus · ${totalTours} tours`.padEnd(64) + `║`)
  console.log(`╚═══════════════════════════════════════════════════════════════╝\n`)
  console.log(`ACTUEL  — 1 tour par appel  · ${String(totalTours).padStart(2)} appels`)
  console.log(`          ${carActuel.toLocaleString('fr-FR')} car.  ≈ ${jetons(carActuel).toLocaleString('fr-FR')} jetons d'entrée\n`)
  console.log(`GROUPÉ  — ${toursParAppel} tours par appel · ${String(nbAppels).padStart(2)} appels`)
  console.log(`          ${carGroupe.toLocaleString('fr-FR')} car.  ≈ ${jetons(carGroupe).toLocaleString('fr-FR')} jetons d'entrée\n`)
  console.log(`GAIN    — ${gain.toFixed(1)} %  ·  ${(jetons(carActuel) - jetons(carGroupe)).toLocaleString('fr-FR')} jetons économisés par émission`)
  console.log(`          × 15 stations = ${((jetons(carActuel) - jetons(carGroupe)) * 15).toLocaleString('fr-FR')} jetons par jour\n`)
  console.log(`Pour ${15} stations : ${(jetons(carActuel) * 15).toLocaleString('fr-FR')} → ${(jetons(carGroupe) * 15).toLocaleString('fr-FR')} jetons/jour\n`)

  if (process.argv.includes('--montrer-prompt')) {
    console.log(`──────── PROMPT GROUPÉ (2ᵉ appel, ${exemple.length} car.) ────────`)
    console.log(exemple)
    console.log(`──────── fin ────────`)
  } else {
    console.log(`(ajouter --montrer-prompt pour lire le prompt groupé en entier)`)
  }
}

main().catch(err => {
  console.error('\n❌ Échec :', err)
  process.exit(1)
})
