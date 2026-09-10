/**
 * La republication REMPLACE l'événement d'une émission. Elle ne doit rien
 * perdre, ne toucher qu'à nos propres événements, et prendre la dernière
 * émission de chaque station.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import {
  choisirDernieres, pourquoiNonReconstructible, aReemballer, aRehorodater, horodatageDeRepublication,
  type EvenementNostr,
} from '../reemballage'

const NOUS = 'a'.repeat(64)
const EUX = 'b'.repeat(64)

function ev(station: string, date: string, opts: Partial<EvenementNostr> & { contenu?: Record<string, unknown> } = {}): EvenementNostr {
  const contenu = opts.contenu ?? {
    stationId: station, date, language: 'fr', durationSec: 1199.6, audioCid: 'Qm' + station,
    audioMime: 'audio/ogg', turns: [], newsRefs: [], model: 'm', generatedAt: 1,
  }
  return {
    kind: opts.kind ?? 30093, pubkey: opts.pubkey ?? NOUS, created_at: opts.created_at ?? 100,
    tags: opts.tags ?? [
      ['d', `${station}:${date}`], ['station', station], ['date', date], ['lang', 'fr'],
      ['duration', '1200'], ['t', 'radio-broadcast'], ['visibility', 'public'],
    ],
    content: JSON.stringify(contenu),
  }
}

test('la dernière émission de chaque station, par date puis par publication', () => {
  const m = choisirDernieres([
    ev('pirate', '2026-09-10'), ev('pirate', '2026-09-11', { created_at: 50 }),
    ev('pirate', '2026-09-11', { created_at: 90 }), ev('oasis', '2026-09-09'),
  ], NOUS)
  assert.equal(m.size, 2)
  assert.equal(m.get('pirate')!.created_at, 90)
  assert.equal(JSON.parse(m.get('oasis')!.content).date, '2026-09-09')
})

test('🔴 jamais l’événement d’un autre auteur, jamais un autre kind', () => {
  const m = choisirDernieres([
    ev('pirate', '2026-09-12', { pubkey: EUX }),
    ev('pirate', '2026-09-13', { kind: 1 }),
    ev('pirate', '2026-09-10'),
  ], NOUS)
  assert.equal(JSON.parse(m.get('pirate')!.content).date, '2026-09-10')
})

test('un événement fidèle se reconstruit à l’identique', () => {
  assert.equal(pourquoiNonReconstructible(ev('pirate', '2026-09-11')), null)
})

test('une clé de contenu inconnue serait perdue : refus', () => {
  const e = ev('p', '2026-09-11', { contenu: { stationId: 'p', date: '2026-09-11', language: 'fr', durationSec: 1200,
    audioCid: 'Qm', audioMime: 'audio/ogg', turns: [], newsRefs: [], model: 'm', generatedAt: 1, voix: 'x' } })
  assert.match(pourquoiNonReconstructible(e)!, /clé de contenu inconnue « voix »/)
})

test('une balise en plus, une valeur divergente, une balise absente : refus', () => {
  const base = ev('p', '2026-09-11').tags
  assert.match(pourquoiNonReconstructible(ev('p', '2026-09-11', { tags: [...base, ['r', 'x']] }))!, /balise inconnue « r »/)
  assert.match(pourquoiNonReconstructible(ev('p', '2026-09-11', {
    tags: base.map(t => t[0] === 'duration' ? ['duration', '999'] : t) }))!, /« duration » : « 999 » deviendrait « 1200 »/)
  assert.match(pourquoiNonReconstructible(ev('p', '2026-09-11', { tags: base.filter(t => t[0] !== 'visibility') }))!,
    /« visibility » absente/)
  assert.match(pourquoiNonReconstructible(ev('p', '2026-09-11', {
    tags: base.map(t => t[0] === 't' ? ['t', 'radio-broadcast', 'extra'] : t) }))!, /plusieurs valeurs/)
})

test('seul le format publié est épargné', () => {
  assert.equal(aReemballer({ audioMime: 'audio/ogg' }), true)
  assert.equal(aReemballer({ audioMime: 'audio/wav' }), true)
  assert.equal(aReemballer({ audioMime: 'audio/webm' }), false)
})

// ── 🔴 L'application départage sur generatedAt, et garde la PREMIÈRE reçue à
//    valeur égale. Une republication qui garde l'horodatage d'origine laisse
//    l'émission Ogg — muette — gagner selon l'ordre d'arrivée des relais.

test('🔴 une republication est STRICTEMENT plus récente que l’ancienne version', () => {
  assert.equal(horodatageDeRepublication(1000, 2000), 2000)
  assert.equal(horodatageDeRepublication(5000, 2000), 5001, 'jamais égal, jamais plus ancien : l’app garderait l’ancienne')
  assert.equal(horodatageDeRepublication('illisible', 2000), 2000)
})

test('une émission déjà en WebM mais à l’horodatage d’origine est à rehorodater', () => {
  const webm = { stationId: 'p', date: '2026-09-11', language: 'fr', durationSec: 1200, audioCid: 'Qm',
    audioMime: 'audio/webm', turns: [], newsRefs: [], model: 'm', generatedAt: 1_789_000_000 }
  assert.equal(aRehorodater(ev('p', '2026-09-11', { contenu: webm, created_at: 1_789_000_000 + 5 * 86400 })), true)
  assert.equal(aRehorodater(ev('p', '2026-09-11', { contenu: webm, created_at: 1_789_000_030 })), false,
    'une émission de la nuit (generatedAt ≈ created_at) ne se rehorodate pas')
  assert.equal(aRehorodater(ev('p', '2026-09-11', { contenu: { ...webm, audioMime: 'audio/ogg' }, created_at: 1_789_900_000 })), false,
    'une émission Ogg se RÉEMBALLE, elle ne se contente pas d’un nouvel horodatage')
})

const script = readFileSync(resolve(process.cwd(), 'src/scripts/reemballer-webm.ts'), 'utf8')

test('🔴 le script avance generatedAt dans ses DEUX chemins de publication', () => {
  assert.match(script, /const generatedAt = horodatageDeRepublication\(c\.generatedAt, /)
  assert.match(script, /\{ \.\.\.c, audioCid: dep\.cid, audioMime: FORMAT_EMISSION\.mime, generatedAt, generatedBy: '' \}/,
    'le réemballage doit publier le nouvel horodatage')
  assert.match(script, /publishBroadcast\(\{ \.\.\.c, generatedAt, generatedBy: '' \}/,
    'le rehorodatage doit publier le nouvel horodatage')
})
