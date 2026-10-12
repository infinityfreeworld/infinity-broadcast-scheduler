/**
 * @module InfinityScheduler/Lib/ReprisesJobTests
 * @description 🔁 Reprises d'une station dans un job GitHub, et filtre des stations demandées par
 *   l'IHL. Logique pure, aucun réseau.
 *
 *   Lancer :  npx tsx --test src/lib/__tests__/reprises-job.test.ts
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { apresPassage, passageFinal, reglagesReprisesJob } from '../reprises-job'
import { stationsDemandees } from '../stations-demandees'
import { aRetirer, demandesSuppression, dateDuD } from '../vidage-emissions'
import { CODE_A_REPRENDRE, CODE_VEILLE_GARDEE } from '../regle-publication'

const MIN = 60_000
const R = reglagesReprisesJob({})
const T0 = 1_000_000_000_000

test('réglages par défaut : 3 passages, 130 min, pause 8, marge 50', () => {
  assert.deepEqual(R, { maxPasses: 3, budgetMs: 130 * MIN, pauseMs: 8 * MIN, margeDerniereMs: 50 * MIN })
  const r = reglagesReprisesJob({ RADIO_JOB_PASSES: '0', RADIO_JOB_BUDGET_MIN: 'x', RADIO_JOB_PAUSE_MIN: '2' })
  assert.equal(r.maxPasses, 3, 'zéro passage n\'a pas de sens : défaut')
  assert.equal(r.budgetMs, 130 * MIN)
  assert.equal(r.pauseMs, 2 * MIN)
})

test('⭐ le PREMIER passage est reportable (avant le 12/10 il était toujours « dernière chance »)', () => {
  assert.equal(passageFinal(1, T0, T0, R), false)
})

test('dernier passage : le n-ième, ou quand le temps restant est sous la marge', () => {
  assert.equal(passageFinal(3, T0, T0, R), true)
  assert.equal(passageFinal(2, T0 + 79 * MIN, T0, R), false)   // reste 51 min
  assert.equal(passageFinal(2, T0 + 81 * MIN, T0, R), true)    // reste 49 min
  assert.equal(passageFinal(1, T0, T0, { ...R, maxPasses: 1 }), true)
})

test('⭐ publiée ou veille gardée : on s\'arrête, avec le bon code', () => {
  assert.deepEqual(apresPassage(0, false, T0, T0, R), { suite: 'fin', code: 0, issue: 'publiee' })
  assert.deepEqual(apresPassage(CODE_VEILLE_GARDEE, true, T0, T0, R), { suite: 'fin', code: 76, issue: 'veille-gardee' })
})

test('⭐ reportée (75) avec du temps devant : on reprend après la pause', () => {
  assert.deepEqual(apresPassage(CODE_A_REPRENDRE, false, T0 + 50 * MIN, T0, R), { suite: 'reprendre', pauseMs: 8 * MIN })
})

test('un échec franc se retente aussi (réseau coupé pendant l\'écriture)', () => {
  assert.equal(apresPassage(1, false, T0, T0, R).suite, 'reprendre')
})

test('la pause ne mord jamais sur la marge du dernier passage', () => {
  // reste 55 min : la marge (50) n'en laisse que 5 de pause.
  assert.deepEqual(apresPassage(CODE_A_REPRENDRE, false, T0 + 75 * MIN, T0, R), { suite: 'reprendre', pauseMs: 5 * MIN })
  assert.deepEqual(apresPassage(CODE_A_REPRENDRE, false, T0 + 100 * MIN, T0, R), { suite: 'reprendre', pauseMs: 0 })
})

test('au dernier passage, un report ou un échec termine le job (code conservé)', () => {
  assert.deepEqual(apresPassage(CODE_A_REPRENDRE, true, T0, T0, R), { suite: 'fin', code: 75, issue: 'a-reprendre' })
  assert.deepEqual(apresPassage(2, true, T0, T0, R), { suite: 'fin', code: 2, issue: 'echec' })
})

// ── Stations demandées depuis l'IHL ─────────────────────────────────────────────────────

const ORDRE = ['tech-radio', 'hydrogene-radio', 'pirate-radio', 'g1-radio']

test('⭐ vide = toutes, dans l\'ordre de la nuit', () => {
  assert.deepEqual(stationsDemandees(ORDRE, ''), { ids: ORDRE, inconnues: [] })
  assert.deepEqual(stationsDemandees(ORDRE, undefined).ids, ORDRE)
})

test('⭐ seulement les stations demandées, dans l\'ordre de la NUIT (pas celui de la demande), sans doublon', () => {
  assert.deepEqual(stationsDemandees(ORDRE, 'g1-radio, tech-radio,g1-radio').ids, ['tech-radio', 'g1-radio'])
})

test('⭐ un identifiant inconnu ou mal formé est ignoré, jamais transmis', () => {
  const r = stationsDemandees(ORDRE, 'pirate-radio,"; rm -rf /,inconnue-radio')
  assert.deepEqual(r.ids, ['pirate-radio'])
  assert.deepEqual(r.inconnues, ['";', 'rm', '-rf', '/', 'inconnue-radio'])
  assert.deepEqual(stationsDemandees(ORDRE, 'inconnue').ids, [], 'rien de connu : liste vide (la matrice ne part pas)')
})

// ── Le workflow ─────────────────────────────────────────────────────────────────────────

test('le workflow passe par les reprises et n\'interpole plus les entrées dans le shell', () => {
  const y = readFileSync(new URL('../../../.github/workflows/daily-broadcast.yml', import.meta.url), 'utf8')
  assert.match(y, /npm run generate:reprises -- "\$STATION"/)
  assert.doesNotMatch(y, /run:[^\n]*\$\{\{ github\.event\.inputs\./, 'entrée interpolée sur une ligne run')
  assert.doesNotMatch(y, /^\s+if \[ -n "\$\{\{ github\.event\.inputs/m)
  assert.match(y, /stations:\n\s+description:/)
})

// ── Vidage préparé (jamais exécuté sans Med) ─────────────────────────────────────────────


test('⭐ vidage : seulement NOS émissions, plus vieilles que N jours, d-tag reconnu', () => {
  const moi = 'a'.repeat(64)
  const autre = 'b'.repeat(64)
  const l = aRetirer([
    { pubkey: moi, d: 'pirate-radio:2026-09-20' },
    { pubkey: moi, d: 'pirate-radio:2026-09-20' },          // doublon
    { pubkey: moi, d: 'pirate-radio:2026-10-02' },          // limite exacte : gardée
    { pubkey: moi, d: 'pirate-radio:2026-10-11' },
    { pubkey: autre, d: 'pirate-radio:2026-09-01' },        // pas à nous
    { pubkey: moi, d: 'bizarre' },                          // illisible : gardée
  ], moi, '2026-10-12', 10)
  assert.deepEqual(l.map(e => e.d), ['pirate-radio:2026-09-20'])
  assert.equal(dateDuD('x:2026-01-01'), '2026-01-01')
})

test('vidage : demandes NIP-09 par paquets de 100, adresses 30093:<clé>:<d>', () => {
  const liste = Array.from({ length: 205 }, (_, i) => ({ pubkey: 'a'.repeat(64), d: `s:2026-01-${String((i % 28) + 1).padStart(2, '0')}` }))
  const p = demandesSuppression(liste, 1)
  assert.equal(p.length, 3)
  assert.equal(p[0].kind, 5)
  assert.equal(p[0].tags.filter(t => t[0] === 'a').length, 100)
  assert.equal(p[2].tags.filter(t => t[0] === 'a').length, 5)
  assert.deepEqual(p[0].tags[0], ['a', `30093:${'a'.repeat(64)}:s:2026-01-01`])
})
