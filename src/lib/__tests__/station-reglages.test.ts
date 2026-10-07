/** La fiche IHL d'une station (kind 30091) : ce qui passe, ce qui est refusé, qui a le droit. */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  lireReglages, retenirEvent, appliquerReglages, stationsAjouteesIHL, stationAjoutee, KIND_RADIO_STATION,
} from '../station-reglages'
import { SEED_STATIONS } from '../../data/seed-stations'
import type { Event as NostrEvent } from 'nostr-tools/core'

const CID = 'bafybeibhjj5cyhauwnrrjntrkwncl6y3bhyetzow54jieku47f2igchw7e'
const pirate = SEED_STATIONS.find(s => s.id === 'pirate-radio')!
const HOTE = { id: 'ranouna', name: 'Ranouna', gender: 'male', trait: 'showman', color: '#888888', avatar: '🎙️' }

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
  const r = lireReglages(JSON.stringify({
    pauses: 42, pauseDureeS: 5, skipMusic: 'oui', tracks: 'x', name: '  ', language: 'klingon',
    hosts: [{ id: 'x', name: 'Sans genre', trait: '', color: '', avatar: '' }], actualite: { part: '50' },
    appels: { actifs: 'oui', nombre: 2 }, rythme: 'vite', sources: [{ type: 'ftp', url: 'x' }, { type: 'rss', url: ' ' }],
  }))!
  assert.deepEqual(r, {})
  assert.equal(lireReglages('{'), null)
  assert.equal(lireReglages(JSON.stringify({ deleted: true, tracks: [{ title: 'x', cid: CID }] })), null, 'une pierre tombale ne règle rien')
})

test('la fiche entière est lue : nom, slogan, raison d’être, langue, animateurs, invités, sources', () => {
  const r = lireReglages(JSON.stringify({
    name: ' Radio Test ', tagline: 'Le slogan', description: 'Parler d’eau douce et de rien d’autre.',
    language: 'en', hosts: [HOTE, { ...HOTE }, { id: 'y', name: 'Y', gender: 'robot', trait: '', color: '', avatar: '' }],
    guestIds: ['capitaine-burne', '', 'capitaine-burne', 3],
    sources: [{ type: 'rss', url: ' https://exemple.org/flux ', title: ' Flux ' }, { type: 'web', url: 'https://w.org' }],
  }))!
  assert.equal(r.name, 'Radio Test'); assert.equal(r.tagline, 'Le slogan')
  assert.equal(r.description, 'Parler d’eau douce et de rien d’autre.'); assert.equal(r.language, 'en')
  assert.deepEqual(r.hosts!.map(h => h.id), ['ranouna'], 'doublon et genre inconnu écartés')
  assert.deepEqual(r.guestIds, ['capitaine-burne'])
  assert.deepEqual(r.sources, [{ type: 'rss', url: 'https://exemple.org/flux', title: 'Flux' }, { type: 'web', url: 'https://w.org', title: '' }])
})

test('rythme / actualité / appels : ramenés dans les bornes (mêmes règles que l’app)', () => {
  const r = lireReglages(JSON.stringify({
    rythme: { dialogueDensity: 140, interventionRate: 'frenetic', averageSegmentSec: 10, globalMood: 'nimporte', verbosity: 'verbose', interruptionTendency: -5 },
    actualite: { part: 133.7 }, appels: { actifs: true, nombre: 9, tousLesNJours: 0.2 },
  }))!
  assert.deepEqual(r.rythme, {
    dialogueDensity: 100, interventionRate: 'frenetic', averageSegmentSec: 30, globalMood: 'satirique',
    verbosity: 'verbose', interruptionTendency: 0, contradictionPropensity: 50,
  })
  assert.deepEqual(r.actualite, { part: 100 })
  assert.deepEqual(r.appels, { actifs: true, nombre: 5, tousLesNJours: 1 })
})

function ev(pubkey: string, d: string, created_at: number, content = '{}', id = 'x'): NostrEvent {
  return { kind: KIND_RADIO_STATION, pubkey, created_at, content, tags: [['d', d]], id, sig: 'y' } as NostrEvent
}

test('🔴 seul un ADMIN règle une station (le « créateur » ne compte plus) ; le plus récent gagne', () => {
  const admin = 'a'.repeat(64), tiers = 'b'.repeat(64)
  const admins = new Set([admin])
  const events = [ev(tiers, 'pirate-radio', 300), ev(admin, 'pirate-radio', 100), ev(admin, 'pirate-radio', 200), ev(admin, 'oasis-fm', 999)]
  assert.equal(retenirEvent(events, 'pirate-radio', admins)?.created_at, 200)
  assert.equal(retenirEvent([ev(tiers, 'pirate-radio', 300)], 'pirate-radio', admins), null, 'un tiers ne pilote pas l’antenne')
  assert.equal(retenirEvent([ev(admin.toUpperCase(), 'pirate-radio', 1)], 'pirate-radio', admins)?.created_at, 1, 'casse indifférente')
  assert.equal(retenirEvent([ev(tiers, 'x', 1)], 'x', null)?.pubkey, tiers, '« * » lève le filtre')
  assert.equal(retenirEvent([ev(admin, 'p', 5, '{}', 'a1'), ev(admin, 'p', 5, '{}', 'b2')], 'p', admins)?.id, 'b2', 'égalité : l’id départage')
})

test('appliquer : les champs présents remplacent, la seed garde le reste', () => {
  const s = appliquerReglages(pirate, { tracks: [{ title: 'Nuit', cid: CID }], pauses: 1 })
  assert.equal(s.tracks!.length, 1); assert.equal(s.pauses, 1)
  assert.equal(s.hosts.length, pirate.hosts.length); assert.equal(s.language, pirate.language)
  assert.equal(s.description, pirate.description); assert.deepEqual(s.sources, pirate.sources)
  assert.equal(appliquerReglages(pirate, null), pirate)
})

test('appliquer : la raison d’être, le nom, les sources et les animateurs de l’IHL passent à l’antenne', () => {
  const r = lireReglages(JSON.stringify({
    name: 'Pirate Nouvelle', description: 'Raison d’être réglée dans l’IHL', hosts: [HOTE],
    sources: [{ type: 'rss', url: 'https://exemple.org/flux', title: 'Flux' }], actualite: { part: 0 },
  }))
  const s = appliquerReglages(pirate, r)
  assert.equal(s.name, 'Pirate Nouvelle')
  assert.equal(s.description, 'Raison d’être réglée dans l’IHL')
  assert.deepEqual(s.hosts.map(h => h.id), ['ranouna'])
  assert.deepEqual(s.sources!.map(x => x.url), ['https://exemple.org/flux'], 'les sources REMPLACENT celles de la seed')
  assert.deepEqual(s.actualite, { part: 0 })
})

test('appliquer : une langue sans voix commercialisable est refusée, la seed garde la sienne', () => {
  assert.equal(appliquerReglages(pirate, { language: 'ja' }).language, pirate.language)
  assert.equal(appliquerReglages(pirate, { language: 'es' }).language, 'es')
})

test('appliquer : aucun animateur complet, ou des sources vides → la seed garde les siens', () => {
  const r = lireReglages(JSON.stringify({ hosts: [], sources: [] }))
  const s = appliquerReglages(pirate, r)
  assert.equal(s.hosts, pirate.hosts); assert.equal(s.sources, pirate.sources)
})

test('stations hors seed : seules les fiches d’admin COMPLÈTES sont fabriquées', () => {
  const admin = 'a'.repeat(64), tiers = 'b'.repeat(64)
  const complete = { kind: 'user', frequency: 140.1, name: 'Radio Neuve', language: 'fr', hosts: [HOTE], description: 'Ligne' }
  const events = [
    ev(admin, 'radio-neuve', 10, JSON.stringify(complete)),
    ev(tiers, 'radio-tiers', 10, JSON.stringify({ ...complete, frequency: 141.1 })),
    ev(admin, 'sans-hote', 10, JSON.stringify({ ...complete, frequency: 142.1, hosts: [] })),
    ev(admin, 'en-japonais', 10, JSON.stringify({ ...complete, frequency: 143.1, language: 'ja' })),
    ev(admin, 'sur-pirate', 10, JSON.stringify({ ...complete, frequency: pirate.frequency + 0.01 })),
    ev(admin, 'bigballs-radio', 10, JSON.stringify({ deleted: true })),
    ev(admin, 'pirate-radio', 10, JSON.stringify(complete)),   // seed : pas une station ajoutée
  ]
  const { stations, ecartees } = stationsAjouteesIHL(events, new Set([admin]), SEED_STATIONS)
  assert.deepEqual(stations.map(s => s.id), ['radio-neuve'])
  assert.equal(stations[0].name, 'Radio Neuve'); assert.equal(stations[0].description, 'Ligne')
  assert.deepEqual(ecartees.map(e => e.id).sort(), ['bigballs-radio', 'en-japonais', 'sans-hote', 'sur-pirate'])
  assert.ok(!ecartees.some(e => e.id === 'radio-tiers'), 'la fiche d’un tiers n’est même pas examinée')
  assert.equal(stationAjoutee(ev(admin, 'x1', 1, JSON.stringify({ ...complete, name: '' })), SEED_STATIONS).motif, 'sans nom')
  assert.equal(stationAjoutee(ev(admin, 'x2', 1, JSON.stringify({ ...complete, language: undefined })), SEED_STATIONS).motif, 'sans langue')
})
