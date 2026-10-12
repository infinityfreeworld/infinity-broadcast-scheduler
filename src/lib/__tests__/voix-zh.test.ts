/**
 * @module InfinityScheduler/Lib/VoixZhTests
 * @description 🇨🇳 Le chinois parle en Kokoro ; le clone seulement sur demande (ZH_VOIX_CLONEE=1).
 *
 *   Lancer :  npx tsx --test src/lib/__tests__/voix-zh.test.ts
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { voixPersonnagePourLangue, voixLocalePrincipale, cloneZhDemande } from '../voix-zh'

test('le réglage : éteint par défaut, seul « 1 » l’allume, et il ne touche que le chinois', () => {
  assert.equal(cloneZhDemande({}), false)
  assert.equal(cloneZhDemande({ ZH_VOIX_CLONEE: 'true' }), false)
  assert.equal(voixPersonnagePourLangue('zh', 'inv-zy-jian', {}), null)
  assert.equal(voixPersonnagePourLangue('zh', 'inv-zy-jian', { ZH_VOIX_CLONEE: '1' }), 'inv-zy-jian')
  assert.equal(voixPersonnagePourLangue('fr', 'inv-fw-leila', {}), 'inv-fw-leila', 'les autres langues ne changent pas')
  assert.equal(voixPersonnagePourLangue('ru', null, {}), null)
  assert.equal(voixLocalePrincipale('zh'), true)
  assert.equal(voixLocalePrincipale('fr'), false)
})

test('⭐ branché partout où une voix clonée était choisie : tours, auditeurs, témoin du réveil, idents, reprise', () => {
  const gb = readFileSync(new URL('../../scripts/generate-broadcast.ts', import.meta.url), 'utf8')
  assert.match(gb, /const chatterboxVoice = voixPersonnagePourLangue\(language,/)
  assert.match(gb, /const voixA = voixPersonnagePourLangue\(language,/)
  assert.match(gb, /const voixTemoin = voixPersonnagePourLangue\(langueStation,/)
  assert.match(gb, /!voixLocalePrincipale\(station\.language \?\? 'fr'\)/, 'pas de job rouge parce que le chinois parle Kokoro')
  assert.match(readFileSync(new URL('../idents.ts', import.meta.url), 'utf8'), /voixPersonnagePourLangue\(langue,/)
  assert.match(readFileSync(new URL('../reprise-branchement.ts', import.meta.url), 'utf8'), /localeVoulue: voixLocalePrincipale\(langue\)/)
})
