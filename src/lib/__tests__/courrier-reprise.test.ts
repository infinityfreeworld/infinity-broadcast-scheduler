/**
 * @module InfinityScheduler/Lib/CourrierRepriseTests
 * @description ✉️🔁 Le courrier des auditeurs face à la reprise de nuit (#81) et aux hésitations (#80) :
 *   (a) le son d'un vocal n'est jamais écrit au chantier ; à la reprise il est RECOLLÉ depuis le
 *       courrier relevé de nouveau, ou SAUTÉ avec ses tours liés — jamais silence, jamais Piper ;
 *   (b) le vocal d'un auditeur échappe à l'oreille de contrôle et à la règle « repli = reporter » ;
 *   (c) le rattrapage des hésitations ne touche jamais un message lu, un appel ni un auditeur.
 *
 *   Lancer :  npx tsx --test src/lib/__tests__/courrier-reprise.test.ts
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Chantier } from '../chantier'
import { RepriseEmission } from '../reprise-emission'
import { Oreille, seuilsOreille, type Transcripteur } from '../oreille'
import { rattraperDisfluences, compterDisfluences } from '../disfluences'
import type { DecodedWav } from '../audio'
import {
  plansPourChantier, restaurerCourrier, sortDuTourCourrier, sansSautes, hesitationPermise, permisPourRattrapage,
  estTourAuditeur, type MarquesCourrier,
} from '../courrier/reprise-courrier'

type Plan = { texte: string; voixPiper: string; voixPersonnage: string | null; court: boolean } & MarquesCourrier

const son = (signature: number, n = 24_000): DecodedWav => {
  const s = new Float32Array(n).fill(0.01)
  s[0] = signature
  return { samples: s, sampleRate: 24_000 }
}
const VOCAL = son(0.42)

/** Une émission avec un message lu (tour 1), puis un vocal : annonce (2), vocal, réaction (3). */
function emission(): { turns: Array<{ id: string; hostId: string; hostName: string; text: string }>; plans: Plan[] } {
  const p = (texte: string, extra: Partial<Plan> = {}): Plan => ({ texte, voixPiper: 'fr_FR-siwis', voixPersonnage: 'aurelien', court: false, ...extra })
  const plans: Plan[] = [
    p('Bonsoir et bienvenue.', { boucle: 0 }),
    p('Léa nous écrit : merci pour les jardins.', { boucle: 1, refCourrier: 'ref-texte' }),
    p('On écoute le message de Sam.', { boucle: 2, lieAuVocal: 'ref-vocal' }),
    { texte: '', voixPiper: 'fr_FR-siwis', voixPersonnage: null, court: false, audio: VOCAL, boucle: 2, refCourrier: 'ref-vocal', vocalRef: 'ref-vocal' },
    p('Merci Sam, très juste.', { boucle: 3, lieAuVocal: 'ref-vocal' }),
    p('Bonne nuit.', { boucle: 4 }),
  ]
  const turns = plans.map((pl, k) => ({ id: `t${k}`, hostId: pl.vocalRef ? 'auditeur' : 'aurelien', hostName: pl.vocalRef ? 'Sam' : 'Aurélien', text: pl.texte || 'transcription' }))
  return { turns, plans }
}

// ── (a) Le son du vocal à la reprise ─────────────────────────────────────────────────────────

test('(a) le chantier ne garde JAMAIS le son d’un auditeur, seulement sa référence et ses marques', () => {
  const racine = mkdtempSync(join(tmpdir(), 'courrier-reprise-'))
  try {
    const { turns, plans } = emission()
    const c = new Chantier<typeof turns[number], Plan>('wtf-radio', '2026-10-08', racine)
    c.enregistrerTextes(turns, plansPourChantier(plans))
    const brut = readFileSync(join(c.dossier, 'chantier.json'), 'utf8')
    assert.ok(!brut.includes('"audio"'), 'aucun son dans le JSON du chantier')
    assert.ok(brut.length < 5_000, `chantier compact (${brut.length} o)`)
    const relu = c.textes()!.plans
    assert.equal(relu[3].audio, undefined)
    assert.equal(relu[3].vocalRef, 'ref-vocal')
    assert.equal(relu[3].refCourrier, 'ref-vocal')
    assert.equal(relu[2].lieAuVocal, 'ref-vocal')
    assert.deepEqual(relu.map(p => p.boucle), [0, 1, 2, 2, 3, 4])
    // L'original n'est pas amputé (le premier passage monte toujours le son).
    assert.equal(plans[3].audio, VOCAL)
  } finally { rmSync(racine, { recursive: true, force: true }) }
})

test('(a) à la reprise, le son est RECOLLÉ depuis le courrier relevé de nouveau ; pauses et messages retrouvés', () => {
  const racine = mkdtempSync(join(tmpdir(), 'courrier-reprise-'))
  try {
    const { turns, plans } = emission()
    const c = new Chantier<typeof turns[number], Plan>('wtf-radio', '2026-10-08', racine)
    c.enregistrerTextes(turns, plansPourChantier(plans))
    const reTelecharge = son(0.42)
    const r = restaurerCourrier(c.textes()!.plans, [{ ref: 'autre', wav: son(0.9) }, { ref: 'ref-vocal', wav: reTelecharge }])
    assert.equal(r.sautes.size, 0)
    assert.equal(r.plans[3].audio, reTelecharge)
    assert.ok(r.plans[3].audio!.samples instanceof Float32Array)
    assert.deepEqual(r.indexBoucle, [0, 1, 2, 2, 3, 4])
    assert.deepEqual(r.refsCourrier, ['ref-texte', 'ref-vocal'])
    const sort = sortDuTourCourrier(r.plans[3], 3, r.sautes)
    assert.ok(sort && 'monter' in sort && sort.monter === reTelecharge)
  } finally { rmSync(racine, { recursive: true, force: true }) }
})

test('(a) vocal INTROUVABLE à la reprise : sauté avec son annonce et sa réaction — ni silence, ni Piper, ni « diffusé »', () => {
  const { plans } = emission()
  for (const vocaux of [null, [], [{ ref: 'ref-vocal', wav: { samples: new Float32Array(0), sampleRate: 24_000 } }]]) {
    const r = restaurerCourrier(plansPourChantier(plans), vocaux)
    assert.deepEqual([...r.sautes].sort(), [2, 3, 4])
    assert.deepEqual(r.refsCourrier, ['ref-texte'], 'le vocal perdu reste dans la fenêtre (pas marqué diffusé)')
    for (const k of [2, 3, 4]) assert.deepEqual(sortDuTourCourrier(r.plans[k], k, r.sautes), { sauter: true })
    // Les autres tours suivent le chemin ordinaire.
    for (const k of [0, 1, 5]) assert.equal(sortDuTourCourrier(r.plans[k], k, r.sautes), null)
    assert.deepEqual(sansSautes(r.indexBoucle, r.sautes), [0, 1, 4])
  }
})

test('(a) un vocal sans son n’est JAMAIS rendu au chemin ordinaire (qui ferait du Piper sur un texte vide)', () => {
  assert.deepEqual(sortDuTourCourrier({ vocalRef: 'x' }, 0, new Set()), { sauter: true })
})

// ── (b) Le vocal hors de l'oreille et du report ──────────────────────────────────────────────

test('(b) le vocal se monte TEL QUEL, avant toute reprise, oreille ou contrôle', () => {
  const { plans } = emission()
  const sort = sortDuTourCourrier(plans[3], 3, new Set())
  assert.ok(sort && 'monter' in sort)
  assert.equal(sort.monter, VOCAL, 'le son de l’auditeur, pas une copie retouchée')
  // Un tour d'animateur ou d'auditeur JOUÉ suit le chemin ordinaire (oreille comprise).
  assert.equal(sortDuTourCourrier(plans[1], 1, new Set()), null)
  assert.equal(sortDuTourCourrier({ boucle: 2 }, 4, new Set()), null)
})

test('(b) la reprise ne compte ni n’écoute un vocal, et ne le reporte jamais (même sans voix de personnage)', async () => {
  const racine = mkdtempSync(join(tmpdir(), 'courrier-reprise-'))
  try {
    let ecoutes = 0
    const t: Transcripteur = { transcrire: async () => { ecoutes++; return 'rien à voir' } }
    const { turns, plans } = emission()
    const reprise = new RepriseEmission<typeof turns[number], Plan>({
      chantier: new Chantier('wtf-radio', '2026-10-08', racine), derniereChance: false,
      oreille: new Oreille(t, seuilsOreille({}), () => {}), langue: 'fr',
      moteurs: { clone: async () => son(0.5), locale: async () => son(-0.5) }, log: () => {},
    })
    reprise.enregistrerTextes(turns, plansPourChantier(plans))
    assert.equal(reprise.etat().attendus, 5, 'le vocal n’est pas une voix de personnage attendue')
    const issue = await reprise.apresTour({ i: 3, texte: '', voixPersonnage: plans[3].voixPersonnage, voixLocale: 'fr_FR-siwis', wav: VOCAL, viaClone: false })
    assert.ok(!issue.aReprendre && issue.wav === VOCAL)
    assert.equal(ecoutes, 0, 'l’oreille n’a pas écouté le vocal')
    assert.deepEqual(reprise.manquants(), [])
  } finally { rmSync(racine, { recursive: true, force: true }) }
})

/** Le corps d'une fonction du script, commentaires retirés (une garde ne lit pas ses propres commentaires). */
function sourceSansCommentaires(): string {
  const src = readFileSync(new URL('../../scripts/generate-broadcast.ts', import.meta.url), 'utf8')
  return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"`])\/\/.*$/gm, '$1')
}

test('(b) dans la boucle de synthèse, le vocal sort AVANT la reprise du chantier, le contrôle, l’oreille et le report', () => {
  const s = sourceSansCommentaires()
  const debut = s.indexOf('for (let i = 0; i < plansVoix.length; i++)')
  assert.ok(debut > 0, 'boucle de synthèse trouvée')
  const boucle = s.slice(debut, s.indexOf('verifierManques()', debut))
  const sortie = boucle.indexOf('sortDuTourCourrier(plan, i, sautes)')
  assert.ok(sortie > 0, 'le vocal passe par sortDuTourCourrier')
  assert.match(boucle.slice(sortie, sortie + 400), /if \(sortCourrier\) \{[\s\S]*?continue\s*\}/, 'et quitte le tour (continue)')
  for (const etape of ['reprendreTour(', 'file.prendre(', 'reprise.manque(', 'controleVoix.controler(', 'apresTour(']) {
    const k = boucle.indexOf(etape)
    assert.ok(k > sortie, `${etape} vient APRÈS la sortie du vocal`)
  }
  // Le chantier reçoit les plans SANS son, et la reprise recolle le son.
  assert.match(s, /enregistrerTextes\(turns, plansPourChantier\(plansVoix\)\)/)
  assert.match(s, /restaurerCourrier\(repris\.plans, opts\.courrier\?\.vocaux\)/)
  // Ni synthèse anticipée d'un tour sauté.
  assert.match(s, /!opts\.reprise\?\.dejaFait\(j\) && !sautes\.has\(j\)/)
})

// ── (c) Les hésitations ──────────────────────────────────────────────────────────────────────

test('(c) jamais d’hésitation sur un tour de courrier ou d’appel, même de genre « courant »', () => {
  assert.equal(hesitationPermise('courant', null), true)
  assert.equal(hesitationPermise('courant', { type: 'courrier-reel' }), false)
  assert.equal(hesitationPermise('courant', { type: 'appel-intro' }), false)
  assert.equal(hesitationPermise('courant', { type: 'vocal-reaction' }), false)
  assert.equal(hesitationPermise('courrier', null), false)
  assert.equal(hesitationPermise('ouverture', null), false)
})

test('(c) le rattrapage ne touche ni un auditeur (vocal, appel joué) ni un message lu, et refuse tout permis désaligné', () => {
  assert.equal(estTourAuditeur('auditeur'), true)
  assert.equal(estTourAuditeur('auditeur-joue-0'), true)
  assert.equal(estTourAuditeur('aurelien'), false)
  const turns = [
    { hostId: 'aurelien', text: 'Les jardins partagés poussent dans tous les quartiers de la ville.' },
    { hostId: 'aurelien', text: 'Léa nous écrit : merci pour les jardins partagés de mon quartier.' },
    { hostId: 'auditeur', text: 'Bonjour, je voulais dire merci pour votre émission sur les jardins.' },
    { hostId: 'auditeur-joue-0', text: 'Oui bonjour, moi je cultive des tomates sur mon balcon depuis un an.' },
    { hostId: 'marina', text: 'Et la mairie a promis trois nouveaux terrains pour le printemps prochain.' },
  ]
  // Permis tels que la boucle les pose : le message lu (1) à faux, les auditeurs à faux.
  const permis = [true, false, false, false, true]
  // Même un permis à vrai par erreur sur un auditeur est refusé.
  const tours = permisPourRattrapage(turns, [true, false, true, true, true])
  assert.deepEqual(tours.map(t => t.permis), [true, false, false, false, true])
  const r = rattraperDisfluences(permisPourRattrapage(turns, permis), 'fr', 'test:courrier', 1)
  for (const k of [1, 2, 3]) assert.equal(r.textes[k], turns[k].text, `tour ${k} intact`)
  assert.ok(r.ajouts.every(k => k === 0 || k === 4))
  assert.ok(compterDisfluences(r.textes[0], 'fr') + compterDisfluences(r.textes[4], 'fr') > 0, 'les tours ordinaires, eux, hésitent')
  // Un permis de moins que de tours (un tour d'auditeur oublié) : AUCUNE hésitation plutôt qu'au mauvais tour.
  assert.ok(permisPourRattrapage(turns, permis.slice(1)).every(t => !t.permis))
})

test('(c) le script pose un permis pour CHAQUE tour inséré et passe par la garde du courrier', () => {
  const s = sourceSansCommentaires()
  assert.match(s, /permisHesitation\.push\(hesitationPermise\(genreTour\.type, tourC\)\)/)
  // Vocal et auditeur joué : un permis à faux à côté de leur plan (alignement tours ↔ permis).
  assert.equal((s.match(/vocalRef: v\.ref \}\)\s*permisHesitation\.push\(false\)/g) ?? []).length, 1)
  assert.equal((s.match(/boucle: i \}\)\s*permisHesitation\.push\(false\)/g) ?? []).length, 1)
  assert.match(s, /permisPourRattrapage\(turns, permisHesitation\)/)
  assert.match(s, /tauxHesitations > 0 && !repris/)
})
