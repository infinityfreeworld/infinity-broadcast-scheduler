/**
 * 23/09/2026 — première nuit avec musique, deux leçons :
 *   · Freeworld (première station) a payé l'allumage du GPU sur sa fenêtre : 10 tours en Piper ;
 *   · Diginomad et WTF « publiées sur 7/9 relais » manquaient sur le relais Cloudflare (timeout),
 *     le seul que l'application lit en premier — inaudibles malgré le score.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { estRelaisDurable, lireResultatPublication, relaisDurablesEnEchec } from '../nostr'

test('🔴 la fenêtre de synthèse repart au PREMIER tour cloné reçu (l’allumage ne se facture plus)', () => {
  const gb = readFileSync('src/scripts/generate-broadcast.ts', 'utf8')
  assert.match(gb, /const buf = await file\.prendre\(i\)\s*\n[\s\S]{0,900}?if \(!fenetreRelancee\) \{\s*fenetreRelancee = true\s*ouvrirEcheanceClone\(\)/)
  assert.match(gb, /let fenetreRelancee = false\s*\n\s*const file = fileEnVol\(/)
})

test('les relais durables sont Cloudflare et data-space ; les publics sont de la redondance', () => {
  assert.equal(estRelaisDurable('wss://infinity-radio-relay.digitalforlifeagency.workers.dev'), true)
  assert.equal(estRelaisDurable('wss://data-space.world/r/relais-public-2/'), true)
  assert.equal(estRelaisDurable('wss://relay.damus.io'), false)
  assert.equal(estRelaisDurable('wss://relay.nostr.band'), false)
})

test('un « connection failure » rendu comme succès est un échec ; un rejet aussi ; le reste est OK', () => {
  assert.equal(lireResultatPublication('wss://x', { status: 'fulfilled', value: 'connection failure: connection timed out' }).ok, false)
  assert.equal(lireResultatPublication('wss://x', { status: 'rejected', reason: new Error('boom') }).reason, 'boom')
  assert.deepEqual(lireResultatPublication('wss://x', { status: 'fulfilled', value: '' }), { url: 'wss://x', ok: true, reason: 'ok' })
})

test('🔴 seuls les relais durables en échec sont retentés', () => {
  const bilan = [
    { url: 'wss://infinity-radio-relay.digitalforlifeagency.workers.dev', ok: false },
    { url: 'wss://data-space.world/r/relais-public-1', ok: true },
    { url: 'wss://relay.nostr.band', ok: false },
    { url: 'wss://relay.damus.io', ok: true },
  ]
  assert.deepEqual(relaisDurablesEnEchec(bilan), ['wss://infinity-radio-relay.digitalforlifeagency.workers.dev'])
  const n = readFileSync('src/lib/nostr.ts', 'utf8')
  assert.match(n, /for \(let essai = 1; essai <= 3; essai\+\+\) \{\s*const aRetenter = relaisDurablesEnEchec\(summary\)/)
})
