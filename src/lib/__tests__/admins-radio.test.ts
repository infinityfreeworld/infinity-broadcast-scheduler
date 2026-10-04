/**
 * La liste blanche des auteurs de réglages : jamais vide par oubli.
 * Chaque nuit depuis mai 2026, « wtf-cyril » et « pi-hex » étaient IGNORÉS faute de
 * `RADIO_ADMIN_PUBKEYS` — les choix du fondateur n'ont jamais compté.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { adminPubkeys, ADMINS_RADIO_PAR_DEFAUT } from '../admins-radio'
import { latestByDTag } from '../radio-personas'

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

// ── 04/10/2026 : la co-racine du Bâtisseur et sa clé de secours ──────────────

const CO_RACINE = 'db02f94a66c3845bcdc6b6d4488112920fdd82cf9d20edd341df00b326a37241'
const SECOURS = '889951cce124cbad13c32c8b83199337eea207416bd3b47d6fedc7ec971d3724'

test('⭐ la co-racine du Bâtisseur et sa clé de secours sont de confiance par défaut', () => {
  const set = adminPubkeys({})!
  assert.ok(set.has(CO_RACINE), 'co-racine db02f94a…')
  assert.ok(set.has(SECOURS), 'clé de secours 889951cc…')
})

test('⭐ ses personas (kind 30104) passent le filtre d’auteur — Cramon, Ki Jun Couille, Trompe', () => {
  // Relevé réel du 04/10/2026 (lecture seule des relais) : ces trois d-tags, signés
  // db02f94a…, étaient écartés par `latestByDTag` faute de la clé dans la liste.
  const ev = (d: string, pubkey: string, created_at = 1) =>
    ({ id: d, pubkey, created_at, kind: 30104, tags: [['d', d]], content: '{}', sig: '' })
  const evts = [
    ev('emmanuel-cramon', CO_RACINE), ev('ki-jun-couille', CO_RACINE), ev('donald-trompe', SECOURS),
    ev('intrus', 'b'.repeat(64)),
  ]
  const retenus = latestByDTag(evts, adminPubkeys({}))
  assert.deepEqual([...retenus.keys()].sort(), ['donald-trompe', 'emmanuel-cramon', 'ki-jun-couille'])
  // Avec l'ancienne liste (4 clés), aucune ne passait.
  const ancienne = new Set(ADMINS_RADIO_PAR_DEFAUT.filter(k => k !== CO_RACINE && k !== SECOURS))
  assert.equal(latestByDTag(evts, ancienne).size, 0)
})
