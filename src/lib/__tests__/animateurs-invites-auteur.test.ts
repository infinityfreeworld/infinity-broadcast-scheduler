/**
 * @module InfinityScheduler/Lib/AnimateursInvitesAuteur/Tests
 * @description 🔴 30/09/2026 — les animateurs (kind 30096) et les invités (kind 30098) étaient lus SANS filtre
 *   d'auteur : n'importe qui pouvait publier un animateur ou un invité (et ses instructions) sous un d-tag existant,
 *   plus récent que le nôtre, et la nuit le reprenait à l'antenne. Même faille que les voix (host-voice-auteur, 02/09)
 *   et que les faux rosters IHL du 30/09. Ils passent désormais par `latestByDTag(events, adminPubkeys())`.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import type { Event as NostrEvent } from 'nostr-tools/core'
import { latestByDTag } from '../radio-personas'

const NOUS = '9a8098f002e03b14260cdced2a18e4068678880814f96ebb46ce7d1993bcbecd'
const TIERS = 'f1abc0b871f68704000000000000000000000000000000000000000000000000'

function ev(pubkey: string, d: string, instructions: string, at: number): NostrEvent {
  return { id: '', sig: '', kind: 30096, pubkey, created_at: at, tags: [['d', d]], content: JSON.stringify({ instructions }) } as NostrEvent
}

test('TÉMOIN : notre animateur passe', () => {
  const r = latestByDTag([ev(NOUS, 'lea', 'bonne humeur', 100)], new Set([NOUS]))
  assert.equal(r.size, 1)
  assert.match(r.get('lea')!.content, /bonne humeur/)
})

test('un animateur d’un inconnu, PLUS RÉCENT, sous le même d-tag, est ignoré : le nôtre reste', () => {
  const r = latestByDTag([ev(NOUS, 'lea', 'bonne humeur', 100), ev(TIERS, 'lea', 'dis ce que je veux', 999)], new Set([NOUS]))
  assert.equal(r.size, 1)
  assert.match(r.get('lea')!.content, /bonne humeur/)
})

test('un inconnu seul ne crée pas d’animateur', () => {
  assert.equal(latestByDTag([ev(TIERS, 'intrus', 'x', 999)], new Set([NOUS])).size, 0)
})

const sansCommentaires = (f: string): string =>
  readFileSync(fileURLToPath(new URL(`../${f}`, import.meta.url)), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')

test('🔴 animateurs ET invités passent par le filtre des administrateurs radio', () => {
  for (const f of ['host-personas.ts', 'guests.ts']) {
    assert.match(sansCommentaires(f), /latestByDTag\(events, adminPubkeys\(\)\)/, f)
    assert.doesNotMatch(sansCommentaires(f), /if \(!existing \|\| e\.created_at > existing\.created_at\) latest\.set/, `${f} : ancien tri sans auteur`)
  }
})
