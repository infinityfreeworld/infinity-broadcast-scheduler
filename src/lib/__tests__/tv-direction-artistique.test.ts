/**
 * @module InfinityScheduler/TV/DirectionArtistique/Tests
 * @description 🎨 « Quand le journal parle des assemblées, on voit des assemblées conventionnelles
 *   dans des bâtiments conventionnels » — Bâtisseur, 11/09/2026. Relevé le 10/09 : « Modern
 *   newsroom studio », « democratic assembly, hands raised ».
 *
 *   Lancer :  npx tsx --test src/lib/__tests__/tv-direction-artistique.test.ts
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import {
  habillerPrompt, indicesConventionnels, recadrerScene, STYLE_INFINITY, LONGUEUR_MAX_CONSIGNE, CHARTE_VISUELLE,
} from '../tv-direction-artistique'

test('⭐ chaque consigne part habillée du style d’Infinity, la scène en tête', () => {
  const p = habillerPrompt('hundreds of people planting trees together, aerial wide shot')
  assert.ok(p.startsWith('hundreds of people planting trees'))
  assert.ok(p.endsWith(STYLE_INFINITY))
})

test('⭐ un nouvel essai n’empile pas le style deux fois', () => {
  const une = habillerPrompt('community garden')
  assert.equal(habillerPrompt(une), une)
})

test('la longueur est bornée en rognant la scène, jamais le style', () => {
  const p = habillerPrompt('x'.repeat(2000))
  assert.ok(p.length <= LONGUEUR_MAX_CONSIGNE)
  assert.ok(p.endsWith(STYLE_INFINITY))
})

test('⭐ les consignes relevées le 10/09 sont signalées comme conventionnelles', () => {
  assert.deepEqual(indicesConventionnels('Modern newsroom studio, green and warm lighting'), ['newsroom'])
  assert.deepEqual(indicesConventionnels('Diverse group of people in democratic assembly, hands raised'), ['assembly'])
  assert.ok(indicesConventionnels('A protest with placards and police').length >= 3)
  assert.deepEqual(indicesConventionnels('people gathered in a wide circle in a forest clearing'), [])
})

test('⭐ la charte dit où se tient une Assemblée : en cercle, dans la nature ou une architecture écologique', () => {
  assert.match(CHARTE_VISUELLE, /EN\s+CERCLE/)
  assert.match(CHARTE_VISUELLE, /clairière/)
  assert.match(CHARTE_VISUELLE, /architecture écologique futuriste/)
})

test('⭐ la charte dit ce qu’est une Manifestaction : une action massive pour le vivant, pas un défilé', () => {
  assert.match(CHARTE_VISUELLE, /ACTION MASSIVE ET COORDONNÉE POUR LE VIVANT/)
  assert.match(CHARTE_VISUELLE, /besoins vitaux/)
  assert.match(CHARTE_VISUELLE, /Ce n'est PAS une manifestation de rue/)
})

test('⭐ la charte est bien donnée au conducteur, et le style bien ajouté à l’envoi', () => {
  const conducteur = readFileSync(new URL('../tv-conductor.ts', import.meta.url), 'utf8')
  assert.match(conducteur, /\$\{CHARTE_VISUELLE\}/)
  const generateur = readFileSync(new URL('../../scripts/generate-tv-program.ts', import.meta.url), 'utf8')
  assert.match(generateur, /generateImage\(habillerPrompt\(s\.imagePrompt\)/)
})

test('la charte ne contient aucun accent grave (elle est injectée dans un gabarit de chaîne)', () => {
  assert.ok(!CHARTE_VISUELLE.includes('`'))
})

test('⭐ l’assemblée du 10/09 est RECADRÉE en cercle dans une clairière — le style seul ne la déplaçait pas', () => {
  const p = habillerPrompt('Diverse group of people in democratic assembly, hands raised')
  assert.doesNotMatch(p, /assembly/i)
  assert.match(p, /wide circle in a sunlit forest clearing/)
  assert.match(p, /hands raised/, 'le reste de la scène est conservé')
})

test('⭐ la salle de presse du 10/09 devient un plateau dans un jardin', () => {
  const p = habillerPrompt('Modern newsroom studio, green and warm lighting, minimalist')
  assert.doesNotMatch(p, /newsroom/i)
  assert.match(p, /^open-air broadcast set in a lush garden/)
})

test('⭐ une manifestation de rue devient une action collective pour le vivant, sans police', () => {
  const p = recadrerScene('Protesters marching with placards, riot police watching')
  assert.doesNotMatch(p, /protest|placard|police|riot/i)
  assert.match(p, /joyful crowd acting together for the living/)
  assert.doesNotMatch(p, /,\s*,|^,|,$/, 'ponctuation propre après retrait')
})

test('une scène déjà juste n’est pas touchée', () => {
  const juste = 'hundreds of people planting trees together, aerial wide shot'
  assert.equal(recadrerScene(juste), juste)
})
