import { test as it } from 'node:test'
import assert from 'node:assert/strict'
import { prononcerNomsInfinity } from '../prononciation-noms'
import { frenchifyEnglishWords } from '../frenchify-english'
import { textePourVoixPiper } from '../piper'

// Les noms d’Infinity dits par une voix française (Med, 12/10/2026).
it('OBF est épelé, sans point ni tiret à lire', () => {
  assert.equal(prononcerNomsInfinity('vous êtes sur OBF — la station qui veille'), 'vous êtes sur Ô Bé Èf — la station qui veille')
  assert.equal(prononcerNomsInfinity('une alerte OBF, puis OBF.'), 'une alerte Ô Bé Èf, puis Ô Bé Èf.')
})
it('seulement le sigle : ni « obf » en minuscules, ni un mot qui le contient', () => {
  assert.equal(prononcerNomsInfinity('obf OBFX XOBF'), 'obf OBFX XOBF')
})
it('Biogame : « game » à l’anglaise, pluriel et variantes', () => {
  assert.equal(prononcerNomsInfinity('Un Biogame, des biogames, le Bio-Game'), 'Un Bio-guéïme, des bio-guéïmes, le Bio-guéïme')
})
it('idempotent, et le dictionnaire anglais ne le défait pas', () => {
  const une = prononcerNomsInfinity('Biogame et OBF')
  assert.equal(prononcerNomsInfinity(une), une)
  assert.ok(frenchifyEnglishWords(une).includes('guéïme'))
  assert.ok(frenchifyEnglishWords(une).includes('Ô Bé Èf'))
})
it('appliqué aux voix Piper françaises, pas aux autres', () => {
  assert.ok(textePourVoixPiper('Bienvenue sur OBF', 'fr_FR-siwis-medium').includes('Ô Bé Èf'))
  assert.ok(textePourVoixPiper('Welcome to OBF', 'en_US-lessac-medium').includes('OBF'))
})
it('« euh » allongé pour la voix clonée (elle avalait « euh… »), mot entier seulement', async () => {
  const { hesitationsAudibles } = await import('../disfluences')
  assert.equal(hesitationsAudibles('Euh… Gnu, euh, tu vois'), 'Eeeuh… Gnu, eeeuh, tu vois')
  assert.equal(hesitationsAudibles('peuh, heuh'), 'peuh, heuh')
  assert.ok(frenchifyEnglishWords(hesitationsAudibles('Euh… bon')).startsWith('Eeeuh'))
})
