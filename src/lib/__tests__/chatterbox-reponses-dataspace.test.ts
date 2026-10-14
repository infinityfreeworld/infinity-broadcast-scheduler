/**
 * @module InfinityScheduler/Lib/Chatterbox/ReponsesDataspaceTests
 * @description 🎙️ Les nouvelles réponses du service de voix de data-space (message du 14/10/2026),
 *   rendues vérifiables — avec de FAUX fetch, aucun appel réseau.
 *
 *   1. Un travail en échec est relancé chez eux si l'on rejoue la MÊME requête : on reçoit
 *      `429 not_ready` + `retry_after`. On attend, puis on rejoue À L'IDENTIQUE.
 *   2. Un échec FINAL est un `500` JSON `{ code: "synthesis_failed", final: true, … }` : on
 *      n'insiste pas (le repli de l'appelant s'applique), raison et job_id au journal.
 *   3. Chaque réponse porte des en-têtes `x-ds-*` : lus, journalisés, résumés dans la note de qualité.
 *   4. Une langue appliquée différente de celle envoyée, ou déduite alors qu'envoyée : avertissement.
 *
 *   Lancer :  npx tsx --test src/lib/__tests__/chatterbox-reponses-dataspace.test.ts
 */
import { test, mock, afterEach, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import { synthesizeWithChatterbox, ChatterboxError, lireCorpsErreur, attenteBornee } from '../chatterbox'
import {
  lireInfosDataspace, formaterInfosDataspace, controleLangue, bilanDataspace, remettreBilanDataspace,
} from '../dataspace-reponse'
import { noteQualite, resumeQualite } from '../note-qualite'

process.env.CHATTERBOX_TTS_URL = 'https://station.exemple.test'
const AUDIO = Buffer.from('RIFF----WAVEfmt ')

const EN_TETES_OK = {
  'x-ds-job-id': 'vxOK0001', 'x-ds-engine': 'chatterbox', 'x-ds-model': 'multilingual',
  'x-ds-language': 'fr', 'x-ds-language-inferred': '0', 'x-ds-station': 'st-paris-2',
  'x-ds-gpu': 'RTX-4090', 'x-ds-queue': '2', 'x-ds-stations-ready': '3', 'x-ds-retries': '1',
}

type Appel = { url: string; init?: RequestInit }

/** Faux serveur : enchaîne les réponses données, répète la dernière, garde chaque appel. */
function serveur(...suite: Array<() => Response>) {
  const appels: Appel[] = []
  mock.method(globalThis, 'fetch', async (url: unknown, init?: RequestInit) => {
    appels.push({ url: String(url), init })
    return suite[Math.min(appels.length - 1, suite.length - 1)]()
  })
  return appels
}

/** Capture console.log / console.warn. */
function journal() {
  const lignes: string[] = []
  mock.method(console, 'log', (...a: unknown[]) => { lignes.push(a.join(' ')) })
  mock.method(console, 'warn', (...a: unknown[]) => { lignes.push(a.join(' ')) })
  return lignes
}

beforeEach(() => remettreBilanDataspace())
afterEach(() => mock.restoreAll())

test('⭐ 429 not_ready + retry_after (relance chez data-space) → on attend puis on rejoue la MÊME requête, jusqu’à l’audio', async () => {
  const lignes = journal()
  const appels = serveur(
    () => new Response(JSON.stringify({ error: { code: 'not_ready' }, retry_after: 1, job_id: 'vxRELANCE1' }), {
      status: 429,
      headers: { 'content-type': 'application/json', 'x-ds-job-id': 'vxRELANCE1', 'x-ds-retries': '1', 'x-ds-station': 'st-a', 'x-ds-language': 'fr', 'x-ds-language-inferred': '0' },
    }),
    () => new Response(AUDIO, { status: 200, headers: { ...EN_TETES_OK, 'x-ds-job-id': 'vxRELANCE1', 'x-ds-station': 'st-b' } }),
  )
  const t0 = Date.now()
  const audio = await synthesizeWithChatterbox({ text: 'Bonjour à tous.', voice: 'ranouna', language: 'fr' })
  assert.deepEqual(audio, AUDIO)
  assert.equal(appels.length, 2)
  // retry_after du CORPS respecté (pas d'en-tête Retry-After ici) : ~1 s, pas les 15 s par défaut.
  const ecoule = Date.now() - t0
  assert.ok(ecoule >= 900 && ecoule < 5000, `attente ${ecoule} ms`)
  // À L'IDENTIQUE : même adresse, même corps.
  assert.equal(appels[0].url, appels[1].url)
  assert.equal(appels[0].init?.body, appels[1].init?.body)
  assert.equal(JSON.parse(String(appels[0].init?.body)).language, 'fr')
  assert.ok(lignes.some(l => /relance en cours chez data-space/.test(l) && /job_id vxRELANCE1/.test(l)), lignes.join('\n'))
  // Le bilan retient les deux stations et la relance (comptée une fois pour le travail).
  assert.deepEqual(bilanDataspace(), { stations: ['st-a', 'st-b'], langueDeduite: 0, retries: 1, echecsFinals: 0 })
})

test('⭐ 500 synthesis_failed final → AUCUN nouvel essai, raison et job_id au journal', async () => {
  const lignes = journal()
  const appels = serveur(() => new Response(JSON.stringify({
    code: 'synthesis_failed', final: true, job_id: 'vxFINAL001',
    reasons: ['CUDA out of memory', { reason: 'worker perdu' }],
  }), {
    status: 500,
    headers: { 'content-type': 'application/json', 'x-ds-job-id': 'vxFINAL001', 'x-ds-station': 'st-c', 'x-ds-gpu': 'A100', 'x-ds-retries': '3', 'x-ds-queue': '0', 'x-ds-language': 'fr', 'x-ds-language-inferred': '0' },
  }))
  await assert.rejects(synthesizeWithChatterbox({ text: 'Bonjour.', voice: 'ranouna', language: 'fr' }), (err: unknown) => {
    assert.ok(err instanceof ChatterboxError)
    assert.equal(err.status, 500)
    assert.equal(err.final, true)
    assert.equal(err.jobId, 'vxFINAL001')
    assert.equal(err.code, 'synthesis_failed')
    assert.match(err.message, /^\[job_id vxFINAL001\] .*échec FINAL.*3 relance/)
    assert.match(err.message, /CUDA out of memory \| worker perdu/)
    return true
  })
  assert.equal(appels.length, 1, 'un échec final ne se réessaie pas')
  const echec = lignes.find(l => /\[chatterbox\] échec HTTP 500 synthesis_failed \(échec FINAL/.test(l))
  assert.ok(echec, lignes.join('\n'))
  for (const attendu of ['job_id vxFINAL001', 'station st-c', 'gpu A100', 'langue fr (reçue)', 'file 0', 'relances 3']) {
    assert.ok(echec!.includes(attendu), `« ${attendu} » absent de : ${echec}`)
  }
  assert.deepEqual(bilanDataspace(), { stations: ['st-c'], langueDeduite: 0, retries: 3, echecsFinals: 1 })
})

test('un 502 sans JSON reste un échec immédiat, comme avant (et la ligne le dit sans en-têtes)', async () => {
  const lignes = journal()
  const appels = serveur(() => new Response('<html>502 Bad Gateway</html>', { status: 502 }))
  await assert.rejects(synthesizeWithChatterbox({ text: 'Bonjour.', voice: 'ranouna' }), (err: unknown) => {
    assert.ok(err instanceof ChatterboxError)
    assert.equal(err.status, 502)
    assert.notEqual(err.final, true)
    return true
  })
  assert.equal(appels.length, 1)
  assert.ok(lignes.some(l => /échec HTTP 502 — job_id \? · \(aucun en-tête x-ds-\*\)/.test(l)), lignes.join('\n'))
  assert.equal(bilanDataspace(), null, 'rien appris de data-space : pas de résumé')
})

test('⭐ en-têtes x-ds-* lus (et repli sur le corps JSON), mis en forme pour le journal', () => {
  const h = new Headers(EN_TETES_OK)
  const i = lireInfosDataspace(h)
  assert.deepEqual(i, {
    jobId: 'vxOK0001', moteur: 'chatterbox', modele: 'multilingual', langue: 'fr', langueDeduite: false,
    station: 'st-paris-2', gpu: 'RTX-4090', file: 2, stationsPretes: '3', relances: 1,
  })
  assert.equal(formaterInfosDataspace(i), 'job_id vxOK0001 · station st-paris-2 · gpu RTX-4090 · langue fr (reçue) · file 2 · relances 1')
  // Sans en-tête : le corps JSON répond.
  const c = lireInfosDataspace(new Headers(), { job_id: 'vxC', station: 'st-x', language_inferred: 1, queue: 4 })
  assert.deepEqual(c, { jobId: 'vxC', station: 'st-x', langueDeduite: true, file: 4 })
  assert.equal(formaterInfosDataspace({}), 'job_id ? · station ? · gpu ? · langue ? · file ? · relances ?')
})

test('⭐ la 302 vers l’audio : ses en-têtes sont lus AVANT de suivre, sans jeton vers une autre origine', async () => {
  journal()
  const appels = serveur(
    () => new Response(null, { status: 302, headers: { location: 'https://stockage.exemple.test/a.wav', ...EN_TETES_OK } }),
    () => new Response(AUDIO, { status: 200 }),
  )
  process.env.CHATTERBOX_API_KEY = 'jeton-de-test'
  try {
    const audio = await synthesizeWithChatterbox({ text: 'Bonjour.', voice: 'ranouna', language: 'fr' })
    assert.deepEqual(audio, AUDIO)
  } finally {
    delete process.env.CHATTERBOX_API_KEY
  }
  assert.equal(appels.length, 2)
  assert.equal(appels[0].init?.redirect, 'manual')
  assert.equal(appels[1].url, 'https://stockage.exemple.test/a.wav')
  assert.equal((appels[1].init?.headers as Record<string, string>).Authorization, undefined)
  assert.deepEqual(bilanDataspace(), { stations: ['st-paris-2'], langueDeduite: 0, retries: 1, echecsFinals: 0 })
})

test('⭐ avertissement de langue : appliquée ≠ envoyée, ou déduite alors qu’envoyée', async () => {
  assert.equal(controleLangue('fr', { langue: 'fr', langueDeduite: false }), null)
  assert.equal(controleLangue('fr', { langue: 'fr-FR' }), null)
  assert.match(controleLangue('fr', { langue: 'en', jobId: 'vxL' })!, /envoyé « fr », data-space a appliqué « en ».*vxL/)
  assert.match(controleLangue('zh', { langue: 'zh', langueDeduite: true })!, /DÉDUITE alors que nous l'avons envoyée/)

  const lignes = journal()
  serveur(() => new Response(AUDIO, { status: 200, headers: { ...EN_TETES_OK, 'x-ds-job-id': 'vxLANGUE', 'x-ds-language': 'en', 'x-ds-language-inferred': '1' } }))
  await synthesizeWithChatterbox({ text: 'Bonjour.', voice: 'ranouna', language: 'fr' })
  assert.ok(lignes.some(l => /LANGUE : nous avons envoyé « fr », data-space a appliqué « en » \(déduite\) \(job_id vxLANGUE\)/.test(l)), lignes.join('\n'))
  assert.equal(bilanDataspace()?.langueDeduite, 1)
})

test('corps d’erreur : code de premier niveau, final, retry_after ; attente toujours bornée', () => {
  const r = lireCorpsErreur(JSON.stringify({ code: 'synthesis_failed', final: true, job_id: 'vxF', previous_errors: ['a', 'b'] }))
  assert.deepEqual(r, { jobId: 'vxF', code: 'synthesis_failed', refus: undefined, final: true, raisons: 'a | b' })
  assert.equal(lireCorpsErreur(JSON.stringify({ error: { code: 'not_ready' }, retry_after: 30 })).retryAfter, 30)
  assert.equal(attenteBornee(undefined), 15)
  assert.equal(attenteBornee(0), 1)
  assert.equal(attenteBornee(30), 30)
  assert.equal(attenteBornee(100_000), 120)
})

test('note de qualité : `dataspace` ADDITIF — absent sans bilan, résumé lisible avec', () => {
  const sans = noteQualite({ voixAttendues: 2, voixObtenues: 2 })
  assert.equal('dataspace' in sans, false)
  const avec = noteQualite({ voixAttendues: 2, voixObtenues: 1, dataspace: { stations: ['st-a', 'st-b'], langueDeduite: 1, retries: 2, echecsFinals: 1 } })
  assert.deepEqual(avec.dataspace, { stations: ['st-a', 'st-b'], langueDeduite: 1, retries: 2, echecsFinals: 1 })
  assert.equal(avec.version, 1)
  assert.match(resumeQualite(avec), /data-space 2 station\(s\), 2 relance\(s\), 1 échec\(s\) final\(s\), 1 langue\(s\) déduite\(s\)/)
})
