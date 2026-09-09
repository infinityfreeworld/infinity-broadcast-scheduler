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
import { readFileSync } from 'node:fs'
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

test("🔴 l'aller-retour est ACTIVÉ PAR DÉFAUT, pas en option", () => {
  // Le 07/09/2026, deux modèles de 63 Mo ont rendu le même CID, qui
  // servait 4 888 octets de JSON. Un CID faux ne se voit NULLE PART :
  // l'envoi rend 200, le manifeste s'écrit, et des semaines plus tard une
  // voix parle avec le mauvais modèle. Le défaut doit donc être « vérifie ».
  const src = readFileSync(new URL('../dataspace.ts', import.meta.url), 'utf8')
  assert.match(src, /verifier: boolean = true/)
  assert.match(src, /sert d'AUTRES octets/)
  assert.match(src, /rendu\.length !== data\.length/)
})

test('un CID injoignable est un ÉCHEC, pas un succès silencieux', () => {
  const src = readFileSync(new URL('../dataspace.ts', import.meta.url), 'utf8')
  assert.match(src, /rendu mais INJOIGNABLE/)
})

test('🔴 la production ne dépose QUE chez data-space', () => {
  // Décision du Bâtisseur (09/09/2026) : « on ne travaille plus avec
  // Pinata, uniquement avec data-space ». J'avais gardé Pinata en second
  // dépôt de ma propre initiative, contre une consigne déjà donnée.
  //
  // Conséquence assumée : plus de second épinglage. Si data-space refuse,
  // l'émission n'est pas publiée — au lieu d'être publiée avec un CID que
  // data-space ne sert pas. Échouer franchement vaut mieux que publier
  // une émission muette.
  const gb = readFileSync(new URL('../../scripts/generate-broadcast.ts', import.meta.url), 'utf8')
  const ga = readFileSync(new URL('../../scripts/generate-all.ts', import.meta.url), 'utf8')
  for (const [nom, src] of [['generate-broadcast', gb], ['generate-all', ga]] as const) {
    assert.ok(!/pinataPinFile|purgeOldBroadcasts|PINATA_JWT/.test(src),
      `${nom} ne doit plus appeler Pinata`)
  }
  // TÉMOIN POSITIF : sans lui, un fichier vidé passerait ce test.
  assert.match(gb, /dataspacePinFile\(opusBlob/, 'le dépôt data-space doit rester')
})

test("un dépôt data-space impossible ARRÊTE l'émission", () => {
  // Sans second dépôt, publier malgré un échec donnerait un événement
  // d'apparence normale, muet pour toujours.
  const gb = readFileSync(new URL('../../scripts/generate-broadcast.ts', import.meta.url), 'utf8')
  assert.match(gb, /Aucun jeton data-space[\s\S]{0,200}throw|throw new Error\([\s\S]{0,80}Aucun jeton data-space/)
})
