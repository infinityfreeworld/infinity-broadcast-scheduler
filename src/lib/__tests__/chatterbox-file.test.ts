/**
 * @module InfinityScheduler/Lib/Chatterbox/FileTests
 * @description 🎙️ Ce que data-space nous a appris le 10/09/2026, rendu vérifiable.
 *
 *   1. Notre garde-fou abandonnait à 20 minutes ; un travail a fini à 20 min 41 s. L'audio
 *      existait, nous avions cessé de le redemander 41 secondes trop tôt.
 *   2. Deux attentes n'appellent pas le même remède : un 429 `not_ready` (le travail existe et
 *      avance) et un 503 `queue_error` (il n'a PAS été enregistré — « réessaie ; si ça
 *      persiste, signale-nous cet identifiant »). Nous traitions le 503 comme une panne
 *      définitive et repliions sur Piper.
 *   3. Pour tout travail bloqué, ils demandent « son job_id et l'heure ». Nous jetions le
 *      job_id, et l'appelant tronque le message à 120 caractères.
 *
 *   Lancer :  npx tsx --test src/lib/__tests__/chatterbox-file.test.ts
 */
import { test, mock, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import {
  synthesizeWithChatterbox, lireCorpsErreur, formaterRefus, ChatterboxError, MAX_FILES_RATEES,
} from '../chatterbox'

process.env.CHATTERBOX_TTS_URL = 'https://station.exemple.test'
const OPTS = { text: 'Bonjour.', voice: 'ranouna' }
const AUDIO = Buffer.from('RIFF----WAVEfmt ')

const reponse = (status: number, corps?: unknown, retryAfter = '0') =>
  status === 200
    ? new Response(AUDIO, { status: 200 })
    : new Response(corps === undefined ? '' : JSON.stringify(corps), {
        status, headers: { 'retry-after': retryAfter, 'content-type': 'application/json' },
      })

/** Enchaîne les réponses données, puis répète la dernière. Compte les appels. */
function serveur(...suite: Array<() => Response>) {
  let n = 0
  const m = mock.method(globalThis, 'fetch', async () => suite[Math.min(n++, suite.length - 1)]())
  return { appels: () => m.mock.callCount() }
}

afterEach(() => mock.restoreAll())

const NOT_READY = { error: { code: 'not_ready' }, status: 'pending', retry_after: 30, job_id: 'vxATTENTE01' }
const QUEUE_ERR = { error: { code: 'queue_error', message: 'Le travail n’a pas pu être mis en file.' }, job_id: 'vxFILE0002' }

test('le corps d’erreur livre job_id et code ; un corps illisible ne fait pas lever', () => {
  // `refus` fait partie du contrat depuis last_refusal (10/09 22:40) : absent du corps → non défini.
  assert.deepEqual(lireCorpsErreur(JSON.stringify(QUEUE_ERR)), { jobId: 'vxFILE0002', code: 'queue_error', refus: undefined })
  assert.deepEqual(lireCorpsErreur('<html>502 Bad Gateway</html>'), {})
  assert.deepEqual(lireCorpsErreur(''), {})
})

test('⭐ un 429 not_ready est redemandé jusqu’à l’audio', async () => {
  const s = serveur(() => reponse(429, NOT_READY), () => reponse(429, NOT_READY), () => reponse(200))
  const audio = await synthesizeWithChatterbox(OPTS)
  assert.deepEqual(audio, AUDIO)
  assert.equal(s.appels(), 3)
})

test('⭐ un 503 queue_error est RÉESSAYÉ, plus replié en Piper au premier accroc', async () => {
  // Avant : premier 503 → exception → repli Piper pour tout le tour.
  const s = serveur(() => reponse(503, QUEUE_ERR), () => reponse(200))
  const audio = await synthesizeWithChatterbox(OPTS)
  assert.deepEqual(audio, AUDIO)
  assert.equal(s.appels(), 2)
})

test('⭐ un queue_error qui PERSISTE finit par être signalé, avec son job_id', async () => {
  const s = serveur(() => reponse(503, QUEUE_ERR))
  await assert.rejects(synthesizeWithChatterbox(OPTS), (err: unknown) => {
    assert.ok(err instanceof ChatterboxError)
    assert.equal(err.jobId, 'vxFILE0002')
    assert.equal(err.code, 'queue_error')
    assert.match(err.message, /à signaler à data-space/)
    return true
  })
  // Borné : on n'insiste pas indéfiniment sur une mise en file qui échoue.
  assert.equal(s.appels(), MAX_FILES_RATEES + 1)
})

test('⭐ le job_id tient dans les 120 premiers caractères du message', async () => {
  // L'appelant écrit `msg.slice(0, 120)` : un identifiant en fin de message était coupé.
  serveur(() => reponse(503, QUEUE_ERR))
  await assert.rejects(synthesizeWithChatterbox(OPTS), (err: unknown) => {
    assert.ok((err as Error).message.slice(0, 120).includes('vxFILE0002'))
    return true
  })
})

test('un 503 SANS queue_error n’est pas réessayé (ce n’est pas le même incident)', async () => {
  const s = serveur(() => reponse(503, { error: { code: 'maintenance' } }))
  await assert.rejects(synthesizeWithChatterbox(OPTS), ChatterboxError)
  assert.equal(s.appels(), 1)
})

test('un échec de synthèse (502) part tout de suite, sans boucle', async () => {
  const s = serveur(() => reponse(502, { error: { code: 'synthesis_failed', message: 'la synthèse a échoué' } }))
  await assert.rejects(synthesizeWithChatterbox(OPTS), (err: unknown) => {
    assert.equal((err as ChatterboxError).code, 'synthesis_failed')
    return true
  })
  assert.equal(s.appels(), 1)
})

test('⭐ la fenêtre d’une émission vaut 30 minutes, et plus aucune ne vaut 20', () => {
  // Travail vx14e385558a… : soumis 09:23:31, prêt 09:44:12 — abandonné 41 s trop tôt.
  const src = readFileSync(new URL('../chatterbox.ts', import.meta.url), 'utf8')
  assert.equal((src.match(/CHATTERBOX_ECHEANCE_S \?\? '1800'/g) ?? []).length, 2)
  assert.doesNotMatch(src, /CHATTERBOX_ECHEANCE_S \?\? '1200'/)
})

test('⭐ la course externe ne coupe plus AVANT le budget de la file', () => {
  // Les deux se contredisaient : 1 800 s de file, coupés à 1 200 par la course.
  const src = readFileSync(new URL('../chatterbox.ts', import.meta.url), 'utf8')
  const file = Number(/CHATTERBOX_QUEUE_BUDGET_S \?\? '(\d+)'/.exec(src)?.[1])
  const course = Number(/CHATTERBOX_ECHEANCE_S \?\? '(\d+)'/.exec(src)?.[1])
  assert.ok(course >= file, `course ${course}s < file ${file}s`)
})

test('l’appelant écrit le job_id ET l’heure datée sur la ligne d’échec', () => {
  const src = readFileSync(new URL('../../scripts/generate-broadcast.ts', import.meta.url), 'utf8')
  assert.match(src, /job_id=\$\{jobId\} \$\{new Date\(\)\.toISOString\(\)\}/)
})

// ── last_refusal : la raison chiffrée d'un refus (data-space, en ligne depuis le 10/09 22:40) ──
const REFUS = { reason: 'audio trop court pour son texte', at: '2026-09-10T20:31:00.000Z', audio_seconds: 3.1, chars: 401, min_seconds: 16, count: 6 }

test('⭐ la raison chiffrée d’un refus est lue et mise en une ligne citable', () => {
  const r = formaterRefus(REFUS)
  assert.match(r ?? '', /audio trop court pour son texte/)
  assert.match(r ?? '', /audio 3\.1 s pour 401 car\. \(min 16 s\)/)
  assert.match(r ?? '', /6 refus/)
  assert.equal(formaterRefus(undefined), undefined)
  assert.equal(formaterRefus('pas un objet'), undefined)
  assert.equal(lireCorpsErreur(JSON.stringify({ job_id: 'vxR', last_refusal: REFUS })).refus, r)
})

test('⭐ un 502 porte son dernier refus jusqu’à l’appelant, AVANT le corps brut', async () => {
  serveur(() => reponse(502, { error: { code: 'synthesis_failed' }, job_id: 'vxREFUS01', last_refusal: REFUS }))
  await assert.rejects(synthesizeWithChatterbox(OPTS), (err: unknown) => {
    assert.ok(err instanceof ChatterboxError)
    assert.match(err.dernierRefus ?? '', /401 car\./)
    assert.match(err.message, /dernier refus : audio trop court/)
    return true
  })
})

test('un 429 qui porte un refus antérieur n’empêche pas d’obtenir l’audio ensuite', async () => {
  const s = serveur(() => reponse(429, { ...NOT_READY, last_refusal: REFUS }), () => reponse(200))
  assert.deepEqual(await synthesizeWithChatterbox(OPTS), AUDIO)
  assert.equal(s.appels(), 2)
})

test('l’appelant écrit le refus EN ENTIER, sur sa propre ligne', () => {
  const src = readFileSync(new URL('../../scripts/generate-broadcast.ts', import.meta.url), 'utf8')
  assert.match(src, /dernier refus data-space : \$\{refus\}/)
})
