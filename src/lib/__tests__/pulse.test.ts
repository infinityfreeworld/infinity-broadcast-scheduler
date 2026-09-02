/**
 * @module InfinityScheduler/Lib/Pulse/Tests
 * @description Le kind 30101 est un espace PARTAGÉ. Ces tests fixent la
 *   frontière entre « config Pulse Infinity » et « event d'une autre
 *   application », avec des charges utiles RÉELLES relevées sur nos.lol
 *   le 2026-09-01.
 *
 *   Lancer :  npx tsx --test src/lib/__tests__/pulse.test.ts
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  parseRhythmStrict, parseBehaviorStrict,
  rhythmDirective, behaviorPulseDirective, guestSlotsForRate,
  DEFAULT_RHYTHM, DEFAULT_BEHAVIOR,
} from '../pulse'

// ── Charges utiles réelles d'AUTRES applications sur les mêmes kinds ──

/** Relevé sur nos.lol, kind:30101, pubkey 9ce3b537bb — un jeu. */
const MATCH_HELLO = {
  type: 'MatchHello',
  matchId: 'fa07d3bb49104d28b06a8911c9abf045',
  seq: 0,
  senderId: '9ce3b537bb992f545d6f21e2609342124f99f330c3361efde8d6c25fca92a6c5',
  sentAt: 1788200000,
}

/** Relevé sur nos.lol, kind:30102 — une location de véhicules. */
const VEHICLE_RENTAL = {
  vehicleName: 'Honda city',
  vehicleType: 'bike',
  pricePerDay: 900,
  discountedPrice: 500,
}

/** Config Pulse authentique, telle que `pulseConfigToTemplate` la produit. */
const VRAIE_CONFIG = {
  dialogueDensity: 80,
  interventionRate: 'frenetic',
  averageSegmentSec: 45,
  globalMood: 'chaotique',
  verbosity: 'concise',
  interruptionTendency: 90,
  contradictionPropensity: 75,
  updatedAt: 1788300000000,
}

test('un event d\'une autre application est REJETÉ, pas parsé en défauts', () => {
  // Le cœur du défaut évité : le codec du navigateur, lui, retomberait
  // champ par champ sur DEFAULT_PULSE_CONFIG et rendrait une config
  // « valide » à partir de ça.
  assert.equal(parseRhythmStrict(MATCH_HELLO), null)
  assert.equal(parseBehaviorStrict(MATCH_HELLO), null)
  assert.equal(parseRhythmStrict(VEHICLE_RENTAL), null)
  assert.equal(parseBehaviorStrict(VEHICLE_RENTAL), null)
  assert.equal(parseRhythmStrict({}), null)
})

test('une vraie config Pulse est acceptée, valeurs conservées', () => {
  const r = parseRhythmStrict(VRAIE_CONFIG)
  assert.deepEqual(r, {
    dialogueDensity: 80, interventionRate: 'frenetic',
    averageSegmentSec: 45, globalMood: 'chaotique',
  })
  const b = parseBehaviorStrict(VRAIE_CONFIG)
  assert.deepEqual(b, {
    verbosity: 'concise', interruptionTendency: 90, contradictionPropensity: 75,
  })
})

test('un seul champ manquant ou d\'un mauvais type suffit à rejeter', () => {
  for (const champ of ['dialogueDensity', 'interventionRate', 'averageSegmentSec', 'globalMood']) {
    const sans: Record<string, unknown> = { ...VRAIE_CONFIG }
    delete sans[champ]
    assert.equal(parseRhythmStrict(sans), null, `champ retiré : ${champ}`)
  }
  // Type faux : une densité passée en chaîne (piège classique du JSON).
  assert.equal(parseRhythmStrict({ ...VRAIE_CONFIG, dialogueDensity: '80' }), null)
  // Valeur hors énumération.
  assert.equal(parseRhythmStrict({ ...VRAIE_CONFIG, globalMood: 'sarcastique' }), null)
  assert.equal(parseBehaviorStrict({ ...VRAIE_CONFIG, verbosity: 'court' }), null)
  // NaN passe `typeof === 'number'` mais n'est pas un réglage.
  assert.equal(parseBehaviorStrict({ ...VRAIE_CONFIG, interruptionTendency: NaN }), null)
})

test('les bornes du navigateur sont respectées (clamp, pas rejet)', () => {
  const r = parseRhythmStrict({ ...VRAIE_CONFIG, dialogueDensity: 999, averageSegmentSec: 5 })
  assert.equal(r?.dialogueDensity, 100)     // borné à 100
  assert.equal(r?.averageSegmentSec, 30)    // borné au plancher 30
})

test('les directives changent vraiment de texte selon les réglages', () => {
  // Une directive qui ne bougerait pas serait un réglage inerte.
  const chaotique = rhythmDirective({ ...DEFAULT_RHYTHM, globalMood: 'chaotique' })
  const didactique = rhythmDirective({ ...DEFAULT_RHYTHM, globalMood: 'didactique' })
  assert.notEqual(chaotique, didactique)

  const dense = rhythmDirective({ ...DEFAULT_RHYTHM, dialogueDensity: 90 })
  const aere  = rhythmDirective({ ...DEFAULT_RHYTHM, dialogueDensity: 10 })
  assert.notEqual(dense, aere)
  assert.match(dense, /DENSE/)
  assert.match(aere,  /AÉRÉ/)

  // La durée de segment doit APPARAÎTRE dans le texte, sinon le curseur
  // « durée moyenne » ne servirait à rien.
  assert.match(rhythmDirective({ ...DEFAULT_RHYTHM, averageSegmentSec: 137 }), /137/)
})

test('le comportement extrême produit des consignes distinctes', () => {
  const coupeur = behaviorPulseDirective({
    verbosity: 'concise', interruptionTendency: 95, contradictionPropensity: 95,
  })
  const poli = behaviorPulseDirective({
    verbosity: 'verbose', interruptionTendency: 5, contradictionPropensity: 5,
  })
  assert.notEqual(coupeur, poli)
  assert.match(coupeur, /COUPES/)
  assert.match(coupeur, /CONTREDIS/)
  assert.match(poli, /ne coupes jamais/)

  // Au milieu : ni l'une ni l'autre des consignes extrêmes.
  const median = behaviorPulseDirective(DEFAULT_BEHAVIOR)
  assert.doesNotMatch(median, /COUPES|ne coupes jamais/)
})

test('interventionRate pilote le nombre d\'invités', () => {
  assert.equal(guestSlotsForRate('normal'), 1)
  assert.equal(guestSlotsForRate('frenetic'), 2)
  // `rare` : tirage — on force le rng aux deux extrêmes.
  assert.equal(guestSlotsForRate('rare', () => 0.1), 1)
  assert.equal(guestSlotsForRate('rare', () => 0.9), 0)
})

// ── La cascade et l'arrivée effective dans le prompt ─────────────────
//
// `loadPulseFromEnv` met en cache au premier appel : l'env est donc posé
// UNE fois ici, avant toute résolution.

process.env.RADIO_PULSE_JSON = JSON.stringify({
  global: {
    rhythm:   { dialogueDensity: 60, interventionRate: 'normal', averageSegmentSec: 60, globalMood: 'satirique' },
    behavior: { verbosity: 'normal', interruptionTendency: 35, contradictionPropensity: 50 },
  },
  byStation: {
    'wtf-radio': { dialogueDensity: 95, interventionRate: 'rare', averageSegmentSec: 40, globalMood: 'chaotique' },
  },
  byPersona: {
    'host:wtf-radio:wtf-cyril': { verbosity: 'verbose', interruptionTendency: 90, contradictionPropensity: 90 },
  },
})

test('cascade : override station gagne, les autres stations gardent le global', async () => {
  const { resolveRhythmForStation, resolveBehaviorForPersona, hasPublishedPulse } = await import('../pulse')

  assert.equal(hasPublishedPulse(), true)

  const wtf = resolveRhythmForStation('wtf-radio')
  assert.equal(wtf.globalMood, 'chaotique')       // override
  assert.equal(wtf.dialogueDensity, 95)

  const autre = resolveRhythmForStation('oasis-fm')
  assert.equal(autre.globalMood, 'satirique')     // global
  assert.equal(autre.dialogueDensity, 60)

  const cyril = resolveBehaviorForPersona('host:wtf-radio:wtf-cyril')
  assert.equal(cyril.verbosity, 'verbose')        // override persona
  const inconnu = resolveBehaviorForPersona('host:oasis-fm:oa-lea')
  assert.equal(inconnu.verbosity, 'normal')       // global
})

test('le réglage arrive RÉELLEMENT dans le system prompt de l\'animateur', async () => {
  const { buildHostSystemPrompt } = await import('../personas')
  const { resolveRhythmForStation, resolveBehaviorForPersona,
          rhythmDirective, behaviorPulseDirective } = await import('../pulse')

  const rhythm = resolveRhythmForStation('wtf-radio')
  const behavior = resolveBehaviorForPersona('host:wtf-radio:wtf-cyril')
  const directive = `${rhythmDirective(rhythm)}\n${behaviorPulseDirective(behavior)}`

  const base = {
    host: { id: 'wtf-cyril', name: 'Cyril', gender: 'male' as const, trait: 't', color: '#fff', avatar: '🎙️' },
    kb: { hostId: 'wtf-cyril', stationId: 'wtf-radio', personality: '', entries: [], updatedAt: 0 },
    selectedEntries: [], stationName: 'WTF Radio', language: 'fr' as const, otherHosts: [],
  }

  const avec = buildHostSystemPrompt({ ...base, pulseDirective: directive })
  assert.match(avec, /RYTHME ET TENUE D'ANTENNE/)
  assert.match(avec, /CHAOTIQUE/)          // l'humeur de l'override station
  assert.match(avec, /DENSE/)              // densité 95
  assert.match(avec, /AMPLE/)              // verbosity verbose de l'override persona
  assert.match(avec, /40 secondes/)        // averageSegmentSec de l'override

  // Sans Pulse publié, le prompt doit rester EXACTEMENT celui d'avant :
  // pas de section, pas une ligne de plus.
  const sans = buildHostSystemPrompt({ ...base })
  assert.doesNotMatch(sans, /RYTHME ET TENUE D'ANTENNE/)
  assert.ok(avec.length > sans.length)
})
