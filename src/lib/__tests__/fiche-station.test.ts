/** Ce que la fiche IHL change à l'écriture : rythme, raison d'être, part d'actualité, appels. */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  rythmeEffectif, tenueEffective, ligneEditoriale, actualitesVoulues, toursActualite, consigneActualite, appelsDuJour,
} from '../fiche-station'
import { DEFAULT_RHYTHM, DEFAULT_BEHAVIOR, type PulseSnapshot } from '../pulse'
import { buildHostSystemPrompt, buildGuestSystemPrompt } from '../personas'
import type { RythmeStation, RadioHost } from '../types'

const VIDE: PulseSnapshot = { global: null, byStation: {}, byPersona: {} }
const RYTHME: RythmeStation = {
  dialogueDensity: 90, interventionRate: 'rare', averageSegmentSec: 45, globalMood: 'didactique',
  verbosity: 'concise', interruptionTendency: 80, contradictionPropensity: 10,
}
const PULSE: PulseSnapshot = {
  global: {
    rhythm: { dialogueDensity: 20, interventionRate: 'normal', averageSegmentSec: 120, globalMood: 'chaotique' },
    behavior: { verbosity: 'verbose', interruptionTendency: 5, contradictionPropensity: 95 },
  },
  byStation: { s: { dialogueDensity: 50, interventionRate: 'frenetic', averageSegmentSec: 60, globalMood: 'analytique' } },
  byPersona: { 'host:s:h': { verbosity: 'normal', interruptionTendency: 50, contradictionPropensity: 50 } },
}

test('rythme : station → ancien Pulse station → Pulse global → défauts', () => {
  assert.equal(rythmeEffectif({ id: 's', rythme: RYTHME }, PULSE).rhythm.globalMood, 'didactique')
  assert.equal(rythmeEffectif({ id: 's', rythme: RYTHME }, PULSE).origine, 'station')
  assert.equal(rythmeEffectif({ id: 's' }, PULSE).origine, 'pulse-station')
  assert.equal(rythmeEffectif({ id: 'autre' }, PULSE).origine, 'pulse-global')
  const d = rythmeEffectif({ id: 's' }, VIDE)
  assert.deepEqual(d.rhythm, DEFAULT_RHYTHM); assert.equal(d.actif, false, 'rien de réglé : prompt d’avant')
  assert.equal(rythmeEffectif({ id: 's', rythme: RYTHME }, VIDE).actif, true, 'la fiche seule suffit à l’activer')
})

test('tenue : persona (30103) → station → Pulse global → défauts', () => {
  assert.equal(tenueEffective('host:s:h', { rythme: RYTHME }, PULSE).verbosity, 'normal', 'le réglage propre de la persona gagne')
  assert.deepEqual(tenueEffective('host:s:x', { rythme: RYTHME }, PULSE), { verbosity: 'concise', interruptionTendency: 80, contradictionPropensity: 10 })
  assert.equal(tenueEffective('host:s:x', {}, PULSE).verbosity, 'verbose')
  assert.deepEqual(tenueEffective('host:s:x', {}, VIDE), DEFAULT_BEHAVIOR)
})

test('part d’actualité : nombre de tours exact, répartis, et déterministe', () => {
  assert.equal(toursActualite(undefined, 22).size, 22, 'sans réglage : comme avant')
  assert.equal(toursActualite(0, 22).size, 0)
  assert.equal(toursActualite(100, 22).size, 22)
  assert.equal(toursActualite(50, 22).size, 11)
  assert.equal(toursActualite(25, 20).size, 5)
  const t = [...toursActualite(30, 20)].sort((a, b) => a - b)
  assert.equal(t.length, 6)
  for (let k = 1; k < t.length; k++) assert.ok(t[k] - t[k - 1] >= 3, `réparti, pas groupé : ${t}`)
  assert.deepEqual([...toursActualite(30, 20)], [...toursActualite(30, 20)])
})

test('part d’actualité : 0 = pas même de récupération ; consignes par tour', () => {
  assert.equal(actualitesVoulues({ actualite: { part: 0 } }), false)
  assert.equal(actualitesVoulues({ actualite: { part: 1 } }), true)
  assert.equal(actualitesVoulues({}), true)
  assert.equal(consigneActualite(undefined, true, true), undefined, 'sans réglage : prompt d’avant')
  assert.match(consigneActualite(0, false, false)!, /ne traite PAS l'actualité/)
  assert.match(consigneActualite(100, true, true)!, /INFORMATION/)
  assert.match(consigneActualite(40, false, true)!, /40 %[\s\S]*thème propre/)
  assert.match(consigneActualite(40, true, true)!, /pars d'une des actualités/)
  assert.match(consigneActualite(40, true, false)!, /aucune n'a pu être récupérée/)
})

test('appels du jour : un jour sur N, déterministe, 0 si coupés', () => {
  const st = { id: 'pirate-radio' }
  const r = { actifs: true, nombre: 2, tousLesNJours: 3 }
  const jours = Array.from({ length: 30 }, (_, k) => new Date(Date.UTC(2026, 9, 1 + k)).toISOString().slice(0, 10))
  const n = jours.map(d => appelsDuJour(r, st, d))
  assert.equal(n.filter(x => x === 2).length, 10, 'exactement un jour sur trois')
  assert.ok(n.every(x => x === 0 || x === 2))
  for (let k = 3; k < n.length; k++) assert.equal(n[k], n[k - 3], 'période de 3 jours')
  assert.deepEqual(jours.map(d => appelsDuJour(r, st, d)), n, 'déterministe')
  assert.equal(appelsDuJour({ ...r, tousLesNJours: 1 }, st, '2026-10-07'), 2, 'tous les jours')
  assert.equal(appelsDuJour({ ...r, actifs: false }, st, '2026-10-07'), 0)
  assert.equal(appelsDuJour(undefined, st, '2026-10-07'), 0)
  assert.equal(appelsDuJour(r, st, 'demain'), 0)
})

const HOTE: RadioHost = { id: 'h', name: 'Hex', gender: 'female', trait: 'hackeuse', color: '#000', avatar: '🐍' }

test('raison d’être : elle entre dans le prompt des animateurs ET des invités', () => {
  const ligne = ligneEditoriale({ name: 'Radio Pirate', tagline: 'Le code est libre', description: 'Défendre le logiciel libre.' })!
  assert.match(ligne, /Défendre le logiciel libre\./)
  assert.match(ligne, /Le code est libre/)
  assert.equal(ligneEditoriale({ name: 'X', tagline: 't' }), undefined, 'sans description : rien')
  const hote = buildHostSystemPrompt({
    host: HOTE, kb: { hostId: 'h', stationId: 's', personality: '', entries: [], updatedAt: 0 }, selectedEntries: [],
    stationName: 'Radio Pirate', language: 'fr', otherHosts: [], ligneEditoriale: ligne,
    consigneActualite: consigneActualite(0, false, false),
  })
  assert.match(hote, /# LIGNE ÉDITORIALE DE LA STATION\nDéfendre le logiciel libre\./)
  assert.match(hote, /# PART DE L'ACTUALITÉ\nCette station ne traite PAS/)
  const invite = buildGuestSystemPrompt({
    guest: { displayName: 'G', gender: 'male', bio: 'b', instructions: 'i', behavior: 'neutral' },
    stationName: 'Radio Pirate', language: 'fr', hostsRecap: 'Hex', behaviorDirective: 'd', ligneEditoriale: ligne,
  })
  assert.match(invite, /# LIGNE ÉDITORIALE DE LA STATION\nDéfendre le logiciel libre\./)
  const sans = buildHostSystemPrompt({
    host: HOTE, kb: { hostId: 'h', stationId: 's', personality: '', entries: [], updatedAt: 0 }, selectedEntries: [],
    stationName: 'Radio Pirate', language: 'fr', otherHosts: [],
  })
  assert.doesNotMatch(sans, /LIGNE ÉDITORIALE|PART DE L'ACTUALITÉ/, 'sans fiche : prompt d’avant')
})
