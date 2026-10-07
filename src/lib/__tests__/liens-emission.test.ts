/**
 * Les liens évoqués dans une émission, calés dans le temps (Bâtisseur, 07/10/2026 : l'écran
 * des liens de la Radio). Extraction, calage sur le DÉBUT du tour, filtre de ce qui est public,
 * dédoublonnage, et contenu publié (champ `liens` du kind 30093, rétrocompatible).
 *
 * Lancer :  npx tsx --test src/lib/__tests__/liens-emission.test.ts
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  extraireLiensEmission, normaliserLien, adressesDansTexte, tourReprendActu, champLiens, cleLien,
  URL_INFINITY, MAX_LIENS, MAX_LONGUEUR_URL,
} from '../liens-emission'
import { contenuEmission } from '../nostr'
import { prononcerDomaine } from '../slogan-radio'
import type { BroadcastTurn, NewsItem, RadioBroadcast } from '../types'

function tour(i: number, text: string, tStart: number): BroadcastTurn {
  return { id: `t${i}`, hostId: 'h', hostName: 'Sarah', color: '#fff', avatar: '', text, tStart, tEnd: tStart + 20 }
}

const NEWS: NewsItem[] = [
  { title: 'Grève des dockers à Marseille : le port paralysé', link: 'https://reporterre.net/greve-dockers-marseille?utm_source=rss&id=42', sourceTitle: 'Reporterre' },
  { title: 'Le prix du diesel flambe dans toute l\'Europe', link: 'https://exemple.org/diesel', sourceTitle: 'Exemple' },
  { title: 'Une actualité dont personne ne parle aujourd\'hui', link: 'https://silence.org/rien', sourceTitle: 'Silence' },
]

test('calage : chaque lien prend le DÉBUT du premier tour qui l\'évoque', () => {
  const turns = [
    tour(0, 'Bonsoir ! Rejoignez Radio Libre sur Infinity-freeworld.com.', 3.25),
    tour(1, 'On commence par la grève des dockers de Marseille, le port est paralysé depuis lundi.', 61.04),
    tour(2, 'Et le diesel ? Le prix flambe dans toute l\'Europe, la grève des dockers n\'arrange rien.', 125.5),
    tour(3, 'Pour aller plus loin, lisez www.lowtechlab.org/fr/wiki, c\'est passionnant.', 300),
  ]
  const liens = extraireLiensEmission({ turns, news: NEWS })
  assert.deepEqual(liens.map(l => [l.url, l.t, l.source]), [
    [URL_INFINITY + '/', 3.3, 'texte'],
    ['https://reporterre.net/greve-dockers-marseille?id=42', 61, 'actu'],
    ['https://exemple.org/diesel', 125.5, 'actu'],
    ['https://www.lowtechlab.org/fr/wiki', 300, 'texte'],
  ])
  // Le titre de l'actu accompagne son lien ; l'actu jamais reprise n'entre pas.
  assert.equal(liens[1].titre, 'Grève des dockers à Marseille : le port paralysé')
  assert.ok(!liens.some(l => l.url.includes('silence.org')))
})

test('calage : l\'ordre des tours n\'est pas l\'ordre des liens — on trie par instant', () => {
  const turns = [tour(1, 'Voir exemple.org/b', 50), tour(0, 'Voir exemple.org/a', 10)]
  assert.deepEqual(extraireLiensEmission({ turns }).map(l => l.t), [10, 50])
})

test('dédoublonnage : un lien évoqué trois fois ne figure qu\'une fois, au premier instant', () => {
  const turns = [
    tour(0, 'Rendez-vous sur https://lowtechlab.org/ ce soir.', 12),
    tour(1, 'Je répète : lowtechlab.org !', 40),
    tour(2, 'Encore une fois www.lowtechlab.org.', 80),
  ]
  const liens = extraireLiensEmission({ turns })
  assert.equal(liens.length, 1)
  assert.equal(liens[0].t, 12)
})

test('l\'adresse d\'Infinity est reconnue sous sa forme écrite (motif du slogan) — une seule fois', () => {
  const turns = [
    tour(0, 'Rejoignez WTF Radio sur Infinity-freeworld.com.', 0),
    tour(1, 'infinity freeworld point com, je le redis.', 30),
  ]
  const liens = extraireLiensEmission({ turns })
  assert.equal(liens.length, 1)
  assert.equal(liens[0].url, URL_INFINITY + '/')
  assert.equal(liens[0].titre, 'Infinity-freeworld.com')
})

test('un lien Infinity précis (avec chemin) est gardé tel quel', () => {
  const liens = extraireLiensEmission({ turns: [tour(0, 'La station est sur infinity-freeworld.com/r/wtf-radio.', 5)] })
  assert.ok(liens.some(l => l.url === 'https://infinity-freeworld.com/r/wtf-radio'), JSON.stringify(liens))
})

test('le texte lu par la voix n\'est pas touché : prononcerDomaine reste la seule transformation', () => {
  const texte = 'Rejoignez Radio Libre sur Infinity-freeworld.com.'
  const turns = [tour(0, texte, 0)]
  extraireLiensEmission({ turns })
  assert.equal(turns[0].text, texte)
  assert.equal(prononcerDomaine(texte, 'fr'), 'Rejoignez Radio Libre sur Infiniti tiret Friwourld point com.')
})

test('filtre : http(s) seulement, pas d\'identifiant, pas d\'hôte privé, pas de donnée secrète', () => {
  assert.equal(normaliserLien('ftp://exemple.org/x'), null)
  assert.equal(normaliserLien('javascript:alert(1)'), null)
  assert.equal(normaliserLien('https://moi:secret@exemple.org/'), null)
  assert.equal(normaliserLien('http://localhost:5173/radio'), null)
  assert.equal(normaliserLien('http://192.168.1.10/admin'), null)
  assert.equal(normaliserLien('http://box.local/'), null)
  assert.equal(normaliserLien('https://exemple.org/?token=abc'), null)
  assert.equal(normaliserLien('https://exemple.org/?api_key=abc'), null)
  assert.equal(normaliserLien('https://exemple.org/profil/nsec1qqqqqqqqqqqqqqqq'), null)
  assert.equal(normaliserLien('https://exemple.org/' + 'a'.repeat(MAX_LONGUEUR_URL)), null)
  // Pistage retiré, fragment retiré, le reste gardé.
  assert.equal(normaliserLien('https://Exemple.ORG/a?utm_medium=x&p=2#haut'), 'https://exemple.org/a?p=2')
})

test('un courriel n\'est pas une adresse web ; la ponctuation finale n\'en fait pas partie', () => {
  assert.deepEqual(adressesDansTexte('Écrivez à contact@exemple.org pour participer.'), [])
  assert.deepEqual(adressesDansTexte('Allez voir reporterre.net, puis wikipedia.org.'), ['https://reporterre.net', 'https://wikipedia.org'])
  assert.deepEqual(adressesDansTexte('La version 3.5 est sortie.'), [])
})

test('reprise d\'une actu : mots forts du titre retrouvés dans la réplique', () => {
  assert.equal(tourReprendActu('les dockers de Marseille sont en grève', 'Grève des dockers à Marseille : le port paralysé'), true)
  assert.equal(tourReprendActu('il fait beau à Marseille', 'Grève des dockers à Marseille : le port paralysé'), false)
  // Écriture sans espaces : une tranche du titre suffit.
  assert.equal(tourReprendActu('今天我们讨论上海港口工人罢工的问题', '上海港口工人罢工持续三天'), true)
})

test('borne : au plus MAX_LIENS liens', () => {
  const turns = Array.from({ length: MAX_LIENS + 10 }, (_, i) => tour(i, `Voir site${i}.org/page`, i * 10))
  assert.equal(extraireLiensEmission({ turns }).length, MAX_LIENS)
})

test('clé de dédoublonnage : www, barre finale et http/https confondus', () => {
  assert.equal(cleLien('https://www.exemple.org/'), cleLien('http://exemple.org'))
})

test('contenu publié : `liens` présent quand il y en a, ABSENT sinon (rétrocompatible)', () => {
  const base: RadioBroadcast = {
    stationId: 'wtf-radio', date: '2026-10-07', language: 'fr', durationSec: 600,
    audioCid: 'bafy', audioMime: 'audio/webm', turns: [tour(0, 'x', 0)], newsRefs: [],
    model: 'm', generatedBy: '', generatedAt: 1,
  }
  const sans = JSON.parse(contenuEmission({ ...base, ...champLiens([]) }))
  assert.equal('liens' in sans, false)
  const liens = [{ url: 'https://exemple.org/', t: 12.5, source: 'texte' as const }]
  const avec = JSON.parse(contenuEmission({ ...base, ...champLiens(liens) }))
  assert.deepEqual(avec.liens, liens)
  // Les champs que lisent les anciens lecteurs sont intacts.
  for (const k of ['stationId', 'date', 'turns', 'newsRefs', 'audioCid']) assert.deepEqual(avec[k], sans[k])
})
