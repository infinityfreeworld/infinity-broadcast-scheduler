/**
 * @module InfinityScheduler/Lib/RepriseEmissionTests
 * @description 🔁 Le chantier et la reprise tour par tour : ce qui est réussi est GARDÉ, ce qui
 *   manque est REPORTÉ (jamais dit en Piper tant qu'une reprise est possible), et une reprise ne
 *   redemande QUE les tours manquants. Disque temporaire, moteurs et oreille simulés.
 *
 *   Lancer :  npx tsx --test src/lib/__tests__/reprise-emission.test.ts
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync, writeFileSync, existsSync, utimesSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Chantier, purgerChantiers, nomChantier } from '../chantier'
import { RepriseEmission, type MoteursReprise } from '../reprise-emission'
import { Oreille, seuilsOreille, type Transcripteur } from '../oreille'
import { ArretVolontaire, CODE_A_REPRENDRE, CODE_VEILLE_GARDEE } from '../regle-publication'
import { deciderOuArreter } from '../reprise-branchement'
import type { DecodedWav } from '../audio'

type Plan = { texte: string; voixPiper: string; voixPersonnage: string | null; court: boolean }
const TEXTE = 'Ce soir on parle des jardins partagés qui poussent partout dans les quartiers populaires.'
const PLANS: Plan[] = [
  { texte: TEXTE, voixPiper: 'fr_FR-siwis', voixPersonnage: 'aurelien', court: false },
  { texte: TEXTE, voixPiper: 'fr_FR-siwis', voixPersonnage: 'marina', court: false },
  { texte: TEXTE, voixPiper: 'fr_FR-siwis', voixPersonnage: null, court: false },
]
const TURNS = PLANS.map((p, i) => ({ id: `t${i}`, text: p.texte }))

/** Un WAV reconnaissable par sa première valeur (« signature »). */
const wav = (signature: number): DecodedWav => {
  const s = new Float32Array(2400).fill(0)
  s[0] = signature
  return { samples: s, sampleRate: 24_000 }
}
const sig = (w: DecodedWav) => Math.round(w.samples[0] * 100) / 100

function banc() {
  const racine = mkdtempSync(join(tmpdir(), 'chantier-test-'))
  const appels = { clone: 0, locale: 0 }
  const moteurs: MoteursReprise = {
    clone: async () => { appels.clone++; return wav(0.5) },
    locale: async () => { appels.locale++; return wav(-0.5) },
  }
  return { racine, appels, moteurs, fin: () => rmSync(racine, { recursive: true, force: true }) }
}

const oreilleQuiEntend = (entendu: string | ((n: number) => string)) => {
  let n = 0
  const t: Transcripteur = { transcrire: async () => (typeof entendu === 'string' ? entendu : entendu(n++)) }
  return new Oreille(t, seuilsOreille({}), () => {})
}

// ── Le chantier ──────────────────────────────────────────────────────────────────────────

test('le chantier garde les textes et les tours, et les rend tels quels', () => {
  const b = banc()
  try {
    const c = new Chantier<typeof TURNS[number], Plan>('wtf-radio', '2026-10-08', b.racine)
    assert.equal(c.textes(), null)
    c.enregistrerTextes(TURNS, PLANS)
    assert.deepEqual(c.textes(), { turns: TURNS, plans: PLANS })
    assert.equal(c.aLeTour(1), false)
    c.enregistrerTour(1, wav(0.25))
    assert.equal(c.aLeTour(1), true)
    assert.equal(sig(c.lireTour(1)!), 0.25)
    assert.deepEqual(c.toursGardes(), [1])
    // Une autre date est un autre chantier.
    assert.equal(new Chantier('wtf-radio', '2026-10-09', b.racine).textes(), null)
    c.supprimer()
    assert.equal(c.textes(), null)
  } finally { b.fin() }
})

test('un tour illisible est EFFACÉ (il sera refait, au lieu d’être « déjà fait » à jamais)', () => {
  const b = banc()
  try {
    const c = new Chantier('wtf-radio', '2026-10-08', b.racine)
    mkdirSync(c.dossier, { recursive: true })
    writeFileSync(join(c.dossier, 'tour-01.wav'), 'pas un wav')
    assert.equal(c.aLeTour(0), true)
    assert.equal(c.lireTour(0), null)
    assert.equal(c.aLeTour(0), false)
  } finally { b.fin() }
})

test('le nom d’un chantier ne sort jamais de son dossier', () => {
  for (const nom of [nomChantier('../../etc', '2026-10-08'), nomChantier('../x/y', 'd')]) {
    assert.ok(!nom.includes('/') && !nom.includes('..'), nom)
  }
  assert.equal(nomChantier('wtf-radio', '2026-10-08'), 'wtf-radio-2026-10-08')
})

test('la purge efface les chantiers de plus de 3 jours, garde les récents', () => {
  const b = banc()
  try {
    const vieux = join(b.racine, 'vieux'); mkdirSync(vieux)
    const jeune = join(b.racine, 'jeune'); mkdirSync(jeune)
    const il_y_a_4j = (Date.now() - 4 * 86_400_000) / 1000
    utimesSync(vieux, il_y_a_4j, il_y_a_4j)
    assert.deepEqual(purgerChantiers(b.racine), ['vieux'])
    assert.equal(existsSync(jeune), true)
    assert.deepEqual(purgerChantiers(join(b.racine, 'absent')), [])
  } finally { b.fin() }
})

// ── La reprise ───────────────────────────────────────────────────────────────────────────

test('⭐ passage reportable : un tour qui a PERDU sa voix est noté manquant (pas de Piper), l’émission est REPORTÉE', async () => {
  const b = banc()
  try {
    const chantier = new Chantier<typeof TURNS[number], Plan>('wtf-radio', '2026-10-08', b.racine)
    const r = new RepriseEmission({ chantier, derniereChance: false, oreille: null, langue: 'fr', moteurs: b.moteurs, log: () => {} })
    r.enregistrerTextes(TURNS, PLANS)
    assert.equal(r.reporterLesManques(), true)
    // Tour 1 : voix obtenue → gardé. Tour 2 : perdue (repli) → à reprendre. Tour 3 : Piper voulu.
    assert.deepEqual(await r.apresTour({ i: 0, texte: TEXTE, voixPersonnage: 'aurelien', voixLocale: 'fr_FR-siwis', wav: wav(0.5), viaClone: true }), { wav: wav(0.5) })
    assert.deepEqual(await r.apresTour({ i: 1, texte: TEXTE, voixPersonnage: 'marina', voixLocale: 'fr_FR-siwis', wav: wav(-0.5), viaClone: false }), { aReprendre: true })
    await r.apresTour({ i: 2, texte: TEXTE, voixPersonnage: null, voixLocale: 'fr_FR-siwis', wav: wav(-0.5), viaClone: false })
    assert.deepEqual(r.manquants(), [1])
    assert.deepEqual(chantier.toursGardes(), [0])
    assert.throws(() => r.verifierManques(), (e: unknown) => e instanceof ArretVolontaire && e.code === CODE_A_REPRENDRE && /REPORTÉE/.test(e.message))
    assert.deepEqual(r.etat(), { attendus: 2, repli: 1, incompris: 0, derniereChance: false })
  } finally { b.fin() }
})

test('⭐ à la reprise : le texte revient, les tours gardés sont repris, SEULS les manquants repartent', async () => {
  const b = banc()
  try {
    const c1 = new Chantier<typeof TURNS[number], Plan>('wtf-radio', '2026-10-08', b.racine)
    const p1 = new RepriseEmission({ chantier: c1, derniereChance: false, oreille: null, langue: 'fr', moteurs: b.moteurs, log: () => {} })
    p1.enregistrerTextes(TURNS, PLANS)
    await p1.apresTour({ i: 0, texte: TEXTE, voixPersonnage: 'aurelien', voixLocale: 'x', wav: wav(0.25), viaClone: true })

    // Passage 2, nouveau processus : nouveau chantier sur le même disque.
    const c2 = new Chantier<typeof TURNS[number], Plan>('wtf-radio', '2026-10-08', b.racine)
    const p2 = new RepriseEmission({ chantier: c2, derniereChance: false, oreille: null, langue: 'fr', moteurs: b.moteurs, log: () => {} })
    assert.deepEqual(p2.textesRepris(), { turns: TURNS, plans: PLANS })
    assert.equal(p2.dejaFait(0), true, 'le tour 1 ne repart pas chez data-space')
    assert.equal(p2.dejaFait(1), false, 'le tour 2 repart')
    const repris = p2.reprendreTour(0)!
    assert.equal(sig(repris), 0.25)
    assert.deepEqual(await p2.apresTour({ i: 0, texte: TEXTE, voixPersonnage: 'aurelien', voixLocale: 'x', wav: repris, viaClone: true }), { wav: repris })
    await p2.apresTour({ i: 1, texte: TEXTE, voixPersonnage: 'marina', voixLocale: 'x', wav: wav(0.75), viaClone: true })
    await p2.apresTour({ i: 2, texte: TEXTE, voixPersonnage: null, voixLocale: 'x', wav: wav(-0.5), viaClone: false })
    p2.verifierManques()   // ne lève plus
    assert.deepEqual(p2.etat(), { attendus: 2, repli: 0, incompris: 0, derniereChance: false })
    assert.match(p2.ligneBilan(), /1 clonée\(s\) neuve\(s\), 1 reprise\(s\) du chantier/)
    p2.clore()
    assert.equal(c2.textes(), null, 'le chantier disparaît à la publication')
  } finally { b.fin() }
})

test('⭐ dernière chance : le repli Piper reprend son rôle (rien n’est reporté), et il est COMPTÉ', async () => {
  const b = banc()
  try {
    const chantier = new Chantier<typeof TURNS[number], Plan>('wtf-radio', '2026-10-08', b.racine)
    const r = new RepriseEmission({ chantier, derniereChance: true, oreille: null, langue: 'fr', moteurs: b.moteurs, log: () => {} })
    r.enregistrerTextes(TURNS, PLANS)
    assert.equal(r.reporterLesManques(), false)
    const issue = await r.apresTour({ i: 1, texte: TEXTE, voixPersonnage: 'marina', voixLocale: 'x', wav: wav(-0.5), viaClone: false })
    assert.deepEqual(issue, { wav: wav(-0.5) })
    r.verifierManques()
    assert.deepEqual(r.etat(), { attendus: 2, repli: 1, incompris: 0, derniereChance: true })
  } finally { b.fin() }
})

test('une répétition (sans chantier) ne reporte jamais', () => {
  const b = banc()
  try {
    const r = new RepriseEmission({ chantier: null, derniereChance: false, oreille: null, langue: 'fr', moteurs: b.moteurs, log: () => {} })
    assert.equal(r.reporterLesManques(), false)
  } finally { b.fin() }
})

test('⭐ l’oreille refuse un tour incompréhensible : régénéré tout de suite, GARDÉ s’il est enfin compris', async () => {
  const b = banc()
  try {
    const chantier = new Chantier<typeof TURNS[number], Plan>('wtf-radio', '2026-10-08', b.racine)
    // 1re écoute : bouillie ; 2e (après régénération) : compris.
    const oreille = oreilleQuiEntend(n => (n === 0 ? 'blabla gna gna' : TEXTE))
    const r = new RepriseEmission({ chantier, derniereChance: false, oreille, langue: 'fr', moteurs: b.moteurs, log: () => {} })
    r.enregistrerTextes(TURNS, PLANS)
    const issue = await r.apresTour({ i: 0, texte: TEXTE, voixPersonnage: 'aurelien', voixLocale: 'x', wav: wav(0.25), viaClone: true })
    assert.equal(b.appels.clone, 1)
    assert.equal(issue.aReprendre, undefined)
    assert.equal(sig((issue as { wav: DecodedWav }).wav), 0.5, 'c’est la régénération qui part, pas la bouillie')
    assert.equal(sig(chantier.lireTour(0)!), 0.5)
    assert.match(r.ligneBilan(), /2 écoute\(s\), 1 tour\(s\) refait\(s\)/)
  } finally { b.fin() }
})

test('⭐ toujours incompréhensible : reporté s’il reste du temps, dit en voix locale à la dernière chance', async () => {
  const b = banc()
  try {
    const chantier = new Chantier<typeof TURNS[number], Plan>('wtf-radio', '2026-10-08', b.racine)
    const r1 = new RepriseEmission({ chantier, derniereChance: false, oreille: oreilleQuiEntend('Tonight we talk about gardens'), langue: 'fr', moteurs: b.moteurs, log: () => {} })
    r1.enregistrerTextes(TURNS, PLANS)
    assert.deepEqual(await r1.apresTour({ i: 0, texte: TEXTE, voixPersonnage: 'aurelien', voixLocale: 'x', wav: wav(0.25), viaClone: true }), { aReprendre: true })
    assert.equal(chantier.aLeTour(0), false, 'un tour incompréhensible n’est jamais gardé')

    const r2 = new RepriseEmission({ chantier, derniereChance: true, oreille: oreilleQuiEntend('Tonight we talk about gardens'), langue: 'fr', moteurs: b.moteurs, log: () => {} })
    r2.enregistrerTextes(TURNS, PLANS)
    const issue = await r2.apresTour({ i: 0, texte: TEXTE, voixPersonnage: 'aurelien', voixLocale: 'x', wav: wav(0.25), viaClone: true })
    assert.equal(sig((issue as { wav: DecodedWav }).wav), -0.5, 'voix locale intelligible')
    assert.equal(r2.etat().repli, 1)
  } finally { b.fin() }
})

test('sans oreille (Whisper absent), un tour cloné est gardé sans jugement', async () => {
  const b = banc()
  try {
    const chantier = new Chantier<typeof TURNS[number], Plan>('wtf-radio', '2026-10-08', b.racine)
    const oreille = new Oreille({ indisponible: 'whisper-cli introuvable' }, seuilsOreille({}), () => {})
    const r = new RepriseEmission({ chantier, derniereChance: false, oreille, langue: 'fr', moteurs: b.moteurs, log: () => {} })
    r.enregistrerTextes(TURNS, PLANS)
    await r.apresTour({ i: 0, texte: TEXTE, voixPersonnage: 'aurelien', voixLocale: 'x', wav: wav(0.25), viaClone: true })
    assert.equal(chantier.aLeTour(0), true)
    assert.match(r.ligneBilan(), /oreille INDISPONIBLE \(whisper-cli introuvable\)/)
  } finally { b.fin() }
})

// ── La décision branchée (veille consultée seulement quand elle compte) ─────────────────────

test('⭐ fin de fenêtre en repli, veille à l’antenne : NON publiée (code 76), chantier effacé', async () => {
  const b = banc()
  try {
    const chantier = new Chantier<typeof TURNS[number], Plan>('wtf-radio', '2026-10-08', b.racine)
    const r = new RepriseEmission({ chantier, derniereChance: true, oreille: null, langue: 'fr', moteurs: b.moteurs, log: () => {} })
    r.enregistrerTextes(TURNS, PLANS)
    await r.apresTour({ i: 1, texte: TEXTE, voixPersonnage: 'marina', voixLocale: 'x', wav: wav(-0.5), viaClone: false })
    let demandees: string[] = []
    await assert.rejects(
      deciderOuArreter(r as never, async d => { demandees = d; return true }, '2026-10-08'),
      (e: unknown) => e instanceof ArretVolontaire && e.code === CODE_VEILLE_GARDEE,
    )
    assert.deepEqual(demandees, ['2026-10-07', '2026-10-06'])
    assert.equal(chantier.textes(), null)
  } finally { b.fin() }
})

test('toutes les voix là : publiée, sans même consulter les relais', async () => {
  const b = banc()
  try {
    const r = new RepriseEmission({ chantier: null, derniereChance: true, oreille: null, langue: 'fr', moteurs: b.moteurs, log: () => {} })
    r.enregistrerTextes(TURNS, PLANS)
    await r.apresTour({ i: 0, texte: TEXTE, voixPersonnage: 'aurelien', voixLocale: 'x', wav: wav(0.5), viaClone: true })
    let consulte = false
    const d = await deciderOuArreter(r as never, async () => { consulte = true; return true }, '2026-10-08')
    assert.equal(d.action, 'publier')
    assert.equal(consulte, false)
  } finally { b.fin() }
})
