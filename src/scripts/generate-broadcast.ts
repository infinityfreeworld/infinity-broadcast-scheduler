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
 *     NUM_TURNS         (défaut 25)
 *     NOSTR_RELAYS      (défaut liste curatée, comma-separated)
 */

import 'dotenv/config'
import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { SEED_STATIONS } from '../data/seed-stations'
import { SEED_HOST_KBS } from '../data/seed-host-kbs'
import type { RadioStation, HostKB, BroadcastTurn, RadioBroadcast, NewsItem } from '../lib/types'
import { callAnthropic, type LLMMessage } from '../lib/anthropic'
import { buildHostSystemPrompt, retrieveTopEntries } from '../lib/personas'
import { fetchNewsForStation, formatNewsForPrompt } from '../lib/news'
import { synthesize, getVoiceSampleRate, ensurePiperBinary, ensureVoice } from '../lib/piper'
import { readWav, concatWavs, encodeWav, durationOf, type ConcatEntry } from '../lib/audio'
import { pinataPinFile } from '../lib/pinata'
import { publishBroadcast } from '../lib/nostr'

// ── Mapping animateur → voix Piper (porté de piper-client.ts) ────────

const PIPER_VOICE_BY_HOST: Record<string, string> = {
  'wtf-cyril':   'fr_FR-tom-medium',
  'wtf-marina':  'fr_FR-siwis-medium',
  'wtf-diogene': 'fr_FR-tom-medium',
  'fw-aurelien': 'fr_FR-tom-medium',
  'fw-leila':    'fr_FR-siwis-medium',
  'bb-rocco':    'fr_FR-tom-medium',
  'mc-anonyme':  'fr_FR-siwis-medium',
  'h2-henri':    'fr_FR-tom-medium',
  'h2-camille':  'fr_FR-siwis-medium',
  'g1-bernard':  'fr_FR-tom-medium',
  'dg-doudou':   'fr_FR-tom-medium',
  'dg-pat':      'fr_FR-siwis-medium',
  'dg-leboss':   'fr_FR-siwis-medium',
  'dn-salome':   'fr_FR-siwis-medium',
  'tk-iris':     'fr_FR-siwis-medium',
}

const FALLBACK_BY_GENDER: Record<'male' | 'female' | 'androgyn', string> = {
  male:     'fr_FR-tom-medium',
  female:   'fr_FR-siwis-medium',
  androgyn: 'fr_FR-siwis-medium',
}

function pickVoice(hostId: string, gender: 'male' | 'female' | 'androgyn'): string {
  return PIPER_VOICE_BY_HOST[hostId] ?? FALLBACK_BY_GENDER[gender]
}

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

interface GenResult {
  audioBlob:   Buffer
  durationSec: number
  turns:       BroadcastTurn[]
  costInputTokens:  number
  costOutputTokens: number
}

async function generateBroadcastBytes(opts: {
  station:  RadioStation
  apiKey:   string
  model:    string
  numTurns: number
  topic:    string
  news:     NewsItem[]
}): Promise<GenResult> {
  const { station, apiKey, model, numTurns, topic, news } = opts
  const language = station.language ?? 'fr'
  const turns: BroadcastTurn[] = []
  const wavEntries: ConcatEntry[] = []
  let costIn = 0, costOut = 0

  for (let i = 0; i < numTurns; i++) {
    const host = station.hosts[i % station.hosts.length]
    const voiceId = pickVoice(host.id, host.gender)

    const kb = SEED_HOST_KBS[host.id] ?? {
      hostId: host.id, stationId: station.id, personality: '', entries: [], updatedAt: 0,
    } as HostKB
    const selectedEntries = retrieveTopEntries(kb.entries, topic, KB_TOP_K)
    const otherHosts = station.hosts.filter(h => h.id !== host.id)
    const isFirstTurn = turns.length === 0

    const systemPrompt = buildHostSystemPrompt({
      host, kb, selectedEntries, topic,
      stationName:        station.name,
      stationDescription: station.description,
      newsBlock:          formatNewsForPrompt(news),
      language,
      otherHosts,
    })

    const history: LLMMessage[] = turns.slice(-HISTORY_DEPTH).map(t => ({
      role: 'assistant',
      content: `[${t.hostName}] ${t.text}`,
    }))
    const userMessage: LLMMessage = {
      role: 'user',
      content: isFirstTurn
        ? `Ouvre le podcast. Présente brièvement le sujet : ${topic || '(libre)'}. Trois phrases max.`
        : 'Ton tour. Continue le dialogue de façon naturelle.',
    }

    process.stdout.write(`  [${i + 1}/${numTurns}] ${host.name}… `)

    const resp = await callAnthropic({
      apiKey, model, systemPrompt,
      messages: [...history, userMessage],
    })
    costIn += resp.inputTokens
    costOut += resp.outputTokens
    const turnText = resp.text.trim()
    if (!turnText) {
      console.log('(vide, skip)')
      continue
    }

    // Synthèse Piper natif
    const wavPath = await synthesize(turnText, voiceId)
    const wav = readWav(wavPath)
    // Sanity check sample rate
    if (wav.sampleRate !== getVoiceSampleRate(voiceId)) {
      console.warn(`  sample rate mismatch ${wav.sampleRate} vs ${getVoiceSampleRate(voiceId)}`)
    }

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
    wavEntries.push({ wav })

    console.log(`${turnText.slice(0, 60)}${turnText.length > 60 ? '…' : ''}`)
  }

  if (turns.length === 0) throw new Error('Aucun tour généré')

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
  }
}

// ── Main ─────────────────────────────────────────────────────────────

async function main() {
  const stationId = process.argv[2]
  if (!stationId) {
    console.error('Usage: tsx src/scripts/generate-broadcast.ts <stationId> [YYYY-MM-DD]')
    process.exit(1)
  }
  const targetDate = process.argv[3] ?? process.env.TARGET_DATE ?? tomorrowLocalISO()

  const apiKey = required('ANTHROPIC_API_KEY')
  const pinataJwt = required('PINATA_JWT')
  const nostrPriv = required('NOSTR_PRIVATE_KEY')
  const model = process.env.ANTHROPIC_MODEL ?? 'claude-haiku-4-5-20251001'
  const numTurns = Number.parseInt(process.env.NUM_TURNS ?? '25', 10)

  const station = SEED_STATIONS.find(s => s.id === stationId)
  if (!station) throw new Error(`Station inconnue : ${stationId}`)
  if (station.hosts.length === 0) throw new Error(`Station ${stationId} sans animateur`)

  console.log(`\n🎙  Génération broadcast : ${station.name} pour ${targetDate}`)
  console.log(`    Model : ${model} · ${numTurns} tours · ${station.hosts.length} animateur(s)`)

  // 1. Préparation Piper (binaire + voix)
  console.log('\n📦 Setup Piper…')
  await ensurePiperBinary()
  const uniqueVoices = new Set<string>()
  for (const h of station.hosts) uniqueVoices.add(pickVoice(h.id, h.gender))
  for (const v of uniqueVoices) await ensureVoice(v)

  // 2. Fetch news
  console.log('\n📰 Fetch actu…')
  const news = await fetchNewsForStation(station, 8)
  console.log(`    ${news.length} item(s) récupérés`)

  // 3. Génération
  console.log('\n🤖 Dialogue + TTS…')
  const t0 = Date.now()
  const result = await generateBroadcastBytes({
    station, apiKey, model, numTurns, topic: '', news,
  })
  const genSec = (Date.now() - t0) / 1000
  console.log(`    ✓ ${result.turns.length} tours, ${(result.durationSec / 60).toFixed(1)} min audio (${genSec.toFixed(0)}s wall)`)
  console.log(`    Tokens : ${result.costInputTokens} in / ${result.costOutputTokens} out`)
  const costUsd = (result.costInputTokens / 1e6) * 0.80 + (result.costOutputTokens / 1e6) * 4
  console.log(`    Coût estimé Haiku 4.5 : $${costUsd.toFixed(4)}`)

  // Optionnel : sauve le WAV localement (debug)
  const localPath = join(tmpdir(), `broadcast-${stationId}-${targetDate}.wav`)
  writeFileSync(localPath, result.audioBlob)
  console.log(`    WAV local : ${localPath}`)

  // 4. Upload IPFS
  console.log('\n📡 Upload Pinata IPFS…')
  const pin = await pinataPinFile(
    result.audioBlob,
    `broadcast-${stationId}-${targetDate}.wav`,
    'audio/wav',
    pinataJwt,
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
    audioMime:   'audio/wav',
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

  console.log(`\n✅ Broadcast ${stationId} pour ${targetDate} publié.`)
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
