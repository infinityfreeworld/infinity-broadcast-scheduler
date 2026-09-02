/**
 * @module InfinityScheduler/Lib/VerifierVoix/Tests
 * @description Le nom demandé sur le fil est la SEULE chose qui compte.
 *
 *   02/09/2026, en préparant l'essai avec data-space : `pirate-radio`
 *   demandait la voix « alain ». Le catalogue contient « alain-morale ».
 *   Notre client aurait demandé « alain.wav » → `404 voice_not_found`.
 *
 *   🔴 Le défaut n'était visible d'AUCUN côté pris séparément. Notre
 *   configuration est cohérente avec elle-même ; leur catalogue est
 *   complet. C'est la COUTURE entre les deux qui était fausse — il
 *   fallait confronter les deux listes pour qu'elle apparaisse.
 *
 *   Lancer : npx tsx --test src/lib/__tests__/verifier-voix.test.ts
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { nomDemande } from '../voix-catalogue'

const SRC_LIB = new URL('../voix-catalogue.ts', import.meta.url)
const SRC_SCRIPT = new URL('../../scripts/verifier-voix.ts', import.meta.url)

test('le nom demandé porte toujours .wav — la forme du catalogue', () => {
  assert.equal(nomDemande('alain-morale'), 'alain-morale.wav')
  assert.equal(nomDemande('ranouna'), 'ranouna.wav')
})

test('un nom déjà suffixé n\'est pas doublé', () => {
  // « ranouna.wav.wav » serait introuvable, et l'échec ressemblerait à un
  // service en panne plutôt qu'à une coquille.
  assert.equal(nomDemande('ranouna.wav'), 'ranouna.wav')
})

test('🔴 le cas réel : « alain » ne devient PAS « alain-morale »', () => {
  // Le suffixe ne rattrape rien. C'est exactement pourquoi la
  // confrontation des deux listes est nécessaire : aucune normalisation
  // de notre côté ne peut deviner le nom déclaré du leur.
  assert.equal(nomDemande('alain'), 'alain.wav')
  assert.notEqual(nomDemande('alain'), 'alain-morale.wav')
})

test('un catalogue VIDE est un échec, jamais « rien à vérifier »', () => {
  // Sans ce refus, l'outil rendrait tout vert dans l'état exact où
  // TOUTE synthèse échoue — le pire des faux verts.
  const src = readFileSync(SRC_LIB, 'utf8')
  assert.match(src, /catalogue VIDE/)
  assert.ok(
    /noms\.length === 0.*\n?.*throw|if \(noms\.length === 0\) throw/.test(src),
    'un catalogue vide doit LEVER, pas rendre un ensemble vide',
  )
})

test('une voix manquante fait sortir en ÉCHEC, pas en avertissement', () => {
  // Un avertissement dans un journal de CI ne se lit pas. Seul un code de
  // sortie non nul arrête la nuit avant la diffusion.
  const src = readFileSync(SRC_SCRIPT, 'utf8')
  assert.match(src, /manquantes > 0[\s\S]{0,400}process\.exit\(1\)/)
})
