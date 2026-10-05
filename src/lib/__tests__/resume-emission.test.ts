/**
 * Titre + résumé d'une émission (« Émissions précédentes », Bâtisseur 04/10/2026).
 * Le modèle est SIMULÉ : ces tests vérifient le nettoyage, le contrôle de langue, le repli et
 * le contenu publié — pas la qualité d'un vrai modèle.
 *
 * Lancer :  npx tsx --test src/lib/__tests__/resume-emission.test.ts
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  resumerEmission, nettoyerTitre, nettoyerResume, resumeDeRepli, lireReponseResume, texteDesTours,
  couperProprement, ligneJournalResume, MAX_TITRE, MAX_RESUME, type AppelResume,
} from '../resume-emission'
import { contenuEmission } from '../nostr'
import type { BroadcastTurn, RadioBroadcast } from '../types'

function tour(i: number, text: string, hostName = i % 2 ? 'Malik' : 'Sarah'): BroadcastTurn {
  return { id: `t${i}`, hostId: hostName.toLowerCase(), hostName, color: '#fff', avatar: '', text, tStart: 0, tEnd: 0 }
}

const TOURS_FR: BroadcastTurn[] = [
  tour(0, 'Bonsoir et bienvenue sur Radio Libre, la radio qui ne dort jamais ! Rejoignez Radio Libre sur Infinity-freeworld.com.'),
  tour(1, 'Ce soir on parle de la grève des dockers à Marseille et de la flambée du prix du diesel dans toute l\'Europe.'),
  tour(2, 'Et aussi de la monnaie libre, la Ğ1, qui gagne des commerçants dans les villages du Sud-Ouest.'),
  tour(3, 'Ouais.'),
  tour(4, 'Merci de nous avoir écoutés. Rejoignez Radio Libre sur Infinity-freeworld.com.'),
]

const TOURS_EN: BroadcastTurn[] = [
  tour(0, 'Good evening and welcome to Free Press FM. Join Free Press FM on Infinity-freeworld.com.'),
  tour(1, 'Tonight we dig into the Marseille dock strike and why diesel prices are climbing across Europe.'),
  tour(2, 'And we look at the free currency movement that is winning over small shops in rural villages.'),
]

/** Modèle simulé : rend les réponses dans l'ordre, puis lève. */
function modele(...reponses: Array<string | Error>): AppelResume & { appels: number } {
  const f: AppelResume = async () => {
    const r = reponses[etat.appels++]
    if (r === undefined) throw new Error('plus de réponse simulée')
    if (r instanceof Error) throw r
    return { text: r, inputTokens: 100, outputTokens: 20, maillon: 'simulé' }
  }
  const etat = Object.assign(f, { appels: 0 })
  return etat
}

test('JSON valide : champs repris, bornés et nettoyés', async () => {
  const long = 'Grève des dockers à Marseille, flambée du diesel en Europe et progression de la monnaie libre Ğ1 chez les commerçants du Sud-Ouest, avec les témoignages des auditeurs et un long détour par les coopératives agricoles et les marchés paysans du Gers.'
  const r = await resumerEmission({
    turns: TOURS_FR, langue: 'fr', nomStation: 'Radio Libre',
    appeler: modele('```json\n{"titre": "« **Radio Libre** : dockers, diesel et Ğ1 🔥 »", "resume": "Dans cette émission, ' + long + ' Plus sur https://exemple.org/page."}\n```'),
  })
  assert.equal(r.source, 'modele')
  assert.equal(r.maillon, 'simulé')
  assert.equal(r.titre, 'dockers, diesel et Ğ1')
  assert.ok(r.resume)
  assert.ok([...r.resume!].length <= MAX_RESUME, `résumé trop long : ${r.resume!.length}`)
  assert.ok(r.resume!.startsWith('Grève des dockers'), r.resume)
  assert.doesNotMatch(r.resume!, /https?:|exemple\.org|\*|dans cette émission/i)
  assert.equal(r.inputTokens, 100)
})

test('titre : guillemets, emoji, nom de station retirés ; borné à 70 caractères', () => {
  assert.equal(nettoyerTitre('"Free Press FM — Ukraine talks stall"', 'Free Press FM'), 'Ukraine talks stall')
  assert.equal(nettoyerTitre('Free Press FM', 'Free Press FM'), undefined)
  assert.equal(nettoyerTitre(42, 'X'), undefined)
  const t = nettoyerTitre('Un titre beaucoup trop long pour la liste des émissions précédentes de la radio Infinity', 'X')!
  assert.ok([...t].length <= MAX_TITRE, t)
  assert.ok(t.endsWith('…'))
})

test('résumé : slogan retiré, ouverture creuse retirée, trop court rejeté', () => {
  assert.equal(
    nettoyerResume('In this episode, the hosts debate the dock strike in Marseille. Join Free Press FM on Infinity-freeworld.com.'),
    'The hosts debate the dock strike in Marseille.',
  )
  assert.equal(nettoyerResume('Rejoignez-nous !'), undefined)
  assert.equal(nettoyerResume(null), undefined)
})

test('couperProprement : coupe à une fin de phrase ou à un mot, jamais au milieu', () => {
  const s = 'Première phrase assez longue pour compter vraiment. Deuxième phrase qui déborde largement de la limite fixée.'
  assert.equal(couperProprement(s, 70), 'Première phrase assez longue pour compter vraiment.')
  const m = couperProprement('mot '.repeat(30).trim(), 20)
  assert.ok(m.length <= 20 && m.endsWith('…') && !m.includes('mo…'), m)
})

test('lireReponseResume : texte autour toléré, illisible = null', () => {
  assert.deepEqual(lireReponseResume('Voici : {"titre":"A","resume":"B"} voilà'), { titre: 'A', resume: 'B' })
  assert.deepEqual(lireReponseResume('{"title":"A","summary":"B"}'), { titre: 'A', resume: 'B' })
  assert.equal(lireReponseResume('pas de JSON'), null)
  assert.equal(lireReponseResume('{titre: A'), null)
})

test('modèle en échec : repli sur les répliques de fond, sans exception, sans titre', async () => {
  const r = await resumerEmission({
    turns: TOURS_FR, langue: 'fr', nomStation: 'Radio Libre',
    appeler: modele(new Error('Aucun maillon LLM n\'a répondu.\n  mistral : HTTP 429')),
  })
  assert.equal(r.source, 'repli')
  assert.match(r.raison!, /modèle indisponible : Aucun maillon/)
  assert.equal(r.titre, undefined)
  // L'ouverture rituelle et le slogan sont sautés : on commence par le fond.
  assert.ok(r.resume!.startsWith('Ce soir on parle de la grève des dockers'), r.resume)
  assert.doesNotMatch(r.resume!, /Infinity-freeworld|Rejoignez/)
  assert.ok([...r.resume!].length <= MAX_RESUME)
  assert.match(ligneJournalResume(r), /^📝 résumé : repli/)
})

test('JSON invalide : repli', async () => {
  const r = await resumerEmission({ turns: TOURS_EN, langue: 'en', nomStation: 'Free Press FM', appeler: modele('Sure! Here is a summary of the show.') })
  assert.equal(r.source, 'repli')
  assert.equal(r.raison, 'JSON illisible')
  assert.ok(r.resume!.startsWith('Tonight we dig into the Marseille dock strike'))
})

test('langue fausse : réécriture demandée, puis acceptée', async () => {
  const appeler = modele(
    '{"titre": "Grève des dockers et prix du diesel", "resume": "La grève des dockers à Marseille et la hausse du prix du diesel dans toute l\'Europe."}',
    '{"titre": "Dock strike and diesel prices", "resume": "The Marseille dock strike and the rise of diesel prices across Europe, with the free currency movement in rural shops."}',
  )
  const r = await resumerEmission({ turns: TOURS_EN, langue: 'en', nomStation: 'Free Press FM', appeler })
  assert.equal(appeler.appels, 2)
  assert.equal(r.source, 'modele')
  assert.equal(r.titre, 'Dock strike and diesel prices')
  assert.match(r.resume!, /^The Marseille dock strike/)
  assert.match(ligneJournalResume(r), /^📝 résumé : modèle \(simulé\)/)
})

test('langue toujours fausse après les réécritures : repli dans la langue de la station', async () => {
  const fr = '{"titre": "Grève des dockers", "resume": "La grève des dockers à Marseille et la hausse du prix du diesel dans toute l\'Europe, avec les auditeurs."}'
  const appeler = modele(fr, fr, fr)
  const r = await resumerEmission({ turns: TOURS_EN, langue: 'en', nomStation: 'Free Press FM', appeler })
  assert.equal(appeler.appels, 3)   // 1 appel + 2 réécritures, pas plus
  assert.equal(r.source, 'repli')
  assert.match(r.raison!, /langue fr après 2 réécriture/)
  assert.equal(r.titre, undefined)
  assert.ok(r.resume!.startsWith('Tonight we dig into'), r.resume)
})

test('repli : rien d\'utile = pas de résumé, jamais d\'exception', async () => {
  assert.equal(resumeDeRepli([tour(0, 'Bonsoir !'), tour(1, 'Ouais.')], 'fr'), undefined)
  assert.equal(resumeDeRepli([], 'fr'), undefined)
  const r = await resumerEmission({ turns: [], langue: 'fr', nomStation: 'X', appeler: modele(new Error('panne')) })
  assert.equal(r.source, 'repli')
  assert.equal(r.resume, undefined)
})

test('entrée du modèle tronquée', () => {
  const beaucoup = Array.from({ length: 200 }, (_, i) => tour(i, 'Une réplique de fond qui parle longuement de sujets variés et importants.'))
  const t = texteDesTours(beaucoup, 2000)
  assert.ok(t.length <= 2000)
  assert.ok(t.startsWith('Sarah: Une réplique'))
})

const EMISSION: RadioBroadcast = {
  stationId: 'radio-libre', date: '2026-10-04', language: 'fr', durationSec: 600,
  audioCid: 'bafy', audioMime: 'audio/webm', turns: TOURS_FR, newsRefs: [], model: 'm',
  generatedBy: '', generatedAt: 1,
}

test('contenu publié (kind 30093) : titre et resume présents quand ils existent', () => {
  const c = JSON.parse(contenuEmission({ ...EMISSION, titre: 'Dockers et diesel', resume: 'La grève des dockers à Marseille.' }))
  assert.equal(c.titre, 'Dockers et diesel')
  assert.equal(c.resume, 'La grève des dockers à Marseille.')
  assert.equal(c.stationId, 'radio-libre')
  assert.equal(c.turns.length, TOURS_FR.length)
})

test('contenu publié : champs absents (pas null) sans résumé — rétro-compatible', () => {
  const c = JSON.parse(contenuEmission(EMISSION))
  assert.equal('titre' in c, false)
  assert.equal('resume' in c, false)
  assert.equal('segments' in c, false)
  assert.deepEqual(Object.keys(c), ['stationId', 'date', 'language', 'durationSec', 'audioCid', 'audioMime', 'turns', 'newsRefs', 'model', 'generatedAt'])
})
