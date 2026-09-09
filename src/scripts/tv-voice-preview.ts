/**
 * @module InfinityScheduler/TV/preview
 * @description Écouter la voix du JT AVANT de la mettre à l'antenne.
 *
 *   Synthétise une narration d'exemple (ou celle qu'on lui donne) et écrit un
 *   WAV local, sans rien publier, sans clé, sans GPU. Sert à valider une voix
 *   pour une chaîne (`voice` de TvChannelConfig) et à vérifier le minutage
 *   réel des plans avant de programmer une diffusion quotidienne.
 *
 *   Usage :
 *     npx tsx src/scripts/tv-voice-preview.ts [--voice fr_FR-siwis-medium] [--out /tmp/jt.wav]
 *     npx tsx src/scripts/tv-voice-preview.ts --texte "Bonsoir et bienvenue."
 */
import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { synthesizeConductor, DEFAULT_TV_VOICE } from '../lib/tv-voice'
import type { TvConductor } from '../lib/tv-types'

function opt(name: string, fallback?: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`)
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : fallback
}

const voiceId = opt('voice', DEFAULT_TV_VOICE)!
const out = opt('out', join(tmpdir(), `jt-voix-${Date.now()}.wav`))!
const texte = opt('texte')

const conducteur: TvConductor = texte
  ? { title: 'Essai', segments: [{ title: 'Essai', imagePrompt: '', narration: texte, durationSec: 5 }] }
  : {
      title: 'JT Infinity — essai de voix',
      segments: [
        { title: 'Générique', imagePrompt: '', durationSec: 4 },
        {
          title: 'Ouverture',
          imagePrompt: '',
          narration: "Bonsoir à toutes et à tous, bienvenue dans le journal des solutions.",
          durationSec: 8,
        },
        {
          title: 'Premier sujet',
          imagePrompt: '',
          narration: "À deux pas d'ici, un terrain vague est devenu un jardin nourricier ; les habitants y récoltent aujourd'hui leurs premiers légumes.",
          durationSec: 8,
        },
      ],
    }

console.log(`\n🎙️  Essai de voix « ${voiceId} »`)
const t0 = Date.now()
const track = await synthesizeConductor(conducteur, { voiceId })
writeFileSync(out, track.wav)

console.log(`\n   ${track.spokenCount}/${conducteur.segments.length} segments parlés`)
console.log(`   bande : ${track.durationSec}s · ${Math.round(track.wav.length / 1024)} Ko · synthèse en ${((Date.now() - t0) / 1000).toFixed(1)}s`)
console.log('\n   Minutage des plans (c’est lui qui pilotera l’image) :')
for (const t of track.timings) {
  const seg = conducteur.segments[t.index]
  console.log(`     plan ${t.index + 1} « ${seg.title} » : ${t.startSec}s → ${(t.startSec + t.durationSec).toFixed(2)}s ` +
    `(${t.durationSec}s à l’écran, ${t.spokenSec}s parlés, proposé ${seg.durationSec}s)`)
}
console.log(`\n✅ Écrit : ${out}\n   (lire avec : ffplay -autoexit "${out}")\n`)
