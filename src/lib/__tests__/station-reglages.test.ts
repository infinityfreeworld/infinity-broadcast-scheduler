/** Les réglages IHL d'une station (kind 30091) : ce qui passe, ce qui est refusé, qui a le droit. */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { lireReglages, retenirEvent, appliquerReglages, KIND_RADIO_STATION } from '../station-reglages'
import { SEED_STATIONS } from '../../data/seed-stations'
import type { Event as NostrEvent } from 'nostr-tools/core'

const CID = 'bafybeibhjj5cyhauwnrrjntrkwncl6y3bhyetzow54jieku47f2igchw7e'

test('les musiques et jingles collés dans l’IHL sont lus, les entrées sans CID valable écartées', () => {
  const r = lireReglages(JSON.stringify({
    tracks: [{ title: 'Nuit', cid: CID }, { title: 'sans cid' }, { title: 'faux', cid: 'pas-un-cid' }, { cid: CID }],
    jingles: [{ title: 'Ident', cid: CID }],
    skipMusic: false, pauses: 3, pauseDureeS: 120.4,
  }))!
  assert.equal(r.tracks!.length, 2)
  assert.equal(r.tracks![1].title, CID.slice(0, 12), 'un titre manquant est remplacé, pas refusé')
  assert.equal(r.jingles!.length, 1)
  assert.equal(r.skipMusic, false); assert.equal(r.pauses, 3); assert.equal(r.pauseDureeS, 120)
})

test('hors bornes ou mal typé : ignoré, jamais interprété', () => {
  const r = lireReglages(JSON.stringify({ pauses: 42, pauseDureeS: 5, skipMusic: 'oui', tracks: 'x' }))!
  assert.deepEqual(r, {})
  assert.equal(lireReglages('{'), null)
  assert.equal(lireReglages(JSON.stringify({ deleted: true, tracks: [{ title: 'x', cid: CID }] })), null, 'une pierre tombale ne règle rien')
})

function ev(pubkey: string, d: string, created_at: number, content = '{}'): NostrEvent {
  return { kind: KIND_RADIO_STATION, pubkey, created_at, content, tags: [['d', d]], id: 'x', sig: 'y' } as NostrEvent
}

test('🔴 seul un admin (ou le créateur) règle une station ; le plus récent gagne', () => {
  const admin = 'a'.repeat(64), tiers = 'b'.repeat(64), createur = 'c'.repeat(64)
  const admins = new Set([admin])
  const events = [ev(tiers, 'pirate-radio', 300), ev(admin, 'pirate-radio', 100), ev(admin, 'pirate-radio', 200), ev(admin, 'oasis-fm', 999)]
  assert.equal(retenirEvent(events, 'pirate-radio', admins, null)?.created_at, 200)
  assert.equal(retenirEvent([ev(tiers, 'pirate-radio', 300)], 'pirate-radio', admins, null), null, 'un tiers ne pilote pas l’antenne')
  assert.equal(retenirEvent([ev(createur, 'ma-station', 5)], 'ma-station', admins, createur)?.pubkey, createur)
  assert.equal(retenirEvent([ev(tiers, 'x', 1)], 'x', null, null)?.pubkey, tiers, '« * » lève le filtre')
})

test('appliquer : les champs présents remplacent, la seed garde le reste', () => {
  const seed = SEED_STATIONS.find(s => s.id === 'pirate-radio')!
  const s = appliquerReglages(seed, { tracks: [{ title: 'Nuit', cid: CID }], pauses: 1 })
  assert.equal(s.tracks!.length, 1); assert.equal(s.pauses, 1)
  assert.equal(s.hosts.length, seed.hosts.length); assert.equal(s.language, seed.language)
  assert.equal(appliquerReglages(seed, null), seed)
})
