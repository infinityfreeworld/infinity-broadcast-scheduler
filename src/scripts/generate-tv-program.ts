/**
 * @module InfinityScheduler/TV/generate
 * @description Génère UN programme TV et le publie sur NOSTR (kind TV_PROGRAM).
 *
 *   Pipeline : news (RSS) → conducteur (LLM) → VOIX-OFF (Piper, CPU) →
 *   images (WAF /generate) → montage (WAF /render → CID) → event TV_PROGRAM →
 *   publish relais.
 *
 *   Modes :
 *     (défaut)     pipeline complète (requiert ANTHROPIC_API_KEY, WAF_API_URL,
 *                  WAF_API_KEY, NOSTR_PRIVATE_KEY).
 *     --dry-run    news + conducteur uniquement (LLM), PAS de WAF ni publish.
 *     --plan       100% hors-ligne : conducteur FIXTURE, montre les shots + le
 *                  programme + l'EVENT TV_PROGRAM qui SERAIT publié. Zéro réseau.
 *     --muet       saute la synthèse vocale (repli de secours : le programme
 *                  part sans voix, comme avant le 08/09/2026).
 *     --fixture    chaîne COMPLÈTE (voix + images + montage) sur un conducteur
 *                  d'exemple, SANS clé de langage et SANS publication. Sert à
 *                  éprouver le montage de bout en bout, et à regarder le
 *                  résultat avant de mettre une chaîne à l'antenne.
 *
 *   Usage : tsx src/scripts/generate-tv-program.ts [channelId] [--dry-run|--plan|--muet]
 */
import 'dotenv/config'
import { findChannel } from '../data/seed-tv-channels'
import { fetchNewsForStation, formatNewsForPrompt } from '../lib/news'
import { fetchSujetsInfinity } from '../lib/infinity-sujets'
import { choisirSujetsEcosysteme } from '../data/sujets-ecosysteme'
import { generateConductor } from '../lib/tv-conductor'
import { generateImage, renderTimeline, uploadMedia, attendreCid } from '../lib/waf'
import { buildShots, buildProgram, totalDuration, applyTimings } from '../lib/tv-assemble'
import { synthesizeConductor, DEFAULT_TV_VOICE } from '../lib/tv-voice'
import { tvProgramEventTemplate, publishTvProgram } from '../lib/tv-nostr'
import type { TvChannelConfig, TvConductor } from '../lib/tv-types'
import type { RadioStation } from '../lib/types'

function arg(name: string): boolean { return process.argv.includes(name) }

/** Conducteur factice pour le mode --plan (aucun appel réseau). */
function fixtureConductor(channel: TvChannelConfig): TvConductor {
  return {
    title: `${channel.name} — épisode de démonstration`,
    segments: [
      { title: 'Ouverture', subtitle: 'Le tour des solutions', imagePrompt: 'wide cinematic sunrise over a green city, solar panels, calm',
        narration: "Bonsoir à toutes et à tous, bienvenue dans le journal des solutions.", durationSec: 6 },
      { title: 'Initiative locale', subtitle: 'Un jardin partagé', imagePrompt: 'community garden, people planting vegetables, warm light',
        narration: "À deux pas d'ici, un terrain vague est devenu un jardin nourricier ; les habitants y récoltent aujourd'hui leurs premiers légumes.", durationSec: 8 },
      { title: 'Technologie libre', subtitle: 'Réparer plutôt que jeter', imagePrompt: 'open-source hardware workshop, hands soldering, focused',
        narration: "Dans cet atelier, on répare ce que l'industrie destinait à la benne, et les plans circulent librement.", durationSec: 7 },
    ],
  }
}

async function main() {
  const channelId = process.argv.slice(2).find(a => !a.startsWith('--'))
  const channel = findChannel(channelId)
  const plan = arg('--plan')
  const dry = arg('--dry-run')
  const muet = arg('--muet')
  // Chaîne COMPLÈTE (voix, images, montage) mais sur un conducteur d'exemple et
  // sans publication : la seule façon d'éprouver le montage de bout en bout sans
  // clé de langage, sans relais, et sans mettre une démonstration à l'antenne.
  const fixture = arg('--fixture')
  const airDateMs = Number(process.env.TV_AIR_MS) || Date.parse(new Date().toISOString().slice(0, 10))

  console.log(`\n📺 Génération TV — chaîne « ${channel.name} » (${channel.id})`)
  console.log(`   mode : ${plan ? 'PLAN (hors-ligne)' : dry ? 'DRY-RUN (LLM seul)' : fixture ? 'FIXTURE (chaîne complète, sans publication)' : muet ? 'COMPLET (sans voix)' : 'COMPLET'}\n`)

  // ── 1) Conducteur ─────────────────────────────────────────────────────────
  let conductor: TvConductor
  if (plan || fixture) {
    conductor = fixtureConductor(channel)
  } else {
    const apiKey = process.env.ANTHROPIC_API_KEY
    if (!apiKey) throw new Error('ANTHROPIC_API_KEY manquant')
    // ── LES SUJETS VIENNENT D'ABORD D'INFINITY ────────────────────────────
    // Retour du Bâtisseur (09/09/2026) : « les thèmes doivent absolument concerner
    // les sujets de l'application ». Le JT lisait Reporterre et Mr Mondialisation :
    // de bonnes sources, qui ne parlent jamais de ce que les gens FONT ici.
    // Les Manifestactions, les projets Abondance et les propositions soumises au
    // vote passent donc AVANT le fil extérieur.
    const sujets = await fetchSujetsInfinity(6)
    console.log(`   🌍 ${sujets.length} sujet(s) RÉEL(S) d'Infinity (Manifestactions, Abondance, DAV)`)
    // ── QUAND L'APPLICATION N'A PAS ASSEZ À RACONTER, ELLE SE PRÉSENTE ─────
    // Le 10/09 au soir, faute d'activité réelle, le JT a été rempli avec Reporterre
    // et Mr Mondialisation — précisément ce que le Bâtisseur refusait (« les thèmes
    // doivent ABSOLUMENT concerner les sujets de l'application »). Avant l'ouverture
    // publique, c'est l'état normal : on explique alors comment Infinity fonctionne,
    // à partir de ses propres fiches.
    const presentation = choisirSujetsEcosysteme(Math.max(0, 3 - sujets.length))
    if (presentation.length) {
      console.log(`   🧭 + ${presentation.length} présentation(s) de l'application (activité réelle insuffisante)`)
    }
    // ⚠️ L'EXTÉRIEUR N'EST PLUS QU'UN COMPLÉMENT, BORNÉ À DEUX. Il ne comble plus le vide :
    // c'est l'application qui le comble.
    const news = channel.sources
      ? await fetchNewsForStation({ sources: channel.sources } as RadioStation, 2)
      : []
    if (news.length) console.log(`   📰 + ${news.length} actualité(s) extérieure(s), en complément`)
    conductor = await generateConductor(
      channel,
      formatNewsForPrompt([...sujets, ...presentation, ...news]),
      apiKey,
      process.env.ANTHROPIC_MODEL,
    )
  }
  console.log(`   🎬 Conducteur « ${conductor.title} » — ${conductor.segments.length} segments, ~${totalDuration(conductor)}s`)
  conductor.segments.forEach((s, i) => console.log(`      ${i + 1}. ${s.title} (${s.durationSec}s) — ${s.imagePrompt.slice(0, 60)}…`))

  if (dry) { console.log('\n✅ DRY-RUN terminé (pas de WAF ni publish).'); return }

  // ── 2) Voix-off (Piper, CPU) — c'est elle qui fixe la durée des plans ─────
  //    Sans cette étape le programme partait MUET : le conducteur écrivait une
  //    narration que rien ne lisait. La synthèse tourne sur le processeur de
  //    l'exécuteur : aucune station GPU n'est réveillée pour un JT quotidien.
  let audioAssetId: string | undefined
  let voiceId: string | undefined
  if (!plan && !muet) {
    const voix = channel.voice ?? DEFAULT_TV_VOICE
    console.log(`\n   🎙️  Synthèse de la voix-off (${voix})…`)
    const track = await synthesizeConductor(conductor, { voiceId: voix })
    voiceId = track.voiceId
    console.log(`      ${track.spokenCount}/${conductor.segments.length} segments parlés — ${track.durationSec}s de bande`)
    // Les durées mesurées remplacent celles proposées à l'aveugle par le LLM.
    conductor = applyTimings(conductor, track.timings)
    track.timings.forEach(t => console.log(
      `      plan ${t.index + 1} : ${t.startSec}s → ${(t.startSec + t.durationSec).toFixed(2)}s`
      + ` · ${t.durationSec}s à l'écran (${t.spokenSec}s parlés)`))
    const dep = await uploadMedia(track.wav, {
      filename: `${channel.id}-${new Date(airDateMs).toISOString().slice(0, 10)}.wav`,
      mime: 'audio/wav',
      label: `voix-off · ${conductor.title}`,
    })
    audioAssetId = dep.id
    console.log(`      piste déposée → asset ${dep.id} (${Math.round(dep.bytes / 1024)} Ko)`)
  }

  // ── 3) Images (WAF) — sauf en --plan ──────────────────────────────────────
  let imageAssetIds: string[] = []
  let render: Awaited<ReturnType<typeof renderTimeline>> | undefined
  if (!plan) {
    console.log('\n   🖼️  Génération des images via WAF…')
    for (const [i, s] of conductor.segments.entries()) {
      const img = await generateImage(s.imagePrompt, { ratio: '16:9', seed: 1000 + i })
      imageAssetIds.push(img.id)
      console.log(`      plan ${i + 1} → asset ${img.id}`)
    }
    // ── 4) Montage (WAF /render) ────────────────────────────────────────────
    console.log('   🎞️  Montage ffmpeg via WAF /api/v1/render…')
    render = await renderTimeline({
      shots: buildShots(conductor, imageAssetIds),
      audio: audioAssetId ? { assetId: audioAssetId } : undefined,
      width: channel.width ?? 1280, height: channel.height ?? 720, fps: channel.fps ?? 30,
      prompt: conductor.title,
    })
    console.log(`      → ${render.durationSec}s · ${render.ipfs ? `CID ${render.ipfs}` : `url ${render.url}`}`)
    if (render.poster) console.log(`      vignette → asset ${render.poster.id}`)

    // ── 4 bis) Attendre l'adresse PERMANENTE ────────────────────────────────
    //    La forge épingle après avoir répondu : le CID n'existe pas encore
    //    ci-dessus. Sans cette attente, le programme part avec la seule URL de
    //    la forge et devient injouable le jour où cette adresse change.
    if (!render.ipfs && !plan) {
      process.stdout.write('   📌 épinglage IPFS…')
      // En mode fixture, on éprouve le CHEMIN sans faire attendre : une
      // démonstration locale n'a pas d'épinglage à attendre, et 90 s de
      // silence donnent l'impression que le programme a planté.
      const cid = await attendreCid(render.id, fixture ? { timeoutMs: 10_000 } : {})
      if (cid) { render = { ...render, ipfs: cid }; console.log(` CID ${cid}`) }
      else console.log(' pas encore épinglé — on publie avec l’URL de la forge (secours)')
      if (render.poster && !render.poster.ipfs) {
        const pc = await attendreCid(render.poster.id, { timeoutMs: 20_000 })
        if (pc) render = { ...render, poster: { ...render.poster, ipfs: pc } }
      }
    }
  }

  // ── 5) Programme + event ──────────────────────────────────────────────────
  const program = buildProgram(channel, conductor, airDateMs, render, {
    generator: voiceId ? `ffmpeg-compose+llm+piper:${voiceId}` : 'ffmpeg-compose+llm',
  })
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

  if (fixture) {
    console.log('\n   📦 Programme produit :')
    console.log('   ' + JSON.stringify(program, null, 2).replace(/\n/g, '\n   '))
    console.log(`\n✅ FIXTURE terminé — la vidéo est là, RIEN n'a été publié.`)
    if (render) console.log(`   ▶ ${render.url}${render.ipfs ? `\n   ▶ ipfs ${render.ipfs}` : ''}`)
    return
  }

  // ── 6) Publish NOSTR ──────────────────────────────────────────────────────
  const sk = process.env.NOSTR_PRIVATE_KEY
  if (!sk) throw new Error('NOSTR_PRIVATE_KEY manquant')
  console.log('\n   📡 Publication de l’event TV_PROGRAM…')
  const res = await publishTvProgram(program, sk)
  const ok = res.relays.filter(r => r.ok).length
  console.log(`      event ${res.eventId} par ${res.pubkey.slice(0, 12)}… — accepté par ${ok}/${res.relays.length} relais`)
  console.log('\n✅ Programme publié. Le player le diffusera sur la chaîne.')
}

main().catch(err => { console.error('\n❌', err instanceof Error ? err.message : err); process.exit(1) })
