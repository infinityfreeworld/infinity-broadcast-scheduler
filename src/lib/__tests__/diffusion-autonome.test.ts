/**
 * @module InfinityScheduler/Diffusion/AutonomieTests
 * @description 🛡️ La diffusion doit tenir « même si le poste A ou B est fermé » (fondateur, 14/09/2026) :
 *   anti-doublon entre producteurs, secours GitHub qui ne refait QUE ce qui manque, veille du matin.
 *
 *   Lancer :  npx tsx --test src/lib/__tests__/diffusion-autonome.test.ts
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dTagsPublies, type Requete } from '../deja-diffuse'
import { SEED_STATIONS } from '../../data/seed-stations'
import { TV_CHANNELS } from '../../data/seed-tv-channels'
// @ts-expect-error — module JavaScript sans déclaration de types (le script de la veille)
import * as V from '../../../scripts/veille-diffusion.mjs'

const lire = (chemin: string) => readFileSync(new URL(chemin, import.meta.url), 'utf8')
const ev = (pubkey: string, d: string) => ({ pubkey, tags: [['d', d]] })

// ── Anti-doublon ───────────────────────────────────────────────────────
test('⭐ une émission déjà publiée par NOTRE clé est reconnue', async () => {
  const q: Requete = async () => [ev('moi', 'wtf-radio:2026-09-15')]
  assert.deepEqual([...(await dTagsPublies(30093, ['wtf-radio:2026-09-15', 'g1-radio:2026-09-15'], 'moi', ['r'], q))!], ['wtf-radio:2026-09-15'])
})

test('⭐ la même émission signée par QUELQU’UN D’AUTRE ne compte pas', async () => {
  const q: Requete = async () => [ev('usurpateur', 'wtf-radio:2026-09-15')]
  assert.equal((await dTagsPublies(30093, ['wtf-radio:2026-09-15'], 'moi', ['r'], q))!.size, 0)
})

test('⭐ relais illisibles → null : l’appelant PRODUIT (mieux vaut payer deux fois qu’un soir de silence)', async () => {
  const q: Requete = async () => { throw new Error('réseau') }
  assert.equal(await dTagsPublies(30093, ['x:2026-09-15'], 'moi', ['r'], q), null)
})

test('le générateur vérifie AVANT de dépenser, et on peut forcer', () => {
  const src = lire('../../scripts/generate-broadcast.ts')
  const corps = src.slice(src.indexOf('async function main'))
  const verif = corps.indexOf('dTagsPublies(')
  assert.ok(verif > 0, 'le contrôle anti-doublon doit exister dans main')
  assert.ok(verif > corps.indexOf('langueSynthetisable('), 'après les contrôles gratuits')
  assert.ok(verif < corps.indexOf('publishBroadcast('), 'avant toute publication')
  assert.match(corps, /FORCER_REGENERATION !== '1'/)
  assert.match(corps, /process\.exit\(0\)/, 'une émission déjà faite n’est pas un échec')
})

test('chaque émission dit QUI l’a fabriquée', () => {
  assert.match(lire('../nostr.ts'), /\['producteur', process\.env\.PRODUCTEUR \|\| 'inconnu'\]/)
  assert.match(lire('../../../scripts/nuit-locale.sh'), /export PRODUCTEUR="\$\{PRODUCTEUR:-mac\}"/)
})

// ── Secours GitHub ─────────────────────────────────────────────────────
const WF = lire('../../../.github/workflows/daily-broadcast.yml')

test('⭐ le secours tourne APRÈS la fenêtre du Mac, pour le jour qui commence', () => {
  assert.match(WF, /cron: '30 1 \* \* \*'/)
  assert.match(WF, /date -u \+%F/, 'la date du secours est celle du jour (UTC)')
})

test('⭐ le secours ne produit QUE les stations manquantes, et ne démarre rien s’il n’y en a aucune', () => {
  assert.match(WF, /stations:list -- --manquantes/)
  assert.match(WF, /needs\.preparer\.outputs\.stations != '\[\]'/)
  assert.match(WF, /PRODUCTEUR: github-secours/)
})

test('🔴 les tests du préparateur ont leurs outils : sans opusenc, le secours échouait AVANT de produire', () => {
  const prep = WF.slice(WF.indexOf('preparer:'), WF.indexOf('emission:'))
  assert.match(prep, /opus-tools/)
  assert.ok(prep.indexOf('opus-tools') < prep.indexOf('npm test'))
})

// ── Veille du matin ────────────────────────────────────────────────────
test('⭐ la veille connaît EXACTEMENT les stations et canaux diffusés', () => {
  assert.deepEqual([...V.RADIOS].sort(), SEED_STATIONS.map(s => s.id).sort())
  assert.deepEqual([...V.CANAUX_TV].sort(), TV_CHANNELS.map(c => c.id).sort())
})

test('la veille fait le bon bilan, et ne s’aveugle pas sur un relais muet', async () => {
  const date = '2026-09-15'
  // La TV attendue le 15 est celle fabriquée le 14 au soir (datée du 14) : cf. veilleDe.
  const faux = async (url: string) => url === 'muet' ? null : new Set([`wtf-radio:${date}`, `tv-main-1:2026-09-14`])
  const b = await V.bilan(date, ['ok', 'muet'], faux)
  assert.equal(b.relaisOk, 1)
  assert.ok(b.radios.ok.includes('wtf-radio') && b.radios.manquantes.includes('g1-radio'))
  assert.deepEqual(b.tv.manquants, ['tv-nature'])
  assert.equal(b.dateTv, '2026-09-14')
})

test('⭐ la TV attendue un matin est celle de la VEILLE (fabriquée à 20 h UTC, datée du jour de fabrication)', () => {
  assert.equal(V.veilleDe('2026-09-15'), '2026-09-14')
  assert.equal(V.veilleDe('2026-03-01'), '2026-02-28')
})

test('⭐ les messages : bilan le matin, alerte forte à 9 h, veille aveugle signalée', () => {
  const tout = { date: 'd', relaisOk: 3, relaisTotal: 4, radios: { ok: V.RADIOS, manquantes: [] }, tv: { ok: V.CANAUX_TV, manquants: [] } }
  assert.equal(V.message(tout, 6).priorite, 'low')
  assert.equal(V.message(tout, 9), null, 'pas de bruit à 9 h quand tout est là')
  const trou = { ...tout, radios: { ok: [], manquantes: ['g1-radio'] } }
  assert.equal(V.message(trou, 9).priorite, 'high')
  assert.match(V.message({ ...tout, relaisOk: 0 }, 6).titre, /AVEUGLE/)
})

test('la veille ne lit que des relais publics, n’a aucune clé et respecte les conditions du hub', () => {
  const src = lire('../../../scripts/veille-diffusion.mjs')
  assert.ok(!/NOSTR_PRIVATE_KEY|state\.db|nsec/.test(src))
  const svc = lire('../../../scripts/veille-diffusion/infinity-veille.service')
  for (const r of [/MemoryMax=256M/, /PrivateTmp=true/, /Nice=19/, /CPUQuota=/, /WorkingDirectory=\/root\/veille-diffusion/]) assert.match(svc, r)
  const tim = lire('../../../scripts/veille-diffusion/infinity-veille.timer')
  assert.match(tim, /06:00:00 UTC/)
  assert.match(tim, /09:00:00 UTC/)
})
