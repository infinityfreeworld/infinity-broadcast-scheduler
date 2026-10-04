/** La ligne « Mots anglais non couverts » du journal de la nuit (04/10/2026). */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { ligneMotsAnglaisNonCouverts } from '../releve-anglais'

test('liste les mots anglais hors dictionnaire, sur le texte nettoyé, une fois chacun', () => {
  assert.equal(
    ligneMotsAnglaisNonCouverts(['Un **feeling** sweet *rit*', 'Encore ce feeling, et la wheel. Breaking news !'], 'fr'),
    'Mots anglais non couverts : feeling, sweet, wheel',
  )
})

test('dit « aucun » quand tout est couvert, et rien hors station française', () => {
  assert.equal(ligneMotsAnglaisNonCouverts(['Le cloud et le live, sur Infiniti tiret Friwourld point com.'], 'fr'), 'Mots anglais non couverts : aucun')
  assert.equal(ligneMotsAnglaisNonCouverts(['A feeling so sweet'], 'en'), null)
})

test('le générateur l’imprime en fin d’émission', () => {
  const src = readFileSync(new URL('../../scripts/generate-broadcast.ts', import.meta.url), 'utf8')
  assert.match(src, /ligneMotsAnglaisNonCouverts\(plansVoix\.map\(p => p\.texte\), language\)/)
})
