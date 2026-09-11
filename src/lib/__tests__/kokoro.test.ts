/**
 * 自由之声 était refusée chaque nuit : la seule voix Piper chinoise n'a pas
 * de licence, et une voix française ÉPELLE les sinogrammes (×11,2 en durée).
 * Depuis le 11/09/2026, le chinois passe par Kokoro-82M v1.1-zh (Apache-2.0),
 * avec des voix chinoises natives.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { tmpdir } from 'node:os'
import { createHash } from 'node:crypto'

import { estVoixKokoro, nomKokoro, empreinte, FICHIERS_KOKORO, TAUX_KOKORO } from '../kokoro'
import { voixPourLangue, languesDiffusables, timbreHonore, type Genre } from '../voix'
import { voixCommercialisable, licenceDe, attributionsRequises } from '../voix-licences'

const GENRES: Genre[] = ['male', 'female', 'androgyn']

test('🔴 le chinois est servi par des voix chinoises NATIVES, jamais par une voix étrangère', () => {
  for (const g of GENRES) {
    const v = voixPourLangue('zh', g)
    assert.ok(v && estVoixKokoro(v), `zh/${g} → ${v} : une voix non chinoise épellerait les sinogrammes`)
  }
  assert.ok(languesDiffusables().includes('zh'), 'le chinois doit être diffusable')
})

test('une femme et un homme ont chacun leur voix', () => {
  const f = voixPourLangue('zh', 'female')!, m = voixPourLangue('zh', 'male')!
  assert.match(nomKokoro(f), /^zf_/, 'voix féminine attendue')
  assert.match(nomKokoro(m), /^zm_/, 'voix masculine attendue')
  assert.equal(timbreHonore('zh', 'female'), true)
})

test('licence déclarée, commercialisable, et crédit OBLIGATOIRE', () => {
  for (const g of GENRES) {
    const v = voixPourLangue('zh', g)!
    assert.ok(voixCommercialisable(v))
    assert.equal(licenceDe(v)?.licence, 'Apache-2.0')
    assert.match(licenceDe(v)?.attribution ?? '', /Kokoro-82M v1\.1-zh.*LongMaoData/)
  }
  assert.ok(attributionsRequises().some(a => a.includes('LongMaoData')), 'Apache-2.0 exige la mention')
})

test('une voix Kokoro inconnue du registre n’est PAS commercialisable', () => {
  assert.equal(voixCommercialisable('kokoro-zh:zf_099'), false, 'le refus reste le défaut')
})

test('estVoixKokoro / nomKokoro', () => {
  assert.equal(estVoixKokoro('kokoro-zh:zf_001'), true)
  assert.equal(estVoixKokoro('fr_FR-siwis-medium'), false)
  assert.equal(nomKokoro('kokoro-zh:zm_009'), 'zm_009')
  assert.throws(() => nomKokoro('ru_RU-denis-medium'), /pas une voix Kokoro/)
})

test('empreinte = SHA-256 du fichier', async () => {
  const d = mkdtempSync(join(tmpdir(), 'kokoro-'))
  try {
    const f = join(d, 'x'); writeFileSync(f, 'Kokoro')
    assert.equal(await empreinte(f), createHash('sha256').update('Kokoro').digest('hex'))
  } finally { rmSync(d, { recursive: true, force: true }) }
})

test('le modèle est ÉPINGLÉ : release datée et empreinte, jamais « la dernière »', () => {
  for (const f of Object.values(FICHIERS_KOKORO)) {
    assert.match(f.sha256, /^[0-9a-f]{64}$/, `${f.nom} sans empreinte`)
    assert.doesNotMatch(f.source, /\/latest\//, `${f.nom} pointe vers une version mouvante`)
  }
  assert.match(FICHIERS_KOKORO.modele.source, /model-files-v1\.1\/kokoro-v1\.1-zh\.onnx$/)
  assert.equal(TAUX_KOKORO, 24000)
})

const code = (p: string) => readFileSync(resolve(process.cwd(), p), 'utf8')
  .replace(/\/\*[\s\S]*?\*\//g, '').split('\n').map(l => l.replace(/\/\/.*$/, '')).join('\n')

test('🔴 la production AIGUILLE vers Kokoro — sinon Piper recevrait une voix qu’il ignore', () => {
  const gb = code('src/scripts/generate-broadcast.ts')
  assert.match(gb, /estVoixKokoro\(v\) \? ensureKokoro\(\) : ensureVoice\(v\)/, 'la préparation doit viser le bon moteur')
  // La DÉCISION doit dépendre de la voix — pas seulement la forme de l'aiguillage
  // (une mutation `const kokoro = false` passait sous l'ancienne assertion).
  assert.match(gb, /const kokoro = estVoixKokoro\(plan\.voixPiper\)\s*\n\s*const wavPath = kokoro\s*\n?\s*\? await synthesizeKokoro\(plan\.texte, plan\.voixPiper\)\s*: await synthesize\(plan\.texte, plan\.voixPiper\)/)
  assert.match(gb, /const tauxAttendu = kokoro \? TAUX_KOKORO : getVoiceSampleRate/)
})

test('le pont utilise le vocabulaire et la phonétique de la v1.1, et signale les lettres latines', () => {
  const py = readFileSync(resolve(process.cwd(), 'scripts/kokoro-python.py'), 'utf8')
  assert.match(py, /ZHG2P\(version='1\.1'\)/, 'la phonétique v1.0 ne correspond pas au modèle v1.1-zh')
  assert.match(py, /vocab_config=a\.config/, 'sans le vocabulaire v1.1, les phonèmes seraient mal lus')
  assert.match(py, /lettres latines ignorées/)
  assert.match(code('src/lib/kokoro.ts'), /'--config',\s+chemin\(FICHIERS_KOKORO\.config\)/)
})

test('l’environnement Kokoro n’entre jamais dans le dépôt', () => {
  assert.match(readFileSync(resolve(process.cwd(), '.gitignore'), 'utf8'), /^\.venv-kokoro\/$/m)
})
