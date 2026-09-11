/**
 * 自由之声 était refusée chaque nuit : la seule voix Piper chinoise n'a pas
 * de licence, et une voix française ÉPELLE les sinogrammes (×11,2 en durée).
 * Depuis le 11/09/2026, le chinois passe par Kokoro-82M v1.1-zh (Apache-2.0),
 * avec des voix chinoises natives.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { tmpdir } from 'node:os'
import { createHash } from 'node:crypto'
import { spawnSync } from 'node:child_process'

import { estVoixKokoro, nomKokoro, empreinte, FICHIERS_KOKORO, TAUX_KOKORO, causeDEchec } from '../kokoro'
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

// ── Les lettres latines : la phonétique chinoise les SUPPRIME en silence.
//    Première répétition (11/09) : « AI », « NGO », « CNN » disparus de 5 tours.

const PONT = resolve(process.cwd(), 'scripts/kokoro-python.py')
function sigles(texte: string): string {
  const r = spawnSync('python3', ['-c', [
    'import importlib.util, sys',
    // numpy INTERDIT : la fonction des sigles doit se charger sans lui, quelle que
    // soit la machine (le Python système de ce Mac l'a — la mutation passait).
    "sys.modules['numpy'] = None",
    // Aucun cache .pyc : le test ne doit laisser aucun fichier dans le dépôt.
    'sys.dont_write_bytecode = True',
    `spec = importlib.util.spec_from_file_location('pont', ${JSON.stringify(PONT)})`,
    'm = importlib.util.module_from_spec(spec); spec.loader.exec_module(m)',
    'print(m.remplacer_sigles(sys.argv[1]))',
  ].join('\n'), texte], { encoding: 'utf8' })
  assert.equal(r.status, 0, `pont inimportable : ${r.stderr}`)
  return r.stdout.trim()
}

test('🔴 les sigles de l’actualité sont DITS en chinois, pas supprimés', () => {
  assert.equal(sigles('关于AI和NGO的报道，CNN说'), '关于人工智能和非政府组织的报道，美国有线电视新闻网说')
  assert.equal(sigles('比特币和Bitcoin、blockchain'), '比特币和比特币、区块链')
  assert.ok(!existsSync(resolve(process.cwd(), 'scripts/__pycache__')), 'le test ne doit laisser aucun cache Python dans le dépôt')
})

test('un mot latin inconnu est laissé tel quel — pour être SIGNALÉ, pas deviné', () => {
  assert.equal(sigles('XYZ公司'), 'XYZ公司')
  assert.equal(sigles('it'), 'it', '« it » minuscule n’est pas le sigle IT')
})

test('le remplacement a lieu AVANT la phonétique, et le signalement APRÈS', () => {
  const py = readFileSync(PONT, 'utf8')
  const iRemp = py.indexOf('texte = remplacer_sigles(texte)')
  const iSign = py.indexOf("latines = re.findall(r'[A-Za-z]+', texte)")
  const iG2P = py.indexOf("ZHG2P(version='1.1')(texte)")
  assert.ok(iRemp > 0 && iSign > iRemp && iG2P > iSign, 'ordre : remplacer → signaler → phonétique')
})

test('la consigne d’écriture chinoise demande les sigles en caractères', () => {
  assert.match(readFileSync(resolve(process.cwd(), 'src/lib/personas.ts'), 'utf8'), /zh: '[^']*外国缩写和外文名称一律用汉字写出/)
})

// ── Un échec doit dire sa CAUSE : « Command failed: <commande> » ne dit rien.
test('🔴 la cause d’un échec vient du signal et de stderr, pas de la ligne de commande', () => {
  const cmd = { message: 'Command failed: /…/python /…/kokoro-python.py --model …' }
  assert.equal(causeDEchec({ ...cmd, signal: 'SIGKILL' }, []), 'tué par SIGKILL', 'un processus tué par manque de mémoire doit le dire')
  assert.equal(
    causeDEchec({ ...cmd, code: 1 }, ['Traceback (most recent call last):', '  File "x"', 'onnxruntime: bad allocation']),
    'code 1 · File "x" | onnxruntime: bad allocation')
  assert.equal(causeDEchec({ ...cmd, code: 1 }, ['lettres latines ignorées par la phonétique chinoise : CNN']), 'code 1',
    'un simple avertissement n’est pas une cause')
  assert.equal(causeDEchec(cmd, []), cmd.message, 'sans rien d’autre, le message d’origine')
})

test('le rejet d’un essai porte la cause EN PREMIÈRE ligne — celle que la reprise affiche', () => {
  assert.match(code('src/lib/kokoro.ts'), /reject\(new Error\(`\$\{causeDEchec\(err, lignes\)\}\\n\$\{err\.message\}`\)\)/)
})
