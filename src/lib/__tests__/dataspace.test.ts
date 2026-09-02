/**
 * @module InfinityScheduler/Lib/DataSpace/Tests
 * @description La lecture du CID est le maillon qui a MENTI.
 *
 *   02/09/2026 : l'outil d'envoi des voix a rapporté 29 échecs sur 29
 *   RÉUSSITES. data-space répond `{"files":[{"cid":…}]}` ; l'analyseur ne
 *   cherchait le CID qu'à la racine, ne le trouvait jamais, et comptait un
 *   échec. Nous avons failli renvoyer 133 Mo et signaler un bogue à un
 *   partenaire dont la route marchait parfaitement.
 *
 *   🔴 Ces tests gardent surtout ceci : une réponse sans CID doit LEVER.
 *   Rendre une chaîne vide ferait publier une émission dont le champ
 *   `audioCid` est vide — un événement d'apparence normale, muet pour
 *   toujours, et que rien ne distinguerait des autres.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { lireCid } from '../dataspace'

test('forme réelle de data-space : le CID est dans files[0]', () => {
  const r = lireCid('{"files":[{"cid":"QmABC","name":"a.opus","size":12}]}')
  assert.equal(r, 'QmABC')
})

test('formes alternatives tolérées — racine, data, majuscules', () => {
  assert.equal(lireCid('{"cid":"QmR"}'), 'QmR')
  assert.equal(lireCid('{"data":{"cid":"QmD"}}'), 'QmD')
  assert.equal(lireCid('{"Hash":"QmH"}'), 'QmH')
})

test('🔴 une réponse SANS CID lève — jamais une chaîne vide', () => {
  // Le cœur du garde. Un `audioCid: ""` publierait une émission muette
  // dont rien ne signalerait le défaut.
  assert.throws(() => lireCid('{"ok":true}'), /sans CID reconnaissable/)
  assert.throws(() => lireCid('{"files":[]}'), /sans CID reconnaissable/)
  assert.throws(() => lireCid('{"files":[{"name":"a.opus"}]}'), /sans CID reconnaissable/)
})

test('un CID vide est un ABSENT, pas un CID', () => {
  assert.throws(() => lireCid('{"files":[{"cid":""}]}'), /sans CID reconnaissable/)
})

test('une réponse non JSON lève en le disant', () => {
  // Une passerelle qui rend une page HTML d'erreur ne doit pas être lue
  // comme « pas de CID » : la cause est ailleurs et le message doit aider.
  assert.throws(() => lireCid('<html>502 Bad Gateway</html>'), /réponse illisible/)
})
