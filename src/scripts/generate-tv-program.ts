/**
 * @module InfinityScheduler/TV/generate
 * @description Génère UN programme TV et le publie sur NOSTR (kind TV_PROGRAM).
 *
 *   Pipeline : news (RSS) → conducteur (LLM) → images (WAF /generate) →
 *   montage (WAF /render → CID) → event TV_PROGRAM → publish relais.
 *
 *   Modes :
 *     (défaut)     pipeline complète (requiert ANTHROPIC_API_KEY, WAF_API_URL,
 *                  WAF_API_KEY, NOSTR_PRIVATE_KEY).
 *     --dry-run    news + conducteur uniquement (LLM), PAS de WAF ni publish.
 *     --plan       100% hors-ligne : conducteur FIXTURE, montre les shots + le
 *                  programme + l'EVENT TV_PROGRAM qui SERAIT publié. Zéro réseau.
 *
 *   Usage : tsx src/scripts/generate-tv-program.ts [channelId] [--dry-run|--plan]
 */
import 'dotenv/config'
import { findChannel } from '../data/seed-tv-channels'
import { fetchNewsForStation, formatNewsForPrompt } from '../lib/news'
import { generateConductor } from '../lib/tv-conductor'
import { generateImage, renderTimeline } from '../lib/waf'
import { buildShots, buildProgram, totalDuration } from '../lib/tv-assemble'
import { tvProgramEventTemplate, publishTvProgram } from '../lib/tv-nostr'
import type { TvChannelConfig, TvConductor } from '../lib/tv-types'
import type { RadioStation } from '../lib/types'

function arg(name: string): boolean { return process.argv.includes(name) }

/** Conducteur factice pour le mode --plan (aucun appel réseau). */
function fixtureConductor(channel: TvChannelConfig): TvConductor {
  return {
    title: `${channel.name} — épisode de démonstration`,
    segments: [
      { title: 'Ouverture', subtitle: 'Le tour des solutions', imagePrompt: 'wide cinematic sunrise over a green city, solar panels, calm', durationSec: 6 },
      { title: 'Initiative locale', subtitle: 'Un jardin partagé', imagePrompt: 'community garden, people planting vegetables, warm light', narration: 'À deux pas, un terrain vague est devenu jardin nourricier.', durationSec: 8 },
      { title: 'Technologie libre', imagePrompt: 'open-source hardware workshop, hands soldering, focused', durationSec: 7 },
    ],
  }
}

async function main() {
  const channelId = process.argv.slice(2).find(a => !a.startsWith('--'))
  const channel = findChannel(channelId)
  const plan = arg('--plan')
  const dry = arg('--dry-run')
  const airDateMs = Number(process.env.TV_AIR_MS) || Date.parse(new Date().toISOString().slice(0, 10))

  console.log(`\n📺 Génération TV — chaîne « ${channel.name} » (${channel.id})`)
  console.log(`   mode : ${plan ? 'PLAN (hors-ligne)' : dry ? 'DRY-RUN (LLM seul)' : 'COMPLET'}\n`)

  // ── 1) Conducteur ─────────────────────────────────────────────────────────
  let conductor: TvConductor
  if (plan) {
    conductor = fixtureConductor(channel)
  } else {
    const apiKey = process.env.ANTHROPIC_API_KEY
    if (!apiKey) throw new Error('ANTHROPIC_API_KEY manquant')
    const news = channel.sources
      ? await fetchNewsForStation({ sources: channel.sources } as RadioStation, 8)
      : []
    console.log(`   📰 ${news.length} actualité(s) récupérée(s)`)
    conductor = await generateConductor(channel, formatNewsForPrompt(news), apiKey, process.env.ANTHROPIC_MODEL)
  }
  console.log(`   🎬 Conducteur « ${conductor.title} » — ${conductor.segments.length} segments, ~${totalDuration(conductor)}s`)
  conductor.segments.forEach((s, i) => console.log(`      ${i + 1}. ${s.title} (${s.durationSec}s) — ${s.imagePrompt.slice(0, 60)}…`))

  if (dry) { console.log('\n✅ DRY-RUN terminé (pas de WAF ni publish).'); return }

  // ── 2) Images (WAF) — sauf en --plan ──────────────────────────────────────
  let imageAssetIds: string[] = []
  let render: Awaited<ReturnType<typeof renderTimeline>> | undefined
  if (!plan) {
    console.log('\n   🖼️  Génération des images via WAF…')
    for (const [i, s] of conductor.segments.entries()) {
      const img = await generateImage(s.imagePrompt, { ratio: '16:9', seed: 1000 + i })
      imageAssetIds.push(img.id)
      console.log(`      plan ${i + 1} → asset ${img.id}`)
    }
    // ── 3) Montage (WAF /render) ────────────────────────────────────────────
    console.log('   🎞️  Montage ffmpeg via WAF /api/v1/render…')
    render = await renderTimeline({
      shots: buildShots(conductor, imageAssetIds),
      width: channel.width ?? 1280, height: channel.height ?? 720, fps: channel.fps ?? 30,
      prompt: conductor.title,
    })
    console.log(`      → ${render.durationSec}s · ${render.ipfs ? `CID ${render.ipfs}` : `url ${render.url}`}`)
  }

  // ── 4) Programme + event ──────────────────────────────────────────────────
  const program = buildProgram(channel, conductor, airDateMs, render)
  const evt = tvProgramEventTemplate(program)

  if (plan) {
    console.log('\n   🧩 Shots de montage :')
    console.log('   ' + JSON.stringify(buildShots(conductor, conductor.segments.map((_, i) => `IMG_${i}`)), null, 2).replace(/\n/g, '\n   '))
    console.log('\n   📦 Programme TvProgram :')
    console.log('   ' + JSON.stringify(program, null, 2).replace(/\n/g, '\n   '))
    console.log('\n   📡 Event NOSTR qui SERAIT publié (kind 30184) :')
    console.log('   ' + JSON.stringify(evt, null, 2).replace(/\n/g, '\n   '))
    console.log('\n✅ PLAN terminé (hors-ligne). Aucune publication.')
    return
  }

  // ── 5) Publish NOSTR ──────────────────────────────────────────────────────
  const sk = process.env.NOSTR_PRIVATE_KEY
  if (!sk) throw new Error('NOSTR_PRIVATE_KEY manquant')
  console.log('\n   📡 Publication de l’event TV_PROGRAM…')
  const res = await publishTvProgram(program, sk)
  const ok = res.relays.filter(r => r.ok).length
  console.log(`      event ${res.eventId} par ${res.pubkey.slice(0, 12)}… — accepté par ${ok}/${res.relays.length} relais`)
  console.log('\n✅ Programme publié. Le player le diffusera sur la chaîne.')
}

main().catch(err => { console.error('\n❌', err instanceof Error ? err.message : err); process.exit(1) })
