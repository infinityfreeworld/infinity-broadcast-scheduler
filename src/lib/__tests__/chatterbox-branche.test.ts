/**
 * @module InfinityScheduler/Lib/Chatterbox/BrancheTests
 * @description 🎙️ Les voix clonées ne doivent pas dépendre d'une variable
 *   que plus personne ne pose.
 *
 *   Constaté le 14/09/2026 : data-space est notre fournisseur depuis le
 *   02/09 et son adresse est le DÉFAUT du client — mais six endroits
 *   n'activaient les voix clonées que si `CHATTERBOX_TTS_URL` était non vide.
 *   Côté serveur, les nuits du 11 et du 12/09 montrent ZÉRO demande de voix
 *   venant de la radio, pendant que ses émissions sortaient normalement :
 *   tout en Piper, sans une ligne d'erreur.
 *
 *   Lancer :  npx tsx --test src/lib/__tests__/chatterbox-branche.test.ts
 */
import { test, beforeEach, mock } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { baseChatterbox, chatterboxBranche, getChatterboxVoiceForHost } from '../chatterbox'

const VARIABLES = [
  'CHATTERBOX_TTS_URL', 'CHATTERBOX_API_KEY', 'DATASPACE_API_KEY', 'DATASPACE_NOSTR_KEY',
  'CHATTERBOX_VOICE_MAP', 'CHATTERBOX_DEFAULT_VOICE', 'HOST_VOICE_MAP_JSON',
]
beforeEach(() => { for (const v of VARIABLES) delete process.env[v] })

test('rien de configuré : Piper, comme avant', () => {
  process.env.CHATTERBOX_VOICE_MAP = JSON.stringify({ 'wtf-ranouna': 'ranouna' })
  assert.equal(chatterboxBranche(), false)
  assert.equal(getChatterboxVoiceForHost('wtf-radio', 'wtf-ranouna', 'fr'), null)
})

test('⭐ la clé NOSTR data-space SEULE suffit à brancher les voix clonées (le cas du Mac)', () => {
  process.env.DATASPACE_NOSTR_KEY = 'a'.repeat(64)
  process.env.CHATTERBOX_VOICE_MAP = JSON.stringify({ 'wtf-ranouna': 'ranouna' })
  assert.equal(chatterboxBranche(), true)
  assert.equal(getChatterboxVoiceForHost('wtf-radio', 'wtf-ranouna', 'fr'), 'ranouna')
})

test('un jeton data-space direct suffit aussi', () => {
  process.env.DATASPACE_API_KEY = 'ds_live_x'
  assert.equal(chatterboxBranche(), true)
})

test('⭐ le secret VIDE que passe le CI ne débranche rien, et l’adresse retombe sur data-space', () => {
  process.env.CHATTERBOX_TTS_URL = ''
  process.env.DATASPACE_NOSTR_KEY = 'a'.repeat(64)
  assert.equal(chatterboxBranche(), true)
  assert.equal(baseChatterbox(), 'https://data-space.world')
})

test('⭐ une adresse Hugging Face périmée est IGNORÉE — et on le dit, une fois', () => {
  const avert = mock.method(console, 'warn', () => {})
  try {
    process.env.CHATTERBOX_TTS_URL = 'https://medinchina-chatterbox-nestor.hf.space/'
    assert.equal(baseChatterbox(), 'https://data-space.world')
    assert.equal(baseChatterbox(), 'https://data-space.world')
    assert.equal(avert.mock.callCount(), 1, 'un seul avertissement par exécution')
    assert.match(String(avert.mock.calls[0].arguments[0]), /Hugging Face/)
  } finally {
    avert.mock.restore()
  }
})

test('une adresse propre est respectée (station de test, miroir)', () => {
  process.env.CHATTERBOX_TTS_URL = 'https://station.exemple.test//'
  assert.equal(baseChatterbox(), 'https://station.exemple.test')
})

test('🔴 plus AUCUN script ne décide des voix sur la seule présence de CHATTERBOX_TTS_URL', () => {
  // Le garde qui compte : le jour où quelqu'un réécrit `if (process.env.CHATTERBOX_TTS_URL)`,
  // la radio repart en Piper sur toute machine qui ne pose pas cette variable.
  const racine = new URL('../../', import.meta.url).pathname
  const fautifs: string[] = []
  for (const dossier of ['lib', 'scripts']) {
    for (const f of readdirSync(join(racine, dossier))) {
      if (!f.endsWith('.ts')) continue
      const code = readFileSync(join(racine, dossier, f), 'utf8')
        .replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
      if (/if\s*\(\s*!?\s*process\.env\.CHATTERBOX_TTS_URL\s*[)&|]|&&\s*process\.env\.CHATTERBOX_TTS_URL\b/.test(code)) {
        fautifs.push(`${dossier}/${f} (garde sur la variable)`)
      }
      if (/CHATTERBOX_TTS_URL\s*\?\?\s*'https/.test(code)) {
        fautifs.push(`${dossier}/${f} (\`??\` : un secret vide donne une adresse vide)`)
      }
    }
  }
  assert.deepEqual(fautifs, [])
})
