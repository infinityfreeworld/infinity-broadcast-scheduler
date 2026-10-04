/**
 * 🔌 Chaque moteur de voix reçoit un texte NETTOYÉ (04/10/2026).
 *
 * Le Bâtisseur a entendu des animateurs dire « astérisque ». L'app Infinity nettoie
 * dans `synthesizeForHost`, mais les émissions AUTOMATIQUES sont fabriquées ici, où
 * aucun nettoyage n'existait. Le nettoyage est donc posé à l'ENTRÉE de chaque moteur
 * (Piper, Kokoro, Chatterbox) : radio, TV, idents, tous y passent.
 *
 * On vérifie ce que le moteur REÇOIT, pas le code qui l'appelle :
 *   · Piper : un faux interpréteur (`PIPER_PYTHON`) note son entrée standard et rend
 *     un vrai WAV — la chaîne réelle `synthesize` est exécutée de bout en bout, et la
 *     voix TV (`synthesizeConductor`) avec elle ;
 *   · Kokoro : ses deux appels lourds sont remplacés (`kokoroInterne`) ;
 *   · Chatterbox : `fetch` simulé, on lit le champ `input` envoyé à data-space.
 */
import { test, mock, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import { chmodSync, mkdtempSync, readFileSync, writeFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { encodeWav } from '../audio'

// ── Faux Piper : AVANT tout import de piper.ts (ses chemins sont lus au chargement) ──
const banc = mkdtempSync(join(tmpdir(), 'banc-piper-'))
const journal = join(banc, 'stdin.log')
const modele = join(banc, 'modele.wav')
writeFileSync(modele, encodeWav({ samples: new Float32Array(22050).fill(0.1), sampleRate: 22050 }))
const fauxPython = join(banc, 'python')
writeFileSync(fauxPython, `#!/bin/sh
sortie=""
while [ $# -gt 0 ]; do
  if [ "$1" = "--output_file" ]; then sortie="$2"; fi
  shift
done
cat >> "${journal}"
printf '\\n<<FIN>>\\n' >> "${journal}"
cp "${modele}" "$sortie"
`)
chmodSync(fauxPython, 0o755)
process.env.PIPER_DIR = join(banc, 'piper')
process.env.VOICES_DIR = join(banc, 'voices')
process.env.PIPER_PYTHON = fauxPython

const piper = await import('../piper')
const { synthesizeConductor } = await import('../tv-voice')
const kokoro = await import('../kokoro')
const { synthesizeWithChatterbox } = await import('../chatterbox')

// Binaire et modèles présents (vides) : `ensurePiperBinary`/`ensureVoice` ne téléchargent rien.
writeFileSync(join(process.env.PIPER_DIR, 'piper'), '')
for (const v of piper.voixDuRegistre()) {
  writeFileSync(join(process.env.VOICES_DIR, `${v}.onnx`), '')
  writeFileSync(join(process.env.VOICES_DIR, `${v}.onnx.json`), '{}')
}

const recuParPiper = (): string[] =>
  existsSync(journal) ? readFileSync(journal, 'utf8').split('\n<<FIN>>\n').filter(Boolean) : []

const SALE = '**Salut** *rit* [musique] ! Venez sur https://exemple.org/page 🎉 #radio @tous'

/** Ce qu'aucune voix ne doit jamais recevoir. */
function assertPropre(dit: string, quoi: string): void {
  assert.doesNotMatch(dit, /[*#@[\]]/, `${quoi} : symbole lu à voix haute dans « ${dit} »`)
  assert.doesNotMatch(dit, /\brit\b|musique/, `${quoi} : didascalie dite dans « ${dit} »`)
  assert.doesNotMatch(dit, /https?:|exemple\.org/, `${quoi} : URL dite dans « ${dit} »`)
  assert.doesNotMatch(dit, /\p{Extended_Pictographic}/u, `${quoi} : emoji dit dans « ${dit} »`)
  assert.match(dit, /Salut/, `${quoi} : le texte lui-même doit rester`)
}

afterEach(() => mock.restoreAll())

test('⭐ Piper (radio, idents) reçoit le texte nettoyé', async () => {
  const avant = recuParPiper().length
  await piper.synthesize(SALE, 'fr_FR-siwis-medium')
  const recus = recuParPiper().slice(avant)
  assert.equal(recus.length, 1)
  assertPropre(recus[0], 'Piper')
  assert.equal(recus[0], 'Salut ! Venez sur radio tous')
})

test('⭐ la voix TV (synthesizeConductor → Piper) reçoit le texte nettoyé', async () => {
  const avant = recuParPiper().length
  const piste = await synthesizeConductor({
    title: 'JT',
    segments: [
      { title: 'A', imagePrompt: 'x', narration: SALE, role: 'plateau', durationSec: 5 },
      { title: 'B', imagePrompt: 'x', narration: '🎉 ✨ ***', role: 'terrain', durationSec: 5 },
    ],
  } as never)
  const recus = recuParPiper().slice(avant)
  assert.equal(recus.length, 1, 'une narration sans rien à dire reste un plan muet, sans synthèse')
  assertPropre(recus[0], 'TV')
  assert.equal(piste.spokenCount, 1)
  assert.equal(piste.timings.length, 2, 'le plan muet garde sa place')
})

test('⭐ Kokoro (chinois) reçoit le texte nettoyé', async () => {
  const recus: string[] = []
  mock.method(kokoro.kokoroInterne, 'assurer', async () => {})
  mock.method(kokoro.kokoroInterne, 'essai', async (texte: string, _v: string, sortie: string) => {
    recus.push(texte); writeFileSync(sortie, '')
  })
  await kokoro.synthesizeKokoro('**你好** *笑* [音乐] 世界 🎉', 'kokoro-zh:zf_001')
  assert.equal(recus.length, 1)
  assert.doesNotMatch(recus[0], /[*[\]]|\p{Extended_Pictographic}/u)
  assert.match(recus[0], /你好/)
})

test('⭐ Chatterbox (voix clonées) reçoit le texte nettoyé, avant tout découpage', async () => {
  process.env.CHATTERBOX_TTS_URL = 'https://station.exemple.test'
  const recus: string[] = []
  mock.method(globalThis, 'fetch', async (_u: unknown, init?: { body?: string }) => {
    recus.push(String(JSON.parse(init?.body ?? '{}').input ?? ''))
    return new Response(encodeWav({ samples: new Float32Array(2205), sampleRate: 22050 }), { status: 200 })
  })
  await synthesizeWithChatterbox({ voice: 'ranouna', text: SALE, language: 'fr' })
  assert.equal(recus.length, 1)
  assertPropre(recus[0], 'Chatterbox')
})
