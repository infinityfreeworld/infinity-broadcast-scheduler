/**
 * @module InfinityScheduler/Lib/FlashObfTests
 * @description ⚡ Le flash spécial OBF : interrupteur éteint par défaut, sélection prudente (graves,
 *   en cours, récentes, jamais deux fois), plafond par jour, gabarit sans rien d'inventé, et
 *   événement DISTINCT de l'émission du jour. Aucun réseau.
 *
 *   Lancer :  npx tsx --test src/lib/__tests__/flash-obf.test.ts
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import {
  reglagesFlash, alertesPourFlash, flashPermis, texteFlash, contenuFlash, tagsFlash, dTagFlash,
  lireFlashsPrecedents, empreinteAlerte, heureDite, STATION_FLASH,
} from '../flash-obf'
import type { AlerteObf } from '../sujets-obf'

const MAINTENANT = Date.UTC(2026, 9, 12, 12, 30)   // 14 h 30 à Paris
const alerte = (o: Partial<AlerteObf>): AlerteObf => ({
  cle: `30501:pk:${Math.random()}`, auteur: 'pk', eventId: 'ev', niveau: 'critical', lieu: 'près de Lyon',
  le: MAINTENANT - 20 * 60_000, terminee: false, ...o,
})
const ALLUME = reglagesFlash({ FLASH_OBF: '1' })

test('⭐ interrupteur ÉTEINT par défaut — seul FLASH_OBF=1 l’allume', () => {
  assert.equal(reglagesFlash({}).actif, false)
  assert.equal(reglagesFlash({ FLASH_OBF: 'true' }).actif, false)
  assert.equal(reglagesFlash({ FLASH_OBF: '0' }).actif, false)
  assert.equal(ALLUME.actif, true)
  assert.deepEqual(ALLUME.niveaux, ['critical'])
  assert.deepEqual(reglagesFlash({ FLASH_OBF_NIVEAUX: 'critical,warning,info' }).niveaux, ['critical', 'warning'], 'jamais bleu ni vert')
  const wf = readFileSync(new URL('../../../.github/workflows/flash-obf.yml', import.meta.url), 'utf8')
  assert.match(wf, /if: vars\.FLASH_OBF == '1'/, 'le workflow ne démarre même pas sans la variable')
})

test('⭐ sélection : grave, en cours, récente, jamais deux fois', () => {
  const rouge = alerte({ cle: 'a' })
  const orange = alerte({ cle: 'b', niveau: 'warning' })
  const finie = alerte({ cle: 'c', terminee: true })
  const vieille = alerte({ cle: 'd', le: MAINTENANT - 3 * 3_600_000 })
  const future = alerte({ cle: 'e', le: MAINTENANT + 3_600_000 })
  const dejaDite = alerte({ cle: 'f' })
  const r = alertesPourFlash([rouge, orange, finie, vieille, future, dejaDite], MAINTENANT, new Set([empreinteAlerte(dejaDite)]), ALLUME)
  assert.deepEqual(r.map(a => a.cle), ['a'])
  const avecOrange = alertesPourFlash([orange, rouge], MAINTENANT, new Set(), reglagesFlash({ FLASH_OBF: '1', FLASH_OBF_NIVEAUX: 'critical,warning' }))
  assert.deepEqual(avecOrange.map(a => a.cle), ['a', 'b'], 'la rouge d’abord')
  const beaucoup = Array.from({ length: 8 }, (_, i) => alerte({ cle: `x${i}` }))
  assert.equal(alertesPourFlash(beaucoup, MAINTENANT, new Set(), ALLUME).length, 3, 'au plus trois par flash')
})

test('plafond par 24 h et intervalle minimal : la radio ne devient pas une sirène', () => {
  assert.equal(flashPermis([], MAINTENANT, ALLUME).permis, true)
  assert.equal(flashPermis([MAINTENANT - 10 * 60_000], MAINTENANT, ALLUME).permis, false)
  const six = Array.from({ length: 6 }, (_, i) => MAINTENANT - (i + 1) * 3_600_000)
  assert.match(flashPermis(six, MAINTENANT, ALLUME).raison, /plafond 6/)
  assert.equal(flashPermis([MAINTENANT - 25 * 3_600_000], MAINTENANT, ALLUME).permis, true, 'au-delà de 24 h, oublié')
})

test('⭐ le gabarit ne dit QUE niveau, ville, heure — et renvoie vers les secours et la carte', () => {
  const t = texteFlash([alerte({ cle: 'a', lieu: 'près de Lyon' })], MAINTENANT)
  assert.match(t, /^Flash spécial OBF\. Il est 14 h 30\./)
  assert.match(t, /Il est 14 h 30\. Une alerte rouge, urgence vitale, lancée près de Lyon, il y a 20 minutes/)
  assert.match(t, /veut dire urgence vitale/)
  assert.match(t, /cent douze/)
  assert.match(t, /Ne vous rendez pas sur les lieux/)
  assert.doesNotMatch(t, /pk|ev|30501/, 'aucun identifiant')
  const mots = t.split(/\s+/).length
  assert.ok(mots > 90 && mots < 300, `${mots} mots : une à deux minutes à l’oral`)
  assert.match(texteFlash([alerte({ lieu: '' })], MAINTENANT), /quelque part sur la carte/)
  assert.match(texteFlash([alerte({ cle: '1' }), alerte({ cle: '2', lieu: 'à Paris' })], MAINTENANT), /2 alertes graves.*Ensuite, une alerte rouge, urgence vitale, lancée à Paris/)
  assert.equal(texteFlash([], MAINTENANT), '')
  assert.equal(heureDite(Date.UTC(2026, 0, 5, 8, 0)), '9 heures', 'heure de Paris, hiver compris')
})

test('⭐ événement DISTINCT : jamais la clé « obf-radio:date » de l’émission du jour', () => {
  const c = JSON.parse(contenuFlash({
    maintenant: MAINTENANT, texte: 'x', durationSec: 75.4, audioCid: 'Qm1', audioMime: 'audio/webm',
    animateur: { id: 'obf-maya', name: 'Maya', color: '#e85555', avatar: '🛟' }, alertes: [alerte({ cle: 'a' })],
  }))
  assert.equal(c.stationId, STATION_FLASH)
  assert.notEqual(c.stationId, 'obf-radio')
  assert.equal(c.flashDe, 'obf-radio')
  assert.equal(c.flash, true)
  assert.equal(c.turns.length, 1)
  assert.equal(c.turns[0].tEnd, 75.4)
  assert.deepEqual(c.alertes, [empreinteAlerte({ cle: 'a' })])
  assert.equal(dTagFlash(MAINTENANT), 'obf-radio-flash:2026-10-12T12:30')
  const tags = tagsFlash(MAINTENANT)
  assert.deepEqual(tags.find(t => t[0] === 'expiration'), ['expiration', String(MAINTENANT / 1000 + 86_400)])
  // Relu : on retrouve l'instant et l'empreinte ; les émissions ordinaires sont ignorées.
  const lus = lireFlashsPrecedents([
    { content: JSON.stringify(c), created_at: MAINTENANT / 1000 },
    { content: JSON.stringify({ stationId: 'obf-radio', alertes: ['zzz'] }), created_at: 1 },
    { content: 'pas du json', created_at: 2 },
  ])
  assert.deepEqual(lus.instants, [MAINTENANT])
  assert.deepEqual([...lus.empreintes], [empreinteAlerte({ cle: 'a' })])
})
