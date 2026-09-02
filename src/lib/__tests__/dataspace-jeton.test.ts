/**
 * @module InfinityScheduler/Lib/DataSpaceJeton/Tests
 * @description Deux gardes, tous deux sur des échecs SILENCIEUX.
 *
 *   1. Un jeton vide rendu au lieu d'une erreur ferait un 401 plus loin,
 *      imputé au service alors que la cause est ici.
 *   2. La marque « Infinity » ne doit pas fuiter dans la requête de
 *      provisionnement (docs/dataspace-provisioning.md §2). Un garde de
 *      ce genre n'est utile que s'il est ÉPROUVÉ — sinon c'est un
 *      commentaire qui a l'air d'un contrôle.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { marqueAbsente, deriverJeton } from '../dataspace-jeton'

test('la marque est détectée dans une URL, quelle que soit la casse', () => {
  assert.equal(marqueAbsente({}, 'https://data-space.world/api/pinning/provision'), true)
  assert.equal(marqueAbsente({}, 'https://x/infinity'), false)
  assert.equal(marqueAbsente({}, 'https://x/INFINITY'), false)
  assert.equal(marqueAbsente({}, 'https://x/Infinity-Radio'), false)
})

test('la marque est détectée dans les en-têtes, pas seulement dans l\'URL', () => {
  // Le cas réel : elle voyagerait dans un `User-Agent` ou un jeton encodé.
  assert.equal(marqueAbsente({ 'User-Agent': 'infinity/1.0' }, 'https://x/'), false)
  assert.equal(marqueAbsente({ Authorization: 'Nostr abc' }, 'https://x/'), true)
})

test('une clé mal formée est refusée AVANT tout appel réseau', async () => {
  // Sans ce refus, une clé tronquée partirait sur le réseau et rendrait un
  // 401 qu'on imputerait au service ou à l'horloge.
  await assert.rejects(() => deriverJeton(''), /64 caractères hexadécimaux/)
  await assert.rejects(() => deriverJeton('abc'), /64 caractères hexadécimaux/)
  await assert.rejects(() => deriverJeton('z'.repeat(64)), /64 caractères hexadécimaux/)
})

test('une clé de 64 hex est acceptée par le contrôle de forme', async () => {
  // TÉMOIN POSITIF : sans lui, un contrôle qui refuserait TOUT passerait
  // les trois assertions ci-dessus sans rien garder.
  await assert.doesNotReject(
    async () => {
      try { await deriverJeton('a'.repeat(64)) } catch (e) {
        // L'appel réseau peut échouer — ce qui compte est que ce ne soit
        // PAS le contrôle de forme qui ait parlé.
        assert.doesNotMatch((e as Error).message, /64 caractères hexadécimaux/)
      }
    },
  )
})
