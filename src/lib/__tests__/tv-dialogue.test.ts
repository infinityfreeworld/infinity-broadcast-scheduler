/**
 * @module InfinityScheduler/TV/Dialogue/Tests
 * @description 🎙️ « Pas une vidéo construite avec des dialogues » — retour du Bâtisseur
 *   (09/09/2026). Une seule voix qui récite quatre sujets s'entend comme une lecture. Deux
 *   rôles suffisent à créer l'échange : le plateau présente et relance, le terrain rapporte.
 *
 *   Lancer :  npx tsx --test src/lib/__tests__/tv-dialogue.test.ts
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { roleDuPlan, VOIX_TERRAIN, DEFAULT_TV_VOICE } from '../tv-voice'
import { LICENCES_PIPER } from '../voix-licences'
import { isVoiceSupported, voixDuRegistre } from '../piper'

test('⭐ le premier plan est TOUJOURS au plateau', () => {
  // Deux raisons et les deux comptent : un journal s'ouvre en studio, ET la première entrée
  // fixe la cadence d'échantillonnage de toute la bande (concatWavs rééchantillonne sur elle).
  assert.equal(roleDuPlan(undefined, 0), 'plateau')
  assert.equal(roleDuPlan('terrain', 0), 'plateau', 'même si le LLM demande le terrain')
})

test('les rôles alternent quand le conducteur n’en demande aucun', () => {
  const suite = [0, 1, 2, 3].map(i => roleDuPlan(undefined, i))
  assert.deepEqual(suite, ['plateau', 'terrain', 'plateau', 'terrain'])
})

test('un rôle explicitement demandé est respecté (hors premier plan)', () => {
  assert.equal(roleDuPlan('plateau', 1), 'plateau')
  assert.equal(roleDuPlan('terrain', 2), 'terrain')
})

test('⭐ les DEUX voix sont commercialisables — la règle du fondateur', () => {
  // `fr_FR-tom-medium` (AGPLv3) était le défaut de ce module jusqu'au 09/09 : le JT serait
  // parti à l'antenne avec une voix non commercialisable. On ne rouvre pas cette porte en
  // ajoutant une seconde voix.
  for (const v of [DEFAULT_TV_VOICE, VOIX_TERRAIN]) {
    const l = LICENCES_PIPER[v]
    assert.ok(l, `${v} doit avoir une licence déclarée`)
    assert.equal(l.commercial, true, `${v} doit être commercialisable`)
  }
})

test('⭐ les deux voix existent vraiment au registre Piper', () => {
  // Une voix déclarée mais absente du registre échouerait à la synthèse, la nuit, sans témoin.
  assert.ok(isVoiceSupported(DEFAULT_TV_VOICE), 'voix du plateau absente du registre')
  assert.ok(isVoiceSupported(VOIX_TERRAIN), `voix du terrain absente : ${voixDuRegistre().join(', ')}`)
})

test('les deux voix sont DISTINCTES (sinon il n’y a pas d’échange)', () => {
  assert.notEqual(VOIX_TERRAIN, DEFAULT_TV_VOICE)
})
