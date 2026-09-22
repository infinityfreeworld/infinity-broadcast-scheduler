/**
 * 22/09/2026 — trois compléments approuvés par le fondateur :
 *   · une voix absente du catalogue mais avec UN homonyme (« alain » → « alain-morale ») est retenue ;
 *   · l'ident d'antenne en voix d'animateur, dans la langue de la station ;
 *   · le maillon LLM souverain (data-space), hors course tant qu'on ne l'enrôle pas.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { aliasDeVoix, lireCorpsErreur } from '../chatterbox'
import { phraseIdent, PHRASES_IDENT } from '../idents'
import { maillons } from '../llm'

test('🔴 « alain » absent, « alain-morale.wav » seul homonyme → retenu ; deux homonymes → personne ne choisit', () => {
  const cat = ['alain-morale.wav', 'andre-le-crapeau.wav', 'inv-pi-hex.wav']
  assert.equal(aliasDeVoix('alain', cat), 'alain-morale.wav')
  assert.equal(aliasDeVoix('alain.wav', cat), 'alain-morale.wav')
  assert.equal(aliasDeVoix('inv-pi-hex', cat), 'inv-pi-hex.wav', 'le nom exact passe tel quel')
  assert.equal(aliasDeVoix('alain', [...cat, 'alain-fache.wav']), null, 'deux candidates : aucune')
  assert.equal(aliasDeVoix('zoe', cat), null)
  assert.equal(aliasDeVoix('', cat), null)
  assert.equal(aliasDeVoix('andre', cat), 'andre-le-crapeau.wav', 'préfixe « andre- », seule candidate')
})

test('le 404 voice_not_found livre son catalogue', () => {
  const r = lireCorpsErreur(JSON.stringify({ error: { code: 'voice_not_found', voice: 'alain.wav' }, voices: ['alain-morale.wav', 7, 'x.wav'] }))
  assert.equal(r.code, 'voice_not_found')
  assert.deepEqual(r.voices, ['alain-morale.wav', 'x.wav'])
  assert.equal(lireCorpsErreur('{}').voices, undefined)
})

test('l’ident parle la langue de la station, et nomme la station', () => {
  assert.equal(phraseIdent('fr', 'Radio Pirate', 'ouverture'), 'Vous écoutez Radio Pirate.')
  assert.equal(phraseIdent('en', 'Free Press FM', 'fermeture'), 'That was Free Press FM. Stay with us.')
  assert.equal(phraseIdent('zh', '自由之声', 'ouverture'), '您正在收听自由之声。')
  assert.equal(phraseIdent(undefined, 'X', 'ouverture'), 'Vous écoutez X.', 'sans langue : français')
  assert.equal(phraseIdent('it', 'X', 'ouverture'), 'Vous écoutez X.', 'langue inconnue : français')
  for (const [l, p] of Object.entries(PHRASES_IDENT)) { assert.match(p.ouverture, /\{n\}/, l); assert.match(p.fermeture, /\{n\}/, l) }
})

test('les idents ne passent QUE sans jingle déposé, et ne bloquent jamais', () => {
  const gb = readFileSync('src/scripts/generate-broadcast.ts', 'utf8')
  assert.match(gb, /const idents = jingles\.length === 0 \? await identsDeStation\(/)
  const id = readFileSync('src/lib/idents.ts', 'utf8')
  assert.match(id, /if \(process\.env\.IDENTS === 'false'\) return \{ ouverture: null, fermeture: null \}/)
  assert.match(id, /catch \(err\) \{\s*console\.warn\(`\s*⚠ ident en voix de/)
})

test('🔴 le LLM souverain est HORS COURSE par défaut, enrôlé par DATASPACE_LLM_ORDRE', () => {
  const sauve = process.env.DATASPACE_LLM_ORDRE
  try {
    delete process.env.DATASPACE_LLM_ORDRE
    const noms = maillons().map(m => m.nom)
    assert.deepEqual(noms, ['mistral', 'passerelle-hl', 'anthropic', 'data-space'])
    assert.match(maillons().find(m => m.nom === 'data-space')!.indisponible() ?? '', /hors course/)
    process.env.DATASPACE_LLM_ORDRE = 'avant-anthropic'
    assert.deepEqual(maillons().map(m => m.nom), ['mistral', 'passerelle-hl', 'data-space', 'anthropic'])
    process.env.DATASPACE_LLM_ORDRE = 'premier'
    assert.equal(maillons()[0].nom, 'data-space')
  } finally {
    if (sauve === undefined) delete process.env.DATASPACE_LLM_ORDRE; else process.env.DATASPACE_LLM_ORDRE = sauve
  }
})
