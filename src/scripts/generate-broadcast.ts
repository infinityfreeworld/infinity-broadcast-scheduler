#!/usr/bin/env tsx
/**
 * @module InfinityScheduler/Scripts/GenerateBroadcast
 * @description Génère UN broadcast (1 station, 1 date) end-to-end :
 *   LLM (Anthropic) → TTS (Piper natif) → concat WAV → Pinata → NOSTR.
 *
 *   Usage :
 *     tsx src/scripts/generate-broadcast.ts <stationId> [YYYY-MM-DD]
 *     # Si date omise : J+1 (lendemain par défaut, cohérent avec cron 22h
 *     # qui prépare pour le lendemain).
 *
 *   Variables d'env requises :
 *     ANTHROPIC_API_KEY
 *     PINATA_JWT
 *     NOSTR_PRIVATE_KEY (hex 64 chars)
 *
 *   Variables optionnelles :
 *     ANTHROPIC_MODEL   (défaut claude-haiku-4-5-20251001)
 *     NUM_TURNS         (défaut 45 ≈ 30 min audio)
 *     NOSTR_RELAYS      (défaut liste curatée, comma-separated)
 */

import 'dotenv/config'
import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { SEED_STATIONS } from '../data/seed-stations'
import { SEED_HOST_KBS } from '../data/seed-host-kbs'
import type { RadioStation, RadioHost, HostKB, BroadcastTurn, RadioBroadcast, NewsItem } from '../lib/types'
import { appelerLLM, maillonsDisponibles, bilanDesMaillons, type LLMMessage } from '../lib/llm'
import { buildHostSystemPrompt, buildGuestSystemPrompt, retrieveTopEntries } from '../lib/personas'
import { fetchNewsForStation, formatNewsForPrompt } from '../lib/news'
import { synthesize, getVoiceSampleRate, ensurePiperBinary, ensureVoice } from '../lib/piper'
import {
  synthesizeWithChatterbox, getChatterboxVoiceForHost, reveillerEtVerifier,
  isFallbackPiperEnabled, ChatterboxError,
} from '../lib/chatterbox'
import { getPersonaForHost, behaviorDirective } from '../lib/host-personas'
import { pickGuestForStation, guestBehaviorDirective } from '../lib/guests'
import {
  resolveRhythmForStation, resolveBehaviorForPersona, hasPublishedPulse,
  rhythmDirective, behaviorPulseDirective, guestSlotsForRate,
  personaKeyForHost, personaKeyForGuest,
} from '../lib/pulse'
import {
  unifiedGuestsForStation, resolvePersonaForStation, hasUnifiedPersonas,
  fetchRadioPersonas, exportRadioPersonasToEnv,
} from '../lib/radio-personas'
import { fetchPulse, exportPulseToEnv } from '../lib/pulse'
import { fetchHostVoiceMappings, exportHostVoiceMappingsToEnv } from '../lib/host-voice-mappings'
import { fetchHostPersonas, exportHostPersonasToEnv } from '../lib/host-personas'
import { fetchRadioGuests, exportGuestsToEnv } from '../lib/guests'
import { readWav, concatWavs, encodeWav, durationOf, type ConcatEntry } from '../lib/audio'
import { encodeWavToOpus } from '../lib/opus'
import { pinataPinFile } from '../lib/pinata'
import { publishBroadcast } from '../lib/nostr'
import { voixPourLangue, langueSynthetisable, timbreHonore } from '../lib/voix'
import { licenceDe } from '../lib/voix-licences'

// ── Helpers date ─────────────────────────────────────────────────────

function tomorrowLocalISO(): string {
  const d = new Date()
  d.setDate(d.getDate() + 1)
  return toIsoLocal(d)
}
function toIsoLocal(d: Date): string {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const dd = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${dd}`
}

// ── Génération séquentielle (même algo que broadcast-generator browser) ──

const HISTORY_DEPTH = 6
const KB_TOP_K = 5

/** Invité du jour, qu'il vienne d'une persona unifiée (30104) ou du
 *  pool legacy (30098) — le dialogue ne fait pas la différence. */
interface BroadcastGuest {
  id:           string
  displayName:  string
  gender:       'male' | 'female' | 'androgyn'
  avatar:       string
  color:        string
  bio:          string
  instructions: string
  behavior:     'warm' | 'aggressive' | 'sad' | 'neutral' | 'adaptive'
}

interface GenResult {
  audioBlob:   Buffer
  durationSec: number
  turns:       BroadcastTurn[]
  costInputTokens:  number
  costOutputTokens: number
  /** Tours pour lesquels une voix de personnage était attribuée. */
  voixAttendues: number
  /** Tours qui ont RÉELLEMENT été dits par cette voix. */
  voixObtenues:  number
}

async function generateBroadcastBytes(opts: {
  station:  RadioStation
  numTurns: number
  topic:    string
  news:     NewsItem[]
}): Promise<GenResult> {
  const { station, numTurns, topic, news } = opts
  const language = station.language ?? 'fr'
  const turns: BroadcastTurn[] = []
  const wavEntries: ConcatEntry[] = []
  /** Ce qu'il faudra faire dire, et par quelle voix — rempli en phase 1. */
  const plansVoix: Array<{ texte: string; voixPiper: string; voixPersonnage: string | null }> = []
  let costIn = 0, costOut = 0
  // Compteurs du verdict de fin : sans eux, une nuit entière peut sortir
  // en voix de repli sans que personne ne l'apprenne (cf. août 2026).
  let voixAttendues = 0, voixObtenues = 0

  // Phase H.4 — Tirage d'un invité au sort parmi `station.guestIds`
  // (filtré par langue de la station).
  //
  // Phase H.8 + H.9 — vrai back-and-forth de 5 tours autour du guest :
  //   tour s-1 : host A PRÉSENTE l'invité + POSE QUESTION 1 (terminée par '?')
  //   tour s   : guest RÉPOND à Q1 + saillie satirique courte
  //   tour s+1 : host B (ou A si solo) RELANCE + POSE QUESTION 2 (autre angle)
  //   tour s+2 : guest RÉPOND à Q2 + amorce de sortie
  //   tour s+3 : host CONCLUT l'échange (1-2 phrases) puis enchaîne
  // `s` clampé à [2, numTurns-4] pour que les 5 tours rentrent toujours.
  // Pulse Pirate (2026-09-01) — le rythme de CETTE station : override
  // station (kind:30102) → global (kind:30101) → défauts. Tant que rien
  // n'a été publié, `pulseActif` est faux et le prompt reste EXACTEMENT
  // celui d'avant : on ne change pas les émissions d'aujourd'hui en
  // injectant des valeurs par défaut.
  const rhythm = resolveRhythmForStation(station.id)
  const pulseActif = hasPublishedPulse()
  if (pulseActif) {
    console.log(`    ⚙️  Pulse : ${rhythm.globalMood} · densité ${rhythm.dialogueDensity} · segment ~${rhythm.averageSegmentSec}s · invités ${rhythm.interventionRate}`)
  }

  // `interventionRate` décide de la PRÉSENCE de l'invité :
  //   rare → environ 1 jour sur 3 · normal et frenetic → présent
  // NB : `frenetic` vaut 2 créneaux dans le Pulse, mais le dialogue ne
  // sait aujourd'hui en placer qu'UN (5 tours autour de `guestStart`).
  // On plafonne donc à 1 plutôt que de laisser croire au second.
  const slots = pulseActif ? Math.min(1, guestSlotsForRate(rhythm.interventionRate)) : 1

  // Personas unifiées (kind:30104) d'abord, invités legacy (kind:30098)
  // en repli. Les unifiées déclarent elles-mêmes sur quelles stations
  // elles peuvent être invitées (`stationRules[].canGuest`) — elles ne
  // dépendent donc pas de `station.guestIds`, qui est figé dans la seed.
  // Une persona en mode mixte est tranchée par `pickRoleForMixed` : elle
  // ne peut pas tenir les deux rôles le même jour.
  let guest: BroadcastGuest | null = null
  let guestVoiceName: string | undefined
  if (slots > 0) {
    const candidats = unifiedGuestsForStation(station.id, language)
    if (candidats.length > 0) {
      const p = candidats[Math.floor(Math.random() * candidats.length)]
      const resolu = resolvePersonaForStation(p, station.id)
      guest = {
        id:           p.id,
        displayName:  p.displayName,
        gender:       p.gender,
        avatar:       p.avatar,
        color:        p.color,
        bio:          p.bio || resolu.trait,
        instructions: resolu.instructions,
        behavior:     resolu.behavior,
      }
      guestVoiceName = resolu.voiceName
      console.log(`    ✨ Invité issu d'une persona unifiée (${candidats.length} candidate(s) sur cette station)`)
    } else {
      guest = pickGuestForStation(station.guestIds, language)
      if (!guest && hasUnifiedPersonas()) {
        console.log(`    · aucune persona unifiée invitée sur ${station.id}, aucun invité legacy non plus`)
      }
    }
  }
  const guestStart = guest
    ? Math.max(2, Math.min(Math.floor(numTurns * 0.4), numTurns - 4))
    : -1
  if (guest) {
    console.log(`    🎭 Invité programmé tours ${guestStart + 1} & ${guestStart + 3}/${numTurns} : ${guest.displayName} (${guest.behavior})`)
  }

  for (let i = 0; i < numTurns; i++) {
    const isGuestTurn1   = guest !== null && i === guestStart        // réponse Q1
    const isGuestTurn2   = guest !== null && i === guestStart + 2    // réponse Q2
    const isGuestTurn    = isGuestTurn1 || isGuestTurn2
    const isPreGuestTurn = guest !== null && i === guestStart - 1    // intro + Q1
    const isMidGuestTurn = guest !== null && i === guestStart + 1    // relance + Q2
    const isPostGuestTurn = guest !== null && i === guestStart + 3   // conclusion

    // Speaker effectif : guest si c'est son tour, sinon round-robin host
    const host: RadioHost = isGuestTurn
      ? {
          id:     `guest:${guest!.id}`,
          name:   guest!.displayName,
          gender: guest!.gender,
          trait:  guest!.bio.slice(0, 60),
          color:  guest!.color,
          avatar: guest!.avatar,
        }
      : station.hosts[i % station.hosts.length]
    // Voix choisie par LANGUE d'abord (cf. lib/voix.ts). `null` est
    // impossible ici : `main()` a déjà renoncé aux langues sans voix.
    const voiceId = voixPourLangue(language, host.gender, host.id)!

    const kb = !isGuestTurn && SEED_HOST_KBS[host.id]
      ? SEED_HOST_KBS[host.id]
      : { hostId: host.id, stationId: station.id, personality: '', entries: [], updatedAt: 0 } as HostKB
    const selectedEntries = retrieveTopEntries(kb.entries, topic, KB_TOP_K)
    const otherHosts = station.hosts.filter(h => h.id !== host.id)
    const isFirstTurn = turns.length === 0

    // Phase D.4 — Persona NOSTR (kind:30096) override la seed si présente
    // (uniquement pour les hosts ; les guests utilisent leurs propres
    // instructions livrées via kind:30098)
    const customPersona = isGuestTurn ? null : getPersonaForHost(station.id, host.id)
    const effectiveHost: RadioHost = customPersona ? {
      id:     host.id,
      name:   customPersona.name,
      gender: customPersona.gender,
      trait:  customPersona.trait,
      color:  customPersona.color,
      avatar: customPersona.avatar,
    } : host

    // Tenue de la persona : override persona (kind:30103) → global → défauts.
    const pulseKey = isGuestTurn
      ? personaKeyForGuest(guest!.id)
      : personaKeyForHost(station.id, host.id)
    const pulseDirective = pulseActif
      ? `${rhythmDirective(rhythm)}\n${behaviorPulseDirective(resolveBehaviorForPersona(pulseKey))}`
      : undefined

    const systemPrompt = isGuestTurn
      ? buildGuestSystemPrompt({
          guest:              guest!,
          stationName:        station.name,
          stationDescription: station.description,
          language,
          hostsRecap:         station.hosts.map(h => h.name).join(', '),
          newsBlock:          formatNewsForPrompt(news),
          behaviorDirective:  guestBehaviorDirective(guest!.behavior),
          pulseDirective,
        })
      : buildHostSystemPrompt({
          host:               effectiveHost,
          kb, selectedEntries, topic,
          stationName:        station.name,
          stationDescription: station.description,
          newsBlock:          formatNewsForPrompt(news),
          language,
          otherHosts,
          currentTurn:        i + 1,
          totalTurns:         numTurns,
          customInstructions: customPersona?.instructions,
          behaviorDirective:  customPersona ? behaviorDirective(customPersona.behavior) : undefined,
          pulseDirective,
        })

    const history: LLMMessage[] = turns.slice(-HISTORY_DEPTH).map(t => ({
      role: 'assistant',
      content: `[${t.hostName}] ${t.text}`,
    }))
    const userMessage: LLMMessage = {
      role: 'user',
      content: isGuestTurn1
        ? `Ton tour d'invité (1/2). L'animateur vient de te poser sa PREMIÈRE question DIRECTEMENT — RÉPONDS-LUI explicitement (1-2 phrases). Tu peux ensuite ajouter UNE saillie satirique courte dans ton style. Total : 1-3 phrases max.`
        : isGuestTurn2
          ? `Ton tour d'invité (2/2 — DERNIER). L'animateur vient de te poser une 2e question (autre angle). RÉPONDS-LUI (1-2 phrases) puis amorce ta SORTIE de l'émission (1 phrase, type "merci de m'avoir reçu" dans ton style satirique). Total : 2-3 phrases max.`
          : isPreGuestTurn
            ? `Ton tour. ${guest!.displayName} (${guest!.bio.slice(0, 80)}) est en ligne avec nous. Présente-le brièvement en 1 phrase puis POSE-LUI UNE QUESTION CONCRÈTE en lien avec un sujet d'actualité évoqué (ou à évoquer). Termine ton tour par cette question, adressée explicitement à ${guest!.displayName}.`
            : isMidGuestTurn
              ? `Ton tour. ${guest!.displayName} vient de répondre — relance avec une 2e question SOUS UN AUTRE ANGLE (provocation, contradiction polie, ou approfondissement). 2-3 phrases max, termine par '?' adressé à ${guest!.displayName}.`
              : isPostGuestTurn
                ? `Ton tour. ${guest!.displayName} s'en va — remercie-le brièvement (1 phrase, dans ton style) puis enchaîne sur le sujet suivant (1 phrase). 2 phrases max.`
                : (isFirstTurn
                  ? `Tu ouvres l'émission. Suis la consigne d'INTRO de la section STRUCTURE.`
                  : (i === numTurns - 1
                      ? `Dernier tour : conclusion + teaser de demain. Suis la consigne de CONCLUSION.`
                      : 'Ton tour. Continue le dialogue en respectant la phase courante (cf. STRUCTURE).')),
    }

    process.stdout.write(`  [${i + 1}/${numTurns}] ${isGuestTurn ? '🎭 ' : ''}${host.name}… `)

    const resp = await appelerLLM({
      systemPrompt,
      messages: [...history, userMessage],
    })
    costIn += resp.inputTokens
    costOut += resp.outputTokens
    const turnText = resp.text.trim()
    if (!turnText) {
      console.log('(vide, skip)')
      continue
    }

    // ── PHASE 1 : on n'écrit que le TEXTE ────────────────────────────
    // La synthèse est repoussée à la phase 2. Voir l'en-tête de la boucle
    // pour la raison — elle vient de l'hébergeur, pas d'un goût pour les
    // refactorisations.
    const chatterboxVoice = (isGuestTurn && guestVoiceName && process.env.CHATTERBOX_TTS_URL)
      ? guestVoiceName
      : getChatterboxVoiceForHost(station.id, host.id, language)
    if (chatterboxVoice) voixAttendues++

    const turn: BroadcastTurn = {
      id:       `bcast-${i}-${Date.now().toString(36).slice(-4)}`,
      hostId:   host.id,
      hostName: host.name,
      color:    host.color,
      avatar:   host.avatar,
      text:     turnText,
      tStart:   0,    // rempli après concat
      tEnd:     0,
    }
    turns.push(turn)
    plansVoix.push({ texte: turnText, voixPiper: voiceId, voixPersonnage: chatterboxVoice })

    console.log(`${turnText.slice(0, 60)}${turnText.length > 60 ? '…' : ''}`)
  }

  if (turns.length === 0) throw new Error('Aucun tour généré')

  // ── PHASE 2 : TOUTE la synthèse, d'un seul trait ───────────────────
  //
  // 🔴 CETTE SÉPARATION EST UNE CONTRAINTE D'HÉBERGEUR, PAS UN GOÛT.
  //
  // data-space nous a dit (02/09/2026) que leur GPU s'éteint quand la file
  // se vide, et qu'après extinction ils imposent **5 minutes de
  // refroidissement** avant toute nouvelle location, puis ~12 minutes de
  // démarrage (image de 33 Go).
  //
  // L'ancienne boucle alternait une réplique écrite, une réplique
  // synthétisée : les quelques requêtes Chatterbox d'une émission étaient
  // donc étalées sur vingt minutes, avec des trous de plusieurs minutes.
  // Chaque trou aurait payé un réveil complet — le démarrage serait devenu
  // plus cher que le travail lui-même.
  //
  // En groupant, la file reste alimentée le temps du lot et une seule
  // location sert toute la station.
  const aSynthetiser = plansVoix.filter(p => p.voixPersonnage).length
  if (aSynthetiser > 0) {
    console.log(`\n🎤 Synthèse groupée — ${aSynthetiser} tour(s) en voix de personnage, d'un seul trait`)
  }
  for (let i = 0; i < plansVoix.length; i++) {
    const plan = plansVoix[i]
    let wav: import('../lib/audio').DecodedWav | null = null
    process.stdout.write(`  [${i + 1}/${plansVoix.length}] `)

    if (plan.voixPersonnage) {
      try {
        const buf = await synthesizeWithChatterbox({
          voice:    plan.voixPersonnage,
          text:     plan.texte,
          language,
          format:   'wav',
        })
        // Écrit le buffer dans un tmpfile WAV pour réutiliser readWav.
        const tmpPath = join(tmpdir(), `chatterbox-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.wav`)
        writeFileSync(tmpPath, buf)
        // 🔴 Le décodage est HORS du try d'appel : une erreur ici n'est PAS une
        // panne de Chatterbox, c'est un défaut CHEZ NOUS (mauvais format
        // demandé, réponse tronquée). La confondre avec un échec de service la
        // ferait avaler par le repli Piper : on perdrait toutes les voix de
        // personnage en lisant « repli piper » comme une soirée normale.
        try {
          wav = readWav(tmpPath)
        } catch (errDecodage) {
          throw new Error(
            `Chatterbox a répondu ${buf.length} octets pour « ${plan.voixPersonnage} », `
            + `mais ce n'est pas du WAV décodable : ${(errDecodage as Error).message}. `
            + `Ce n'est pas une panne du service — vérifier response_format.`,
          )
        }
        voixObtenues++
        process.stdout.write(`chatterbox:${plan.voixPersonnage}\n`)
      } catch (err) {
        const msg = err instanceof ChatterboxError ? err.message : (err as Error).message
        // Un défaut de décodage n'est jamais un motif de repli : il ne se
        // réparera pas tout seul et se répéterait sur les 22 tours en silence.
        if (!(err instanceof ChatterboxError) && msg.includes('pas du WAV décodable')) {
          throw err
        }
        console.warn(`\n  ⚠ chatterbox fail [${plan.voixPersonnage}]: ${msg.slice(0, 120)}`)
        if (!isFallbackPiperEnabled()) throw err
        process.stdout.write('  (repli piper)\n')
      }
    }
    if (!wav) {
      const wavPath = await synthesize(plan.texte, plan.voixPiper)
      const piperWav = readWav(wavPath)
      if (piperWav.sampleRate !== getVoiceSampleRate(plan.voixPiper)) {
        console.warn(`  sample rate mismatch ${piperWav.sampleRate} vs ${getVoiceSampleRate(plan.voixPiper)}`)
      }
      wav = piperWav
      if (!plan.voixPersonnage) process.stdout.write(`piper:${plan.voixPiper}\n`)
    }
    wavEntries.push({ wav })
  }

  // Concat + encode
  const merged = concatWavs(wavEntries)
  for (let i = 0; i < turns.length; i++) {
    turns[i].tStart = wavEntries[i].tStart ?? 0
    turns[i].tEnd   = wavEntries[i].tEnd   ?? 0
  }
  const audioBlob = encodeWav(merged)
  return {
    audioBlob,
    durationSec: durationOf(merged),
    turns,
    costInputTokens:  costIn,
    costOutputTokens: costOut,
    voixAttendues,
    voixObtenues,
  }
}

// ── Main ─────────────────────────────────────────────────────────────

/**
 * Récolte la configuration NOSTR si le parent ne l'a pas déjà fournie.
 *
 * ── POURQUOI CETTE FONCTION EXISTE ──
 * `generate-all.ts` récolte tout UNE fois et le passe aux sous-processus
 * par l'environnement — un seul aller-retour NOSTR pour 15 stations.
 *
 * Mais depuis le 02/09/2026, chaque station est générée par un JOB
 * SÉPARÉ (cf. `.github/workflows/daily-broadcast.yml`) : il n'y a plus de
 * parent. Sans cette récolte de secours, un job isolé partirait avec une
 * configuration VIDE — pas de Pulse, pas de personas unifiées, pas de
 * voix — et produirait une émission d'apparence normale, avec les valeurs
 * par défaut. Le pire des échecs : celui qui réussit.
 *
 * Les variables déjà posées ont la priorité : lancé par le parent, ce
 * chemin ne coûte rien.
 */
async function assurerConfigNostr(stationIds: string[]): Promise<void> {
  const dejaFournie = !!process.env.RADIO_PULSE_JSON
    && !!process.env.RADIO_PERSONAS_UNIFIED_JSON
  if (dejaFournie) return

  console.log('\n📨 Aucune configuration héritée — récolte NOSTR autonome…')
  const [pulse, unifiees, guests, personas] = await Promise.all([
    fetchPulse(stationIds),
    fetchRadioPersonas(stationIds),
    fetchRadioGuests(),
    fetchHostPersonas(),
  ])
  exportPulseToEnv(pulse)
  exportRadioPersonasToEnv(unifiees)
  exportGuestsToEnv(guests)
  exportHostPersonasToEnv(personas)
  if (process.env.CHATTERBOX_TTS_URL) {
    exportHostVoiceMappingsToEnv(await fetchHostVoiceMappings())
  }
  console.log(`   ✓ ${Object.keys(unifiees.personas).length} persona(s) unifiée(s)`
    + ` · ${guests.size} invité(s) · ${personas.size} persona(s) legacy`
    + ` · Pulse ${pulse.global ? 'publié' : 'par défaut'}`)
}

async function main() {
  const stationId = process.argv[2]
  if (!stationId) {
    console.error('Usage: tsx src/scripts/generate-broadcast.ts <stationId> [YYYY-MM-DD]')
    process.exit(1)
  }
  // `||` (pas `??`) cf bug 2026-05-19 — TARGET_DATE peut être '' venant du
  // workflow YAML (cron sans workflow_dispatch), `??` ne fallback que sur
  // null/undefined → propageait `date = ""` dans NOSTR. Voir generate-all.ts.
  const targetDate = process.argv[3] || process.env.TARGET_DATE || tomorrowLocalISO()

  // ⚠️ Plus de `required('ANTHROPIC_API_KEY')` : Anthropic n'est que le
  // DERNIER maillon de la chaîne. Exiger sa clé rendait impossible de
  // tourner entièrement sur du gratuit, ce qui est pourtant le but.
  const pinataJwt = required('PINATA_JWT')
  const nostrPriv = required('NOSTR_PRIVATE_KEY')
  const model = process.env.ANTHROPIC_MODEL ?? 'claude-haiku-4-5-20251001'
  // 22 tours ≈ 15 min audio (décision user 2026-05-11 : émissions courtes +
  // 5 min de musique entre = cycle 20 min en boucle 72×/jour). Ajustable via
  // NUM_TURNS. Estimation : 1 tour ≈ 40s audio (3 phrases TTS Piper FR +
  // ~150ms pacing).
  const numTurns = Number.parseInt(process.env.NUM_TURNS ?? '22', 10)

  const station = SEED_STATIONS.find(s => s.id === stationId)
  if (!station) throw new Error(`Station inconnue : ${stationId}`)
  if (station.hosts.length === 0) throw new Error(`Station ${stationId} sans animateur`)

  // Aucune voix commercialisable dans cette langue ⇒ on RENONCE, avant
  // d'avoir dépensé un seul jeton. Publier quand même reviendrait à
  // diffuser une voix étrangère qui ÉPELLE le texte : du son, donc aucune
  // alerte, et des heures d'inaudible (mesuré ×8,8 en ru et ×11,2 en zh
  // le 29/08/2026, avant ce correctif). Cf. lib/voix.ts.
  const langueStation = station.language ?? 'fr'
  if (!langueSynthetisable(langueStation)) {
    throw new Error(
      `Station ${stationId} : la langue « ${langueStation} » n'a aucune voix `
      + `commercialisable (cf. lib/voix-licences.ts). Génération abandonnée — `
      + `mieux vaut le silence qu'une voix étrangère qui épelle le texte.`,
    )
  }

  await assurerConfigNostr(SEED_STATIONS.map(s => s.id))

  console.log(`\n🎙  Génération broadcast : ${station.name} pour ${targetDate}`)
  console.log(`    ${numTurns} tours · ${station.hosts.length} animateur(s)`)
  console.log(`    Chaîne LLM (gratuit d'abord, Anthropic en dernier recours) :`)
  for (const m of maillonsDisponibles()) {
    console.log(`      ${m.raison ? '·' : '✓'} ${m.nom.padEnd(14)} ${m.raison ?? 'utilisable'}`)
  }
  if (maillonsDisponibles().every(m => m.raison)) {
    throw new Error('Aucun maillon LLM utilisable — poser MISTRAL_API_KEY, ou laisser la passerelle HL active.')
  }

  // 1. Préparation Piper (binaire + voix) — gardé même si Chatterbox
  // configuré : sert de fallback robuste si le HF Space est down ou
  // qu'un host n'a pas de voix Chatterbox mappée.
  console.log('\n📦 Setup Piper…')
  await ensurePiperBinary()
  const uniqueVoices = new Set<string>()
  for (const h of station.hosts) {
    const v = voixPourLangue(langueStation, h.gender, h.id)
    if (v) uniqueVoices.add(v)
    if (!timbreHonore(langueStation, h.gender)) {
      console.warn(`    ⚠ ${h.name} : timbre ${h.gender} impossible en ${langueStation} `
        + `(aucune voix commercialisable) — pis-aller assumé, pas une panne.`)
    }
  }
  for (const v of uniqueVoices) await ensureVoice(v)
  const attributions = [...uniqueVoices]
    .map(v => licenceDe(v)?.attribution)
    .filter((a): a is string => !!a)
  if (attributions.length > 0) {
    console.log('    Crédits de voix EXIGÉS par la licence :')
    for (const a of attributions) console.log(`      · ${a}`)
  }

  // 1.b — Sprint DE : ping Chatterbox jusqu'à ready si configuré.
  // Le Space HF peut être en cold start (sleep auto 15min). On le
  // réveille AVANT de commencer à synthétiser, pour éviter un long
  // timeout au 1er turn.
  if (process.env.CHATTERBOX_TTS_URL) {
    // Quelle voix cette station va-t-elle réellement demander ? On réveille
    // AVEC celle-là : un service qui répond mais ne connaît pas notre voix
    // n'est pas « prêt », et mieux vaut l'apprendre en dix secondes qu'au
    // milieu de l'émission.
    const invitesUnifies = unifiedGuestsForStation(station.id, langueStation)
    const voixTemoin =
      (invitesUnifies.length ? resolvePersonaForStation(invitesUnifies[0], station.id).voiceName : undefined)
      ?? station.hosts
        .map(h => getChatterboxVoiceForHost(station.id, h.id, langueStation))
        .find((v): v is string => !!v)

    if (!voixTemoin) {
      console.log('\n🎙  Chatterbox configuré, mais aucune voix de personnage sur cette station — tout ira sur Piper.')
    } else {
      console.log(`\n🎙  Réveil du service de synthèse, témoin « ${voixTemoin} »…`)
      const etat = await reveillerEtVerifier(voixTemoin)
      if (etat === 'voix-absente') {
        // NOTRE faute, pas la leur : le nom demandé n'existe pas chez eux.
        // On le DIT distinctement, sinon on accuserait le service d'une
        // panne alors qu'il fonctionne parfaitement.
        const msg = `${stationId} : le service ne connaît pas la voix « ${voixTemoin} » `
          + `— vérifier le nom du fichier côté hébergeur. Repli Piper pour cette émission.`
        console.warn(`    ⚠ ${msg}`)
        if (process.env.GITHUB_ACTIONS) console.log(`::warning::${msg}`)
      } else if (etat === 'injoignable') {
        console.warn('    ⚠ Service de synthèse injoignable — repli Piper actif pour toute l\'émission.')
      }
    }
  }

  // 2. Fetch news
  console.log('\n📰 Fetch actu…')
  const news = await fetchNewsForStation(station, 8)
  console.log(`    ${news.length} item(s) récupérés`)

  // 3. Génération
  console.log('\n🤖 Dialogue + TTS…')
  const t0 = Date.now()
  const result = await generateBroadcastBytes({
    station, numTurns, topic: '', news,
  })
  const genSec = (Date.now() - t0) / 1000
  console.log(`    ✓ ${result.turns.length} tours, ${(result.durationSec / 60).toFixed(1)} min audio (${genSec.toFixed(0)}s wall)`)
  console.log(`    Tokens : ${result.costInputTokens} in / ${result.costOutputTokens} out`)
  // Sans cette ligne, on croirait tourner sur le gratuit alors qu'on paye —
  // ou l'inverse. Le maillon qui sert doit être DIT, pas supposé.
  console.log(`    Maillons ayant écrit : ${bilanDesMaillons()}`)
  const costUsd = (result.costInputTokens / 1e6) * 0.80 + (result.costOutputTokens / 1e6) * 4
  console.log(`    Coût estimé Haiku 4.5 : $${costUsd.toFixed(4)}`)

  // Optionnel : sauve le WAV localement (debug)
  const localWavPath = join(tmpdir(), `broadcast-${stationId}-${targetDate}.wav`)
  writeFileSync(localWavPath, result.audioBlob)
  console.log(`    WAV local : ${localWavPath} (${(result.audioBlob.byteLength / 1024 / 1024).toFixed(1)} MB)`)

  // 3.5. Encode Opus (Spring 2026) — gain ~16× vs WAV brut, sans perte audible
  // pour de la voix Piper. Fichier .opus (container OGG) joué nativement par
  // tous les navigateurs modernes via AudioContext.decodeAudioData().
  console.log('\n🎵 Encodage Opus…')
  const opusBlob = await encodeWavToOpus(result.audioBlob, 32)
  const ratio = (opusBlob.byteLength / result.audioBlob.byteLength * 100).toFixed(1)
  console.log(`    ✓ ${(opusBlob.byteLength / 1024 / 1024).toFixed(1)} MB Opus (${ratio}% du WAV)`)
  // Sauve aussi l'Opus en debug
  const localOpusPath = join(tmpdir(), `broadcast-${stationId}-${targetDate}.opus`)
  writeFileSync(localOpusPath, opusBlob)

  // 4. Upload IPFS (Opus, pas WAV)
  console.log('\n📡 Upload Pinata IPFS…')
  const pin = await pinataPinFile(
    opusBlob,
    `broadcast-${stationId}-${targetDate}.opus`,
    'audio/ogg',
    pinataJwt,
    // Metadata pour l'auto-purge (purgeOldBroadcasts filtre par date)
    { station: stationId, date: targetDate },
  )
  console.log(`    ✓ CID ${pin.cid} (${(pin.size / 1024 / 1024).toFixed(1)} MB)`)

  // 5. Publish NOSTR
  console.log('\n📨 Publish NOSTR kind:30093…')
  const broadcast: RadioBroadcast = {
    stationId:   station.id,
    date:        targetDate,
    language:    station.language ?? 'fr',
    durationSec: result.durationSec,
    audioCid:    pin.cid,
    audioMime:   'audio/ogg',     // Opus depuis Spring 2026 (plus de WAV)
    turns:       result.turns,
    newsRefs:    news.map(n => n.link).filter((l): l is string => !!l),
    model,
    generatedBy: '',   // sera rempli par publishBroadcast
    generatedAt: Math.floor(Date.now() / 1000),
  }
  const publish = await publishBroadcast(broadcast, nostrPriv)
  const okCount = publish.relays.filter(r => r.ok).length
  console.log(`    ✓ Event ${publish.eventId.slice(0, 12)}… publié sur ${okCount}/${publish.relays.length} relays`)
  console.log(`    Pubkey publisher : ${publish.pubkey}`)
  // Détail par relay (pour détecter les échecs silencieux nostr-tools type
  // "connection failure: …" qui donnaient un faux positif "publié 7/7")
  for (const r of publish.relays) {
    const tag = r.ok ? '✓' : '✗'
    console.log(`      ${tag} ${r.url} → ${r.reason ?? 'ok'}`)
  }

  console.log(`\n✅ Broadcast ${stationId} pour ${targetDate} publié.`)

  // ── VERDICT DES VOIX — la partie qui manquait ────────────────────────
  //
  // Jusqu'ici, un échec Chatterbox produisait un `console.warn` par tour et
  // l'émission était publiée comme un succès. Toutes les émissions d'août
  // 2026 sont ainsi sorties en voix de repli, sans que rien ne le dise :
  // le Space était en pause depuis des semaines et personne ne l'a su.
  //
  // On ne retire PAS l'émission — une émission en voix Piper vaut mieux que
  // le silence. Mais le job devient ROUGE quand les personnages ont perdu
  // leur voix, parce qu'un faux succès coûte plus cher qu'une panne : la
  // panne, on la cherche.
  const { voixAttendues, voixObtenues } = result
  if (voixAttendues === 0) {
    console.log(`    · aucune voix de personnage attribuée sur cette station (tout en Piper)`)
  } else if (voixObtenues === voixAttendues) {
    console.log(`    🎭 ${voixObtenues}/${voixAttendues} tour(s) dits par leur voix de personnage`)
  } else {
    const perdus = voixAttendues - voixObtenues
    const msg = `${stationId} : ${perdus}/${voixAttendues} tour(s) ont PERDU leur voix de personnage `
      + `(repli Piper). L'émission est publiée, mais les personnages ne sonnent pas comme eux.`
    console.warn(`\n⚠️  ${msg}`)
    // Annotation lisible dans l'interface GitHub, pas seulement dans le journal.
    if (process.env.GITHUB_ACTIONS) console.log(`::warning::${msg}`)

    const strict = (process.env.CHATTERBOX_STRICT ?? 'true') !== 'false'
    if (strict && voixObtenues === 0) {
      console.error(`\n❌ AUCUNE voix de personnage n'a fonctionné : le service de synthèse `
        + `est probablement injoignable. L'émission est publiée en repli, mais ce job `
        + `échoue volontairement pour que quelqu'un regarde.`)
      process.exit(1)
    }
  }
}

function required(name: string): string {
  const v = process.env[name]
  if (!v) {
    console.error(`❌ Variable d'env manquante : ${name}`)
    process.exit(1)
  }
  return v
}

main().catch(err => {
  console.error('\n❌ Échec :', err)
  process.exit(1)
})
