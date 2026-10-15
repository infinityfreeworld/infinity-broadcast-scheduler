/**
 * Annonces d'animateur du direct (14/10/2026) : règle des titres (cas partagés avec l'app), choix
 * des pistes (musique du direct, repli sur la bibliothèque commune), cache par empreinte
 * texte + voix, format conforme à l'app, taille de l'événement bornée, échec de voix = pas
 * d'annonce (jamais de repli Piper).
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { titreAnnoncable } from '../titre-annoncable'
import {
  ANNONCES_MAX_APP, TAILLE_MAX_EVENEMENT, bornerAnnonces, ecrireCacheAnnonces, empreinteAnnonce,
  importerAnnoncesPubliees, lireCacheAnnonces, planAnnonces, reglagesAnnonces, tailleEvenement,
  titrePourAntenne, texteParle, type AnnonceAntenne, type CacheAnnonces,
} from '../annonces'
import { fabriquerAnnonces, preparerSonAnnonce, rognerSilences, type DependancesAnnonces } from '../annonces-fabrique'
import { musiqueDuDirect } from '../bibliotheque-musique'
import { musiqueDeRepli, type PisteBibliotheque } from '../selection-musique'
import { joursPrecedents } from '../annonces-nuit'
import { contenuEmission } from '../nostr'
import { mesurerLufs } from '../loudness'
import type { RadioBroadcast } from '../types'

const ICI = dirname(fileURLToPath(import.meta.url))
const CAS = JSON.parse(readFileSync(resolve(ICI, 'cas-titre-annoncable.json'), 'utf8')) as { cas: Array<{ titre: string; annoncable: boolean }> }

// ── La règle de l'app, à l'identique ─────────────────────────────────────

for (const c of CAS.cas) {
  test(`🔢 titre partagé avec l'app — ${JSON.stringify(c.titre)} → ${c.annoncable ? 'annonçable' : 'jamais'}`, () => {
    assert.equal(titreAnnoncable(c.titre), c.annoncable)
  })
}

test('🔢 titreAnnoncable : null et undefined ne s\'annoncent pas', () => {
  assert.equal(titreAnnoncable(null), false)
  assert.equal(titreAnnoncable(undefined), false)
})

test('🔢 titrePourAntenne : numérotation, extension, soulignés retirés ; « Titre — Artiste » séparé', () => {
  assert.deepEqual(titrePourAntenne('03 - Aurore boréale.mp3'), { titre: 'Aurore boréale' })
  assert.deepEqual(titrePourAntenne('Aurore_boreale'), { titre: 'Aurore boreale' })
  assert.deepEqual(titrePourAntenne('Aurore — Lena'), { titre: 'Aurore', artiste: 'Lena' })
  // L'app accepterait « Track 01 — Lena » (l'artiste fait un mot) : nous, jamais « voici Track 01 ».
  assert.equal(titrePourAntenne('Track 01 — Lena'), null)
  assert.equal(titrePourAntenne('01'), null)
  assert.equal(titrePourAntenne('x'.repeat(120)), null)
})

// ── Les pistes du direct (comme l'app : useMusiqueDuDirect) ─────────────

const CID = (n: number) => `bafybei${String(n).padStart(3, '0')}${'a'.repeat(50)}`
const BIBLIO: PisteBibliotheque[] = [
  { title: 'Aurore', cid: CID(2), artiste: 'Lena', genres: ['ambient'], langue: 'fr' },
  { title: 'Night Song', cid: CID(1), genres: ['jazz'], langue: 'en' },
  { title: 'Piste 3', cid: CID(3), genres: ['ambient'] },
]

test('🎵 musique du direct : la station d\'abord (choix + règles)', () => {
  const pistes = musiqueDuDirect({ tracks: [{ title: 'Choix', cid: CID(9) }], musique: { etiquettes: { genres: ['ambient'] } }, language: 'fr' }, BIBLIO)
  assert.deepEqual(pistes.map(p => p.cid), [CID(9), CID(2), CID(3)])
})

test('🎵 musique du direct : station sans musique → bibliothèque commune, sans chanson d\'une autre langue', () => {
  const pistes = musiqueDuDirect({ tracks: [], language: 'fr' }, BIBLIO)
  assert.deepEqual(pistes.map(p => p.cid), [CID(2), CID(3)])
  assert.deepEqual(pistes, musiqueDeRepli(BIBLIO, 'fr'))
  assert.equal(pistes[0].title, 'Aurore — Lena')
})

test('🎵 plan : seules les pistes avec CID et vrai titre sont annoncées, voici puis c\'était, sans doublon', () => {
  const plan = planAnnonces({ name: 'Diginomad', language: 'fr' }, [
    { title: 'Aurore — Lena', cid: CID(2) }, { title: 'Piste 3', cid: CID(3) }, { title: 'Sans CID' },
    { title: 'Aurore — Lena', cid: CID(2) }, { title: '07', cid: CID(7) },
  ], 2)
  assert.deepEqual(plan.map(p => [p.type, p.piste ?? '']), [['ident', ''], ['ident', ''], ['voici', CID(2)], ['cetait', CID(2)]])
  assert.match(plan[2].texte, /« Aurore », de Lena/)
  assert.match(plan[3].texte, /^(C'était|Vous venez d'écouter) « Aurore », de Lena\.$/)
})

test('🎙 idents : « Vous écoutez X, rejoignez-nous sur Infinity-freeworld.com », adresse dite en toutes lettres', () => {
  const plan = planAnnonces({ name: 'Diginomad', language: 'fr', tagline: 'Le code est libre' }, [], 4)
  assert.equal(plan[0].texte, 'Vous écoutez Diginomad. Rejoignez-nous sur Infinity-freeworld.com.')
  assert.equal(plan[0].parle, 'Vous écoutez Diginomad. Rejoignez-nous sur Infiniti tiret Friwourld point com.')
  assert.equal(plan[1].texte, 'Vous écoutez Diginomad. Le code est libre.')
  assert.equal(plan.length, 3)
  assert.equal(planAnnonces({ name: 'X', language: 'fr' }, [], 0).length, 0)
})

test('🌍 dans la langue de la station ; une langue inconnue → aucune annonce', () => {
  const ru = planAnnonces({ name: 'Свобода', language: 'ru' }, [{ title: 'Катюша', cid: CID(4) }], 1)
  assert.match(ru[0].texte, /^Вы слушаете Свобода/)
  assert.ok(ru.slice(1).every(a => a.texte.includes('«Катюша»')))
  const zh = planAnnonces({ name: '自由之声', language: 'zh' }, [{ title: '茉莉花', cid: CID(5) }], 1)
  assert.ok(zh[1].texte.includes('《茉莉花》'))
  assert.equal(zh[1].parle.includes('《'), false)
  assert.deepEqual(planAnnonces({ name: 'X', language: 'xx' }, [{ title: 'Aurore', cid: CID(2) }], 2), [])
})

test('🎲 la tournure d\'une piste est stable d\'une nuit à l\'autre (même texte → cache)', () => {
  const a = planAnnonces({ name: 'D', language: 'en' }, [{ title: 'Night Song', cid: CID(1) }], 0)
  const b = planAnnonces({ name: 'D', language: 'en' }, [{ title: 'Other', cid: CID(8) }, { title: 'Night Song', cid: CID(1) }], 0)
  assert.deepEqual(a, b.filter(x => x.piste === CID(1)))
})

test('🗣 texteParle : guillemets retirés', () => {
  assert.equal(texteParle('Et voici « Aurore ».', 'fr'), 'Et voici Aurore.')
})

// ── Cache par empreinte texte + voix ─────────────────────────────────────

const SONIE = { cible: -16, crete: -1.5 }

test('🔑 empreinte : même texte + même voix = même empreinte ; autre voix, autre texte ou autre sonie = autre', () => {
  const e = empreinteAnnonce('Et voici Aurore.', 'voix-a', 'fr', SONIE)
  assert.match(e, /^[0-9a-f]{24}$/)
  assert.equal(empreinteAnnonce('Et voici Aurore.', 'voix-a', 'fr', SONIE), e)
  assert.notEqual(empreinteAnnonce('Et voici Aurore.', 'voix-b', 'fr', SONIE), e)
  assert.notEqual(empreinteAnnonce('C\'était Aurore.', 'voix-a', 'fr', SONIE), e)
  assert.notEqual(empreinteAnnonce('Et voici Aurore.', 'voix-a', 'fr', { cible: -14, crete: -1.5 }), e)
})

test('💾 cache : écrit puis relu ; fichier abîmé → cache vide ; entrée invalide écartée', () => {
  const dossier = mkdtempSync(join(tmpdir(), 'annonces-cache-'))
  try {
    const chemin = join(dossier, 'sous', 'cache.json')
    assert.deepEqual(lireCacheAnnonces(chemin), {})
    const cache: CacheAnnonces = { ['a'.repeat(24)]: { cid: CID(1), dureeSec: 2.1, mime: 'audio/webm; codecs=opus', vu: '2026-10-15' } }
    ecrireCacheAnnonces(chemin, { ...cache, ['b'.repeat(24)]: { cid: 'court', dureeSec: 2, mime: 'x', vu: 'y' } })
    assert.deepEqual(lireCacheAnnonces(chemin), cache)
    ecrireCacheAnnonces(chemin, {})
    writeFileSync(chemin, '{abîmé')
    assert.deepEqual(lireCacheAnnonces(chemin), {})
  } finally {
    rmSync(dossier, { recursive: true, force: true })
  }
})

test('💾 cache : les annonces publiées la veille (avec empreinte) nourrissent le cache', () => {
  const cache: CacheAnnonces = {}
  const n = importerAnnoncesPubliees(cache, [
    { type: 'voici', cid: CID(1), dureeSec: 2, texte: 't', piste: CID(2), empreinte: 'c'.repeat(24) },
    { type: 'voici', cid: CID(1), dureeSec: 99, texte: 't', empreinte: 'd'.repeat(24) },
    { type: 'ident', cid: CID(1), dureeSec: 2, texte: 't' },
  ], '2026-10-15')
  assert.equal(n, 1)
  assert.equal(cache['c'.repeat(24)].cid, CID(1))
  assert.equal(importerAnnoncesPubliees(cache, 'pas un tableau', 'x'), 0)
})

// ── Fabrication ──────────────────────────────────────────────────────────

/** Une « voix » : 2 s de sinusoïde entourée de 0,5 s de silence. */
function voixFactice(): { samples: Float32Array; sampleRate: number } {
  const sr = 24000
  const s = new Float32Array(sr * 3)
  for (let i = sr / 2; i < sr * 2.5; i++) s[i] = 0.2 * Math.sin(i * 0.05)
  return { samples: s, sampleRate: sr }
}

function depsFactices(opts: { echec?: (texte: string) => boolean } = {}) {
  const appels = { synth: [] as string[], pins: 0 }
  const deps: DependancesAnnonces = {
    synthetiser: async (texte) => {
      appels.synth.push(texte)
      if (opts.echec?.(texte)) throw new Error('synthesis_failed (final)')
      return voixFactice()
    },
    encoder: async () => Buffer.from('webm'),
    epingler: async () => `bafybeiannonce${String(++appels.pins).padStart(4, '0')}${'b'.repeat(40)}`,
  }
  return { deps, appels }
}

const STATION = { id: 'diginomad', name: 'Diginomad', language: 'fr' }
const PISTES = [{ title: 'Aurore — Lena', cid: CID(2) }, { title: 'Night Song', cid: CID(1) }, { title: '01', cid: CID(3) }]
const VOIX = { id: 'dn-voix', animateur: 'dn-host' }
const REGLAGES = { ...reglagesAnnonces({}), idents: 2 }

test('🏭 format conforme à l\'app : type, cid, mime, dureeSec 0,3-15, texte, piste, animateur', async () => {
  const { deps } = depsFactices()
  const b = await fabriquerAnnonces({ station: STATION, pistes: PISTES, voix: VOIX, cache: {}, reglages: REGLAGES, date: '2026-10-15', deps, sonie: SONIE })
  assert.equal(b.annonces.length, 6)
  for (const a of b.annonces) {
    assert.ok(['ident', 'voici', 'cetait'].includes(a.type))
    assert.match(a.cid, /^[A-Za-z0-9]{20,100}$/)
    assert.equal(a.mime, 'audio/webm; codecs=opus')
    assert.match(a.mime!, /^audio\/[\w.+-]+(;.{0,60})?$/)
    assert.ok(a.dureeSec >= 0.3 && a.dureeSec <= 15, `durée ${a.dureeSec}`)
    assert.ok(a.texte.length > 0 && a.texte.length <= 240)
    assert.equal(a.animateur, 'dn-host')
    if (a.type !== 'ident') assert.ok(a.piste === CID(1) || a.piste === CID(2))
  }
  // Rognage : 2 s de voix + au plus 2 × 0,1 s de marge (le silence de 0,5 s autour a disparu).
  assert.ok(b.annonces[0].dureeSec <= 2.25 && b.annonces[0].dureeSec >= 1.95, `durée ${b.annonces[0].dureeSec}`)
})

test('🏭 cache : la nuit suivante, rien n\'est refabriqué ; même CID', async () => {
  const cache: CacheAnnonces = {}
  const n1 = depsFactices()
  const b1 = await fabriquerAnnonces({ station: STATION, pistes: PISTES, voix: VOIX, cache, reglages: REGLAGES, date: '2026-10-15', deps: n1.deps, sonie: SONIE })
  const n2 = depsFactices()
  const b2 = await fabriquerAnnonces({ station: STATION, pistes: PISTES, voix: VOIX, cache, reglages: REGLAGES, date: '2026-10-16', deps: n2.deps, sonie: SONIE })
  assert.equal(n2.appels.synth.length, 0)
  assert.equal(b2.reutilisees, 6)
  assert.deepEqual(b2.annonces.map(a => a.cid), b1.annonces.map(a => a.cid))
  assert.ok(Object.values(cache).every(e => e.vu === '2026-10-16'))
  // Autre voix → tout est à refaire.
  const n3 = depsFactices()
  await fabriquerAnnonces({ station: STATION, pistes: PISTES, voix: { ...VOIX, id: 'autre' }, cache, reglages: REGLAGES, date: '2026-10-16', deps: n3.deps, sonie: SONIE })
  assert.equal(n3.appels.synth.length, 6)
})

test('🏭 limite de la nuit : au plus N nouvelles, le reste est remis aux nuits suivantes', async () => {
  const cache: CacheAnnonces = {}
  const { deps, appels } = depsFactices()
  const b = await fabriquerAnnonces({ station: STATION, pistes: PISTES, voix: VOIX, cache, reglages: { ...REGLAGES, nouvellesMax: 3 }, date: 'j1', deps, sonie: SONIE })
  assert.equal(appels.synth.length, 3)
  assert.equal(b.nouvelles, 3)
  assert.equal(b.remises, 3)
  const n2 = depsFactices()
  const b2 = await fabriquerAnnonces({ station: STATION, pistes: PISTES, voix: VOIX, cache, reglages: { ...REGLAGES, nouvellesMax: 3 }, date: 'j2', deps: n2.deps, sonie: SONIE })
  assert.equal(b2.annonces.length, 6)
  assert.equal(b2.reutilisees, 3)
})

test('🚫 échec de voix = pas d\'annonce, jamais de repli ; deux échecs de suite → arrêt pour la station', async () => {
  const { deps, appels } = depsFactices({ echec: t => t.includes('Aurore') })
  const b = await fabriquerAnnonces({ station: STATION, pistes: PISTES, voix: VOIX, cache: {}, reglages: REGLAGES, date: 'j', deps, sonie: SONIE })
  assert.equal(b.echecs, 2)
  assert.ok(b.arret)
  assert.equal(b.annonces.some(a => a.piste === CID(2)), false)
  assert.equal(b.annonces.length, 2)   // les deux idents faits avant
  assert.equal(appels.synth.length, 4) // rien tenté après l'arrêt
  const tout = depsFactices({ echec: () => true })
  const b2 = await fabriquerAnnonces({ station: STATION, pistes: PISTES, voix: VOIX, cache: {}, reglages: REGLAGES, date: 'j', deps: tout.deps, sonie: SONIE })
  assert.deepEqual(b2.annonces, [])
})

test('🚫 sans voix clonée (ou ANNONCES=false) : aucune annonce, aucun appel', async () => {
  const { deps, appels } = depsFactices()
  assert.deepEqual((await fabriquerAnnonces({ station: STATION, pistes: PISTES, voix: null, cache: {}, reglages: REGLAGES, date: 'j', deps })).annonces, [])
  assert.deepEqual((await fabriquerAnnonces({ station: STATION, pistes: PISTES, voix: VOIX, cache: {}, reglages: reglagesAnnonces({ ANNONCES: 'false' }), date: 'j', deps })).annonces, [])
  assert.equal(appels.synth.length, 0)
})

test('🔊 son : silences rognés (≤ 0,15 s), calé sur la sonie de l\'antenne', () => {
  const v = voixFactice()
  const r = rognerSilences(v.samples, v.sampleRate)
  assert.ok(r.length <= v.sampleRate * 2.3)
  const p = preparerSonAnnonce(v, SONIE)
  assert.ok(Math.abs(mesurerLufs(p.samples, p.sampleRate) - SONIE.cible) < 1)
  assert.equal(rognerSilences(new Float32Array(100), 24000).length, 0)
})

// ── Taille de l'événement ────────────────────────────────────────────────

function emission(): RadioBroadcast {
  return {
    stationId: 'diginomad', date: '2026-10-15', language: 'fr', durationSec: 900, audioCid: CID(0), audioMime: 'audio/webm',
    turns: Array.from({ length: 22 }, (_, i) => ({ hostId: 'h', hostName: 'Hôte', text: `Réplique « ${i} » `.repeat(30), tStart: i * 40, tEnd: i * 40 + 39 })) as unknown as RadioBroadcast['turns'],
    newsRefs: [], model: 'm', generatedBy: '0'.repeat(64), generatedAt: 1,
  }
}

function annonce(i: number, type: AnnonceAntenne['type'] = 'voici'): AnnonceAntenne {
  return { type, cid: CID(i), mime: 'audio/webm; codecs=opus', dureeSec: 2.4, texte: `Et voici « Un titre assez long numéro ${i} », de Quelqu'un.`, piste: CID(1000 + Math.floor(i / 2)), animateur: 'dn-host', empreinte: 'e'.repeat(24) }
}

test('📏 taille bornée : l\'événement complet reste sous 60 Ko, au plus 400 annonces', () => {
  const b = emission()
  const contenuNu = contenuEmission(b)
  const toutes = Array.from({ length: 1000 }, (_, i) => annonce(i, i % 2 ? 'cetait' : 'voici'))
  const gardees = bornerAnnonces(toutes, contenuNu)
  assert.ok(gardees.length > 0 && gardees.length <= ANNONCES_MAX_APP)
  const taille = tailleEvenement(contenuEmission({ ...b, annonces: gardees }))
  assert.ok(taille <= TAILLE_MAX_EVENEMENT, `${taille} octets`)
  // Mesure : la taille réelle d'un événement signé est sous l'estimation.
  const reel = Buffer.byteLength(JSON.stringify({ id: 'f'.repeat(64), pubkey: 'f'.repeat(64), created_at: 1, kind: 30093, sig: 'f'.repeat(128),
    tags: [['d', 'diginomad:2026-10-15'], ['station', 'diginomad'], ['date', '2026-10-15'], ['lang', 'fr'], ['duration', '900'], ['t', 'radio-broadcast'], ['visibility', 'public'], ['producteur', 'mac-de-nuit']],
    content: contenuEmission({ ...b, annonces: gardees }) }))
  assert.ok(reel <= taille && reel <= TAILLE_MAX_EVENEMENT, `réel ${reel}, estimé ${taille}`)
  assert.equal(bornerAnnonces(toutes, contenuNu, 10).length, 10)
})

test('📏 une paire voici / c\'était n\'est jamais coupée ; émission déjà trop grosse → aucune annonce', () => {
  const paires = [annonce(0, 'voici'), { ...annonce(1, 'cetait'), piste: annonce(0).piste }]
  assert.equal(bornerAnnonces(paires, contenuEmission(emission()), 1).length, 0)
  assert.equal(bornerAnnonces(paires, 'x'.repeat(TAILLE_MAX_EVENEMENT)).length, 0)
})

test('📦 content : champ `annonces` ADDITIF, absent quand il n\'y en a pas', () => {
  const sans = JSON.parse(contenuEmission(emission())) as Record<string, unknown>
  assert.equal('annonces' in sans, false)
  const avec = JSON.parse(contenuEmission({ ...emission(), annonces: [annonce(1)] })) as Record<string, unknown>
  assert.deepEqual(avec.annonces, [annonce(1)])
  // Tout le reste est inchangé : les anciennes versions de l'app lisent la même émission.
  delete avec.annonces
  assert.deepEqual(avec, sans)
})

test('📅 émissions précédentes interrogées : la veille et l\'avant-veille', () => {
  assert.deepEqual(joursPrecedents('2026-10-01'), ['2026-09-30', '2026-09-29'])
  assert.deepEqual(joursPrecedents('n\'importe quoi'), [])
})
