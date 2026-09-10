/**
 * 🔴 Toutes les émissions publiées depuis juillet 2026 étaient en Ogg/Opus,
 * et WebKit — Safari ET l'application macOS (WKWebView) — refuse ce format :
 * « Decoding failed ». Mesuré le 11/09/2026 dans le WebKit système de ce
 * Mac (scripts/decodage-webkit.py) : Ogg/Opus et MP4/Opus échouent,
 * WebM/Opus, MP3 et AAC passent.
 *
 * Ces tests prouvent que la PRODUCTION sort du WebM, et que la chaîne entière
 * — encodage, dépôt, événement publié, rétention — en tient compte.
 *
 * ⚠️ Ils exigent `opusenc` et `ffmpeg` : la nuit en a besoin aussi, et un
 * test qui s'éteindrait en leur absence masquerait exactement la panne qu'il
 * doit signaler.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { tmpdir } from 'node:os'

import { encoderEmission, oggOpusVersWebm, estWebm, encodeWavToOpus, FORMAT_EMISSION } from '../opus'
import { estUneEmission } from '../retention'

/** WAV PCM16 mono : une sinusoïde, rien d'autre. */
function wavSinus(secondes = 2, hz = 440, taux = 22050): Buffer {
  const n = Math.round(secondes * taux)
  const data = Buffer.alloc(n * 2)
  for (let i = 0; i < n; i++) data.writeInt16LE(Math.round(Math.sin(2 * Math.PI * hz * i / taux) * 12000), i * 2)
  const h = Buffer.alloc(44)
  h.write('RIFF', 0, 'ascii'); h.writeUInt32LE(36 + data.length, 4); h.write('WAVE', 8, 'ascii')
  h.write('fmt ', 12, 'ascii'); h.writeUInt32LE(16, 16); h.writeUInt16LE(1, 20); h.writeUInt16LE(1, 22)
  h.writeUInt32LE(taux, 24); h.writeUInt32LE(taux * 2, 28); h.writeUInt16LE(2, 32); h.writeUInt16LE(16, 34)
  h.write('data', 36, 'ascii'); h.writeUInt32LE(data.length, 40)
  return Buffer.concat([h, data])
}

function sonder(octets: Buffer): { format: string; codec: string; duree: number } {
  const dossier = mkdtempSync(join(tmpdir(), 'sonde-'))
  try {
    const f = join(dossier, 'x')
    writeFileSync(f, octets)
    const j = JSON.parse(execFileSync('ffprobe', ['-v', 'error', '-print_format', 'json',
      '-show_entries', 'format=format_name,duration:stream=codec_name', f], { encoding: 'utf8' }))
    return { format: j.format.format_name, codec: j.streams[0].codec_name, duree: Number(j.format.duration) }
  } finally { rmSync(dossier, { recursive: true, force: true }) }
}

test('les outils de la nuit sont présents (sinon rien ne s’encode)', () => {
  for (const outil of ['opusenc', 'ffmpeg', 'ffprobe']) {
    assert.doesNotThrow(() => execFileSync('sh', ['-c', `command -v ${outil}`]), `${outil} introuvable`)
  }
})

test('🔴 une émission encodée est du WebM, PAS de l’Ogg', async () => {
  const sortie = await encoderEmission(wavSinus(2))
  assert.notEqual(sortie.subarray(0, 4).toString('latin1'), 'OggS', 'de l’Ogg : muet sous Safari et dans l’app macOS')
  assert.ok(estWebm(sortie), 'la sortie doit porter l’en-tête EBML et le DocType webm')
  const s = sonder(sortie)
  assert.match(s.format, /webm|matroska/)
  assert.equal(s.codec, 'opus', 'le codec ne change pas : seul l’emballage change')
  assert.ok(Math.abs(s.duree - 2) < 0.15, `durée ${s.duree} s au lieu de 2 s`)
})

test('le réemballage ne réencode pas : même flux Opus, taille quasi identique', async () => {
  const ogg = await encodeWavToOpus(wavSinus(3))
  const webm = await oggOpusVersWebm(ogg)
  assert.ok(estWebm(webm))
  const ecart = Math.abs(webm.length - ogg.length) / ogg.length
  assert.ok(ecart < 0.15, `écart de taille ${(ecart * 100).toFixed(0)} % : ce n’est plus un simple emballage`)
})

test('le réemballage REFUSE ce qui n’est pas de l’Ogg, et le dit', async () => {
  await assert.rejects(oggOpusVersWebm(Buffer.from('Trop de requêtes.')), /pas un flux Ogg/)
})

test('estWebm distingue le WebM d’un Matroska générique et de l’Ogg', () => {
  const ebml = Buffer.from([0x1a, 0x45, 0xdf, 0xa3])
  const matroska = Buffer.concat([ebml, Buffer.alloc(20), Buffer.from('matroska'), Buffer.alloc(40)])
  const webm = Buffer.concat([ebml, Buffer.alloc(20), Buffer.from('webm'), Buffer.alloc(40)])
  const ogg = Buffer.concat([Buffer.from('OggS'), Buffer.alloc(60)])
  assert.equal(estWebm(webm), true)
  assert.equal(estWebm(matroska), false, 'WebKit ne lit que le profil WebM')
  assert.equal(estWebm(ogg), false)
})

test('le format publié est audio/webm, extension .webm', () => {
  assert.deepEqual({ ...FORMAT_EMISSION }, { extension: 'webm', mime: 'audio/webm' })
})

// ── Couplage : la mécanique pourrait être parfaite et la production ne pas
//    s'en servir. C'est le défaut qu'on a déjà payé avec le tri GPU.
const source = readFileSync(resolve(process.cwd(), 'src/scripts/generate-broadcast.ts'), 'utf8')
const code = source.replace(/\/\*[\s\S]*?\*\//g, '').split('\n').map(l => l.replace(/\/\/.*$/, '')).join('\n')

test('🔴 la production passe par encoderEmission, jamais par l’Ogg brut', () => {
  assert.match(code, /await encoderEmission\(result\.audioBlob/)
  assert.doesNotMatch(code, /encodeWavToOpus\(/, 'encodeWavToOpus rend de l’Ogg')
})

test('le fichier déposé et l’événement publié annoncent le même format', () => {
  assert.match(code, /dataspacePinFile\(opusBlob, nomFichier, FORMAT_EMISSION\.mime/)
  assert.match(code, /audioMime:\s+FORMAT_EMISSION\.mime/)
  assert.match(code, /const nomFichier = `broadcast-\$\{stationId\}-\$\{targetDate\}\.\$\{FORMAT_EMISSION\.extension\}`/)
  assert.doesNotMatch(code, /'audio\/ogg'/, 'plus aucune trace d’audio/ogg dans la production')
})

test('🔴 la rétention reconnaît les .webm — sinon ils ne seraient JAMAIS purgés', () => {
  // Un fichier non reconnu est GARDÉ par prudence : un .webm ignoré par la
  // rétention remplirait data-space pour toujours, sans un mot.
  assert.ok(estUneEmission('broadcast-pirate-radio-2026-09-11.webm'))
  assert.ok(estUneEmission('broadcast-pirate-radio-2026-09-10.opus'), 'les anciens .opus doivent encore être purgés')
  assert.ok(!estUneEmission('broadcast-pirate-radio-2026-09-11.webm.bak'))
})
