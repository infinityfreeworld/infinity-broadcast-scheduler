#!/usr/bin/env tsx
/**
 * @module InfinityScheduler/Scripts/GenerateAll
 * @description Boucle sur toutes les stations seed et génère le broadcast
 *   du lendemain pour chacune. Tourne séquentiellement (1 station après
 *   l'autre) pour ne pas saturer Anthropic + Pinata.
 *
 *   Robustesse : si une station échoue, on log l'erreur et on continue
 *   avec les suivantes. Le job CI n'échoue que si TOUTES échouent.
 *
 *   Usage :
 *     tsx src/scripts/generate-all.ts [YYYY-MM-DD]
 *
 *   Variables d'env : cf. generate-broadcast.ts
 */

import 'dotenv/config'
import { getChatterboxVoiceForHost, chatterboxBranche } from '../lib/chatterbox'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { delaiStationMs } from '../lib/sortie'
import {
  reglagesFenetre, finDeFenetre, echeanceVoixClonees, derniereChance, pauseAvantReprise, classerSortie,
  heureLisible, type IssueStation,
} from '../lib/fenetre-nuit'
import { purgerChantiers } from '../lib/chantier'
import { SEED_STATIONS } from '../data/seed-stations'
import { fetchHostVoiceMappings, exportHostVoiceMappingsToEnv } from '../lib/host-voice-mappings'
import { fetchHostPersonas, exportHostPersonasToEnv } from '../lib/host-personas'
import { fetchRadioGuests, exportGuestsToEnv } from '../lib/guests'
import { fetchPulse, exportPulseToEnv } from '../lib/pulse'
import { fetchStationsAjoutees } from '../lib/station-reglages'
import { fetchRadioPersonas, exportRadioPersonasToEnv, unifiedGuestsForStation, resolvePersonaForStation } from '../lib/radio-personas'

const exec = promisify(execFile)

function tomorrowLocalISO(): string {
  const d = new Date()
  d.setDate(d.getDate() + 1)
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const dd = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${dd}`
}

async function main() {
  // ATTENTION : `||` (pas `??`) — le workflow YAML set `TARGET_DATE: ''` quand
  // le cron déclenche sans workflow_dispatch, ce qui faisait propager une date
  // vide partout (cf bug observé 2026-05-19 : 11 broadcasts publiés sur NOSTR
  // avec `content.date = ""` car nullish coalescing ne fallback pas sur '').
  const targetDate = process.argv[2] || process.env.TARGET_DATE || tomorrowLocalISO()

  console.log(`\n╔══════════════════════════════════════════════════════════╗`)
  console.log(`║  Infinity Broadcast Scheduler — génération pour ${targetDate}  ║`)
  console.log(`║  ${SEED_STATIONS.length} stations seed à traiter               ║`)
  console.log(`╚══════════════════════════════════════════════════════════╝`)

  // ── Auto-purge Pinata (Spring 2026) ──────────────────────────────────
  // Avant chaque run cron, on supprime les broadcasts > J-1 du compte Pinata
  // pour rester sous le quota free tier (1 GB). On garde [hier, aujourd'hui,
  // demain] = 3 jours de retention, suffit pour overlap entre J et J+1
  // + grace period si l'utilisateur reste plusieurs heures sur une page.
  // La purge Pinata a été retirée le 09/09/2026 : nous ne déposons plus
  // que chez data-space. La rétention à 10 jours y est faite par
  // `purger-emissions.ts`, appelé par la nuit — et qui ne supprime QUE ce
  // qu'il reconnaît comme émission, jamais les voix ni les modèles.

  // ── Fetch mappings animateur → voix Chatterbox (Phase C.3) ───────────
  // Publiés sur NOSTR kind:30095 par l'IHL Infinity. On les fetch UNE FOIS
  // au démarrage du parent process, on sérialise dans HOST_VOICE_MAP_JSON,
  // et chaque sous-process generate-broadcast hérite via `env: process.env`.
  // Évite N × round-trips NOSTR (1 par station). Si fetch échoue, on
  // continue avec une map vide → fallback CHATTERBOX_DEFAULT_VOICE.
  if (chatterboxBranche()) {
    console.log(`\n📨 Fetch mappings animateurs (NOSTR kind:30095)…`)
    const mappings = await fetchHostVoiceMappings()
    exportHostVoiceMappingsToEnv(mappings)
    console.log(`   ✓ ${mappings.size} mapping(s) trouvé(s)${
      mappings.size > 0 ? ' : ' + [...mappings.entries()].slice(0, 5).map(([k, v]) => `${k}→${v}`).join(', ') + (mappings.size > 5 ? ', …' : '') : ''
    }`)
  }

  // ── Fetch personas animateurs (Phase D.4) ────────────────────────────
  // Publiés sur NOSTR kind:30096 par l'IHL Infinity. Contiennent les
  // instructions système enrichies + le ton (warm/aggressive/sad/neutral/
  // adaptive) que l'admin a choisi pour chaque (station, host). Pattern
  // identique aux voix : 1 round-trip parent, env-serialized aux enfants.
  // Fallback : si pas de persona NOSTR pour un host, le scheduler utilise
  // la seed RadioHost (compatibilité ascendante).
  console.log(`\n📨 Fetch personas animateurs (NOSTR kind:30096)…`)
  const personas = await fetchHostPersonas()
  exportHostPersonasToEnv(personas)
  console.log(`   ✓ ${personas.size} persona(s) trouvée(s)${
    personas.size > 0 ? ' : ' + [...personas.values()].slice(0, 5).map(p => `${p.stationId}:${p.hostId}(${p.behavior})`).join(', ') + (personas.size > 5 ? ', …' : '') : ''
  }`)

  // ── Fetch invités personas (Phase H.4) ────────────────────────────────
  // Publiés sur NOSTR kind:30098 par l'IHL « 🎭 Invités ». Pool global
  // cross-stations. Le scheduler choisit 1 guest random par broadcast
  // (parmi `station.guestIds[]` filtré par langue) et l'insère sur 2
  // tours d'intervention au milieu du dialogue.
  console.log(`\n📨 Fetch invités (NOSTR kind:30098)…`)
  const guests = await fetchRadioGuests()
  exportGuestsToEnv(guests)
  console.log(`   ✓ ${guests.size} invité(s) trouvé(s)${
    guests.size > 0 ? ' : ' + [...guests.values()].slice(0, 5).map(g => g.displayName).join(', ') + (guests.size > 5 ? ', …' : '') : ''
  }`)

  // ── Fetch Pulse Pirate (2026-09-01) ──────────────────────────────────
  // kinds 30101 (global) / 30102 (override station) / 30103 (override
  // persona), réglés dans le panneau Pirate › ⚙️ Pulse. Jusqu'ici le
  // scheduler ne les lisait pas : tout ce que l'admin réglait n'avait
  // AUCUN effet sur la génération. Même patron que ci-dessus : un seul
  // aller-retour NOSTR, sérialisé en env pour les sous-processus.
  //
  // Ces kinds étaient aussi REJETÉS par notre propre relais souverain
  // (« blocked: event kind 30101 not allowed ») — corrigé le même jour
  // dans infinity-relay. Sans ce correctif déployé, la récolte reste
  // vide et le scheduler retombe sur les valeurs par défaut.
  // ── Stations AJOUTÉES par un administrateur dans l'IHL (07/10/2026) ──────────────────
  // Une fiche 30091 d'admin dont le d-tag n'est pas dans la seed, et COMPLÈTE (nom, langue
  // ayant une voix, au moins un animateur) : fabriquée comme les autres, après elles.
  console.log(`\n📨 Stations ajoutées dans l'IHL (NOSTR kind:30091, administrateurs seulement)…`)
  const ajoutees = await fetchStationsAjoutees(SEED_STATIONS)
  console.log(`   ✓ ${ajoutees.length} station(s) ajoutée(s)${ajoutees.length ? ' : ' + ajoutees.map(s => `${s.name} (${s.id}, ${s.language})`).join(', ') : ''}`)
  const STATIONS_NUIT = [...SEED_STATIONS, ...ajoutees]

  console.log(`\n📨 Fetch Pulse (NOSTR kinds:30101/30102/30103)…`)
  const pulse = await fetchPulse(STATIONS_NUIT.map(s => s.id))
  exportPulseToEnv(pulse)
  const nbStation = Object.keys(pulse.byStation).length
  const nbPersona = Object.keys(pulse.byPersona).length
  if (pulse.global) {
    console.log(`   ✓ global : ${pulse.global.rhythm.globalMood} · densité ${pulse.global.rhythm.dialogueDensity} · invités ${pulse.global.rhythm.interventionRate} · ${pulse.global.behavior.verbosity}`)
  } else {
    console.log(`   · aucun Pulse global publié → valeurs par défaut (émissions inchangées)`)
  }
  console.log(`   · ${nbStation} override(s) station, ${nbPersona} override(s) persona`)

  // ── Fetch personas unifiées (2026-09-01) ─────────────────────────────
  // kind:30104 + affinages per-station kind:30105. Modèle qui remplace le
  // couple animateur(30096)/invité(30098) : chaque persona déclare
  // elle-même les stations et les rôles qu'elle peut tenir. Le scheduler
  // ne les lisait pas — 7 personas publiées depuis juin 2026 n'avaient
  // jamais pris l'antenne.
  console.log(`\n📨 Fetch personas unifiées (NOSTR kinds:30104/30105)…`)
  const unified = await fetchRadioPersonas(STATIONS_NUIT.map(s => s.id))
  exportRadioPersonasToEnv(unified)
  const listePersonas = Object.values(unified.personas)
  console.log(`   ✓ ${listePersonas.length} persona(s) unifiée(s), ${Object.keys(unified.overrides).length} affinage(s) per-station`)
  for (const p of listePersonas) {
    const roles = p.stationRules
      .filter(r => r.canHost || r.canGuest)
      .map(r => `${r.stationId}${r.canHost ? '/anim' : ''}${r.canGuest ? '/invité' : ''}`)
      .join(' ')
    console.log(`      · ${p.displayName} (${p.id})${p.voiceName ? ` voix=${p.voiceName}` : ''} → ${roles}`)
  }

  const startedAt = Date.now()

  // 🔴 Les stations à voix clonée passent EN TÊTE. Sans ce tri, elles sont
  // dispersées dans l'ordre de la seed et CHACUNE repaie un réveil complet
  // de 35 minutes. Groupées, elles se partagent une seule station chaude.
  // Le tri existait pour la matrice GitHub (`lister-stations.ts`) et n'était
  // pas appliqué ici — un outil écrit puis oublié à l'endroit qui compte.
  // 🔴 Il faut regarder les INVITÉS autant que les animateurs.
  //
  // La première version de ce tri ne consultait que les animateurs. Or les
  // voix de personnage viennent surtout des personas d'invités — et depuis
  // que le durcissement par auteur a écarté la seule association
  // d'animateur contestée (`pirate-radio:pi-hex` → « alain »), PLUS AUCUNE
  // station n'avait de voix d'animateur.
  //
  // Résultat : le tri rendait ZÉRO station en tête. Il ne triait rien, sans
  // jamais échouer — les quatre stations à voix clonée restaient dispersées
  // et repayaient chacune un réveil de 35 minutes.
  //
  // Même logique que `lister-stations.ts`, qui la tenait juste depuis le
  // début. Deux endroits doivent s'accorder ; un test le vérifie.
  const avecGpu = new Set<string>()
  for (const st of STATIONS_NUIT) {
    const lg = st.language ?? 'fr'
    const invites = unifiedGuestsForStation(st.id, lg)
    const parInvite = invites.length
      ? resolvePersonaForStation(invites[0], st.id).voiceName : undefined
    const parAnimateur = st.hosts
      .map(h => getChatterboxVoiceForHost(st.id, h.id, lg))
      .find((v): v is string => !!v)
    if (parInvite || parAnimateur) avecGpu.add(st.id)
  }
  const ordreNuit = [
    ...STATIONS_NUIT.filter(s => avecGpu.has(s.id)),
    ...STATIONS_NUIT.filter(s => !avecGpu.has(s.id)),
  ]
  if (avecGpu.size > 0) {
    console.log(`\n🎭 ${avecGpu.size} station(s) à voix clonée passent en tête : `
      + `${[...avecGpu].join(', ')}`)
  }

  // ── LA FENÊTRE ET LES REPRISES (07/10/2026, lib/fenetre-nuit.ts) ──────────────────────
  // 🔴 L'ancien budget — 150 min de voix clonée pour TOUTE la nuit — servait 3 à 5 stations :
  // le GPU calcule à peu près en temps réel (~32 min par station), et les 9 à 11 suivantes
  // partaient entières en Piper (88 % des tours perdus du 21/09 au 06/10). La nuit dure
  // désormais jusqu'à RADIO_FIN_FENETRE (07:00) ; une station à qui il manque des voix est
  // REPORTÉE (code 75) et reprise à un passage suivant, en ne refaisant que les tours manquants.
  const reglages = reglagesFenetre()
  const debutNuit = Date.now()
  const finFenetre = finDeFenetre(debutNuit, reglages.finHeure, reglages.maxHeures)
  // Instant absolu au-delà duquel PLUS AUCUNE station n'attend le GPU.
  // Une échéance par station borne une station, pas la nuit.
  process.env.CHATTERBOX_FIN_NUIT = String(echeanceVoixClonees(debutNuit, finFenetre, reglages))
  console.log(`⏳ fenêtre de fabrication jusqu'à ${heureLisible(finFenetre)} · voix clonées jusqu'à `
    + `${heureLisible(Number(process.env.CHATTERBOX_FIN_NUIT))}${reglages.nuitMinutes !== null ? ` (CHATTERBOX_NUIT_MINUTES=${reglages.nuitMinutes})` : ''}`
    + ` · ${reglages.maxPasses} passage(s) au plus`)
  const purges = purgerChantiers()
  if (purges.length > 0) console.log(`🧹 ${purges.length} chantier(s) de plus de 3 jours effacé(s)`)

  /** Fabrique UNE station dans un sous-processus ; rend ce que dit son code de sortie. */
  const fabriquer = async (station: (typeof SEED_STATIONS)[number], passe: number): Promise<{ issue: IssueStation; error?: string }> => {
    const derniere = derniereChance(Date.now(), finFenetre, passe, reglages)
    console.log(`\n────────────────────────────────────────────────────────────`)
    console.log(`▶ ${station.name} (${station.id})${passe > 1 ? ` — reprise, passage ${passe}` : ''}${derniere ? ' · dernière chance' : ''}`)
    console.log(`────────────────────────────────────────────────────────────`)
    try {
      // On fork un sous-process tsx pour isoler les générations
      // (chaque station = process clean, pas de fuite de state Piper).
      const { stdout, stderr } = await exec(
        'npx',
        ['tsx', 'src/scripts/generate-broadcast.ts', station.id, targetDate],
        // Filet : une station qui ne rend pas la main (socket orpheline,
        // lib/sortie.ts) ne retient plus toute la nuit derrière elle.
        {
          env: { ...process.env, RADIO_DERNIERE_CHANCE: derniere ? '1' : '0' },
          maxBuffer: 50 * 1024 * 1024, timeout: delaiStationMs(), killSignal: 'SIGTERM',
        },
      )
      if (stdout) process.stdout.write(stdout)
      if (stderr) process.stderr.write(stderr)
      return { issue: classerSortie(0) }
    } catch (err) {
      const e = err as { killed?: boolean; code?: unknown; stdout?: string; stderr?: string }
      const suspendue = e?.killed === true
      const issue = classerSortie(e?.code, suspendue)
      // Un report ou une veille gardée n'est pas une panne : son journal s'imprime en entier.
      if (issue === 'a-reprendre' || issue === 'veille-gardee') {
        if (e.stdout) process.stdout.write(e.stdout)
        if (e.stderr) process.stderr.write(e.stderr)
        return { issue }
      }
      const msg = suspendue
        ? `abandonnée après ${delaiStationMs() / 60_000} min sans rendre la main (processus suspendu)`
        : err instanceof Error ? err.message : String(err)
      console.error(`✗ ${station.id} : ${msg}`)
      return { issue, error: msg }
    }
  }

  const results = new Map<string, { stationId: string; issue: IssueStation; error?: string; passe: number }>()
  let aReprendre: typeof ordreNuit = []
  let debutPasse = Date.now()
  // Passage 1 : toutes les stations, dans l'ordre de la nuit.
  for (const station of ordreNuit) {
    const r = await fabriquer(station, 1)
    results.set(station.id, { stationId: station.id, ...r, passe: 1 })
    // Un échec franc (réseau coupé pendant l'écriture : « Aucun maillon LLM n'a répondu ») se
    // retente aussi : une émission DÉJÀ publiée est reconnue par l'anti-doublon et rend la main.
    if (r.issue === 'a-reprendre' || r.issue === 'echec') aReprendre.push(station)
  }
  // Passages suivants : seulement les stations reportées, après une pause.
  for (let passe = 2; aReprendre.length > 0 && passe <= reglages.maxPasses; passe++) {
    // Une coupure réseau peut tout reporter en quelques minutes : on la laisse passer.
    const pause = pauseAvantReprise(Date.now(), debutPasse, finFenetre, reglages)
    console.log(`\n🔁 Passage ${passe} : ${aReprendre.length} station(s) à reprendre (${aReprendre.map(s => s.id).join(', ')})`
      + `${pause > 0 ? ` — pause de ${Math.round(pause / 60_000)} min d'abord` : ''}`)
    if (pause > 0) await new Promise(r => setTimeout(r, pause))
    debutPasse = Date.now()
    const encore: typeof ordreNuit = []
    for (const station of aReprendre) {
      const r = await fabriquer(station, passe)
      results.set(station.id, { stationId: station.id, ...r, passe })
      if (r.issue === 'a-reprendre' || r.issue === 'echec') encore.push(station)
    }
    aReprendre = encore
  }

  const totalSec = ((Date.now() - startedAt) / 1000).toFixed(0)
  const liste = [...results.values()]
  const compte = (i: IssueStation) => liste.filter(r => r.issue === i).length
  const okCount = compte('publiee')
  const failCount = compte('echec') + compte('suspendue')

  console.log(`\n╔══════════════════════════════════════════════════════════╗`)
  console.log(`║  Résumé : ${okCount}/${liste.length} publiée(s) · ${compte('veille-gardee')} veille gardée · `
    + `${compte('a-reprendre')} encore à reprendre · ${failCount} échec(s) · ${totalSec}s wall time  ║`)
  console.log(`╚══════════════════════════════════════════════════════════╝`)
  for (const r of liste.filter(r => r.passe > 1)) console.log(`  🔁 ${r.stationId} : ${r.issue} au passage ${r.passe}`)
  for (const r of liste.filter(r => r.issue === 'veille-gardee')) {
    console.log(`  🛑 ${r.stationId} : NON publiée (voix de repli en fin de fenêtre) — l'émission précédente reste à l'antenne`)
  }

  if (failCount > 0) {
    console.log('\nÉchecs :')
    for (const r of liste.filter(r => r.issue === 'echec' || r.issue === 'suspendue')) {
      console.log(`  - ${r.stationId}: ${r.error?.split('\n')[0] ?? '(no message)'}`)
    }
  }

  // Une veille gardée est une décision, pas une panne : seule l'absence TOTALE de résultat échoue.
  if (okCount + compte('veille-gardee') === 0) {
    console.error('\n❌ Toutes les stations ont échoué.')
    process.exit(1)
  }
}

main().catch(err => {
  console.error('\n❌ Erreur fatale :', err)
  process.exit(1)
})
