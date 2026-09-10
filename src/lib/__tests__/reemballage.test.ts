/**
 * La republication REMPLACE l'événement d'une émission. Elle ne doit rien
 * perdre, ne toucher qu'à nos propres événements, et prendre la dernière
 * émission de chaque station.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { choisirDernieres, pourquoiNonReconstructible, aReemballer, type EvenementNostr } from '../reemballage'

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
