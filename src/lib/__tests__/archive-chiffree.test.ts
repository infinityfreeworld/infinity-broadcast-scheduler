/**
 * @module InfinityScheduler/Lib/ArchiveChiffree/Tests
 * @description 🔴 Nous avons déposé notre code en clair en croyant le sauvegarder.
 *
 *   Vérifié le 08/09/2026 : `curl` sans aucun jeton rendait 200 et
 *   321 557 octets — clonables, 62 commits lisibles.
 *
 *   data-space a montré pire : leur DHT annonçait le CID au réseau IPFS
 *   mondial, deux fournisseurs sur deux continents. Fermer leur passerelle
 *   n'aurait rien protégé — « une porte sur une maison sans murs ».
 *
 *   Un contenu publié une fois est public à jamais. La seule protection
 *   qui ne dépende de personne est de ne jamais déposer de clair.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { randomBytes, createHash } from 'node:crypto'
import { chiffrer, dechiffrer } from '../coffre'

const SRC = new URL('../../scripts/deposer-archive.ts', import.meta.url)

test("l'aller-retour rend les octets À L'IDENTIQUE", () => {
  // Un chiffrement qu'on ne sait pas défaire est une perte de données
  // déguisée en sécurité.
  const cle = randomBytes(32)
  const clair = randomBytes(50_000)
  const rendu = dechiffrer(chiffrer(clair, cle), cle)
  assert.equal(createHash('sha256').update(rendu).digest('hex'),
               createHash('sha256').update(clair).digest('hex'))
})

test('🔴 le chiffré ne laisse RIEN paraître du clair', () => {
  const cle = randomBytes(32)
  const clair = Buffer.from('# v2 git bundle\nsecret-tres-visible-dans-un-bundle')
  const paquet = chiffrer(clair, cle)
  assert.ok(!paquet.includes(Buffer.from('git bundle')), "l'en-tête git ne doit pas subsister")
  assert.ok(!paquet.includes(Buffer.from('secret-tres-visible')), 'aucun fragment de clair')
})

test('deux chiffrements du MÊME clair diffèrent — le nonce est bien tiré', () => {
  // Sans nonce aléatoire, deux archives identiques donneraient le même
  // bloc : un observateur saurait que rien n'a changé cette nuit-là.
  const cle = randomBytes(32)
  const clair = Buffer.from('archive du soir')
  assert.notEqual(chiffrer(clair, cle).toString('hex'), chiffrer(clair, cle).toString('hex'))
})

test('une clé FAUSSE échoue bruyamment, ne rend jamais du charabia', () => {
  // GCM authentifie : un déchiffrement raté LÈVE. Sans ça on restaurerait
  // une archive corrompue en croyant l'avoir récupérée.
  const paquet = chiffrer(Buffer.from('x'.repeat(1000)), randomBytes(32))
  assert.throws(() => dechiffrer(paquet, randomBytes(32)))
})

test("🔴 le dépôt PROUVE qu'un anonyme n'obtient que de l'opaque", () => {
  // Une protection qu'on ne peut pas éprouver ne vaut rien. Le script
  // relit son propre dépôt SANS jeton et sort en échec s'il y voit du git.
  const src = readFileSync(SRC, 'utf8')
  assert.match(src, /UN ANONYME LIT ENCORE DU GIT/)
  assert.match(src, /process\.exit\(1\)/)
  const iFetch = src.indexOf('const anon = await fetch')
  const iVerif = src.indexOf('estGit')
  assert.ok(iFetch > 0 && iFetch < iVerif, 'la preuve doit suivre le dépôt')
})

test('la clé de coffre reste en 0600 et ne quitte pas la machine', () => {
  const src = readFileSync(SRC, 'utf8')
  assert.match(src, /mode: 0o600/)
  assert.ok(!/cle\.toString\('hex'\)[\s\S]{0,200}fetch/.test(src),
    'la clé ne doit jamais partir sur le réseau')
})
