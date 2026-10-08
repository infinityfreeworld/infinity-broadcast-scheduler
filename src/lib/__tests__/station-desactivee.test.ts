/**
 * 08/10/2026 — Station DÉSACTIVÉE dans l'IHL (`active: false` du kind 30091, réversible) : la nuit ne
 * la fabrique pas. Seul un administrateur radio désactive ; seule une fiche signée depuis la date butoir
 * `RADIO_FICHE_COMPLETE_DEPUIS` compte ; une fiche plus récente sans le champ réactive.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import {
  ficheDesactivee, stationsDesactiveesIHL, stationsAFabriquer, stationAjoutee, KIND_RADIO_STATION,
  FICHE_COMPLETE_DEPUIS_DEFAUT,
} from '../station-reglages'
import { SEED_STATIONS } from '../../data/seed-stations'
import type { Event as NostrEvent } from 'nostr-tools/core'

const ADMIN = 'a'.repeat(64)
const INCONNU = 'b'.repeat(64)
const ADMINS = new Set([ADMIN])
const APRES = FICHE_COMPLETE_DEPUIS_DEFAUT + 86_400        // le 08/10/2026 et après
const AVANT = FICHE_COMPLETE_DEPUIS_DEFAUT - 86_400
const pirate = SEED_STATIONS.find(s => s.id === 'pirate-radio')!
const HOTE = { id: 'ranouna', name: 'Ranouna', gender: 'male', trait: 'showman', color: '#888888', avatar: '🎙️' }

let n = 0
const fiche = (id: string, contenu: object, created_at = APRES, pubkey = ADMIN): NostrEvent => ({
  id: `${(n++).toString(16).padStart(64, '0')}`, kind: KIND_RADIO_STATION, pubkey, created_at,
  tags: [['d', id]], content: JSON.stringify(contenu), sig: 's',
})

test('ficheDesactivee : seul `active: false` désactive ; absent, true, "false", illisible = active', () => {
  assert.equal(ficheDesactivee(fiche('x', { active: false })), true)
  for (const v of [undefined, true, 'false', 0, null]) assert.equal(ficheDesactivee(fiche('x', { active: v })), false, String(v))
  assert.equal(ficheDesactivee({ ...fiche('x', {}), content: '{' }), false)
  assert.equal(ficheDesactivee(null), false)
  assert.equal(ficheDesactivee(fiche('x', { deleted: true, active: false })), false, 'une pierre tombale n’est pas une désactivation')
})

test('date butoir : une désactivation publiée APRÈS le 07/10/2026 s’applique, une fiche antérieure non', () => {
  assert.equal(ficheDesactivee(fiche('x', { active: false }, APRES)), true)
  assert.equal(ficheDesactivee(fiche('x', { active: false }, FICHE_COMPLETE_DEPUIS_DEFAUT)), true, 'le jour même compte')
  assert.equal(ficheDesactivee(fiche('x', { active: false }, AVANT)), false)
})

test('stationsDesactiveesIHL : fiche la plus récente d’un ADMIN ; un inconnu ne désactive rien ; réversible', () => {
  const ids = SEED_STATIONS.map(s => s.id)
  assert.deepEqual(stationsDesactiveesIHL([fiche('pirate-radio', { active: false })], ADMINS, ids).map(d => d.id), ['pirate-radio'])
  assert.deepEqual(stationsDesactiveesIHL([fiche('pirate-radio', { active: false }, APRES, INCONNU)], ADMINS, ids), [])
  const reactivee = [fiche('pirate-radio', { active: false }, APRES), fiche('pirate-radio', { name: 'Radio Pirate' }, APRES + 60)]
  assert.deepEqual(stationsDesactiveesIHL(reactivee, ADMINS, ids), [], 'une fiche plus récente sans le champ la réactive')
  const redesactivee = [...reactivee, fiche('pirate-radio', { active: false }, APRES + 120)]
  assert.deepEqual(stationsDesactiveesIHL(redesactivee, ADMINS, ids).map(d => d.id), ['pirate-radio'])
  assert.match(stationsDesactiveesIHL(redesactivee, ADMINS, ids)[0].le, /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/)
})

test('stationsAFabriquer : la station désactivée n’est PAS fabriquée, les autres si', () => {
  const nuit = stationsAFabriquer(SEED_STATIONS, [], [{ id: 'pirate-radio' }])
  assert.equal(nuit.some(s => s.id === 'pirate-radio'), false)
  assert.equal(nuit.length, SEED_STATIONS.length - 1)
  assert.equal(stationsAFabriquer(SEED_STATIONS, [], []).length, SEED_STATIONS.length)
})

test('station AJOUTÉE dans l’IHL et désactivée : écartée, motif dit', () => {
  const contenu = { kind: 'user', frequency: 143.3, name: 'Radio Test', language: 'fr', hosts: [HOTE] }
  assert.ok(stationAjoutee(fiche('radio-test', contenu), SEED_STATIONS).station, 'active : fabriquée')
  const r = stationAjoutee(fiche('radio-test', { ...contenu, active: false }), SEED_STATIONS)
  assert.equal(r.station, null)
  assert.match(r.motif ?? '', /désactivée/)
})

test('la nuit et la matrice GitHub écartent les stations désactivées (garde de câblage)', () => {
  const sansCommentaires = (f: string) => readFileSync(new URL(f, import.meta.url), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
  const nuit = sansCommentaires('../../scripts/generate-all.ts')
  assert.match(nuit, /const STATIONS_NUIT = stationsAFabriquer\(SEED_STATIONS, ajoutees, fiches\.desactivees\)/)
  assert.match(nuit, /désactivée dans l'IHL/)
  assert.match(sansCommentaires('../../scripts/lister-stations.ts'), /ids = ids\.filter\(i => !off\.has\(i\)\)/)
  assert.match(sansCommentaires('../../scripts/generate-broadcast.ts'), /await stationDesactiveeSelonIHL\(stationId\)/)
  void pirate
})
