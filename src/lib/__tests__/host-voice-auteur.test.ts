/**
 * @module InfinityScheduler/Lib/HostVoiceAuteur/Tests
 * @description 🔴 Un tiers pouvait piloter notre antenne.
 *
 *   Un event remplaçable est identifié par le TRIPLET (auteur, kind, d-tag)
 *   — NIP-01. `fetchHostVoiceMappings` indexait par le d-tag SEUL et gardait
 *   le plus récent : n'importe qui pouvait donc écraser la voix d'un de nos
 *   animateurs en publiant après nous.
 *
 *   Constaté le 02/09/2026, en vrai, sur `nos.lol` et `nostr.mom` :
 *   `pirate-radio:pi-hex` portait deux events, l'un de `f1abc0b8…` (inconnu
 *   du dépôt) disant « alain », l'autre de notre clé disant « Layla ». Le
 *   tiers gagnait, plus récent de 55 secondes.
 *
 *   C'était le seul des trois modules de configuration radio sans filtre
 *   par auteur — `pulse.ts` et `radio-personas.ts` en avaient un.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import type { Event as NostrEvent } from 'nostr-tools/core'
import { resoudreParAuteur } from '../host-voice-mappings'

const NOUS = '9a8098f002e03b14260cdced2a18e4068678880814f96ebb46ce7d1993bcbecd'
const TIERS = 'f1abc0b871f68704000000000000000000000000000000000000000000000000'

function ev(pubkey: string, d: string, voix: string, at: number): NostrEvent {
  return {
    id: '', sig: '', kind: 30095, pubkey, created_at: at,
    tags: [['d', d]], content: JSON.stringify({ voiceName: voix }),
  } as NostrEvent
}

test('TÉMOIN : un seul auteur, le mapping passe normalement', () => {
  // Sans ce témoin, une fonction qui rejetterait TOUT passerait les tests
  // de refus ci-dessous sans rien garder d'utile.
  const r = resoudreParAuteur([ev(NOUS, 'a:b', 'ranouna', 100)], null, NOUS)
  assert.equal(r.size, 1)
  assert.match(r.get('a:b')!.content, /ranouna/)
})

test('🔴 le cas réel : un tiers PLUS RÉCENT ne nous écrase plus', () => {
  const r = resoudreParAuteur(
    [ev(NOUS, 'pirate-radio:pi-hex', 'Layla', 100),
     ev(TIERS, 'pirate-radio:pi-hex', 'alain', 155)],
    null, NOUS,
  )
  assert.match(r.get('pirate-radio:pi-hex')!.content, /Layla/)
})

test('deux tiers en conflit, aucun reconnu : le mapping est IGNORÉ', () => {
  // Repli Piper : moins beau, jamais piloté par un inconnu. Prendre « le
  // plus récent » reviendrait à donner l'antenne au dernier qui parle.
  const autre = 'c'.repeat(64)
  const r = resoudreParAuteur(
    [ev(TIERS, 'x:y', 'alain', 100), ev(autre, 'x:y', 'bush', 200)],
    null, NOUS,
  )
  assert.equal(r.has('x:y'), false)
})

test('avec RADIO_ADMIN_PUBKEYS, seuls les auteurs reconnus comptent', () => {
  const allowed = new Set([NOUS])
  const r = resoudreParAuteur(
    [ev(TIERS, 'pirate-radio:pi-hex', 'alain', 999),
     ev(NOUS, 'pirate-radio:pi-hex', 'Layla', 1)],
    allowed, NOUS,
  )
  assert.match(r.get('pirate-radio:pi-hex')!.content, /Layla/)
})

test('un auteur qui se met à jour garde bien sa version la plus récente', () => {
  // La sémantique « remplaçable » doit survivre au durcissement : c'est
  // l'écrasement PAR UN AUTRE auteur qui est interdit, pas la mise à jour.
  const r = resoudreParAuteur(
    [ev(NOUS, 'a:b', 'ancienne', 100), ev(NOUS, 'a:b', 'nouvelle', 200)],
    null, NOUS,
  )
  assert.match(r.get('a:b')!.content, /nouvelle/)
})

test('sans clé publique connue, un conflit reste ignoré plutôt qu\'arbitré', () => {
  const r = resoudreParAuteur(
    [ev(NOUS, 'a:b', 'Layla', 100), ev(TIERS, 'a:b', 'alain', 200)],
    null, '',
  )
  assert.equal(r.has('a:b'), false)
})

test("🔴 un auteur INCONNU, seul à revendiquer, est écarté par l'allowlist", () => {
  // Le trou que la mutation a révélé : mes autres cas passaient même
  // allowlist débranchée, parce que la résolution de conflit sauvait la
  // mise. Ici il n'y a AUCUN conflit — seul le filtre par auteur protège.
  const allowed = new Set([NOUS])
  assert.equal(resoudreParAuteur([ev(TIERS, 'x:y', 'alain', 100)], allowed, NOUS).has('x:y'), false)
  // et sans allowlist, ce même event passerait — c'est bien le filtre qui agit
  assert.equal(resoudreParAuteur([ev(TIERS, 'x:y', 'alain', 100)], null, NOUS).has('x:y'), true)
})

test('🔴 en conflit non arbitrable, on n\'élit PAS le plus récent', () => {
  // L'autre trou : rien ne vérifiait qu'on s'abstient VRAIMENT au lieu de
  // retomber sur « le dernier qui parle ». Deux tiers, aucun reconnu, et
  // une clé nôtre absente de la liste.
  const t2 = 'd'.repeat(64)
  const r = resoudreParAuteur(
    [ev(TIERS, 'x:y', 'alain', 100), ev(t2, 'x:y', 'bush', 999)],
    null, NOUS,
  )
  assert.equal(r.has('x:y'), false, 'aucun ne doit être élu, même le plus récent')
})
