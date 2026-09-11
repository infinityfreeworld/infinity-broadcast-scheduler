/**
 * @module InfinityScheduler/Lib/VoixLicences/Tests
 * @description Un audit fait une fois se périme au prochain ajout de voix.
 *   Celui-ci ne peut pas se périmer sans faire ROUGIR la porte : le test
 *   parcourt toutes les voix atteignables depuis `voixPourLangue`, pour
 *   chaque animateur seed, chaque genre et chaque langue.
 *
 *   Lancer :  npx tsx --test src/lib/__tests__/voix-licences.test.ts
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { voixPourLangue, languesDiffusables, type Genre } from '../voix'
import { estVoixKokoro } from '../kokoro'
import { voixCommercialisable, licenceDe, LICENCES_PIPER } from '../voix-licences'
import { voixDuRegistre, isVoiceSupported } from '../piper'
import { SEED_STATIONS } from '../../data/seed-stations'
import type { StationLanguage } from '../types'

const GENRES: Genre[] = ['male', 'female', 'androgyn']
const LANGUES: StationLanguage[] = ['fr', 'en', 'es', 'it', 'pt', 'hi', 'ja', 'zh', 'ru']

test('aucune voix NON COMMERCIALISABLE n\'est atteignable', () => {
  const fautives: string[] = []
  for (const st of SEED_STATIONS) {
    const langue = st.language ?? 'fr'
    for (const h of st.hosts) {
      const v = voixPourLangue(langue, h.gender, h.id)
      if (v && !voixCommercialisable(v)) {
        fautives.push(`${st.id}/${h.id} (${langue}, ${h.gender}) → ${v} [${licenceDe(v)?.licence}]`)
      }
    }
  }
  // Et le repli par genre, hors animateur nommé.
  for (const langue of LANGUES) {
    for (const genre of GENRES) {
      const v = voixPourLangue(langue, genre)
      if (v && !voixCommercialisable(v)) fautives.push(`repli ${langue}/${genre} → ${v}`)
    }
  }
  assert.deepEqual(fautives, [], 'voix non commercialisables atteignables')
})

test('fr_FR-tom-medium (AGPLv3) n\'est plus atteignable NULLE PART', () => {
  // Le défaut réel du 01/09/2026 : cette voix sortait sur toutes les
  // stations françaises. Ce test est ce qui l'empêche de revenir.
  assert.equal(voixCommercialisable('fr_FR-tom-medium'), false)
  assert.equal(isVoiceSupported('fr_FR-tom-medium'), false, 'retirée du registre technique')
  for (const st of SEED_STATIONS) {
    for (const h of st.hosts) {
      assert.notEqual(voixPourLangue(st.language ?? 'fr', h.gender, h.id), 'fr_FR-tom-medium')
    }
  }
})

test('toute voix du registre technique déclare sa licence', () => {
  // Sinon une voix ajoutée sans licence partirait à l'antenne parce que
  // personne n'y aurait pensé.
  const sansLicence = voixDuRegistre().filter(v => licenceDe(v) === undefined)
  assert.deepEqual(sansLicence, [], 'voix sans licence déclarée')
  const refusees = voixDuRegistre().filter(v => !voixCommercialisable(v))
  assert.deepEqual(refusees, [], 'voix refusée présente dans le registre technique')
})

test('toute voix atteignable est téléchargeable par le scheduler', () => {
  // Une voix nommée mais absente du registre technique planterait à
  // l'exécution, après la dépense LLM.
  // Kokoro (chinois) tient son propre registre, épinglé par empreinte : lib/kokoro.ts.
  const manquantes: string[] = []
  for (const langue of LANGUES) {
    for (const genre of GENRES) {
      const v = voixPourLangue(langue, genre)
      if (v && !isVoiceSupported(v) && !estVoixKokoro(v)) manquantes.push(`${langue}/${genre} → ${v}`)
    }
  }
  for (const st of SEED_STATIONS) {
    for (const h of st.hosts) {
      const v = voixPourLangue(st.language ?? 'fr', h.gender, h.id)
      if (v && !isVoiceSupported(v) && !estVoixKokoro(v)) manquantes.push(`${st.id}/${h.id} → ${v}`)
    }
  }
  assert.deepEqual(manquantes, [], 'voix atteignables absentes du registre technique')
})

test('le chinois est servi par des voix chinoises NATIVES, jamais par une voix étrangère', () => {
  // Jusqu'au 11/09/2026, refusé franchement faute de voix sous licence.
  // Désormais Kokoro-82M v1.1-zh (Apache-2.0) — cf. lib/kokoro.ts.
  for (const genre of GENRES) {
    const v = voixPourLangue('zh', genre)
    assert.ok(v && estVoixKokoro(v), `zh/${genre} → ${v} : une voix étrangère épellerait les sinogrammes`)
  }
  assert.ok(languesDiffusables().includes('zh'))
  assert.ok(languesDiffusables().includes('fr'))
  assert.ok(languesDiffusables().includes('ru'))
})

test('une langue SANS voix reste refusée franchement', () => {
  // Le refus franc demeure la règle : le chinois en sort parce qu'il a
  // trouvé des voix, pas parce que la règle s'est relâchée.
  for (const genre of GENRES) assert.equal(voixPourLangue('ja', genre), null, `ja/${genre} doit être refusé`)
  assert.ok(!languesDiffusables().includes('ja'))
})

test('les attributions obligatoires ne sont pas perdues', () => {
  // CC BY / CC BY-SA imposent un crédit : s'il disparaît du registre, la
  // voix devient inutilisable en l'état.
  for (const [nom, l] of Object.entries(LICENCES_PIPER)) {
    if (l.commercial && /CC BY/i.test(l.licence)) {
      assert.ok(l.attribution && l.attribution.length > 0, `${nom} : crédit manquant`)
    }
  }
})

test('une voix d\'animateur refusée retombe sur le repli, sans laisser un muet', () => {
  // Reproduit le cas révélé par mutation : si un timbre nommé devenait
  // non commercialisable, l'animateur ne doit pas se retrouver SANS voix
  // (le plantage arriverait alors après la dépense LLM).
  const v = voixPourLangue('fr', 'male', 'animateur-qui-nexiste-pas')
  assert.ok(v !== null, 'un animateur inconnu doit obtenir le repli par genre')
  assert.ok(voixCommercialisable(v!))
})
