/**
 * Les pauses musicales : où, quoi, à quel niveau — et jamais au prix de l'émission.
 * 22/09/2026 : décision du fondateur d'entendre des musiques DANS les émissions.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  reglagesMusique, positionsDesPauses, choisirPistes, rmsDb, rmsDbGlobal, ajusterNiveau,
  appliquerFondus, encadrerDeSilence, planifierPauses, segmentDePause, decoderEnWavMono,
} from '../musique'
import { concatWavs, type ConcatEntry } from '../audio'
import type { TrackRef } from '../types'

const PISTES: TrackRef[] = Array.from({ length: 10 }, (_, i) => ({ title: `Piste ${i + 1}`, cid: `bafy${'a'.repeat(20)}${i}` }))

test('🔴 22 tours, 2 pauses → après le 7ᵉ et le 15ᵉ : trois blocs de dialogue, jamais avant le premier ni après le dernier', () => {
  assert.deepEqual(positionsDesPauses(22, 2), [6, 14])
  assert.deepEqual(positionsDesPauses(22, 1), [10])
  assert.deepEqual(positionsDesPauses(22, 3), [5, 10, 16])
  assert.deepEqual(positionsDesPauses(2, 5), [0], 'deux tours : une seule coupure possible')
  assert.deepEqual(positionsDesPauses(1, 2), [], 'un seul tour : aucune pause')
  assert.deepEqual(positionsDesPauses(22, 0), [])
})

test('le tirage est DÉTERMINISTE par (station, date) : le Mac et le secours cuisent la même émission', () => {
  const a = choisirPistes(PISTES, 2, 'pirate-radio:2026-09-23')
  const b = choisirPistes(PISTES, 2, 'pirate-radio:2026-09-23')
  assert.deepEqual(a, b)
  const c = choisirPistes(PISTES, 2, 'pirate-radio:2026-09-24')
  assert.notDeepEqual(a, c, 'deux nuits ne se ressemblent pas (10 pistes, 2 tirées)')
  assert.notEqual(a[0].cid, a[1].cid, 'jamais deux fois la même piste dans une émission')
})

test('une piste sans CID ni URL n’est pas jouable ; au-delà du catalogue on recycle', () => {
  assert.deepEqual(choisirPistes([{ title: 'vide' }], 2, 'x'), [])
  const deux = choisirPistes(PISTES.slice(0, 2), 3, 'x')
  assert.equal(deux.length, 3)
  assert.equal(deux[2].cid, deux[0].cid)
})

test('réglages : station (IHL) > environnement > défauts ; skipMusic et le kill switch coupent tout', () => {
  const env = { MUSIQUE_PAUSES: '3', MUSIQUE_PAUSE_S: '120', MUSIQUE_MARGE_DB: '-6' } as NodeJS.ProcessEnv
  const r = reglagesMusique({ tracks: PISTES }, env)
  assert.equal(r.actif, true); assert.equal(r.pauses, 3); assert.equal(r.pauseDureeS, 120); assert.equal(r.margeDb, -6)
  const s = reglagesMusique({ tracks: PISTES, pauses: 1, pauseDureeS: 240 }, env)
  assert.equal(s.pauses, 1); assert.equal(s.pauseDureeS, 240, 'la station l’emporte')
  assert.equal(reglagesMusique({ tracks: PISTES, skipMusic: true }, env).actif, false)
  assert.equal(reglagesMusique({ tracks: PISTES }, { ...env, MUSIQUE_DESACTIVEE: 'true' }).actif, false)
  assert.equal(reglagesMusique({ tracks: [] }, env).actif, false, 'sans piste, pas de pause')
  assert.equal(reglagesMusique({ tracks: PISTES, pauses: 0 }, env).actif, false)
  const d = reglagesMusique({ tracks: PISTES }, {} as NodeJS.ProcessEnv)
  assert.equal(d.pauses, 2); assert.equal(d.pauseDureeS, 180); assert.equal(d.margeDb, -4)
  assert.equal(reglagesMusique({ tracks: PISTES, pauseDureeS: 5 }, {} as NodeJS.ProcessEnv).pauseDureeS, 30, 'bornes')
})

test('le plan ne télécharge rien et associe une piste à chaque coupure', () => {
  const r = reglagesMusique({ tracks: PISTES }, {} as NodeJS.ProcessEnv)
  const plan = planifierPauses({ id: 'pirate-radio', tracks: PISTES }, '2026-09-23', 22, r)
  assert.deepEqual(plan.map(p => p.apresTour), [6, 14])
  assert.ok(plan.every(p => p.track.cid))
  assert.deepEqual(planifierPauses({ id: 'x', tracks: PISTES }, 'd', 22, { ...r, actif: false }), [])
})

function sinus(freq: number, secondes: number, rate = 22050, amplitude = 0.5): Float32Array {
  const out = new Float32Array(Math.floor(secondes * rate))
  for (let i = 0; i < out.length; i++) out[i] = amplitude * Math.sin(2 * Math.PI * freq * i / rate)
  return out
}

test('niveau : la musique est calée sur la voix moins la marge, sans jamais écrêter', () => {
  const voix = sinus(220, 2, 22050, 0.3)
  const musique = sinus(440, 2, 22050, 0.9)
  const cible = rmsDb(voix) - 4
  const calee = ajusterNiveau(musique, cible)
  assert.ok(Math.abs(rmsDb(calee) - cible) < 0.1, `RMS ${rmsDb(calee).toFixed(2)} attendu ${cible.toFixed(2)}`)
  const faible = sinus(440, 2, 22050, 0.01)
  const poussee = ajusterNiveau(faible, -0.5)
  let crete = 0; for (const x of poussee) crete = Math.max(crete, Math.abs(x))
  assert.ok(crete <= 0.95 + 1e-6, 'plafond de crête')
  assert.equal(rmsDb(new Float32Array(10)), -100, 'le silence ne fait pas planter le log')
  assert.ok(Math.abs(rmsDbGlobal([voix, voix]) - rmsDb(voix)) < 1e-6)
})

test('fondus et silences : la pause commence et finit à zéro, encadrée de silence', () => {
  const rate = 1000
  const s = appliquerFondus(new Float32Array(5000).fill(1), rate, 1, 2)
  assert.equal(s[0], 0); assert.ok(s[500] < 0.51 && s[500] > 0.49); assert.equal(s[1000], 1)
  assert.equal(s[4999], 0); assert.ok(s[2999] > 0.99); assert.ok(Math.abs(s[3999] - 0.5) < 0.01)
  const e = encadrerDeSilence(new Float32Array(10).fill(1), rate, 0.5, 0.25)
  assert.equal(e.length, 500 + 10 + 250); assert.equal(e[0], 0); assert.equal(e[500], 1); assert.equal(e[759], 0)
  const court = appliquerFondus(new Float32Array(10).fill(1), rate, 5, 5)
  assert.equal(court.length, 10, 'un tampon plus court que les fondus survit')
})

test('montage : tours et pauses s’entrelacent, les temps du manifeste sont ceux de l’audio', () => {
  const rate = 1000
  const tour = (): ConcatEntry => ({ wav: { samples: new Float32Array(2000).fill(0.1), sampleRate: rate } })
  const pause: ConcatEntry = { wav: { samples: new Float32Array(3000).fill(0.2), sampleRate: rate } }
  const t1 = tour(), t2 = tour(), t3 = tour()
  const merged = concatWavs([t1, t2, pause, t3])
  assert.equal(t1.tStart, 0); assert.equal(t1.tEnd, 2)
  assert.ok(Math.abs((pause.tStart ?? 0) - 4.2) < 1e-9, 'la pause commence après 2 tours + 2 silences de 0,1 s')
  assert.ok(Math.abs((pause.tEnd ?? 0) - 7.2) < 1e-9)
  assert.ok(Math.abs((t3.tStart ?? 0) - 7.3) < 1e-9)
  assert.equal(merged.samples.length, 2000 * 3 + 3000 + 3 * 100)
  const seg = segmentDePause({ title: 'Piste 1', cid: 'bafyx' }, 'music', pause.tStart!, pause.tEnd!)
  assert.deepEqual(seg, { type: 'music', cid: 'bafyx', title: 'Piste 1', tStart: 4.2, tEnd: 7.2 })
})

const ffmpeg = spawnSync('ffmpeg', ['-version']).status === 0

test('ffmpeg décode un MP3 stéréo en WAV mono coupé à la durée demandée', { skip: !ffmpeg && 'ffmpeg absent' }, async () => {
  const d = mkdtempSync(join(tmpdir(), 'musique-'))
  try {
    const mp3 = join(d, 'x.mp3')
    const r = spawnSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i', 'sine=frequency=440:duration=12', '-ac', '2', '-ar', '44100', '-b:a', '128k', '-y', mp3])
    assert.equal(r.status, 0, r.stderr.toString())
    const wav = await decoderEnWavMono(readFileSync(mp3), 24000, 5)
    assert.equal(wav.sampleRate, 24000)
    assert.ok(Math.abs(wav.samples.length / 24000 - 5) < 0.1, `${wav.samples.length / 24000} s au lieu de 5`)
    assert.ok(rmsDb(wav.samples) > -30, 'du son, pas du silence (la sinusoïde lavfi sort à −24,5 dBFS)')
  } finally { rmSync(d, { recursive: true, force: true }) }
})

test('🔴 le générateur SAUTE une pause en échec et n’arrête jamais l’émission', () => {
  const gb = readFileSync('src/scripts/generate-broadcast.ts', 'utf8')
  assert.match(gb, /const pause = await preparerPause\([^)]*\)[\s\S]*?\} catch \(err\) \{\s*console\.warn\(`\s*⚠ pause après le tour/)
  assert.match(gb, /const seed = SEED_STATIONS\.find\(s => s\.id === stationId\)/)
  assert.match(gb, /await stationSelonIHL\(seed\)/, 'les musiques collées dans l’IHL (30091) passent à l’antenne')
  assert.match(gb, /encoderEmission\(result\.audioBlob, result\.segments\.length > 0 \? 64 : 32\)/, '32 kbps suffisent à la voix, pas à la musique')
})

test('le manifeste 30093 porte les segments quand il y en a, et seulement alors', () => {
  const n = readFileSync('src/lib/nostr.ts', 'utf8')
  assert.match(n, /finalBroadcast\.segments && finalBroadcast\.segments\.length > 0\s*\? \{ segments: finalBroadcast\.segments \} : \{\}/)
})
