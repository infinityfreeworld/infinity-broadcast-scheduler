/**
 * Jingles des stations (fondateur, 16/09/2026) : CID collés dans l'IHL,
 * placés au début, au milieu et à la fin, sans décaler le transcript.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import {
  jinglesDeLaFiche, planJingles, monter, segmentsDuMontage, chargerJingle, debitEmission, sourceDuJingle,
} from '../jingles'
import { concatWavs, readWav, type ConcatEntry, type DecodedWav } from '../audio'

const CID_A = 'bafybeibhjj5cyhauwnrrjntrkwncl6y3bhyetzow54jieku47f2igchw7e'
const CID_B = 'bafybeiey67moux547ib62r5uojwssqz3iu63ro3d2hvr7z62npifw3dlq4'

const wav = (secondes: number, taux = 22050): DecodedWav =>
  ({ samples: new Float32Array(Math.round(secondes * taux)).fill(0.1), sampleRate: taux })

test('la fiche IHL ne laisse passer que des CID ou des https', () => {
  const fiche = JSON.stringify({ jingles: [
    { title: 'Ouverture', cid: CID_A },
    { title: 'faux', cid: 'pas-un-cid' },
    { title: 'lien', url: 'https://exemple.org/j.mp3' },
    { title: 'lien douteux', url: 'http://exemple.org/j.mp3' },
    { cid: `  ${CID_B}  ` },
    null, 42,
  ] })
  assert.deepEqual(jinglesDeLaFiche(fiche), [
    { title: 'Ouverture', cid: CID_A },
    { title: 'lien', url: 'https://exemple.org/j.mp3' },
    { title: 'Jingle', cid: CID_B },
  ])
  assert.deepEqual(jinglesDeLaFiche('{"tracks":[]}'), [])
  assert.deepEqual(jinglesDeLaFiche('pas du json'), [])
})

test('le CID se lit sur data-space', () => {
  assert.equal(sourceDuJingle({ title: 'x', cid: CID_A }), `https://data-space.world/api/ipfs/${CID_A}`)
})

test('placement : un jingle → début et fin ; deux → + milieu ; trois → tournent', () => {
  assert.deepEqual(planJingles(0, 22), [])
  assert.deepEqual(planJingles(1, 22), [{ avantTour: 0, jingle: 0 }, { avantTour: 22, jingle: 0 }])
  assert.deepEqual(planJingles(2, 22), [{ avantTour: 0, jingle: 0 }, { avantTour: 11, jingle: 1 }, { avantTour: 22, jingle: 0 }])
  assert.deepEqual(planJingles(5, 22), [{ avantTour: 0, jingle: 0 }, { avantTour: 11, jingle: 1 }, { avantTour: 22, jingle: 2 }])
  assert.deepEqual(planJingles(3, 1), [{ avantTour: 0, jingle: 0 }, { avantTour: 1, jingle: 2 }])
})

test('🔴 le transcript reste aligné sur la VOIX malgré les jingles intercalés', () => {
  const voix: ConcatEntry[] = [wav(2), wav(3), wav(1), wav(4)].map(w => ({ wav: w }))
  const jingles = [{ title: 'A', cid: CID_A }, { title: 'B', cid: CID_B }]
  const m = monter(voix, jingles, [wav(1.5), wav(0.5)])
  // début, voix0, voix1, MILIEU, voix2, voix3, fin
  assert.equal(m.entrees.length, 7)
  assert.deepEqual(m.indexTour, [1, 2, 4, 5])
  concatWavs(m.entrees)
  // Chaque réplique pointe bien sur SA durée (2, 3, 1, 4 s).
  const durees = m.indexTour.map(i => +((m.entrees[i].tEnd! - m.entrees[i].tStart!)).toFixed(2))
  assert.deepEqual(durees, [2, 3, 1, 4])
  const seg = segmentsDuMontage(m)
  assert.deepEqual(seg.map(s => s.cid), [CID_A, CID_B, CID_A])
  assert.equal(seg[0].tStart, 0)
  assert.ok(seg[1].tStart > m.entrees[2].tEnd! && seg[1].tEnd < m.entrees[4].tStart!)
  assert.ok(Math.abs(seg[2].tEnd - (m.entrees[6].tEnd ?? 0)) < 1e-9)
})

test('un jingle qui n’a pas pu être chargé est simplement absent', () => {
  const voix: ConcatEntry[] = [wav(1), wav(1)].map(w => ({ wav: w }))
  const m = monter(voix, [{ title: 'A', cid: CID_A }, { title: 'B', cid: CID_B }], [null, wav(1)])
  assert.equal(m.entrees.length, 3)                // seul le milieu (B) est posé
  assert.deepEqual(m.indexTour, [0, 2])
  const sans = monter(voix, [], [])
  assert.deepEqual(sans.indexTour, [0, 1])
  assert.equal(segmentsDuMontage(sans).length, 0)
})

test('🔴 conversion réelle : un fichier stéréo 44,1 kHz devient mono 16 bits au taux des voix', async () => {
  const d = mkdtempSync(join(tmpdir(), 'jingle-test-'))
  try {
    const source = join(d, 'source.mp3')
    execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-f', 'lavfi', '-i', 'sine=frequency=440:duration=1.5:sample_rate=44100',
      '-ac', '2', source])
    const octets = new Uint8Array(readFileSync(source))
    const w = await chargerJingle({ title: 'A', cid: CID_A }, 22050, readWav, async url => {
      assert.match(url, /data-space\.world\/api\/ipfs\//)
      return octets
    })
    assert.ok(w)
    assert.equal(w.sampleRate, 22050)
    assert.ok(Math.abs(w.samples.length / 22050 - 1.5) < 0.1)
  } finally {
    rmSync(d, { recursive: true, force: true })
  }
})

test('un téléchargement raté ne fait pas tomber l’émission', async () => {
  const w = await chargerJingle({ title: 'A', cid: CID_A }, 22050, readWav, async () => { throw new Error('HTTP 404') })
  assert.equal(w, null)
})

test('la musique a besoin de plus de débit que la voix', () => {
  assert.equal(debitEmission(false), 32)
  assert.equal(debitEmission(true), 64)
})

test('la génération passe par le montage et publie les segments', () => {
  const src = readFileSync(new URL('../../scripts/generate-broadcast.ts', import.meta.url), 'utf8')
  assert.match(src, /const merged = concatWavs\(montage\.entrees\)/)
  assert.match(src, /montage\.entrees\[montage\.indexTour\[i\]\]/)
  assert.doesNotMatch(src, /turns\[i\]\.tStart = wavEntries\[i\]/)
  assert.match(src, /encoderEmission\(result\.audioBlob, debitEmission\(result\.segments\.length > 0\)\)/)
  assert.match(src, /segments: result\.segments/)
  const miroir = readFileSync(new URL('../../scripts/mirror-config-to-relay.ts', import.meta.url), 'utf8')
  assert.match(miroir, /30091:/)
})
