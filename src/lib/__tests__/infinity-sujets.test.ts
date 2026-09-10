/**
 * @module InfinityScheduler/Lib/SujetsInfinity/Tests
 * @description 🌍 La télévision parle de l'APPLICATION — et rejette ce qui n'en vient pas.
 *
 *   Retour du Bâtisseur (09/09/2026) : « les thèmes doivent absolument concerner les sujets de
 *   l'application, comme les DAV, les Manifestactions, les projets proposés dans Abondance ».
 *
 *   Ces contrôles gardent les DEUX moitiés de la promesse : qu'on lise bien ces sujets, et
 *   qu'un event étranger posé sur le même kind ne soit JAMAIS lu à l'antenne d'une voix posée.
 *   Le kind est un espace partagé : mesuré le 01/09/2026, le 30101 portait 326 events de 306
 *   pubkeys dont aucune n'était Infinity.
 *
 *   Lancer :  npx tsx --test src/lib/__tests__/infinity-sujets.test.ts
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import type { Event as NostrEvent } from 'nostr-tools'
import {
  lireManifestaction, lireProjetAbondance, lirePropositionDav, retenirSujets,
  KIND_MANIFESTACTION, KIND_PROJET_ABONDANCE, KIND_PROPOSITION_DAV,
} from '../infinity-sujets'

const MAINTENANT = Date.UTC(2026, 8, 10)
const ev = (kind: number, content: unknown, tags: string[][] = [], ageJours = 1): NostrEvent => ({
  kind, id: 'x', pubkey: 'p', sig: 's', tags,
  created_at: Math.floor((MAINTENANT - ageJours * 86400_000) / 1000),
  content: typeof content === 'string' ? content : JSON.stringify(content),
} as NostrEvent)

test('une Manifestaction se lit, avec son lieu et sa date', () => {
  const m = lireManifestaction(ev(KIND_MANIFESTACTION, {
    title: 'Nettoyage des berges', description: 'Ramassage collectif le long de la rivière',
    location: 'Sion', startDate: Date.UTC(2026, 8, 20),
  }))
  assert.equal(m?.title, 'Nettoyage des berges')
  assert.ok(m?.summary?.includes('Sion'), 'le lieu doit être dit')
  assert.ok(m?.summary?.includes('20/09/2026'), 'la date doit être dite')
  // La source se nomme : sans elle, le JT ne sait pas qu'il parle de chez lui.
  assert.equal(m?.sourceTitle, 'Manifestaction (Infinity)')
})

test('⭐ ce qui n’est pas une Manifestaction Infinity est REJETÉ', () => {
  // Un kind est un espace PARTAGÉ. Le risque n'est pas la prise de contrôle — c'est un JT
  // qui annoncerait sérieusement le contenu d'un event étranger.
  assert.equal(lireManifestaction(ev(KIND_MANIFESTACTION, 'partie de MatchHello')), null)
  assert.equal(lireManifestaction(ev(KIND_MANIFESTACTION, '[1,2,3]')), null)
  assert.equal(lireManifestaction(ev(KIND_MANIFESTACTION, { question: 'Quel est ton animal ?' })), null)
  // « Manifestaction fantôme » : ni titre ni description. Même règle que le codec de l'app —
  // un JT qui annonce « Pas de description » est pire qu'un JT qui n'en parle pas.
  assert.equal(lireManifestaction(ev(KIND_MANIFESTACTION, { status: 'preparation' })), null)
})

test('un projet Abondance exige un objectif chiffré', () => {
  const p = lireProjetAbondance(ev(KIND_PROJET_ABONDANCE,
    { title: 'Four solaire', description: 'Cuire sans bois', goal: 1500 }, [['category', 'energie']]))
  assert.equal(p?.title, 'Four solaire')
  assert.ok(p?.summary?.includes('1500'))
  assert.ok(p?.summary?.includes('energie'), 'la catégorie vient du tag')
  assert.equal(lireProjetAbondance(ev(KIND_PROJET_ABONDANCE, { title: 'Vague idée' })), null)
  assert.equal(lireProjetAbondance(ev(KIND_PROJET_ABONDANCE, { title: 'X', goal: 0 })), null)
})

test('⭐ une proposition ne s’annonce QUE si le vote est ouvert', () => {
  // Une proposition en brouillon n'est pas une nouvelle : son auteur peut encore la réécrire
  // entièrement. L'annoncer, ce serait rapporter une décision que personne n'a prise.
  const prop = lirePropositionDav(ev(KIND_PROPOSITION_DAV, {
    title: 'Article 4 — l’eau', description: 'Statut de l’eau', status: 'open',
    expiresAt: Date.UTC(2026, 8, 30), quorum: 50,
  }))
  assert.equal(prop?.title, 'Article 4 — l’eau')
  assert.ok(prop?.summary?.includes('30/09/2026'), 'l’échéance du vote doit être dite')
  assert.equal(lirePropositionDav(ev(KIND_PROPOSITION_DAV, { title: 'X', status: 'draft' })), null)
  assert.equal(lirePropositionDav(ev(KIND_PROPOSITION_DAV, { title: 'X', status: 'closed' })), null)
})

test('⭐ le tri ne laisse aucune famille hors antenne', () => {
  // Trier par date seule donnerait, un jour de forte activité, un JT entièrement consacré aux
  // Manifestactions — et l'Assemblée n'existerait jamais à l'antenne.
  const lot = [
    ev(KIND_MANIFESTACTION, { title: 'M1', description: 'a' }, [], 1),
    ev(KIND_MANIFESTACTION, { title: 'M2', description: 'b' }, [], 2),
    ev(KIND_MANIFESTACTION, { title: 'M3', description: 'c' }, [], 3),
    ev(KIND_PROJET_ABONDANCE, { title: 'P1', goal: 10 }, [], 20),
    ev(KIND_PROPOSITION_DAV, { title: 'D1', status: 'open' }, [], 30),
  ]
  const trois = retenirSujets(lot, 3, MAINTENANT).map(s => s.title)
  assert.equal(new Set(trois).size, 3)
  assert.ok(trois.includes('P1') && trois.includes('D1'), 'chaque famille a sa place')
  assert.ok(trois.includes('M1'), 'et c’est le plus récent de sa famille')
})

test('ce qui est vieux sort de l’antenne', () => {
  assert.equal(retenirSujets([ev(KIND_MANIFESTACTION, { title: 'Ancien', description: 'a' }, [], 200)], 5, MAINTENANT).length, 0)
  assert.equal(retenirSujets([ev(KIND_MANIFESTACTION, { title: 'Récent', description: 'a' }, [], 10)], 5, MAINTENANT).length, 1)
})
