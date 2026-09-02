/**
 * @module InfinityScheduler/Lib/LLM/Tests
 * @description Un maillon qui rend 0 jeton SANS erreur est indiscernable
 *   d'un maillon qui n'avait rien à dire. Toute chaîne de repli qui traite
 *   « vide » comme « essaie le suivant » peut donc écarter son MEILLEUR
 *   maillon pour toujours, en silence.
 *
 *   C'est ce qui a fait que Matrixia n'a JAMAIS utilisé Groq. Ces tests
 *   sont ce qui empêche que ça recommence ici.
 *
 *   Lancer :  npx tsx --test src/lib/__tests__/llm.test.ts
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { lireOpenAI } from '../llm'

/** Fabrique une Response comme celle d'un vrai fournisseur. */
function reponse(corps: unknown, ok = true, status = 200): Response {
  return new Response(typeof corps === 'string' ? corps : JSON.stringify(corps), {
    status: ok ? status : status,
  })
}

test('une réponse normale est lue, avec ses compteurs de jetons', async () => {
  const r = await lireOpenAI(reponse({
    choices: [{ message: { content: '  Bonsoir à tous.  ' } }],
    usage:   { prompt_tokens: 120, completion_tokens: 8 },
  }), 'essai')
  assert.equal(r.text, 'Bonsoir à tous.')
  assert.equal(r.inputTokens, 120)
  assert.equal(r.outputTokens, 8)
})

test('🔴 une réponse VIDE LÈVE — elle ne doit pas passer pour « rien à dire »', async () => {
  // Le cœur du défaut évité. Si ceci rendait une chaîne vide, la chaîne
  // de repli noterait « maillon muet » et passerait au suivant : le
  // meilleur maillon serait écarté pour toujours, sans un mot.
  for (const vide of [
    { choices: [{ message: { content: '' } }] },
    { choices: [{ message: { content: '   ' } }] },
    { choices: [{ message: {} }] },
    { choices: [] },
    {},
  ]) {
    await assert.rejects(
      () => lireOpenAI(reponse(vide), 'essai'),
      /VIDE|réponse/,
      `devrait lever sur ${JSON.stringify(vide)}`,
    )
  }
})

test('le message d\'erreur d\'une réponse vide NOMME le maillon', async () => {
  // Sans le nom, on cherche la panne dans toute la chaîne.
  await assert.rejects(
    () => lireOpenAI(reponse({ choices: [{ message: { content: '' } }] }), 'mistral'),
    /mistral/,
  )
})

test('un HTTP non-OK lève en portant le code ET le corps', async () => {
  await assert.rejects(
    () => lireOpenAI(reponse({ error: 'quota dépassé' }, false, 429), 'essai'),
    /429/,
  )
  await assert.rejects(
    () => lireOpenAI(reponse({ error: 'quota dépassé' }, false, 429), 'essai'),
    /quota dépassé/,
  )
})

test('une réponse illisible lève sans faire croire à un maillon muet', async () => {
  await assert.rejects(
    () => lireOpenAI(reponse('<html>503 Service Unavailable</html>'), 'essai'),
    /illisible/,
  )
})

test('les compteurs absents valent 0, pas undefined', async () => {
  // Un NaN dans le total de jetons rendrait le bilan de coût illisible.
  const r = await lireOpenAI(reponse({ choices: [{ message: { content: 'ok' } }] }), 'essai')
  assert.equal(r.inputTokens, 0)
  assert.equal(r.outputTokens, 0)
})
