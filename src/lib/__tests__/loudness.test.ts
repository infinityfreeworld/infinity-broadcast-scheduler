/**
 * @module InfinityScheduler/Lib/LoudnessTests
 * @description 🔊 La sonie (EBU R128 / BS.1770) : la mesure, le calage, le limiteur, la normalisation
 *   de l'émission. Le contrôle croisé avec ffmpeg (filtre ebur128) ne tourne que si ffmpeg est là.
 *
 *   Lancer :  npx tsx --test src/lib/__tests__/loudness.test.ts
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  mesurerLufs, creteDb, gainVersLufs, calerSurLufs, limiterCretes, normaliserEmission, lufsEnsemble,
  reglagesLoudness, SILENCE_LUFS,
} from '../loudness'
import { calerSurVoix, appliquerFondus } from '../musique'
import { encodeWav } from '../audio'

const sinus = (f: number, s: number, rate: number, a: number) =>
  Float32Array.from({ length: Math.round(s * rate) }, (_, i) => a * Math.sin(2 * Math.PI * f * i / rate))

/** Bruit pseudo-aléatoire reproductible, en salves (une « parole » grossière avec des silences). */
function parole(s: number, rate: number, a: number, graine = 7): Float32Array {
  let x = graine
  const r = () => { x = (x * 1103515245 + 12345) % 2147483648; return x / 2147483648 * 2 - 1 }
  const out = new Float32Array(Math.round(s * rate))
  for (let i = 0; i < out.length; i++) {
    const salve = Math.floor(i / (0.6 * rate)) % 3 !== 2       // 1,2 s de son, 0,6 s de silence
    out[i] = salve ? a * (0.6 * r() + 0.4 * Math.sin(2 * Math.PI * 220 * i / rate)) : 0
  }
  return out
}

test('⭐ BS.1770 : un sinus de 1 kHz à −20 dBFS crête vaut −23 LUFS, à tous nos taux', () => {
  for (const rate of [48_000, 24_000, 22_050, 16_000]) {
    const l = mesurerLufs(sinus(1000, 5, rate, 0.1), rate)
    assert.ok(Math.abs(l - -23.01) < 0.15, `${rate} Hz : ${l.toFixed(2)} LUFS`)
  }
})

test('la porte : le silence ne fait pas baisser la sonie d’une voix', () => {
  const rate = 24_000
  const seule = mesurerLufs(sinus(500, 4, rate, 0.1), rate)
  const avecSilences = mesurerLufs(Float32Array.from([...sinus(500, 4, rate, 0.1), ...new Float32Array(rate * 8)]), rate)
  assert.ok(Math.abs(seule - avecSilences) < 0.2, `${seule.toFixed(2)} vs ${avecSilences.toFixed(2)}`)
  assert.equal(mesurerLufs(new Float32Array(rate * 3), rate), SILENCE_LUFS)
  assert.equal(mesurerLufs(new Float32Array(100), rate), SILENCE_LUFS, 'trop court')
})

test('calage au LUFS : la cible est atteinte, la crête jamais dépassée', () => {
  const rate = 24_000
  const m = calerSurLufs(parole(10, rate, 0.05), rate, -18)
  assert.ok(Math.abs(mesurerLufs(m, rate) - -18) < 0.1)
  // Cible inatteignable sans écrêter : on s'arrête au plafond.
  const fort = calerSurLufs(sinus(1000, 3, rate, 0.1), rate, -2, -1.5)
  assert.ok(creteDb(fort) <= -1.5 + 1e-6)
  assert.equal(gainVersLufs(new Float32Array(rate), rate, -16), 0, 'le silence reste silence')
})

test('⭐ musique et voix au même niveau PERÇU : la musique grave n’est plus 6 LU sous la voix', () => {
  const rate = 24_000
  const voix = parole(20, rate, 0.08)
  const musique = Float32Array.from(sinus(80, 20, rate, 0.3), (v, i) => v + 0.05 * Math.sin(2 * Math.PI * 3000 * i / rate))
  const lv = mesurerLufs(voix, rate)
  const calee = calerSurVoix(musique, rate, { rmsDb: -30, lufs: lv }, 0)
  assert.ok(Math.abs(mesurerLufs(calee, rate) - lv) < 0.2)
  // Sans LUFS connu : l'ancien calage au RMS (compatibilité, HABILLAGE_LOUDNESS=off).
  const rms = calerSurVoix(musique, rate, -20, 0)
  assert.ok(Math.abs(20 * Math.log10(Math.sqrt(rms.reduce((a, x) => a + x * x, 0) / rms.length)) - -20) < 0.1)
})

test('le limiteur garantit le plafond et ne touche pas ce qui est dessous', () => {
  const rate = 24_000
  const s = parole(5, rate, 0.2)
  s[rate] = 0.99; s[rate + 1] = -0.98
  const avant = Float32Array.from(s)
  const touches = limiterCretes(s, rate, -6)
  assert.ok(creteDb(s) <= -6 + 1e-4, `crête ${creteDb(s)}`)
  assert.ok(touches > 0 && touches < s.length * 0.2)
  // loin de la crête, rien n'a bougé
  assert.equal(s[3 * rate], avant[3 * rate])
})

test('⭐ l’émission ramenée à −16 LUFS, crêtes sous −1,5 dBFS, quel que soit son niveau de départ', () => {
  const rate = 24_000
  for (const a of [0.02, 0.1, 0.5]) {
    const s = parole(30, rate, a)
    const n = normaliserEmission(s, rate)
    assert.ok(Math.abs(n.apresLufs - -16) < 0.6, `départ ${n.avantLufs.toFixed(1)} → ${n.apresLufs.toFixed(1)}`)
    assert.ok(n.creteDb <= -1.5 + 1e-4)
  }
  const muet = normaliserEmission(new Float32Array(rate * 2), rate)
  assert.equal(muet.gainDb, 0)
})

test('sonie d’un ensemble de tours à des taux différents', () => {
  const a = { samples: sinus(1000, 3, 24_000, 0.1), sampleRate: 24_000 }
  const b = { samples: sinus(1000, 3, 22_050, 0.1), sampleRate: 22_050 }
  assert.ok(Math.abs(lufsEnsemble([a, b]) - -23.01) < 0.15)
  assert.equal(lufsEnsemble([]), SILENCE_LUFS)
})

test('réglages : cible et plafond lus dans l’environnement, valeurs absurdes écartées', () => {
  assert.deepEqual(reglagesLoudness({}), { cible: -16, crete: -1.5 })
  assert.deepEqual(reglagesLoudness({ RADIO_LUFS: '-14', RADIO_CRETE_DB: '-1' }), { cible: -14, crete: -1 })
  assert.deepEqual(reglagesLoudness({ RADIO_LUFS: '5', RADIO_CRETE_DB: 'x' }), { cible: -16, crete: -1.5 })
})

test('fondus en S : départ et arrivée en douceur, mi-parcours à 0,5', () => {
  const s = appliquerFondus(new Float32Array(4000).fill(1), 1000, 1, 1)
  assert.equal(s[0], 0)
  assert.ok(s[10] < 0.001, 'le début ne « saute » pas comme une droite (0,01)')
  assert.ok(Math.abs(s[500] - 0.5) < 1e-6)
})

test('contrôle croisé : même mesure que ffmpeg ebur128 (si ffmpeg est installé)', (t) => {
  const ffmpeg = process.env.FFMPEG_BIN ?? 'ffmpeg'
  if (spawnSync(ffmpeg, ['-version'], { stdio: 'ignore' }).status !== 0) { t.skip('ffmpeg absent'); return }
  const rate = 24_000
  const s = Float32Array.from(parole(20, rate, 0.15), (v, i) => v + (i > 10 * rate ? 0.1 * Math.sin(2 * Math.PI * 60 * i / rate) : 0))
  const d = mkdtempSync(join(tmpdir(), 'lufs-'))
  try {
    const f = join(d, 'x.wav')
    writeFileSync(f, encodeWav({ samples: s, sampleRate: rate }))
    // ffmpeg écrit son résumé sur la sortie d'erreur.
    const r = spawnSync(ffmpeg, ['-nostats', '-hide_banner', '-i', f, '-af', 'ebur128', '-f', 'null', '-'], { encoding: 'utf8' })
    const m = /Summary:[\s\S]*?I:\s+(-?[\d.]+) LUFS/.exec(r.stderr)
    assert.ok(m, 'résumé ebur128 introuvable')
    const ff = Number(m[1])
    const nous = mesurerLufs(s, rate)
    assert.ok(Math.abs(ff - nous) <= 0.3, `ffmpeg ${ff} / nous ${nous.toFixed(2)}`)
  } finally { rmSync(d, { recursive: true, force: true }) }
})
