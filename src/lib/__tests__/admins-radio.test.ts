/**
 * La liste blanche des auteurs de réglages : jamais vide par oubli.
 * Chaque nuit depuis mai 2026, « wtf-cyril » et « pi-hex » étaient IGNORÉS faute de
 * `RADIO_ADMIN_PUBKEYS` — les choix du fondateur n'ont jamais compté.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { adminPubkeys, ADMINS_RADIO_PAR_DEFAUT } from '../admins-radio'

test('🔴 sans variable, la liste par défaut s’applique — plus jamais « aucun reconnu »', () => {
  const set = adminPubkeys({})
  assert.ok(set && set.size === ADMINS_RADIO_PAR_DEFAUT.length)
  assert.ok(set.has('f1abc0b871f6870489391d47ca1fe2a216ddc854c6a6fe5b619c5f7f2381ef3c'), 'les voix de Cyril et Hex')
  assert.ok(set.has('6e0083049e5425fe902f6b5c6c44c62e0a767d88346090d05e8d8ecec80898ce'), 'les 8 stations du 16/06')
})

test('le générateur lui-même n’est PAS admin : ses mappings de l’ère Hugging Face ne passent pas', () => {
  for (const k of ADMINS_RADIO_PAR_DEFAUT) assert.doesNotMatch(k, /^9a8098f0/)
  assert.ok(ADMINS_RADIO_PAR_DEFAUT.every(k => /^[0-9a-f]{64}$/.test(k)), 'hex 64, jamais un npub')
})

test('la variable REMPLACE la liste (banc d’essai, changement de clé)', () => {
  const k = 'a'.repeat(64)
  const set = adminPubkeys({ RADIO_ADMIN_PUBKEYS: ` ${k.toUpperCase()} , , ` })
  assert.deepEqual([...set!], [k], 'normalisée en minuscules, espaces et vides ignorés')
})

test('une variable sans aucune clé valable ne DÉSARME pas la liste', () => {
  const set = adminPubkeys({ RADIO_ADMIN_PUBKEYS: 'npub1pasunhex,,' })
  assert.ok(set && set.size === ADMINS_RADIO_PAR_DEFAUT.length)
})

test('« * » seul lève le filtre — explicitement, jamais par oubli', () => {
  assert.equal(adminPubkeys({ RADIO_ADMIN_PUBKEYS: '*' }), null)
  assert.notEqual(adminPubkeys({ RADIO_ADMIN_PUBKEYS: '' }), null)
})
