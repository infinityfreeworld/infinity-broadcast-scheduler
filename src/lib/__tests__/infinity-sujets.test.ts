/**
 * @module InfinityScheduler/Lib/SujetsInfinity/Tests
 * @description 🌍 La télévision parle de l'APPLICATION — et seulement de ce qui mérite d'être dit.
 *
 *   Retour du Bâtisseur (09/09/2026) : « les thèmes doivent absolument concerner les sujets de
 *   l'application ». Mesuré le 10/09 au soir : sur 28 events récents des trois kinds, 27 venaient
 *   d'autres applications, et le 28e était une Manifestaction de TEST — « jdfdosij », sans
 *   description, ANNULÉE, datée du 2 août — dont le JT a fait « Les Gardiens du Vivant ».
 *
 *   Lancer :  npx tsx --test src/lib/__tests__/infinity-sujets.test.ts
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import type { Event as NostrEvent } from 'nostr-tools'
import {
  lireManifestaction, lireProjetAbondance, lirePropositionDav, retenirSujets, DESCRIPTION_MIN,
  KIND_MANIFESTACTION, KIND_PROJET_ABONDANCE, KIND_PROPOSITION_DAV,
} from '../infinity-sujets'

const MAINTENANT = Date.UTC(2026, 8, 10)
const J = 86400_000
const D = 'Une action concrète et décrite, avec assez de matière pour être racontée.'
const ev = (kind: number, content: unknown, tags: string[][] = [], ageJours = 1): NostrEvent => ({
  kind, id: 'x', pubkey: 'p', sig: 's', tags,
  created_at: Math.floor((MAINTENANT - ageJours * J) / 1000),
  content: typeof content === 'string' ? content : JSON.stringify(content),
} as NostrEvent)

test('la description témoin fait bien le minimum exigé (sinon les tests ne prouvent rien)', () => {
  assert.ok(D.length >= DESCRIPTION_MIN)
})

test('une Manifestaction à venir se lit, avec son lieu, sa date ET son temps', () => {
  const m = lireManifestaction(ev(KIND_MANIFESTACTION, {
    title: 'Nettoyage des berges', description: D, location: 'Sion', startDate: MAINTENANT + 10 * J,
  }), MAINTENANT)
  assert.equal(m?.title, 'Nettoyage des berges')
  assert.ok(m?.summary?.includes('Sion'))
  assert.ok(m?.summary?.includes('20/09/2026 (à venir)'), m?.summary)
  assert.equal(m?.sourceTitle, 'Manifestaction (Infinity)')
})

test('⭐ l’événement RÉEL du 10/09 est rejeté : « jdfdosij », sans description, annulé, passé', () => {
  // Reproduit tel quel ce que les relais ont servi ce soir-là.
  const jdfdosij = ev(KIND_MANIFESTACTION, {
    title: 'jdfdosij', description: '', categories: [], status: 'cancelled',
    location: 'Valais', coordinates: [7.3, 46.2], startDate: Date.UTC(2026, 7, 2),
  }, [], 38)
  assert.equal(lireManifestaction(jdfdosij, MAINTENANT), null)
  assert.equal(retenirSujets([jdfdosij], 5, MAINTENANT).length, 0)
})

test('⭐ chacune des trois règles suffit à elle seule', () => {
  const base = { title: 'Action', description: D, startDate: MAINTENANT + 5 * J }
  assert.ok(lireManifestaction(ev(KIND_MANIFESTACTION, base), MAINTENANT), 'le témoin doit passer')
  assert.equal(lireManifestaction(ev(KIND_MANIFESTACTION, { ...base, description: 'Trop court.' }), MAINTENANT), null, 'description')
  assert.equal(lireManifestaction(ev(KIND_MANIFESTACTION, { ...base, status: 'cancelled' }), MAINTENANT), null, 'annulée')
  assert.equal(lireManifestaction(ev(KIND_MANIFESTACTION, { ...base, startDate: MAINTENANT - 10 * J }), MAINTENANT), null, 'passée')
})

test('⭐ un événement terminé HIER reste, mais annoncé au passé', () => {
  const m = lireManifestaction(ev(KIND_MANIFESTACTION, { title: 'Récolte', description: D, startDate: MAINTENANT - J }), MAINTENANT)
  assert.match(m?.summary ?? '', /terminée — à rapporter au passé/)
})

test('un événement en cours est dit « en cours »', () => {
  const m = lireManifestaction(ev(KIND_MANIFESTACTION, {
    title: 'Chantier', description: D, startDate: MAINTENANT - 2 * J, endDate: MAINTENANT + 2 * J,
  }), MAINTENANT)
  assert.match(m?.summary ?? '', /\(en cours\)/)
})

test('⭐ ce qui n’est pas une Manifestaction Infinity reste REJETÉ', () => {
  // Formes relevées le 10/09 sur les relais, venues d'autres applications.
  for (const etranger of [
    { spec: 'x', version: 1, type: 't', id: 'i', scope: 's', visibility: 'v' },
    { protocol: 'p', v: 1, channel: 'c', payload: {} },
    { Heartbeat: 1 },
    'partie de MatchHello',
    '[1,2,3]',
  ]) assert.equal(lireManifestaction(ev(KIND_MANIFESTACTION, etranger), MAINTENANT), null)
})

test('un projet Abondance exige un objectif chiffré ET une description', () => {
  const p = lireProjetAbondance(ev(KIND_PROJET_ABONDANCE, { title: 'Four solaire', description: D, goal: 1500 }, [['category', 'energie']]))
  assert.equal(p?.title, 'Four solaire')
  assert.ok(p?.summary?.includes('1500') && p?.summary?.includes('energie'))
  assert.equal(lireProjetAbondance(ev(KIND_PROJET_ABONDANCE, { title: 'X', description: D })), null, 'sans objectif')
  assert.equal(lireProjetAbondance(ev(KIND_PROJET_ABONDANCE, { title: 'X', description: D, goal: 0 })), null, 'objectif nul')
  assert.equal(lireProjetAbondance(ev(KIND_PROJET_ABONDANCE, { title: 'X', description: 'Court.', goal: 10 })), null, 'sans matière')
})

test('⭐ une proposition ne s’annonce QUE si le vote est ouvert… et pas échu', () => {
  const ok = { title: 'Article 4 — l’eau', description: D, status: 'open', expiresAt: MAINTENANT + 20 * J, quorum: 50 }
  const prop = lirePropositionDav(ev(KIND_PROPOSITION_DAV, ok), MAINTENANT)
  assert.ok(prop?.summary?.includes('30/09/2026'))
  assert.equal(lirePropositionDav(ev(KIND_PROPOSITION_DAV, { ...ok, status: 'draft' }), MAINTENANT), null, 'brouillon')
  assert.equal(lirePropositionDav(ev(KIND_PROPOSITION_DAV, { ...ok, status: 'closed' }), MAINTENANT), null, 'close')
  // Statut resté « open » mais échéance passée : le vote est clos, on ne l'annonce pas ouvert.
  assert.equal(lirePropositionDav(ev(KIND_PROPOSITION_DAV, { ...ok, expiresAt: MAINTENANT - J }), MAINTENANT), null, 'échue')
})

test('⭐ le tri ne laisse aucune famille hors antenne', () => {
  const lot = [
    ev(KIND_MANIFESTACTION, { title: 'M1', description: D, startDate: MAINTENANT + J }, [], 1),
    ev(KIND_MANIFESTACTION, { title: 'M2', description: D, startDate: MAINTENANT + J }, [], 2),
    ev(KIND_MANIFESTACTION, { title: 'M3', description: D, startDate: MAINTENANT + J }, [], 3),
    ev(KIND_PROJET_ABONDANCE, { title: 'P1', description: D, goal: 10 }, [], 20),
    ev(KIND_PROPOSITION_DAV, { title: 'D1', description: D, status: 'open' }, [], 30),
  ]
  const trois = retenirSujets(lot, 3, MAINTENANT).map(s => s.title)
  assert.equal(new Set(trois).size, 3)
  assert.ok(trois.includes('P1') && trois.includes('D1') && trois.includes('M1'))
})

test('ce qui a été publié il y a longtemps sort de l’antenne', () => {
  const vieux = ev(KIND_MANIFESTACTION, { title: 'Ancien', description: D, startDate: MAINTENANT + J }, [], 200)
  assert.equal(retenirSujets([vieux], 5, MAINTENANT).length, 0)
})
