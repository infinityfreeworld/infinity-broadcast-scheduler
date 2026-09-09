/**
 * @module InfinityScheduler/Lib/RadioPersonas/Tests
 * @description Garde la règle « jamais les deux rôles le même jour » et
 *   l'exclusion des tombstones — deux défauts qui ne se voient pas dans
 *   un broadcast réussi.
 *
 *   Lancer :  npx tsx --test src/lib/__tests__/radio-personas.test.ts
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  getPersonaRoleOnStation,
  type RadioPersona,
} from '../radio-personas'

function persona(id: string, rules: Array<[string, boolean, boolean]>): RadioPersona {
  return {
    id, displayName: id, realIdentityHint: '', gender: 'androgyn',
    avatar: '🎙️', color: '#888888', trait: '', bio: '', instructions: '',
    behavior: 'adaptive', updatedAt: 0,
    stationRules: rules.map(([stationId, canHost, canGuest]) => ({ stationId, canHost, canGuest })),
  }
}

test('les 4 combinaisons de rôles sur une station', () => {
  assert.equal(getPersonaRoleOnStation(persona('p', [['s', true,  false]]), 's'), 'host')
  assert.equal(getPersonaRoleOnStation(persona('p', [['s', false, true ]]), 's'), 'guest')
  assert.equal(getPersonaRoleOnStation(persona('p', [['s', true,  true ]]), 's'), 'both')
  assert.equal(getPersonaRoleOnStation(persona('p', [['s', false, false]]), 's'), 'none')
  // Station absente des règles → non programmée.
  assert.equal(getPersonaRoleOnStation(persona('p', [['autre', true, true]]), 's'), 'none')
})

test('une persona mixte ne tient JAMAIS les deux rôles le même jour', async () => {
  const { assignRolesForStation, resetRoleAssignments } = await import('../radio-personas')

  process.env.RADIO_PERSONAS_UNIFIED_JSON = JSON.stringify({
    personas: {
      mixte: persona('mixte', [['wtf-radio', true, true]]),
      anim:  persona('anim',  [['wtf-radio', true, false]]),
      invit: persona('invit', [['wtf-radio', false, true]]),
    },
    overrides: {},
  })

  // Les deux faces du tirage, forcées.
  for (const [tirage, attendu] of [[0.1, 'hosts'], [0.9, 'guests']] as const) {
    resetRoleAssignments()
    const { hosts, guests } = assignRolesForStation('wtf-radio', 'fr', () => tirage)
    const dansHosts  = hosts.some(p => p.id === 'mixte')
    const dansGuests = guests.some(p => p.id === 'mixte')
    assert.notEqual(dansHosts, dansGuests, 'la mixte doit être d\'un seul côté')
    assert.equal(attendu === 'hosts' ? dansHosts : dansGuests, true)
    // Les non-mixtes restent à leur place quel que soit le tirage.
    assert.ok(hosts.some(p => p.id === 'anim'))
    assert.ok(guests.some(p => p.id === 'invit'))
  }
})

test('la répartition est STABLE sur un même broadcast', async () => {
  const { unifiedHostsForStation, unifiedGuestsForStation, resetRoleAssignments } =
    await import('../radio-personas')
  resetRoleAssignments()

  // rng qui alterne : sans mémorisation, les deux appels tireraient
  // différemment et la persona mixte sortirait des DEUX listes.
  let n = 0
  const rngAlterne = () => (n++ % 2 === 0 ? 0.1 : 0.9)

  const hosts  = unifiedHostsForStation('wtf-radio', 'fr', rngAlterne)
  const guests = unifiedGuestsForStation('wtf-radio', 'fr', rngAlterne)
  const enDouble = hosts.filter(h => guests.some(g => g.id === h.id))
  assert.deepEqual(enDouble.map(p => p.id), [], 'aucune persona des deux côtés')
})

test('une langue exclue retire la persona des DEUX listes', async () => {
  const { assignRolesForStation, resetRoleAssignments } = await import('../radio-personas')

  const muette = persona('muette', [['svoboda-fm', true, true]])
  muette.unavailableLanguages = ['ru']
  const parlante = persona('parlante', [['svoboda-fm', true, true]])
  process.env.RADIO_PERSONAS_UNIFIED_JSON = JSON.stringify({
    personas: { muette, parlante }, overrides: {},
  })
  resetRoleAssignments()   // vide aussi le cache d'env

  const { hosts, guests } = assignRolesForStation('svoboda-fm', 'ru', () => 0.1)
  const tous = [...hosts, ...guests].map(p => p.id)
  assert.ok(!tous.includes('muette'), 'la persona indisponible en ru ne doit apparaître nulle part')
  assert.ok(tous.includes('parlante'), 'témoin : une persona sans restriction passe bien')

  // La même persona SUR UNE AUTRE LANGUE doit repasser — sinon le test
  // ci-dessus pourrait réussir pour une mauvaise raison (persona jamais
  // chargée du tout).
  resetRoleAssignments()
  const autre = assignRolesForStation('svoboda-fm', 'fr', () => 0.1)
  assert.ok([...autre.hosts, ...autre.guests].map(p => p.id).includes('muette'))
})
