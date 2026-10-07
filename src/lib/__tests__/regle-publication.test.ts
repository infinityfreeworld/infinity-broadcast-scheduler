/**
 * @module InfinityScheduler/Lib/ReglePublicationTests
 * @description ⚖️ « Si elle sonne robotique ou incompréhensible, elle est refabriquée au lieu
 *   d'être diffusée » (Bâtisseur, 07/10/2026) — et la fenêtre de nuit qui laisse le temps de le
 *   faire. Logique pure, aucun réseau.
 *
 *   Lancer :  npx tsx --test src/lib/__tests__/regle-publication.test.ts
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import {
  deciderPublication, modeFinal, reglesPublication, estDerniereChance, joursPrecedents,
  CODE_A_REPRENDRE, CODE_VEILLE_GARDEE, type EtatEmission,
} from '../regle-publication'
import {
  reglagesFenetre, finDeFenetre, echeanceVoixClonees, derniereChance, pauseAvantReprise, classerSortie,
} from '../fenetre-nuit'

const R = { mode: 'garder-veille' as const, tolere: 0 }
const etat = (o: Partial<EtatEmission>): EtatEmission => ({ attendus: 22, repli: 0, incompris: 0, derniereChance: false, ...o })

// ── La règle ─────────────────────────────────────────────────────────────────────────────

test('⭐ toutes les voix là : publiée', () => {
  assert.equal(deciderPublication(etat({}), R, null).action, 'publier')
  assert.equal(deciderPublication(etat({ derniereChance: true }), R, true).action, 'publier')
})

test('⭐ des tours en repli et du temps devant : REPORTÉE, jamais publiée', () => {
  for (const repli of [1, 6, 22]) {
    const d = deciderPublication(etat({ repli }), R, true)
    assert.equal(d.action, 'reporter', `${repli} tour(s)`)
    assert.match(d.raison, /reprise plus tard/)
  }
  // Un seul tour incompréhensible suffit aussi.
  assert.equal(deciderPublication(etat({ incompris: 1 }), R, true).action, 'reporter')
})

test('⭐ fin de fenêtre, une émission récente existe : on GARDE LA VEILLE', () => {
  const d = deciderPublication(etat({ repli: 4, derniereChance: true }), R, true)
  assert.equal(d.action, 'garder-veille')
  assert.match(d.raison, /NON publiée/)
})

test('⭐ fin de fenêtre sans émission récente (ou relais muets) : publiée AVEC ALERTE plutôt qu’un silence', () => {
  assert.equal(deciderPublication(etat({ repli: 4, derniereChance: true }), R, false).action, 'publier-alerte')
  assert.equal(deciderPublication(etat({ repli: 4, derniereChance: true }), R, null).action, 'publier-alerte')
})

test('RADIO_REPLI_FINAL=publier-alerte : publiée en repli en fin de fenêtre, même avec une veille', () => {
  const d = deciderPublication(etat({ repli: 4, derniereChance: true }), { mode: 'publier-alerte', tolere: 0 }, true)
  assert.equal(d.action, 'publier-alerte')
  // …mais jamais avant la fin : il reste du temps, on refait.
  assert.equal(deciderPublication(etat({ repli: 4 }), { mode: 'publier-alerte', tolere: 0 }, true).action, 'reporter')
})

test('RADIO_REPLI_TOLERE : quelques tours en repli acceptés sans rien reporter', () => {
  assert.equal(deciderPublication(etat({ repli: 2 }), { ...R, tolere: 2 }, true).action, 'publier')
  assert.equal(deciderPublication(etat({ repli: 3 }), { ...R, tolere: 2 }, true).action, 'reporter')
})

test('les réglages : défauts, valeurs lues, valeurs absurdes', () => {
  assert.equal(modeFinal({}), 'garder-veille')
  assert.equal(modeFinal({ RADIO_REPLI_FINAL: 'publier-alerte' }), 'publier-alerte')
  assert.equal(modeFinal({ RADIO_REPLI_FINAL: 'n’importe quoi' }), 'garder-veille')
  assert.deepEqual(reglesPublication({}), { mode: 'garder-veille', tolere: 0, veilleMaxJours: 2 })
  assert.deepEqual(reglesPublication({ RADIO_REPLI_TOLERE: '3', RADIO_VEILLE_MAX_JOURS: '0' }),
    { mode: 'garder-veille', tolere: 3, veilleMaxJours: 2 })
})

test('un lancement à la main est une DERNIÈRE CHANCE ; la nuit dit « 0 » quand elle peut reprendre', () => {
  assert.equal(estDerniereChance({}), true)
  assert.equal(estDerniereChance({ RADIO_DERNIERE_CHANCE: '1' }), true)
  assert.equal(estDerniereChance({ RADIO_DERNIERE_CHANCE: '0' }), false)
})

test('les jours précédents (changement de mois compris)', () => {
  assert.deepEqual(joursPrecedents('2026-10-01', 2), ['2026-09-30', '2026-09-29'])
  assert.deepEqual(joursPrecedents('2026-03-01', 1), ['2026-02-28'])
})

// ── La fenêtre ───────────────────────────────────────────────────────────────────────────

const heure = (h: number, m = 0, j = 6) => new Date(2026, 9, j, h, m, 0, 0).getTime()

test('⭐ la fenêtre court jusqu’au matin, bornée à 11 h après le départ', () => {
  const r = reglagesFenetre({})
  assert.equal(r.finHeure, '07:00')
  assert.equal(finDeFenetre(heure(20, 3), r.finHeure, r.maxHeures), heure(7, 0, 7))
  assert.equal(finDeFenetre(heure(3, 0), r.finHeure, r.maxHeures), heure(7, 0, 6), 'rattrapage de nuit : le matin même')
  assert.equal(finDeFenetre(heure(14, 0), r.finHeure, r.maxHeures), heure(1, 0, 7), 'rattrapage d’après-midi : 11 h au plus')
  assert.equal(reglagesFenetre({ RADIO_FIN_FENETRE: '5:30' }).finHeure, '05:30')
  assert.equal(reglagesFenetre({ RADIO_FIN_FENETRE: '25:00' }).finHeure, '07:00')
})

test('⭐ 14 stations à ~32 min de GPU tiennent dans la fenêtre — pas dans l’ancien budget de 150 min', () => {
  // Mesuré dans les journaux du 03 au 06/10/2026 : 849 à 3 622 s par station, ~1 900 s en moyenne.
  const r = reglagesFenetre({})
  const debut = heure(20, 3)
  const finVoix = echeanceVoixClonees(debut, finDeFenetre(debut, r.finHeure, r.maxHeures), r)
  const besoin = 14 * 1_900_000
  assert.ok(finVoix - debut >= besoin, `${(finVoix - debut) / 60_000} min de voix clonée pour ${besoin / 60_000} min de besoin`)
  const ancien = echeanceVoixClonees(debut, finDeFenetre(debut, r.finHeure, r.maxHeures), reglagesFenetre({ CHATTERBOX_NUIT_MINUTES: '150' }))
  assert.equal(ancien - debut, 150 * 60_000, 'CHATTERBOX_NUIT_MINUTES posé à la main garde l’ancien budget')
  assert.ok(ancien - debut < besoin)
})

test('les voix clonées s’arrêtent avant la fin, pour laisser le montage', () => {
  const r = reglagesFenetre({})
  assert.equal(echeanceVoixClonees(heure(20), heure(7, 0, 7), r), heure(6, 45, 7))
})

test('dernière chance : dernier passage, ou moins de 45 min avant la fin', () => {
  const r = reglagesFenetre({})
  const fin = heure(7, 0, 7)
  assert.equal(derniereChance(heure(22), fin, 1, r), false)
  assert.equal(derniereChance(heure(6, 20, 7), fin, 1, r), true)
  assert.equal(derniereChance(heure(22), fin, 4, r), true)
  assert.equal(derniereChance(heure(22), fin, 2, reglagesFenetre({ RADIO_MAX_PASSES: '2' })), true)
})

test('la pause avant reprise : complétée si le passage a été bref, jamais au point d’entamer la dernière chance', () => {
  const r = reglagesFenetre({})
  const fin = heure(7, 0, 7)
  assert.equal(pauseAvantReprise(heure(20, 4), heure(20, 0), fin, r), 6 * 60_000)
  assert.equal(pauseAvantReprise(heure(2, 0, 7), heure(20, 0), fin, r), 0)
  assert.equal(pauseAvantReprise(heure(6, 10, 7), heure(6, 9, 7), fin, r), 5 * 60_000, 'bornée à la dernière chance (6 h 15)')
  assert.equal(pauseAvantReprise(heure(6, 30, 7), heure(6, 29, 7), fin, r), 0)
})

test('⭐ les codes de sortie : 75 à reprendre, 76 veille gardée, le reste est un échec', () => {
  assert.equal(CODE_A_REPRENDRE, 75)
  assert.equal(CODE_VEILLE_GARDEE, 76)
  assert.equal(classerSortie(0), 'publiee')
  assert.equal(classerSortie(75), 'a-reprendre')
  assert.equal(classerSortie(76), 'veille-gardee')
  assert.equal(classerSortie(1), 'echec')
  assert.equal(classerSortie('ENOENT'), 'echec')
  assert.equal(classerSortie(undefined, true), 'suspendue')
})

// ── Le câblage (lecture du code, commentaires retirés) ───────────────────────────────────

const code = (p: string) => readFileSync(p, 'utf8')
  .replace(/\/\*[\s\S]*?\*\//g, '').split('\n').map(l => l.replace(/(^|\s)\/\/.*$/, '$1')).join('\n')

test('🔴 generate-all ne borne plus la nuit à 150 min, passe la dernière chance, et reprend les reportées', () => {
  const ga = code('src/scripts/generate-all.ts')
  assert.ok(!/CHATTERBOX_NUIT_MINUTES \?\? '150'/.test(ga), 'l’ancien budget de 150 min ne doit plus être le défaut')
  assert.match(ga, /echeanceVoixClonees\(debutNuit, finFenetre, reglages\)/)
  assert.match(ga, /RADIO_DERNIERE_CHANCE: derniere \? '1' : '0'/)
  assert.match(ga, /r\.issue === 'a-reprendre'/)
  assert.match(ga, /for \(let passe = 2; aReprendre\.length > 0 && passe <= reglages\.maxPasses; passe\+\+\)/)
})

test('🔴 generate-broadcast : un tour sans sa voix est REPORTÉ avant tout Piper, et un arrêt voulu sort avec son code', () => {
  const gb = code('src/scripts/generate-broadcast.ts')
  const iReport = gb.indexOf('opts.reprise?.reporterLesManques()')
  const iPiper = gb.indexOf("process.stdout.write('  (repli piper)\\n')")
  assert.ok(iReport > 0 && iReport < iPiper, 'le report doit précéder le repli Piper')
  assert.match(gb, /if \(err instanceof ArretVolontaire\) \{.*return terminer\(err\.code\) \}/)
  assert.match(gb, /opts\.reprise\?\.verifierManques\(\)/)
  // La règle passe AVANT le dépôt et la publication.
  assert.ok(gb.indexOf('await deciderOuArreter(') < gb.indexOf('await dataspacePinFile('))
  assert.ok(gb.indexOf('await deciderOuArreter(') < gb.indexOf('await publishBroadcast('))
})

test('🔴 passé l’échéance de la nuit, le réveil rend la main AUSSITÔT (plus 12 min d’essais sans espoir)', async () => {
  const { reveillerEtVerifier } = await import('../chatterbox')
  const avant = { fin: process.env.CHATTERBOX_FIN_NUIT, fetch: globalThis.fetch }
  let appels = 0
  globalThis.fetch = (async () => { appels++; throw new Error('pas de réseau en test') }) as typeof fetch
  process.env.CHATTERBOX_FIN_NUIT = String(Date.now() - 1000)
  try {
    const t0 = Date.now()
    assert.equal(await reveillerEtVerifier('aurelien'), 'injoignable')
    assert.equal(appels, 0)
    assert.ok(Date.now() - t0 < 1000)
  } finally {
    globalThis.fetch = avant.fetch
    if (avant.fin === undefined) delete process.env.CHATTERBOX_FIN_NUIT; else process.env.CHATTERBOX_FIN_NUIT = avant.fin
  }
})
