/**
 * 📣 « Rejoignez <station> sur Infinity-freeworld.com » : une ou deux fois par émission
 * radio, jamais zéro, jamais trois (Bâtisseur, 04/10/2026).
 *
 * `generateBroadcastBytes` (scripts/generate-broadcast.ts) part sur le réseau (modèle,
 * moteurs) : on rejoue ici SA boucle de tours, avec les mêmes fonctions et dans le même
 * ordre, contre des modèles simulés qui oublient la phrase, la répètent à chaque tour ou
 * rendent des tours vides. Un second test vérifie que le script est bien branché ainsi.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import {
  appliquerSlogan, compterSlogans, consigneSloganPourTour, phraseSlogan,
  positionDuTour, positionPourConsigne, prononcerDomaine, type PositionTour,
} from '../slogan-radio'
import { resteADire, sanitizeForSpeech } from '../tts-sanitize'
import { buildHostSystemPrompt } from '../personas'
import type { StationLanguage } from '../types'

interface Emission { transcript: string[]; voix: string[]; consignes: string[] }

/** La boucle de `generateBroadcastBytes`, réduite à ce qui touche la phrase d'appel. */
function emission(
  numTurns: number, nom: string, langue: StationLanguage,
  modele: (i: number, consigne: string, position: PositionTour) => string,
): Emission {
  const transcript: string[] = [], voix: string[] = [], consignes: string[] = []
  let slogansDits = 0
  for (let i = 0; i < numTurns; i++) {
    const isFirstTurn = transcript.length === 0
    const position = positionDuTour(isFirstTurn, i === numTurns - 1)
    const consigne = consigneSloganPourTour(nom, langue, positionPourConsigne(position, slogansDits))
    consignes.push(consigne)
    let turnText = modele(i, consigne, position).trim()
    if (!turnText || !resteADire(turnText)) continue
    const s = appliquerSlogan({ texte: turnText, nomStation: nom, langue, dejaDits: slogansDits, position })
    turnText = s.texte
    slogansDits = s.dits
    transcript.push(turnText)
    // Ce que le moteur prononce : forme parlée du domaine, puis nettoyage à son entrée.
    voix.push(sanitizeForSpeech(prononcerDomaine(turnText, langue)))
  }
  return { transcript, voix, consignes }
}

const total = (e: Emission) => e.transcript.reduce((n, t) => n + compterSlogans(t), 0)

const MODELES: Record<string, (i: number, c: string, p: PositionTour) => string> = {
  'oublie toujours': i => `Réplique ${i}, on parle du sujet du jour.`,
  'obéit mot pour mot': (i, c) => {
    const m = /mot pour mot : « (.+) »$/.exec(c)
    return `Réplique ${i}.${m ? ' ' + m[1] : ''}`
  },
  'la répète à chaque tour': i => `Réplique ${i}. Rejoignez Radio Libre sur Infinity-freeworld.com.`,
  'la dit trois fois dans un tour': i => `Réplique ${i}. Infinity-freeworld.com ! Infinity-freeworld.com ? Allez sur infinity-freeworld.com.`,
  'premier et dernier tours vides': (i) => (i === 0 || i === 21 ? '' : `Réplique ${i}.`),
  'markdown et emojis': i => (i === 0 ? '🎉🎉' : `**Réplique** ${i} *rit*.`),
}

for (const [quoi, modele] of Object.entries(MODELES)) {
  test(`⭐ modèle qui ${quoi} : 1 ou 2 mentions sur l’émission, jamais 0, jamais 3`, () => {
    const e = emission(22, 'Radio Libre', 'fr', modele)
    const n = total(e)
    assert.ok(n >= 1 && n <= 2, `${n} mention(s) : ${JSON.stringify(e.transcript.filter(t => compterSlogans(t) > 0))}`)
    assert.ok(e.transcript.length > 0)
  })
}

test('⭐ l’ouverture et la clôture la portent quand le modèle l’oublie', () => {
  const e = emission(22, 'Radio Libre', 'fr', MODELES['oublie toujours'])
  assert.equal(total(e), 2)
  assert.ok(e.transcript[0].endsWith(phraseSlogan('Radio Libre', 'fr')), 'ouverture')
  assert.ok(e.transcript.at(-1)!.endsWith(phraseSlogan('Radio Libre', 'fr')), 'clôture')
})

test('le modèle reçoit la consigne à l’ouverture et à la clôture, l’interdiction au milieu', () => {
  const e = emission(5, 'Radio Libre', 'fr', MODELES['oublie toujours'])
  assert.match(e.consignes[0], /mot pour mot/)
  assert.match(e.consignes[4], /mot pour mot/)
  for (const c of e.consignes.slice(1, 4)) assert.match(c, /Ne dis PAS/)
})

test('une émission d’un seul tour : une seule mention', () => {
  const e = emission(1, 'Radio Libre', 'fr', MODELES['oublie toujours'])
  assert.equal(total(e), 1)
})

test('⭐ le nom de la station EN COURS et la langue de la STATION', () => {
  const e = emission(6, 'Голос Свободы', 'ru', MODELES['oublie toujours'])
  assert.ok(e.transcript[0].endsWith('Присоединяйтесь к Голос Свободы на Infinity-freeworld.com.'))
  const en = emission(6, 'Pirate Radio', 'en', MODELES['oublie toujours'])
  assert.ok(en.transcript[0].endsWith('Join Pirate Radio on Infinity-freeworld.com.'))
})

test('⭐ le transcript garde l’adresse ÉCRITE, la voix la DIT, sans symbole', () => {
  const e = emission(4, 'Radio Libre', 'fr', MODELES['oublie toujours'])
  assert.match(e.transcript[0], /Infinity-freeworld\.com/)
  assert.match(e.voix[0], /Rejoignez Radio Libre sur Infiniti tiret Friwourld point com\.$/)
  for (const v of e.voix) assert.doesNotMatch(v, /freeworld\.com|[*#]/i)
  const en = emission(4, 'Pirate Radio', 'en', MODELES['oublie toujours'])
  assert.match(en.voix[0], /Join Pirate Radio on Infinity dash Freeworld dot com\.$/)
})

test('⭐ le script de génération est branché comme cette boucle', () => {
  const src = readFileSync(new URL('../../scripts/generate-broadcast.ts', import.meta.url), 'utf8')
  const corps = src.slice(src.indexOf('async function generateBroadcastBytes'), src.indexOf('PHASE 2'))
  assert.match(corps, /let slogansDits = 0/)
  assert.match(corps, /positionDuTour\(isFirstTurn, i === numTurns - 1\)/)
  assert.match(corps, /consigneSloganPourTour\(station\.name, language, positionPourConsigne\(position, slogansDits\)\)/)
  assert.match(corps, /\+ ' ' \+ consigneSlogan/, 'la consigne doit partir dans le message du tour')
  assert.match(corps, /appliquerSlogan\(\{[\s\S]*?nomStation: station\.name, langue: language,[\s\S]*?dejaDits: slogansDits, position,/)
  assert.match(corps, /slogansDits = slogan\.dits/)
  assert.match(corps, /texte: prononcerDomaine\(turnText, language\)/, 'la voix reçoit la forme parlée')
  assert.match(corps, /text:\s+turnText,/, 'le transcript garde la forme écrite')
  // L'ordre compte : la garantie s'applique AVANT que le tour soit enregistré.
  assert.ok(corps.indexOf('appliquerSlogan(') < corps.indexOf('turns.push(turn)'))
})

test('le prompt système d’un animateur annonce la phrase et ne la réserve qu’à la consigne', () => {
  const p = buildHostSystemPrompt({
    host: { id: 'h', name: 'Cyril', gender: 'male', trait: 't', color: '#000000', avatar: 'x' },
    kb: { hostId: 'h', stationId: 's', personality: '', entries: [], updatedAt: 0 },
    selectedEntries: [], topic: '', stationName: 'Radio Libre', language: 'fr',
    otherHosts: [],
  } as never)
  assert.match(p, /« Rejoignez Radio Libre sur Infinity-freeworld\.com\. »/)
  assert.match(p, /Tu ne la dis QUE si la consigne de ton tour te le demande/)
})
