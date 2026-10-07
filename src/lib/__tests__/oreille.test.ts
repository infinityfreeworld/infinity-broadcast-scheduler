/**
 * @module InfinityScheduler/Lib/OreilleTests
 * @description 👂 L'oreille de contrôle : la mesure (WER, mots perdus, fin), les seuils, et la
 *   dégradation propre quand Whisper n'est pas là. Aucun binaire, aucun réseau.
 *
 *   Lancer :  npx tsx --test src/lib/__tests__/oreille.test.ts
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  motsCompares, distanceEdition, tauxErreurMots, partMotsPerdus, finEntendue, jugerEcoute,
  seuilsOreille, reechantillonner, transcripteurWhisperCpp, Oreille, type Transcripteur,
} from '../oreille'

const PREVU = 'Ce soir on parle des jardins partagés qui poussent partout dans les quartiers populaires, et de ceux qui les cultivent.'
const S = seuilsOreille({})

test('les mots comparés : minuscules, sans accents ni ponctuation', () => {
  assert.deepEqual(motsCompares('les jardins partagés, déjà !', 'fr'), ['les', 'jardins', 'partages', 'deja'])
})

test('⭐ nombres, noms propres, sigles et hésitations NE COMPTENT PAS', () => {
  // « cent six » dit en lettres, écrit « 106 » par Whisper ; « NAW » écrit « Nao » ; « euh » effacé.
  assert.deepEqual(motsCompares('euh le NAW compte cent six jardins à Lyon', 'fr'), ['le', 'compte', 'jardins', 'a'])
  assert.deepEqual(motsCompares('le Nao compte 106 jardins à lyon', 'fr'), ['le', 'compte', 'jardins', 'a', 'lyon'])
})

test('le chinois se compare caractère par caractère, sans le latin ni les hésitations', () => {
  assert.deepEqual(motsCompares('嗯，今天我们聊 AI 和花园。', 'zh'), ['今', '天', '我', '们', '聊', '和', '花', '园'])
})

test('le russe garde ses lettres', () => {
  assert.deepEqual(motsCompares('ну, сегодня мы говорим о садах', 'ru'), ['сегодня', 'мы', 'говорим', 'о', 'садах'])
})

test('distance d’édition et taux d’erreur de mots', () => {
  assert.equal(distanceEdition(['a', 'b', 'c'], ['a', 'b', 'c']), 0)
  assert.equal(distanceEdition(['a', 'b', 'c'], ['a', 'x', 'c']), 1)
  assert.equal(distanceEdition(['a', 'b', 'c'], ['a', 'c']), 1)
  assert.equal(distanceEdition([], ['a']), 1)
  assert.equal(tauxErreurMots(['a', 'b', 'c', 'd'], ['a', 'b']), 0.5)
  assert.equal(tauxErreurMots([], []), 0)
})

test('mots perdus : ce qui manque à l’écoute, peu importe l’ordre', () => {
  assert.equal(partMotsPerdus(['a', 'b', 'c', 'd'], ['d', 'c', 'b', 'a']), 0)
  assert.equal(partMotsPerdus(['a', 'b', 'c', 'd'], ['a', 'b']), 0.5)
  assert.equal(partMotsPerdus(['a', 'a'], ['a']), 0.5, 'un mot répété doit être entendu deux fois')
})

test('la fin : l’un des deux derniers mots, parmi les derniers entendus', () => {
  assert.equal(finEntendue(['il', 'fait', 'beau', 'ce', 'soir'], ['il', 'fait', 'beau', 'ce', 'soir']), true)
  assert.equal(finEntendue(['il', 'fait', 'beau', 'ce', 'soir'], ['il', 'fait', 'beau']), false)
  assert.equal(finEntendue([], ['x']), true)
})

test('⭐ une réplique bien dite est COMPRISE (Whisper l’écrit à sa façon)', () => {
  const entendu = 'Ce soir, on parle des jardins partagés qui poussent partout dans les quartiers populaires et de ceux qui les cultivent.'
  const j = jugerEcoute(PREVU, entendu, 'fr', S)
  assert.equal(j.verdict, 'bon', j.motif)
  assert.ok(j.wer < 0.1)
})

test('⭐ une réplique COUPÉE au milieu est refusée', () => {
  const j = jugerEcoute(PREVU, 'Ce soir on parle des jardins partagés qui poussent', 'fr', S)
  assert.equal(j.verdict, 'mauvais')
  assert.match(j.motif, /perdus|fin non entendue/)
})

test('⭐ une réplique dite dans une AUTRE LANGUE est refusée', () => {
  const j = jugerEcoute(PREVU, 'Tonight we talk about the shared gardens growing everywhere in working-class neighborhoods.', 'fr', S)
  assert.equal(j.verdict, 'mauvais')
  assert.ok(j.wer > 0.8, `WER ${j.wer}`)
})

test('⭐ une bouillie (rien de compréhensible) est refusée', () => {
  assert.equal(jugerEcoute(PREVU, '', 'fr', S).verdict, 'mauvais')
  assert.equal(jugerEcoute(PREVU, 'Sous-titrage ST 501', 'fr', S).verdict, 'mauvais')
})

test('une réplique trop courte n’est pas jugée (Whisper est peu fiable sur deux mots)', () => {
  assert.equal(jugerEcoute('Ah, oui !', 'Ha.', 'fr', S).verdict, 'non-juge')
})

test('le chinois : bien dit = compris, coupé = refusé', () => {
  const prevu = '今天我们聊聊城市里的共享花园，还有照顾它们的人。'
  assert.equal(jugerEcoute(prevu, '今天我们聊聊城市里的共享花园,还有照顾它们的人', 'zh', S).verdict, 'bon')
  assert.equal(jugerEcoute(prevu, '今天我们聊聊', 'zh', S).verdict, 'mauvais')
})

test('les seuils se règlent ; une valeur absurde retombe sur le défaut', () => {
  assert.deepEqual(seuilsOreille({}), { wer: 0.5, perdus: 0.25, exigerFin: true, motsMinimum: 4 })
  const r = seuilsOreille({ OREILLE_SEUIL_WER: '0,3', OREILLE_SEUIL_PERDUS: '0.1', OREILLE_FIN: '0', OREILLE_MOTS_MIN: '6' })
  assert.deepEqual(r, { wer: 0.3, perdus: 0.1, exigerFin: false, motsMinimum: 6 })
  assert.equal(seuilsOreille({ OREILLE_SEUIL_WER: 'beaucoup' }).wer, 0.5)
  assert.equal(seuilsOreille({ OREILLE_SEUIL_PERDUS: '7' }).perdus, 0.25)
  // Un seuil plus sévère refuse ce que le défaut acceptait.
  const presque = 'Ce soir on parle des jardins qui poussent partout dans les quartiers populaires, et de ceux qui les cultivent.'
  assert.equal(jugerEcoute(PREVU, presque, 'fr', S).verdict, 'bon')
  assert.equal(jugerEcoute(PREVU, presque, 'fr', { ...S, perdus: 0.01 }).verdict, 'mauvais')
})

test('ré-échantillonnage vers 16 kHz : durée gardée', () => {
  const w = { samples: new Float32Array(24_000).fill(0.5), sampleRate: 24_000 }
  const r = reechantillonner(w)
  assert.equal(r.sampleRate, 16_000)
  assert.equal(r.samples.length, 16_000)
  assert.ok(Math.abs(r.samples[100] - 0.5) < 1e-6)
  assert.equal(reechantillonner(r), r)
})

test('⭐ sans whisper-cli ni modèle, l’oreille se déclare INDISPONIBLE (et ne bloque rien)', async () => {
  const sans = transcripteurWhisperCpp({ PATH: '/nulle/part', OREILLE_MODELE: '/nulle/part/modele.bin' })
  assert.ok('indisponible' in sans)
  assert.match((sans as { indisponible: string }).indisponible, /whisper-cli introuvable/)
  const coupee = transcripteurWhisperCpp({ OREILLE: '0' })
  assert.ok('indisponible' in coupee)
  const o = new Oreille(sans, S, () => {})
  assert.match(o.indisponible() ?? '', /whisper-cli/)
  assert.equal(await o.ecouter({ samples: new Float32Array(10), sampleRate: 16_000 }, PREVU, 'fr'), null)
})

test('un binaire présent sans modèle : indisponible, motif « modèle absent »', () => {
  const t = transcripteurWhisperCpp({ OREILLE_BINAIRE: process.execPath, OREILLE_MODELE: '/nulle/part/ggml.bin' })
  assert.match((t as { indisponible: string }).indisponible, /modèle Whisper absent/)
})

test('l’oreille juge avec son transcripteur, et se COUPE après trois échecs d’affilée', async () => {
  const wav = { samples: new Float32Array(10), sampleRate: 16_000 }
  let appels = 0
  const bon: Transcripteur = { transcrire: async () => { appels++; return PREVU } }
  assert.equal((await new Oreille(bon, S, () => {}).ecouter(wav, PREVU, 'fr'))?.verdict, 'bon')
  const casse: Transcripteur = { transcrire: async () => { appels++; throw new Error('segfault') } }
  const lignes: string[] = []
  const o = new Oreille(casse, S, l => lignes.push(l))
  for (let k = 0; k < 5; k++) assert.equal(await o.ecouter(wav, PREVU, 'fr'), null)
  assert.equal(appels, 1 + 3, 'plus aucun appel après le coupe-circuit')
  assert.match(o.indisponible() ?? '', /3 transcriptions ratées/)
})

test('⭐ une FIN avalée suffit à refuser, même quand presque tous les mots sont là', () => {
  const prevu = 'Ce soir on parle des jardins partagés qui poussent partout dans les quartiers populaires, et de ceux qui les cultivent avec patience chaque matin.'
  const entendu = 'Ce soir on parle des jardins partagés qui poussent partout dans les quartiers populaires, et de ceux qui les cultivent avec patience'
  const j = jugerEcoute(prevu, entendu, 'fr', S)
  assert.ok(j.perdus <= S.perdus && j.wer <= S.wer, `ni les mots perdus (${j.perdus}) ni le WER (${j.wer}) ne le voient`)
  assert.equal(j.verdict, 'mauvais')
  assert.match(j.motif, /fin non entendue/)
  assert.equal(jugerEcoute(prevu, entendu, 'fr', { ...S, exigerFin: false }).verdict, 'bon', 'OREILLE_FIN=0 le laisse passer')
})
