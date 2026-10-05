/**
 * 🔍 Contrôle de qualité d'une réplique synthétisée (04/10/2026 — « des vides sonores avec des
 * chuchotements au milieu des répliques »).
 *
 * ⚠️ Signaux FABRIQUÉS : une « voix » = harmoniques d'une fondamentale qui glisse (110-190 Hz),
 * modulée en syllabes ; un « chuchotement » = bruit blanc faible ; un « blanc » = silence. Ils
 * éprouvent la mécanique des détecteurs. Le calibrage des seuils, lui, a été fait sur de vraies
 * émissions publiées (cf. l'en-tête de controle-voix.ts) — ces fichiers audio ne sont pas dans le dépôt.
 *
 * Lancer :  npx tsx --test src/lib/__tests__/qualite-voix.test.ts
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { analyserTour, rognerDefauts, unitesTexte } from '../qualite-voix'

const TAUX = 24000

/** Générateur pseudo-aléatoire déterministe. */
function prng(graine = 1): () => number {
  let x = graine
  return () => { x = (x * 1103515245 + 12345) & 0x7fffffff; return x / 0x7fffffff }
}

/** « Voix » : 4 syllabes/s voisées, séparées de courtes consonnes et micro-pauses. */
function voix(secondes: number, rand = prng(7)): Float32Array {
  const n = Math.round(secondes * TAUX)
  const out = new Float32Array(n)
  let phase = 0
  for (let i = 0; i < n; i++) {
    const t = i / TAUX
    const f0 = 150 + 40 * Math.sin(2 * Math.PI * 0.7 * t)
    phase += (2 * Math.PI * f0) / TAUX
    const syll = (t * 4) % 1
    const env = syll < 0.75 ? Math.sin((Math.PI * syll) / 0.75) : 0
    let v = 0
    for (let h = 1; h <= 8; h++) v += Math.sin(h * phase) / h
    const consonne = syll >= 0.75 && syll < 0.85 ? (rand() - 0.5) * 0.08 : 0
    out[i] = 0.25 * env * v + consonne
  }
  return out
}

function bruit(secondes: number, amplitude: number, rand = prng(3)): Float32Array {
  const out = new Float32Array(Math.round(secondes * TAUX))
  for (let i = 0; i < out.length; i++) out[i] = (rand() - 0.5) * 2 * amplitude
  return out
}

function silence(secondes: number): Float32Array { return new Float32Array(Math.round(secondes * TAUX)) }

function coller(...p: Float32Array[]): Float32Array {
  const out = new Float32Array(p.reduce((s, x) => s + x.length, 0))
  let o = 0
  for (const x of p) { out.set(x, o); o += x.length }
  return out
}

// 50 caractères chinois ≈ 10 s à 5 car/s.
const TEXTE_ZH = '今天我们来聊聊新闻自由，聊聊那些政府不想让你知道的事情。西班牙的住房危机越来越严重，年轻人根本租不起房子，大家怎么看'
const types = (a: ReturnType<typeof analyserTour>) => a.defauts.map(d => d.type)

test('unités de texte : caractères chinois, lettres ailleurs, crochets ignorés', () => {
  assert.equal(unitesTexte('[美琳] 今天我们', 'zh'), 4)
  assert.equal(unitesTexte('Hello, world!', 'en'), 10)
})

test('⭐ une voix saine, au débit attendu, passe sans défaut', () => {
  const a = analyserTour(voix(11), TAUX, TEXTE_ZH, 'zh')
  assert.deepEqual(types(a), [], a.defauts.map(d => d.detail).join(' ; '))
  assert.ok(a.mesures.voiseS > 5)
})

test('⭐ un blanc de 2 s au milieu du tour est détecté', () => {
  const a = analyserTour(coller(voix(5), silence(2), voix(5)), TAUX, TEXTE_ZH, 'zh')
  assert.ok(types(a).includes('silence'), a.defauts.map(d => d.detail).join(' ; '))
  assert.ok(a.mesures.silenceInterneMaxS > 1.7 && a.mesures.silenceInterneMaxS < 2.3)
})

test('⭐ un souffle (bruit faible, non voisé) de 1,5 s est un chuchotement', () => {
  const a = analyserTour(coller(voix(5), bruit(1.5, 0.02), voix(5)), TAUX, TEXTE_ZH, 'zh')
  assert.ok(types(a).includes('chuchotement'), a.defauts.map(d => d.detail).join(' ; '))
  assert.ok(a.mesures.chuchotementMaxS > 1.1)
})

test('les consonnes brèves d’une voix saine ne sont PAS des chuchotements', () => {
  const a = analyserTour(voix(11), TAUX, TEXTE_ZH, 'zh')
  assert.ok(a.mesures.chuchotementMaxS < 0.8)
})

test('⭐ texte non dit : 50 caractères en 3 s', () => {
  const a = analyserTour(voix(3), TAUX, TEXTE_ZH, 'zh')
  assert.ok(types(a).includes('debit-rapide'))
})

test('⭐ trop long pour son texte : 8 caractères étirés sur 12 s', () => {
  const a = analyserTour(voix(12), TAUX, '首相的沙发被占了', 'zh')
  assert.ok(types(a).includes('debit-lent'))
})

test('un tour (presque) muet est signalé', () => {
  const a = analyserTour(coller(silence(2), bruit(0.2, 0.0005)), TAUX, TEXTE_ZH, 'zh')
  assert.deepEqual(types(a), ['muet'])
})

test('l’écrêtage est signalé', () => {
  const v = voix(11)
  for (let i = 0; i < v.length; i++) v[i] = Math.max(-1, Math.min(1, v[i] * 8))
  assert.ok(types(analyserTour(v, TAUX, TEXTE_ZH, 'zh')).includes('ecretage'))
})

test('langue alphabétique : un tour français sain passe', () => {
  const texte = 'Bon, alors aujourd’hui on parle de la Ğ1, et franchement, c’est pas ce que vous croyez.'
  const a = analyserTour(voix(5.5), TAUX, texte, 'fr')
  assert.deepEqual(types(a), [], a.defauts.map(d => d.detail).join(' ; '))
})

test('⭐ rognage : blanc et chuchotement raccourcis, le défaut disparaît, la voix reste', () => {
  const s = coller(voix(5), silence(2), voix(3), bruit(1.5, 0.02), voix(3))
  const a = analyserTour(s, TAUX, TEXTE_ZH, 'zh')
  const r = rognerDefauts(s, TAUX, a)
  assert.ok(r.retireS > 2.5, `retiré ${r.retireS} s`)
  const apres = analyserTour(r.samples, TAUX, TEXTE_ZH, 'zh')
  assert.ok(!types(apres).includes('silence') && !types(apres).includes('chuchotement'), apres.defauts.map(d => d.detail).join(' ; '))
  assert.ok(apres.mesures.voiseS > a.mesures.voiseS * 0.9, 'la voix n’a pas été coupée')
})

test('rognage d’un tour sain : rien ne change', () => {
  const s = voix(6)
  const r = rognerDefauts(s, TAUX, analyserTour(s, TAUX, TEXTE_ZH, 'zh'))
  assert.equal(r.retireS, 0)
  assert.equal(r.samples, s)
})

test('rapide : moins de 200 ms d’analyse pour 10 s de son', () => {
  const s = voix(10)
  analyserTour(s, TAUX, TEXTE_ZH, 'zh')
  const t0 = performance.now()
  analyserTour(s, TAUX, TEXTE_ZH, 'zh')
  assert.ok(performance.now() - t0 < 200, `${(performance.now() - t0).toFixed(0)} ms`)
})
