/**
 * @module InfinityScheduler/Lib/LiensAction/Tests
 * @description 🔗 Les liens d'action de l'écran des liens (décision du Bâtisseur, 07/10/2026) : une LISTE
 *   FERMÉE, copiée de l'application, montrée seulement quand l'émission cite la campagne, et JAMAIS dans
 *   ce que le modèle lit (donc jamais prononcée).
 *
 *   Lancer :  npx tsx --test src/lib/__tests__/liens-action.test.ts
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { LIENS_ACTION, EXTRAIT_MIN, lienSur, lienAutorise, liensActionCites } from '../liens-action'
import { antenneAbondance, campagneVersActualite, ligneEditorialeAbondance, projetEnDetail, projetVersActualite, type ProjetAbondance } from '../sujets-abondance'
import { actualitesStationManifestactions, ligneEditorialeManifestactions, sujetEnUneLigne, sujetVersActualite, type SujetCarte } from '../sujets-carte'
import { CAMPAGNES_ABONDANCE } from '../../data/campagnes-abondance'
import { formatNewsForPrompt } from '../news'

/** La liste fermée attendue — 6 des 7 demandées (la cagnotte pour Infinity n'a pas d'adresse externe). */
const ATTENDUS: Readonly<Record<string, string>> = {
  'aaron-korrigan-oak':    'https://www.papayoux.com/fr/cagnotte/f-aaron-of-korrigan-oak',
  'axiom-team':            'https://axiom-team.fr/collectes',
  'emancipactions':        'https://emancipactions.fr/billet-virtuel/',
  'desobeissance-fertile': 'https://www.helloasso.com/associations/desobeissance-fertile/formulaires/1',
  'pompiers-odp':          'https://don.odp-pompiers.fr/odp-2024',
  'enfants-phare':         'https://lesenfantsphare.fr/le-pharandol/boutique/',
}

test('⭐ liste FERMÉE : exactement ces liens, chacun rattaché à une campagne connue', () => {
  assert.deepEqual(
    Object.fromEntries(LIENS_ACTION.map(l => [l.campagne, l.url])),
    ATTENDUS,
  )
  assert.equal(LIENS_ACTION.length, Object.keys(ATTENDUS).length)
  for (const l of LIENS_ACTION) {
    assert.ok(CAMPAGNES_ABONDANCE.some(c => c.id === l.campagne), l.campagne)
    assert.equal(lienSur(l.url), l.url, `${l.campagne} : adresse déjà propre`)
    assert.ok(lienAutorise(l.url), l.campagne)
  }
  // Emancipactions et les Enfants-Phare : la BOUTIQUE (consigne du Bâtisseur).
  assert.equal(LIENS_ACTION.find(l => l.campagne === 'emancipactions')!.nature, 'boutique')
  assert.equal(LIENS_ACTION.find(l => l.campagne === 'enfants-phare')!.nature, 'boutique')
})

test('⭐ hors liste : refusé — même une vraie cagnotte, même un site de la même campagne', () => {
  for (const u of [
    'https://www.helloasso.com/associations/autre-chose/formulaires/1',
    'https://www.leetchi.com/fr/c/une-cagnotte-quelconque',
    'https://desobeissancefertile.com/',                    // site, pas le lien retenu
    'https://emancipactions.fr/',                           // site, pas la boutique
    'https://www.helloasso.com/associations/les-enfants-phare/formulaires/1',  // don, pas la boutique
    'https://infinity-freeworld.com/e/naddr1qqqq',         // pas de fiche Infinity pour l'instant
  ]) assert.equal(lienAutorise(u), false, u)
})

test('⭐ adresse sûre : http(s) seulement, sans identifiant ni IP ; utm_* retirés', () => {
  assert.equal(lienSur('javascript:alert(1)'), null)
  assert.equal(lienSur('ftp://axiom-team.fr/collectes'), null)
  assert.equal(lienSur('data:text/html,coucou'), null)
  assert.equal(lienSur('https://moi:secret@axiom-team.fr/collectes'), null)
  assert.equal(lienSur('https://jean@axiom-team.fr/collectes'), null)
  assert.equal(lienSur('https://192.168.1.10/cagnotte'), null)
  assert.equal(lienSur('http://[::1]/cagnotte'), null)
  assert.equal(lienSur('https://localhost/cagnotte'), null)
  assert.equal(
    lienSur('https://axiom-team.fr/collectes?utm_source=radio&utm_medium=ecran&x=1#haut'),
    'https://axiom-team.fr/collectes?x=1',
  )
  // Une adresse de la liste, pistée : reconnue une fois nettoyée.
  assert.ok(lienAutorise('https://axiom-team.fr/collectes?utm_campaign=radio'))
  assert.equal(lienAutorise('https://moi:mdp@axiom-team.fr/collectes'), false)
})

test('⭐ montré seulement si l’émission CITE la campagne ; extrait = nom tel que dit', () => {
  assert.deepEqual(liensActionCites(['On parle du climat aujourd’hui.', 'Et de la monnaie libre.']), [])
  const l = liensActionCites([
    'Bonjour à tous.',
    "Pensez à Axiom Team, qui finance les développeurs de la monnaie libre.",
    'Et la Désobéissance Fertile continue de semer.',
    'Encore Axiom-Team !',
  ])
  assert.deepEqual(l.map(x => x.link), [ATTENDUS['axiom-team'], ATTENDUS['desobeissance-fertile']])
  assert.equal(l[0].title, 'Axiom Team')
  assert.equal(l[1].title, 'Désobéissance Fertile')
  for (const x of l) assert.ok(x.title.length >= EXTRAIT_MIN)
  // « émancipation » n'est pas « Émancip'Actions » ; « Manifestactions » non plus.
  assert.deepEqual(liensActionCites(["L'émancipation par les Manifestactions."]), [])
  assert.deepEqual(liensActionCites(["Le festival Émancip'Actions en replay."]).map(x => x.link), [ATTENDUS.emancipactions])
  assert.deepEqual(liensActionCites(['Le Pharandol des Enfants-Phare.']).map(x => x.link), [ATTENDUS['enfants-phare']])
})

test('⭐ « les pompiers » : un sujet d’actualité ailleurs ≠ la campagne — sauf campagne du jour', () => {
  const r = ['Les pompiers ont maîtrisé l’incendie cette nuit.']
  assert.deepEqual(liensActionCites(r), [])
  assert.deepEqual(liensActionCites(r, { campagneDuJour: 'axiom-team' }), [])
  const l = liensActionCites(r, { campagneDuJour: 'pompiers-odp' })
  assert.deepEqual(l.map(x => x.link), [ATTENDUS['pompiers-odp']])
  assert.equal(l[0].title, 'Les pompiers')
  // Cité par son nom propre : partout.
  assert.equal(liensActionCites(["L'Œuvre des Pupilles des Sapeurs-Pompiers aide les familles."]).length, 1)
  // « Oak » : Korrigan Oak / F'Aaron, ou « Oak Camping Car ».
  assert.equal(liensActionCites(["La cagnotte de F'Aaron of Korrigan Oak."])[0].link, ATTENDUS['aaron-korrigan-oak'])
  assert.equal(liensActionCites(['Le Oak Camping-Car de Nina.'])[0].link, ATTENDUS['aaron-korrigan-oak'])
  assert.deepEqual(liensActionCites(['Un chêne, an oak tree.']), [])
})

// ── Jamais prononcés : rien de tout cela dans ce que lit le modèle ────────────────────────────

const URLS = /https?:\/\/|www\.|\bnaddr1|papayoux|axiom-team\.fr|emancipactions\.fr|helloasso|odp-pompiers|lesenfantsphare|infinity-freeworld\.com\/e\//i

const projet: ProjetAbondance = {
  cle: `31200:${'a'.repeat(64)}:p1`, auteur: 'a'.repeat(64), eventId: 'e'.repeat(64), titre: 'Four solaire partagé',
  description: "Un four solaire pour le quartier, construit ensemble et prêté à qui veut cuisiner.", lieu: 'à Lyon',
  themes: ['alimentation et eau'], besoins: ['du financement'], porteur: 'Les Voisins', objectif: '500 euros', finance: false,
  publieLe: 1, apparuLe: 2,
}
const sujet: SujetCarte = {
  famille: 'manifestaction', cle: `30500:${'b'.repeat(64)}:m1`, auteur: 'b'.repeat(64), eventId: 'f'.repeat(64),
  titre: 'Nettoyage de la berge', lieu: 'à Brest', quand: 'à partir du 12 octobre', quoi: 'On ramasse les déchets le long du fleuve.',
  rejoindre: "s'inscrire sur sa fiche, onglet Manifestactions d'Infinity", publieLe: 1,
}

test('⭐ JAMAIS dans le texte destiné au modèle : aucune adresse, pour aucune campagne de la liste', () => {
  const textes: string[] = []
  for (const l of LIENS_ACTION) {
    const c = CAMPAGNES_ABONDANCE.find(x => x.id === l.campagne)!
    const a = antenneAbondance([projet], 0, '2026-10-07', [c])
    assert.equal(a.campagne?.id, l.campagne)
    textes.push(formatNewsForPrompt(a.actualites), a.ligneEditoriale, JSON.stringify(campagneVersActualite(c)))
    for (const n of a.actualites) assert.equal(n.link, undefined, `${l.campagne} : aucune actualité du prompt ne porte de lien`)
  }
  textes.push(
    projetEnDetail(projet), JSON.stringify(projetVersActualite(projet, true)), ligneEditorialeAbondance([projet], true, null),
    sujetEnUneLigne(sujet), JSON.stringify(sujetVersActualite(sujet)), formatNewsForPrompt(actualitesStationManifestactions([sujet], '2026-10-07')),
    ligneEditorialeManifestactions(true),
  )
  for (const t of textes) assert.doesNotMatch(t, URLS, t.slice(0, 120))
})

test('⭐ branchement : les liens d’action entrent dans le fil APRÈS la dernière réplique écrite', () => {
  const src = readFileSync(fileURLToPath(new URL('../../scripts/generate-broadcast.ts', import.meta.url)), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
  const boucle = src.indexOf('for (let i = 0; i < numTurns; i++)')
  const finBoucle = src.indexOf("if (turns.length === 0) throw new Error('Aucun tour généré')")
  const ajout = src.indexOf('news.push(...liensAction)')
  const prompts = [...src.matchAll(/formatNewsForPrompt\(news\)/g)].map(m => m.index!)
  assert.ok(boucle > 0 && finBoucle > boucle && ajout > finBoucle, 'ajout après la boucle d’écriture')
  assert.ok(prompts.length > 0 && prompts.every(i => i > boucle && i < finBoucle), 'le prompt est construit DANS la boucle')
  assert.equal(src.split('liensActionCites(').length - 1, 1, 'un seul appel')
})

test('⭐ les adresses sont celles de l’application (origin/main), pour la bonne campagne', (t) => {
  const depot = process.env.INFINITY_DEPOT ?? fileURLToPath(new URL('../../../../infinity/', import.meta.url))
  if (!existsSync(depot)) { t.skip('dépôt infinity absent — provenance NON vérifiée'); return }
  let src: string
  try {
    src = execFileSync('git', ['-C', depot, 'show', 'origin/main:src/modules/abondance/campagnes-soutien.ts'], { encoding: 'utf8' })
  } catch { t.skip('origin/main illisible — provenance NON vérifiée'); return }
  for (const l of LIENS_ACTION) {
    const debut = src.indexOf(`id: '${l.campagne}'`)
    assert.ok(debut > 0, l.campagne)
    const fin = src.indexOf('\n  },', debut)
    const bloc = src.slice(debut, fin)
    assert.ok(bloc.includes(`${l.nature}: '${l.url}'`), `${l.campagne} : ${l.nature} = ${l.url}`)
  }
})
