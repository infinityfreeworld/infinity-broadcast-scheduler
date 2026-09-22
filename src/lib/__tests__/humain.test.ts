/**
 * Le côté « réel, humain » de l'antenne (22/09/2026) : réactions courtes, courrier, silences
 * variables, niveaux égalisés, fond de salle, talk-over, lit musical, date du jour.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { planHumain, silenceApresTour, egaliserNiveaux, fusionTalkOver, superposerLit, dateLisible, habillageActif, ajouterBruitDeFond } from '../humain'
import { prng } from '../musique'
import { concatWavs, type ConcatEntry } from '../audio'
import { phraseIdent } from '../idents'

test('plan humain : ~1 tour sur 5 est court, jamais deux de suite, jamais un tour réservé ; un courrier au milieu', () => {
  const exclus = new Set([0, 21, 6, 7, 14, 15])
  const p = planHumain(22, exclus, 'pirate-radio:2026-09-23:humain')
  assert.ok(p.courts.size >= 2 && p.courts.size <= 4, `${p.courts.size} courts`)
  for (const i of p.courts) { assert.ok(!exclus.has(i)); assert.ok(!p.courts.has(i + 1)) }
  assert.ok(p.courrier !== null && p.courrier >= 7 && p.courrier <= 14 && !p.courts.has(p.courrier))
  assert.deepEqual(planHumain(22, exclus, 'x'), planHumain(22, exclus, 'x'), 'déterministe')
  assert.notDeepEqual([...planHumain(22, exclus, 'a').courts], [...planHumain(22, exclus, 'b').courts])
  const petit = planHumain(6, new Set([0, 5]), 'x')
  assert.equal(petit.courts.size, 0); assert.equal(petit.courrier, null)
})

test('silences : bornés, plus longs après une question, plus courts après une réaction brève', () => {
  const r = prng('s')
  for (let k = 0; k < 200; k++) {
    const s = silenceApresTour('Bon.', false, r)
    assert.ok(s >= 0.1 && s <= 0.7)
  }
  const fixe = () => 0.5
  assert.ok(silenceApresTour('Tu en penses quoi ?', false, fixe) > silenceApresTour('Je pense ça.', false, fixe))
  assert.ok(silenceApresTour('Ah oui !', true, fixe) < silenceApresTour('Ah oui !', false, fixe))
})

function sinus(amp: number, n = 4000): Float32Array { const s = new Float32Array(n); for (let i = 0; i < n; i++) s[i] = amp * Math.sin(i / 7); return s }

test('niveaux : chaque voix rejoint la médiane à ±6 dB près, sans écrêter', () => {
  const t = [sinus(0.05), sinus(0.2), sinus(0.8)]
  const gains = egaliserNiveaux(t)
  assert.equal(gains[1], 0, 'la médiane ne bouge pas')
  assert.ok(gains[0] > 0 && gains[0] <= 6, `faible remonté de ${gains[0]} dB`)
  assert.ok(gains[2] < 0 && gains[2] >= -6, `fort baissé de ${gains[2]} dB`)
  let crete = 0; for (const x of t[0]) crete = Math.max(crete, Math.abs(x)); assert.ok(crete <= 0.97)
  assert.deepEqual(egaliserNiveaux([sinus(0.3)]), [0], 'seul : rien à égaliser')
})

test('talk-over : la musique commence sous la fin de la voix, la fin de la voix est connue, pas d’écrêtage', () => {
  const voix = sinus(0.6, 10000), musique = sinus(0.6, 8000)
  const f = fusionTalkOver(voix, musique, 1200)
  assert.equal(f.samples.length, 10000 + 8000 - 1200)
  assert.equal(f.finVoix, 10000)
  let crete = 0; for (const x of f.samples) crete = Math.max(crete, Math.abs(x)); assert.ok(crete <= 0.98 + 1e-6)
  assert.ok(Math.abs(f.samples[9000]) > 0, 'la zone de chevauchement porte les deux')
  const sans = fusionTalkOver(voix, musique, 0); assert.equal(sans.samples.length, 18000)
})

test('lit : mélangé en place sous la voix, fondu de sortie ou d’entrée, sans écrêtage', () => {
  const base = new Float32Array(1000).fill(0.5), lit = new Float32Array(2000).fill(0.4)
  const n = superposerLit(base, lit, 0.5, 1000, 'debut', 0)
  assert.equal(n, 1000)
  assert.ok(base[0] > 0.5, 'lit présent au début'); assert.ok(Math.abs(base[999] - 0.5) < 0.01, 'lit éteint à la fin (fondu)')
  const b2 = new Float32Array(1000).fill(0.5)
  superposerLit(b2, lit, 0.5, 1000, 'fin', 500)
  assert.ok(Math.abs(b2[0] - 0.5) < 0.01, 'lit absent au début (fondu d’entrée)'); assert.ok(b2[999] > 0.5)
  const vue = b2.subarray(500); superposerLit(vue, lit, 0, 1000, 'debut', 0); assert.ok(b2[600] > 0.9, 'une vue partage la mémoire')
  let crete = 0; for (const x of b2) crete = Math.max(crete, Math.abs(x)); assert.ok(crete <= 0.98 + 1e-6)
})

test('fond de salle : présent dans les silences seulement, à −58 dBFS, déterministe', () => {
  const e = (): ConcatEntry => ({ wav: { samples: new Float32Array(100).fill(0.3), sampleRate: 100 }, silenceApresS: 0.5 })
  const a = concatWavs([e(), e()], { bruitDb: -58, rand: prng('f') })
  const b = concatWavs([e(), e()], { bruitDb: -58, rand: prng('f') })
  assert.equal(a.samples.length, 100 + 50 + 100)
  assert.deepEqual(a.samples, b.samples)
  let bruit = 0; for (let i = 100; i < 150; i++) bruit = Math.max(bruit, Math.abs(a.samples[i]))
  assert.ok(bruit > 0 && bruit < 0.01, `bruit crête ${bruit}`)
  assert.ok(Math.abs(a.samples[0] - 0.3) < 1e-6)
  const sans = concatWavs([e(), e()]); assert.equal(sans.samples[120], 0, 'sans option : silence numérique')
  const out = new Float32Array(10); ajouterBruitDeFond(out, 2, 5, -40, prng('x')); assert.equal(out[0], 0); assert.notEqual(out[3], 0)
})

test('silence variable : concatWavs respecte silenceApresS, et garde 0,10 s par défaut', () => {
  const e = (s?: number): ConcatEntry => ({ wav: { samples: new Float32Array(100), sampleRate: 100 }, ...(s !== undefined ? { silenceApresS: s } : {}) })
  assert.equal(concatWavs([e(0.3), e()]).samples.length, 230)
  assert.equal(concatWavs([e(), e()]).samples.length, 210)
})

test('la date du jour se dit en toutes lettres dans la langue de la station', () => {
  assert.equal(dateLisible('2026-09-23', 'fr'), 'mercredi 23 septembre 2026')
  assert.match(dateLisible('2026-09-23', 'en'), /Wednesday,? 23 September 2026/)
  assert.equal(dateLisible('n/a', 'fr'), 'n/a')
})

test('habillage : actif par défaut, coupé par off/false/non/0', () => {
  assert.equal(habillageActif('X', {}), true)
  for (const v of ['off', 'false', 'non', '0', 'OFF']) assert.equal(habillageActif('X', { X: v }), false)
  assert.equal(habillageActif('X', { X: 'on' }), true)
})

test('l’ident d’ouverture porte le slogan de la station quand il est court', () => {
  assert.equal(phraseIdent('fr', 'Radio Pirate', 'ouverture', 'Le code est libre, l\'humain aussi.'), 'Vous écoutez Radio Pirate. Le code est libre, l\'humain aussi.')
  assert.equal(phraseIdent('fr', 'Radio Pirate', 'ouverture', 'Sans point'), 'Vous écoutez Radio Pirate. Sans point.')
  assert.equal(phraseIdent('fr', 'Radio Pirate', 'fermeture', 'Le code est libre'), 'C\'était Radio Pirate. À tout de suite.')
  assert.equal(phraseIdent('fr', 'X', 'ouverture', 'x'.repeat(90)), 'Vous écoutez X.', 'un slogan trop long est tu')
})

test('🔴 l’écriture sait où sont les pauses : lancer la musique, en revenir, réagir court, lire le courrier', () => {
  const gb = readFileSync('src/scripts/generate-broadcast.ts', 'utf8')
  assert.match(gb, /const planPauses = planifierPauses\(station, opts\.date, numTurns, reglagesM\)/, 'même tirage que le montage')
  assert.match(gb, /pauseApres\.has\(i\)\s*\?\s*`Ton tour, et c'est le DERNIER avant une pause musicale/)
  assert.match(gb, /retourApres\.has\(i\)\s*\?\s*`On REVIENT d'une pause musicale/)
  assert.match(gb, /humain\.courts\.has\(i\)\s*\?\s*`Tour COURT/)
  assert.match(gb, /humain\.courrier === i\s*\?\s*`Le standard a reçu un message d'auditeur/)
  assert.match(gb, /dateDuJour,\n/, 'la date est passée au prompt')
  assert.match(gb, /plansVoix\[j\]\.court \? \{ emotionExaggeration: 0\.70 \} : \{\}/, 'une réaction courte se dit avec plus d’élan')
  const pe = readFileSync('src/lib/personas.ts', 'utf8')
  assert.match(pe, /8\. Parle comme à l'ORAL/)
  assert.match(pe, /ne donne JAMAIS l'heure qu'il est/)
})
