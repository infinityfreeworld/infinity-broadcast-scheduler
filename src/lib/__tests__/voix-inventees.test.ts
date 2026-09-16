/**
 * @module InfinityScheduler/Lib/Chatterbox/VoixInventeesTests
 * @description 🎙️ L'ordre de choix d'une voix d'animateur — décision du fondateur (14/09/2026) :
 *   des voix INVENTÉES par défaut, et « pouvoir remplacer les voix à tout moment » depuis l'admin.
 *
 *   Lancer :  npx tsx --test src/lib/__tests__/voix-inventees.test.ts
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { resoudreVoix } from '../chatterbox'
import { VOIX_INVENTEES, voixInventee, ANIMATEURS_SANS_VOIX_INVENTEE } from '../../data/voix-inventees'
import { SEED_STATIONS } from '../../data/seed-stations'

test('⭐ le choix fait dans l’ADMIN passe devant la voix inventée (remplacer à tout moment)', () => {
  assert.equal(resoudreVoix({ admin: 'ma-voix', inventee: 'inv-cyril' }, 'fr'), 'ma-voix')
})

test('sans choix dans l’admin, la voix INVENTÉE répond', () => {
  assert.equal(resoudreVoix({ admin: null, inventee: 'inv-cyril', defaut: 'Abigail' }, 'fr'), 'inv-cyril')
})

test('⭐ une voix anglaise de l’ère Hugging Face ne BLOQUE plus l’animateur : elle est sautée', () => {
  // Le 14/09 : 23 attributions « Abigail, Alice, Cora… » sur des stations FR → 0/33 en voix clonée.
  assert.equal(resoudreVoix({ admin: 'Abigail', inventee: 'inv-marina' }, 'fr'), 'inv-marina')
})

test('… mais reste valable sur une station ANGLAISE', () => {
  assert.equal(resoudreVoix({ admin: 'Abigail', inventee: 'inv-sarah' }, 'en'), 'Abigail')
})

test('la carte legacy garde sa place, entre l’admin et la voix inventée', () => {
  assert.equal(resoudreVoix({ carteLegacy: 'legacy', inventee: 'inv' }, 'fr'), 'legacy')
})

test('rien d’utilisable → null (Piper), comme avant', () => {
  assert.equal(resoudreVoix({ admin: 'Alice', defaut: 'Abigail' }, 'fr'), null)
  assert.equal(resoudreVoix({}, 'fr'), null)
})

test('⭐ chaque animateur des radios a SA voix inventée — ni oubli, ni animateur fantôme', () => {
  // Remplie le 14/09/2026 APRÈS le dépôt des 31 références au catalogue (workflow deposer-voix) :
  // une voix absente du catalogue rendrait 404 voice_not_found, puis Piper.
  // Un animateur sans voix inventée doit être DÉCLARÉ en attente, jamais oublié ;
  // et la liste d'attente ne peut nommer ni un animateur inexistant, ni un déjà servi.
  const tous = SEED_STATIONS.flatMap(s => s.hosts.map(h => `${s.id}:${h.id}`))
  const enAttente = new Set(ANIMATEURS_SANS_VOIX_INVENTEE)
  for (const cle of enAttente) {
    assert.ok(tous.includes(cle), `en attente mais inexistant : ${cle}`)
    assert.ok(!(cle in VOIX_INVENTEES), `en attente ET servi : ${cle}`)
  }
  const attendues = tous.filter(c => !enAttente.has(c)).sort()
  assert.deepEqual(Object.keys(VOIX_INVENTEES).sort(), attendues)
})

test('le nom au catalogue est inv-<animateur>, sans .wav (le client l’ajoute)', () => {
  for (const [cle, nom] of Object.entries(VOIX_INVENTEES)) assert.equal(nom, `inv-${cle.split(':')[1]}`, cle)
  assert.equal(voixInventee('wtf-radio', 'wtf-cyril'), 'inv-wtf-cyril')
  assert.equal(voixInventee('wtf-radio', 'animateur-inconnu'), undefined)
})

test('getChatterboxVoiceForHost passe bien par resoudreVoix, l’admin en premier', () => {
  const src = readFileSync(new URL('../chatterbox.ts', import.meta.url), 'utf8')
  const corps = src.slice(src.indexOf('export function getChatterboxVoiceForHost'), src.indexOf('export interface SourcesVoix'))
  assert.match(corps, /return resoudreVoix\(\{\s*admin: getNostrVoiceForHost\(stationId, hostId\)/)
  assert.match(corps, /inventee: voixInventee\(stationId, hostId\)/)
})
