/**
 * 🔍 La boucle de correction d'une réplique défectueuse : régénérer (même voix, 2 essais), puis
 * voix native de secours, puis rognage — et JAMAIS d'émission qui échoue à cause du contrôle.
 *
 * Moteurs simulés : ils rendent des signaux fabriqués (voix saine, ou voix trouée d'un blanc et
 * d'un souffle), sans réseau ni binaire.
 *
 * Lancer :  npx tsx --test src/lib/__tests__/controle-voix.test.ts
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { ControleQualiteVoix, reglagesEssai, type MoteursControle, type TourAControler } from '../controle-voix'
import type { DecodedWav } from '../audio'

const TAUX = 24000

function voix(secondes: number): Float32Array {
  const n = Math.round(secondes * TAUX)
  const out = new Float32Array(n)
  let phase = 0
  for (let i = 0; i < n; i++) {
    const t = i / TAUX
    phase += (2 * Math.PI * (150 + 40 * Math.sin(2 * Math.PI * 0.7 * t))) / TAUX
    const syll = (t * 4) % 1
    const env = syll < 0.75 ? Math.sin((Math.PI * syll) / 0.75) : 0
    let v = 0
    for (let h = 1; h <= 8; h++) v += Math.sin(h * phase) / h
    out[i] = 0.25 * env * v
  }
  return out
}
function coller(...p: Float32Array[]): Float32Array {
  const out = new Float32Array(p.reduce((s, x) => s + x.length, 0))
  let o = 0
  for (const x of p) { out.set(x, o); o += x.length }
  return out
}
function souffle(secondes: number): Float32Array {
  const out = new Float32Array(Math.round(secondes * TAUX))
  let x = 3
  for (let i = 0; i < out.length; i++) { x = (x * 1103515245 + 12345) & 0x7fffffff; out[i] = (x / 0x7fffffff - 0.5) * 0.04 }
  return out
}

const TEXTE = '今天我们来聊聊新闻自由，聊聊那些政府不想让你知道的事情。西班牙的住房危机越来越严重，年轻人根本租不起房子，大家怎么看'
const SAIN = (): DecodedWav => ({ samples: voix(11), sampleRate: TAUX })
const TROUE = (): DecodedWav => ({ samples: coller(voix(5), new Float32Array(2 * TAUX), voix(3), souffle(1.5), voix(3)), sampleRate: TAUX })

function tour(wav: DecodedWav, viaClone = true, numero = 3): TourAControler {
  return { numero, locuteur: '建国', texte: TEXTE, wav, viaClone, voixPersonnage: viaClone ? 'inv-zy-jian' : null, voixLocale: 'kokoro-zh:zm_009' }
}

interface Appels { clone: Array<{ temperature: number; maxCaracteres: number }>; locale: Array<number | undefined> }

function moteurs(clone: Array<() => DecodedWav>, locale: Array<() => DecodedWav>): { m: MoteursControle; appels: Appels } {
  const appels: Appels = { clone: [], locale: [] }
  let ic = 0, il = 0
  return {
    appels,
    m: {
      async clone(_t, _v, r) { appels.clone.push({ temperature: r.temperature, maxCaracteres: r.maxCaracteres }); return clone[Math.min(ic++, clone.length - 1)]() },
      async locale(_t, _v, max) { appels.locale.push(max); return locale[Math.min(il++, locale.length - 1)]() },
    },
  }
}

const panne = () => { throw new Error('service injoignable') }

test('⭐ un tour sain n’appelle aucun moteur et sort tel quel', async () => {
  const { m, appels } = moteurs([panne], [panne])
  const c = new ControleQualiteVoix({ langue: 'zh', moteurs: m, log: () => {} })
  const w = SAIN()
  assert.equal(await c.controler(tour(w)), w)
  assert.equal(appels.clone.length + appels.locale.length, 0)
  assert.match(c.ligneBilan(), /1 tours contrôlés, aucun défaut/)
})

test('⭐ (a) régénéré : essai 1 encore troué, essai 2 sain — réglages plus prudents, morceaux plus courts', async () => {
  const { m, appels } = moteurs([TROUE, SAIN], [panne])
  const journal: string[] = []
  const c = new ControleQualiteVoix({ langue: 'zh', moteurs: m, log: l => journal.push(l) })
  const w = await c.controler(tour(TROUE()))
  assert.equal(appels.clone.length, 2)
  assert.ok(appels.clone[1].temperature < appels.clone[0].temperature)
  assert.ok(appels.clone[1].maxCaracteres < appels.clone[0].maxCaracteres)
  assert.equal(appels.locale.length, 0)
  assert.equal(w.samples.length, SAIN().samples.length)
  assert.match(journal.join('\n'), /🔍 tour 3 \(建国\) : .*blanc de 2,0 s.* → régénéré \(essai 2\) OK/)
  assert.equal(c.bilan().regeneres, 1)
})

test('⭐ (b) voix clonée toujours trouée : la voix native de secours prend le tour', async () => {
  const { m, appels } = moteurs([TROUE], [SAIN])
  const journal: string[] = []
  const c = new ControleQualiteVoix({ langue: 'zh', moteurs: m, log: l => journal.push(l) })
  await c.controler(tour(TROUE()))
  assert.equal(appels.clone.length, 2)
  assert.deepEqual(appels.locale, [undefined])
  assert.match(journal.join('\n'), /→ voix de secours kokoro-zh:zm_009 OK/)
  assert.equal(c.bilan().secours, 1)
})

test('⭐ (c) tout reste troué : le moins mauvais est rogné (blancs et souffle raccourcis)', async () => {
  const { m } = moteurs([TROUE], [TROUE])
  const journal: string[] = []
  const c = new ControleQualiteVoix({ langue: 'zh', moteurs: m, log: l => journal.push(l) })
  const original = TROUE()
  const w = await c.controler(tour(original))
  assert.ok(w.samples.length < original.samples.length - 2 * TAUX, 'au moins 2 s retirées')
  assert.match(journal.join('\n'), /rognés \(−\d+,\d s\)/)
  assert.equal(c.bilan().rognes, 1)
})

test('⭐ moteurs en panne : jamais d’exception, le tour est rogné ou gardé', async () => {
  const { m } = moteurs([panne], [panne])
  const journal: string[] = []
  const c = new ControleQualiteVoix({ langue: 'zh', moteurs: m, log: l => journal.push(l) })
  const w = await c.controler(tour(TROUE()))
  assert.ok(w.samples.length > 0)
  assert.match(journal.join('\n'), /impossible — service injoignable/)
})

test('⭐ une analyse qui lève rend le tour d’origine', async () => {
  const { m } = moteurs([panne], [panne])
  const c = new ControleQualiteVoix({ langue: 'zh', moteurs: m, log: () => {} })
  const bancal = { samples: null as unknown as Float32Array, sampleRate: TAUX }
  assert.equal(await c.controler(tour(bancal)), bancal)
})

test('⭐ coupe-circuit : après 3 régénérations clonées ratées, voix native directement', async () => {
  const { m, appels } = moteurs([TROUE], [SAIN])
  const journal: string[] = []
  const c = new ControleQualiteVoix({ langue: 'zh', moteurs: m, log: l => journal.push(l) })
  await c.controler(tour(TROUE(), true, 1))   // 2 essais clonés ratés
  await c.controler(tour(TROUE(), true, 2))   // 1 essai cloné raté → coupe-circuit
  const avant = appels.clone.length
  await c.controler(tour(TROUE(), true, 3))   // plus aucun essai cloné
  assert.equal(avant, 3)
  assert.equal(appels.clone.length, 3)
  assert.match(journal.join("\n"), /tour 3 .*voix clonée instable sur cette émission/)
  assert.equal(c.bilan().secours, 3)
})

test('un tour déjà en voix native est régénéré par phrases (morceaux plus courts), sans « secours »', async () => {
  const { m, appels } = moteurs([panne], [SAIN])
  const c = new ControleQualiteVoix({ langue: 'zh', moteurs: m, log: () => {} })
  await c.controler(tour(TROUE(), false))
  assert.equal(appels.clone.length, 0)
  assert.deepEqual(appels.locale, [reglagesEssai(1, 'zh').maxCaracteres])
  assert.equal(c.bilan().regeneres, 1)
})

test('budget : au-delà de maxRegenerations, plus de régénération (la voix de secours reste permise)', async () => {
  const { m, appels } = moteurs([SAIN], [SAIN])
  const c = new ControleQualiteVoix({ langue: 'zh', moteurs: m, log: () => {}, maxRegenerations: 0 })
  await c.controler(tour(TROUE()))
  assert.equal(appels.clone.length, 0)
  assert.equal(appels.locale.length, 1, 'la voix de secours reste permise')
})

test('QUALITE_VOIX=0 (actif: false) : rien n’est contrôlé', async () => {
  const { m } = moteurs([panne], [panne])
  const c = new ControleQualiteVoix({ langue: 'zh', moteurs: m, log: () => {}, actif: false })
  const w = TROUE()
  assert.equal(await c.controler(tour(w)), w)
  assert.equal(c.ligneBilan(), '')
})

test('le bilan de l’émission compte les défauts par type', async () => {
  const { m } = moteurs([SAIN], [SAIN])
  const c = new ControleQualiteVoix({ langue: 'zh', moteurs: m, log: () => {} })
  await c.controler(tour(SAIN(), true, 1))
  await c.controler(tour(TROUE(), true, 2))
  const l = c.ligneBilan()
  assert.match(l, /2 tours · 1 défectueux \(blanc 1, chuchotement 1\) · 1 régénéré/)
})
