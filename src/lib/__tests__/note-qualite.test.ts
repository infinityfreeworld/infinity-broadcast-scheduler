/**
 * @module InfinityScheduler/Lib/NoteQualiteTests
 * @description 🏷 La note de qualité publiée avec l'émission : calcul, bornes, et contrat ADDITIF
 *   (l'émission sans note reste identique, l'ancienne application lit la nouvelle sans broncher).
 *
 *   Lancer :  npx tsx --test src/lib/__tests__/note-qualite.test.ts
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { noteQualite, resumeQualite } from '../note-qualite'
import { contenuEmission } from '../nostr'
import type { RadioBroadcast } from '../types'

test('⭐ la note d’une nuit GitHub d’avant (oreille absente) : tout ce que le journal disait', () => {
  // tech-radio, 12/10/2026 : 16 clonées, 6 en repli, 4 défectueux dont 2 régénérés + 1 rogné.
  const n = noteQualite({
    voixAttendues: 22, voixObtenues: 16,
    reprise: { clone: 16, repris: 0, incompris: 0 },
    controle: { defectueux: 4, regeneres: 2, rognes: 1 },
    oreille: { statut: 'absente', ecoutes: 0, refaits: 0, hesitationsEcrites: 0, hesitationsAvalees: 0 },
    sonie: { apresLufs: -16.04, creteDb: -1.5 },
    producteur: 'github-secours',
  })
  assert.deepEqual(n, {
    version: 1, voixAttendues: 22, voixClonees: 16, voixSecours: 6, incompris: 0,
    defautsDetectes: 4, defautsCorriges: 3, oreille: 'absente', lufs: -16, creteDb: -1.5, producteur: 'github-secours',
  })
  assert.match(resumeQualite(n), /voix de personnage 16\/22 \(6 en secours\) · défauts 3\/4 corrigés · oreille absente · -16 LUFS/)
})

test('oreille active : écoutes, tours refaits, « euh » entendus', () => {
  const n = noteQualite({
    voixAttendues: 22, voixObtenues: 22, reprise: { clone: 20, repris: 2, incompris: 0 },
    controle: { defectueux: 0, regeneres: 0, rognes: 0 },
    oreille: { statut: 'active', ecoutes: 24, refaits: 2, hesitationsEcrites: 9, hesitationsAvalees: 3 },
  })
  assert.equal(n.voixClonees, 22)
  assert.equal(n.voixSecours, 0)
  assert.equal(n.ecoutes, 24)
  assert.deepEqual(n.hesitations, { ecrites: 9, entendues: 6 })
  assert.equal(n.lufs, undefined, 'sans normalisation, pas de sonie inventée')
})

test('station sans voix de personnage, sans reprise : aucun nombre négatif ni absurde', () => {
  const n = noteQualite({ voixAttendues: 0, voixObtenues: 0 })
  assert.deepEqual(n, { version: 1, voixAttendues: 0, voixClonees: 0, voixSecours: 0, incompris: 0, defautsDetectes: 0, defautsCorriges: 0, oreille: 'non-branchee' })
  const bizarre = noteQualite({ voixAttendues: 3, voixObtenues: 9, controle: { defectueux: 1, regeneres: 4, rognes: 0 } })
  assert.equal(bizarre.voixClonees, 3, 'jamais plus de clonées que d’attendues')
  assert.equal(bizarre.defautsCorriges, 1, 'jamais plus de corrigés que de détectés')
})

const BASE: RadioBroadcast = {
  stationId: 'obf-radio', date: '2026-10-13', language: 'fr', durationSec: 900, audioCid: 'Qm', audioMime: 'audio/webm',
  turns: [], newsRefs: [], model: 'm', generatedBy: '', generatedAt: 1,
}

test('⭐ contrat ADDITIF : le champ `qualite` n’apparaît que s’il existe, le reste est inchangé', () => {
  const sans = JSON.parse(contenuEmission(BASE))
  assert.equal('qualite' in sans, false)
  const note = noteQualite({ voixAttendues: 2, voixObtenues: 2 })
  const avec = JSON.parse(contenuEmission({ ...BASE, qualite: note }))
  assert.deepEqual(avec.qualite, note)
  const { qualite: _q, ...reste } = avec
  assert.deepEqual(reste, sans, 'les champs lus par l’application ne bougent pas')
})
