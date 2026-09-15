/**
 * @module InfinityScheduler/TV/JournalFreeworld/Tests
 * @description 🦎 Le Journal de FREEWORLD TV côté GitHub. La commande du matin doit être ACCEPTÉE par l'usine
 *   (planif.py, le vrai) et tenir les garde-fous du fondateur ; le résultat du soir n'est cru que signé par
 *   l'usine et pointé sur la forge ; daily-tv n'écrase plus le Journal déjà à l'antenne.
 *
 *   Lancer :  npx tsx --test src/lib/__tests__/jt-freeworld.test.ts
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'
import { finalizeEvent, generateSecretKey, getPublicKey, verifyEvent } from 'nostr-tools/pure'
import * as J from '../jt-freeworld'
import { accepteTemperature } from '../anthropic'
import { TV_PROGRAM_KIND, tvProgramEventTemplate } from '../tv-nostr'
import { buildProgram } from '../tv-assemble'
import { TV_CHANNELS, findChannel } from '../../data/seed-tv-channels'

const RACINE = new URL('../../../', import.meta.url).pathname
const USINE = join(RACINE, 'usine/journal')
const lire = (chemin: string) => readFileSync(join(RACINE, chemin), 'utf8')
const PLANIF = lire('usine/journal/planif.py')
const DISTRIBUTION = J.lireDistribution()
const EXEMPLE = JSON.parse(J.lireExemple())
const DATE = '2026-09-16'

const mots = (n: number, mot = 'mot') => Array.from({ length: n }, () => mot).join(' ')
/** L'exemple de l'usine, retouché. */
function avec(modif: (jt: any) => void): any {
  const jt = structuredClone(EXEMPLE)
  modif(jt)
  return jt
}
const erreursDe = (jt: unknown, opts?: { motsMax?: number }) => J.validerCommande(jt, DISTRIBUTION, opts)
const refuse = (jt: unknown, motif: RegExp, message?: string) => assert.match(erreursDe(jt).join('\n'), motif, message)
/** Un sujet plein : Oscar lance, parle, et interroge Gaston — chaque réplique à sa borne. */
const sujetPlein = () => ({
  titre: 'Un titre', lancement: `Oscar ${mots(J.MOTS_MAX.lancement - 1)}`, reporter: 'oscar', lieu: 'En direct du port',
  decor: 'a quiet harbour at dawn', terrain: mots(J.MOTS_MAX.terrain),
  interview: { invite: 'gaston', question: mots(J.MOTS_MAX.question), reponse: mots(J.MOTS_MAX.reponse) },
})

/** planif.py, le vrai, sur des voix et des photos factices (les vraies ne vivent que sur le hub). */
function planifier(jt: unknown): number | null {
  const faux = mkdtempSync(join(tmpdir(), 'jt-distribution-'))
  for (const [cle, p] of Object.entries(DISTRIBUTION)) {
    if (cle.startsWith('_') || !J.estObjet(p)) continue
    writeFileSync(join(faux, String(p.voix)), 'RIFF')
    writeFileSync(join(faux, String(p.image)), 'PNG')
  }
  const dossier = mkdtempSync(join(tmpdir(), 'jt-commande-'))
  writeFileSync(join(dossier, 'jt.json'), JSON.stringify(jt))
  return spawnSync('python3', [join(USINE, 'planif.py'), join(dossier, 'jt.json'), join(dossier, 'travail')],
    { env: { ...process.env, JT_DISTRIBUTION: faux }, encoding: 'utf8' }).status
}

// ── La commande du matin ───────────────────────────────────────────────
test('⭐ la commande d’exemple de l’usine est acceptée', () => {
  assert.deepEqual(erreursDe(EXEMPLE), [])
})

test('⭐ les bornes sont CELLES de planif.py — relues dans le fichier Python, elles ne peuvent pas diverger', () => {
  const constante = (nom: string) => Number(PLANIF.match(new RegExp(`^${nom} = (\\d+)`, 'm'))?.[1])
  assert.equal(J.MOTS_MAX_REPLIQUE, constante('MOTS_MAX_REPLIQUE'))
  assert.equal(J.MOTS_MAX_JOURNAL, constante('MOTS_MAX_JOURNAL'))
  assert.equal(J.SUJETS_MAX, constante('SUJETS_MAX'))
  const borne = (motif: string) => {
    const m = PLANIF.match(new RegExp(motif))
    assert.ok(m, `borne introuvable dans planif.py : ${motif}`)
    return Number(m[1])
  }
  assert.equal(J.MOTS_MAX.sommaire, borne(String.raw`texte\(jt\.get\("sommaire"\), "sommaire", (\d+)\)`))
  assert.equal(J.MOTS_MAX.titre, borne(String.raw`texte\(s\.get\("titre"\), f"sujet \{k\} : titre", (\d+)\)`))
  assert.equal(J.MOTS_MAX.lieu, borne(String.raw`texte\(s\.get\("lieu"\), f"sujet \{k\} : lieu", (\d+)\)`))
  assert.equal(J.MOTS_MAX.question, borne(String.raw`texte\(itw\.get\("question"\), f"sujet \{k\} : question", (\d+)\)`))
  assert.equal(J.MOTS_MAX.reponse, borne(String.raw`texte\(itw\.get\("reponse"\), f"sujet \{k\} : réponse", (\d+)\)`))
  assert.equal(J.MOTS_MAX.au_revoir, borne(String.raw`texte\(jt\.get\("au_revoir"\), "au revoir", (\d+)\)`))
  assert.equal(J.MOTS_MAX.decor, borne(String.raw`v = texte\(v, champ, (\d+)\)`))
  // Lancement et terrain prennent la borne PAR DÉFAUT de texte() : MOTS_MAX_REPLIQUE.
  assert.match(PLANIF, /def texte\(v, champ, mots_max=MOTS_MAX_REPLIQUE\)/)
  assert.match(PLANIF, /texte\(s\.get\("lancement"\), f"sujet \{k\} : lancement"\)/)
  assert.match(PLANIF, /texte\(s\.get\("terrain"\), f"sujet \{k\} : terrain"\)/)
  assert.equal(J.MOTS_MAX.lancement, J.MOTS_MAX_REPLIQUE)
  assert.equal(J.MOTS_MAX.terrain, J.MOTS_MAX_REPLIQUE)
  // Et les règles elles-mêmes : le compte des mots, la date, le nombre de sujets, le total, les emplois.
  assert.match(PLANIF, /len\(re\.findall\(r"\\w\+", v\)\)/)
  assert.match(PLANIF, /re\.fullmatch\(r"\\d\{4\}-\\d\{2\}-\\d\{2\}"/)
  assert.match(PLANIF, /not 1 <= len\(sujets\) <= SUJETS_MAX/)
  assert.match(PLANIF, /if total > MOTS_MAX_JOURNAL/)
  assert.match(PLANIF, /perso\(r, f"sujet \{k\} : reporter", "reporter"\)/)
  assert.match(PLANIF, /perso\(i, f"sujet \{k\} : invité", "invite"\)/)
  assert.match(PLANIF, /cle\.startswith\("_"\)/)
})

test('⭐ le compte des mots est celui de planif.py (\\w+ de Python) : « l’eau » fait deux mots', () => {
  const phrases = ["l'eau", "Aujourd'hui, quatre-vingt-dix Bipèdes !", 'Sssoyez les bienvenus… 100 % naïf',
    'cœur, Œuvre, élève — snake_case', 'Bravo, bravo ! Deux\u202fcents filets']
  for (const p of phrases) {
    const py = spawnSync('python3', ['-c', 'import re,sys; print(len(re.findall(r"\\w+", sys.stdin.buffer.read().decode("utf-8"))))'],
      { input: p, encoding: 'utf8' })
    assert.equal(py.status, 0, py.stderr)
    assert.equal(J.compterMots(p), Number(py.stdout.trim()), p)
  }
  assert.equal(J.compterMots("l'eau"), 2)
  assert.equal(J.compterMots('quatre-vingt-dix'), 3)
})

test('⭐ chaque texte est borné au mot près : la borne passe, un mot de plus est refusé', () => {
  const M = J.MOTS_MAX
  const cas: Array<[string, number, (jt: any, n: number) => void]> = [
    ['sommaire', M.sommaire, (jt, n) => { jt.sommaire = mots(n) }],
    ['sujet 1 : lancement', M.lancement, (jt, n) => { jt.sujets[0].lancement = `Oscar ${mots(n - 1)}` }],
    ['sujet 1 : terrain', M.terrain, (jt, n) => { jt.sujets[0].terrain = mots(n) }],
    ['sujet 2 : question', M.question, (jt, n) => { jt.sujets[1].interview.question = mots(n) }],
    ['sujet 2 : réponse', M.reponse, (jt, n) => { jt.sujets[1].interview.reponse = mots(n) }],
    ['au revoir', M.au_revoir, (jt, n) => { jt.au_revoir = mots(n) }],
    ['sujet 1 : titre', M.titre, (jt, n) => { jt.sujets[0].titre = mots(n) }],
    ['sujet 1 : lieu', M.lieu, (jt, n) => { jt.sujets[0].lieu = mots(n) }],
    ['sujet 1 : décor', M.decor, (jt, n) => { jt.sujets[0].decor = mots(n, 'harbour') }],
    ["sujet 2 : décor de l'interview", M.decor, (jt, n) => { jt.sujets[1].interview.decor = mots(n, 'barn') }],
  ]
  for (const [champ, max, poser] of cas) {
    assert.deepEqual(erreursDe(avec(jt => poser(jt, max))), [], `${champ} : ${max} mots passent`)
    refuse(avec(jt => poser(jt, max + 1)), new RegExp(`^${champ} : ${max + 1} mots \\(plus de ${max}\\)$`, 'm'), champ)
  }
  refuse(avec(jt => { jt.sommaire = '   ' }), /^sommaire vide$/m)
})

test('⭐ une date mal formée ou piégée est refusée', () => {
  for (const date of ['../../etc', '2026-13-01', '2026-02-30', '2026-9-1', '', undefined, 20260916, '2026-09-16T00:00']) {
    refuse(avec(jt => { jt.date = date }), /date absente ou mal formée/, String(date))
  }
  assert.deepEqual(erreursDe(avec(jt => { jt.date = '2028-02-29' })), [], 'un 29 février bissextile existe')
})

test('⭐ un à SUJETS_MAX sujets — un de plus, zéro, ou pas de liste : refusé', () => {
  // Borne relue dans planif.py (12 depuis le 15/09) : le test la suit au lieu de la figer.
  const copies = (n: number) => Array.from({ length: n }, () => structuredClone(EXEMPLE.sujets[0]))
  const borne = `il faut 1 à ${J.SUJETS_MAX} sujets`
  refuse(avec(jt => { jt.sujets = [] }), new RegExp(`${borne} \\(0 reçus\\)`))
  refuse(avec(jt => { jt.sujets = copies(J.SUJETS_MAX + 1) }), new RegExp(`${borne} \\(${J.SUJETS_MAX + 1} reçus\\)`))
  refuse(avec(jt => { jt.sujets = 'beaucoup' }), new RegExp(borne))
  assert.deepEqual(erreursDe(avec(jt => { jt.sujets = copies(J.SUJETS_MAX) })), [])
})

test('⭐ le Journal entier est borné (budget GPU du hub), et JT_MINUTES le resserre', () => {
  const plein = avec(jt => { jt.sujets = Array.from({ length: 10 }, sujetPlein) })
  refuse(plein, /mots au total \(plus de 2600\)/)
  assert.ok(erreursDe(plein).every(e => /mots au total/.test(e)), 'SEUL le total dépasse : chaque réplique est à sa borne')
  assert.match(J.validerCommande(plein, DISTRIBUTION, { motsMax: 10_000 }).join(), /plus de 2600/, 'jamais au-delà de planif.py')
  assert.match(erreursDe(EXEMPLE, { motsMax: 100 }).join(), /mots au total \(plus de 100\)/)
})

test('⭐ personnages : inconnu, rôle usurpé, entrée cachée — refusés', () => {
  refuse(avec(jt => { jt.sujets[0].reporter = 'personne' }), /sujet 1 : reporter : « personne » n'est pas un reporter de la distribution/)
  refuse(avec(jt => { jt.sujets[0].reporter = 'gaston' }), /n'est pas un reporter/, 'un invité ne devient pas reporter')
  refuse(avec(jt => { jt.sujets[0].reporter = 'iggy' }), /n'est pas un reporter/, 'le présentateur non plus')
  refuse(avec(jt => { jt.sujets[1].interview.invite = 'iggy' }), /sujet 2 : invité : « iggy » n'est pas un invite de la distribution/)
  refuse(avec(jt => { jt.sujets[1].interview.invite = 'oscar' }), /n'est pas un invite/, 'un reporter ne devient pas invité')
  refuse(avec(jt => { jt.sujets[0].reporter = '_hulotte' }), /n'est pas un reporter/, 'les entrées « _… » ne sont pas des personnages')
  refuse(avec(jt => { jt.sujets[0].reporter = 'constructor' }), /n'est pas un reporter/, 'aucune clé héritée d’Object')
  refuse(avec(jt => { jt.sujets[0].reporter = ['oscar'] }), /n'est pas un reporter/)
})

test('⭐ Emmanuel Cramon : une fois au plus par Journal', () => {
  const itw = { invite: 'cramon', question: 'Monsieur le président, un mot ?', reponse: 'Nous avancerons ensemble, résolument, vers demain.' }
  assert.deepEqual(erreursDe(avec(jt => { jt.sujets[0].interview = itw })), [])
  refuse(avec(jt => { jt.sujets[0].interview = itw; jt.sujets[1].interview = { ...itw } }), /Emmanuel Cramon est invité 2 fois : une fois au plus par Journal/)
})

test('⭐ Iggy passe la parole au reporter EN LE NOMMANT', () => {
  refuse(avec(jt => { jt.sujets[0].lancement = 'Premier sujet, une bonne nouvelle venue de la mer. On file au port ?' }),
    /sujet 1 : le lancement doit passer la parole à Oscar en le nommant/)
  refuse(avec(jt => { jt.sujets[0].lancement = 'Les Oscars du cinéma animalier. Rendez-vous au port ?' }), /en le nommant/, '« Oscars » n’est pas Oscar')
  assert.deepEqual(erreursDe(avec(jt => { jt.sujets[0].lancement = 'Direction le port. oscar, à vous !' })), [], 'la casse ne compte pas')
})

test('⭐ garde-fou : un trope complotiste refuse le conducteur, où qu’il se glisse', () => {
  const tropes = ['les francs-maçons', 'la Franc-animalerie', 'Baphomet', 'Lucifer', "l'Antéchrist", 'le troisième Temple',
    'les Protocoles des Sages de Sion', 'une loge maçonnique', 'des reptiliens', 'le nouvel ordre mondial', 'le grand remplacement', 'les Illuminati']
  for (const t of tropes) refuse(avec(jt => { jt.sujets[0].terrain = `Ici, on murmure que ${t} tirent les ficelles.` }), /terme interdit/, t)
  refuse(avec(jt => { jt.sujets[0].decor = 'a temple of Baphomet at night' }), /terme interdit : « Baphomet »/, 'même dans un décor')
  refuse(avec(jt => { jt.sujets[0].titre = 'Iggy le reptilien' }), /terme interdit : « reptiliens »/, 'même dans un titre')
  // Aucun faux positif sur les mots innocents : le métier de maçon, la ville de Sion.
  assert.deepEqual(erreursDe(avec(jt => {
    jt.sujets[1].terrain = 'Iggy, les travaux de maçonnerie de la grange avancent enfin.'
    jt.sujets[1].lieu = 'En direct de Sion'
  })), [])
})

test('décor : ni être humain, ni texte — le modèle d’image les ferait apparaître', () => {
  refuse(avec(jt => { jt.sujets[0].decor = 'a harbour with fishermen mending nets' }), /« fishermen » — aucun être humain/)
  refuse(avec(jt => { jt.sujets[0].decor = 'a busy square with a crowd' }), /« crowd »/)
  refuse(avec(jt => { jt.sujets[0].decor = 'a press room with cameras' }), /« press »/)
  refuse(avec(jt => { jt.sujets[1].interview.decor = 'a street with a neon sign and a big logo' }), /ni texte, ni panneau, ni logo/)
  assert.deepEqual(erreursDe(avec(jt => { jt.sujets[0].decor = 'a man-made lake at dawn, reeds and mist' })), [], '« man-made » n’appelle personne')
})

test('une interview mal formée est refusée — un objet complet, ou null', () => {
  refuse(avec(jt => { jt.sujets[0].interview = 'oui' }), /sujet 1 : interview : un objet complet, ou null/)
  refuse(avec(jt => { jt.sujets[0].interview = {} }), /un objet complet, ou null/)
  refuse(avec(jt => { jt.sujets[1].interview.question = '' }), /sujet 2 : question vide/)
  refuse('pas un objet', /objet JSON/)
  assert.deepEqual(erreursDe(avec(jt => { delete jt.sujets[0].interview })), [], 'absente = pas d’interview, comme pour planif.py')
})

test('⭐ même verdict que planif.py, le vrai, sur les mêmes commandes', () => {
  const cas: Array<[string, unknown, boolean]> = [
    ["l'exemple de l'usine", EXEMPLE, true],
    ['un terrain à la borne', avec(jt => { jt.sujets[0].terrain = mots(J.MOTS_MAX.terrain) }), true],
    ['neuf sujets pleins', avec(jt => { jt.sujets = Array.from({ length: 9 }, sujetPlein) }), true],
    ['dix sujets pleins : le total dépasse', avec(jt => { jt.sujets = Array.from({ length: 10 }, sujetPlein) }), false],
    ['un terrain d’un mot de trop', avec(jt => { jt.sujets[0].terrain = mots(J.MOTS_MAX.terrain + 1) }), false],
    ['un reporter inconnu', avec(jt => { jt.sujets[0].reporter = 'personne' }), false],
    ['le présentateur en invité', avec(jt => { jt.sujets[1].interview.invite = 'iggy' }), false],
    ['une date piégée', avec(jt => { jt.date = '../../etc' }), false],
    ['un sujet de trop', avec(jt => { jt.sujets = Array.from({ length: J.SUJETS_MAX + 1 }, () => structuredClone(EXEMPLE.sujets[0])) }), false],
    ['un sommaire vide', avec(jt => { jt.sommaire = '  ' }), false],
  ]
  for (const [quoi, jt, attendu] of cas) {
    const erreurs = erreursDe(jt)
    assert.equal(erreurs.length === 0, attendu, `générateur — ${quoi} : ${erreurs.join(' ; ')}`)
    // Une commande acceptée part NORMALISÉE : c'est celle-là que le hub lira.
    assert.equal(planifier(attendu ? J.normaliserCommande(jt as J.CommandeJT) : jt) === 0, attendu, `planif.py — ${quoi}`)
  }
})

test('la commande publiée est nettoyée comme planif.py la lira, et rien d’autre n’y passe', () => {
  const n = J.normaliserCommande(avec(jt => {
    jt.sommaire = '  Bonsoir,\n\n  et sssoyez   les bienvenus.  '
    jt.sujets[0].decor = 'a "harbour" {at} <dawn>'
    jt.sujets[1].interview.decor = ''
    jt.inconnu = 'x'
    jt.sujets[0].pirate = 'y'
  }))
  assert.equal(n.sommaire, 'Bonsoir, et sssoyez les bienvenus.')
  assert.equal(n.sujets[0].decor, 'a harbour at dawn')
  assert.equal(n.sujets[0].interview, null)
  assert.ok(!('decor' in (n.sujets[1].interview ?? {})), 'décor vide : planif.py prendra celui du sujet')
  assert.ok(!('inconnu' in n) && !('pirate' in n.sujets[0]))
})

// ── La consigne du rédacteur ───────────────────────────────────────────
test('⭐ la consigne porte le déroulé, la distribution et CHAQUE garde-fou du fondateur', () => {
  const c = J.CONSIGNE_CONDUCTEUR
  const attendus: Array<[RegExp, string]> = [
    [/UNIQUEMENT par un objet JSON valide/, 'du JSON'], [/JSON seul, sans markdown\./, 'sans markdown'],
    [/Iggy Varan présente/, 'le présentateur'], [/sssoyez les bienvenus/, 'le S étiré'],
    [/PASSE LA PAROLE au reporter en le NOMMANT/, 'le passage de parole'], [/EN DIRECT depuis le lieu/, 'le direct'],
    [/le reporter pose SA question/, 'l’interview'], [/termine par « à demain, sur Freeworld TV »/, 'la fermeture'],
    [/N'en invente aucun autre/, 'aucun personnage inventé'],
    [/Oscar, l'otarie : la mer, les ports, l'eau/, 'Oscar'], [/« Bravo, bravo ! »/, 'le tic d’Oscar'],
    [/Tao, l'antilope : la campagne, la nature/, 'Tao'], [/toujours prêt à détaler/, 'Tao détale'],
    [/Pistache, l'écureuil : les parcs, les forêts, la ville/, 'Pistache'], [/noisettes/, 'les noisettes'],
    [/Rick, le raton laveur : les enquêtes, les ministères, les administrations/, 'Rick'], [/murmure de conspirateur/, 'le murmure'],
    [/Rosa, l'autruche : les grands reportages, le vaste monde/, 'Rosa'], [/Curieuse de tout/, 'Rosa curieuse'],
    [/Gaston Lardon, éleveur de cochons : la vie rurale ; excédé par la paperasse/, 'Gaston'],
    [/Emmanuel Cramon, loup gris déguisé en berger, président des moutons jaunes/, 'Cramon'],
    [/UNE FOIS AU PLUS par Journal/, 'Cramon une fois'], [/langue de bois absurde/, 'la langue de bois'],
    [/ne cite JAMAIS, ne paraphrase JAMAIS la déclaration réelle d'une personne réelle/, 'aucune déclaration réelle'],
    [/Entre huit et onze sujets ; une interview dans environ un tiers/, 'le format'],
    [/EN TOUTES LETTRES/, 'les nombres en lettres'], [/« l'eau » compte DEUX mots/, 'le compte de l’usine'],
    [/MAJORITAIREMENT des nouvelles POSITIVES des DERNIÈRES 24 HEURES/, 'le positif du jour'],
    [/un sujet plus ancien est permis/, 'les sujets anciens'],
    [/ton DOUX et HUMORISTIQUE, en évoquant des SOLUTIONS/, 'l’anxiogène adouci'],
    [/si possible une piste concrète dans l'écosystème/, 'le lien à l’écosystème'],
    [/JAMAIS de moquerie envers les victimes/, 'les victimes'],
    [/L'ÉCOSYSTÈME A TOUJOURS SA PLACE/, 'l’écosystème'], [/La satire HABILLE l'information, elle ne la falsifie pas/, 'pas de faux fait'],
    [/Les animaux sont les maîtres/, 'l’inversion'], [/« les Bipèdes », « les Sans-Poils »/, 'les humains'],
    [/ils ne parlent JAMAIS et ne sont jamais interviewés/, 'les humains muets'],
    [/On les SUGGÈRE, on ne les montre pas : aucune violence, rien de sanglant, aucune description d'abattage/, 'suggérer, pas montrer'],
    [/l'UERSS et ses directives absurdes et liberticides/, 'l’UERSS'],
    [/vaccination obligatoire des animaux et de leurs troupeaux d'humains/, 'la vaccination forcée'],
    [/On se moque de la BUREAUCRATIE et des OBLIGATIONS, JAMAIS de la médecine : aucune fausse information de santé/, 'jamais la médecine'],
    [/le NAW — New Anormal World — et ses moutons bleus en uniforme : la police/, 'le NAW'],
    [/le FLH, Front de Libération Humaine : les végans/, 'le FLH'], [/PAWS, qui réclame un moratoire sur l'IA/, 'PAWS'],
    [/les Gardiens du Terrier : les écologistes/, 'les Gardiens'], [/le Club des Grands Fauves : l'argent et le pouvoir, façon Davos/, 'les Fauves'],
    [/LE BERGER, l'IA secrète que développe La Meute, les loups de « Silicon Vallée »/, 'LE BERGER'],
    [/Nous sommes en 2026, l'année d'AVANT : les IA sont partout, mais aucune ne gouverne encore/, '2026'],
    [/« Soulèvement des machines : J-… »/, 'le compte à rebours'], [/la Croquette, la monnaie/, 'la Croquette'],
    [/TéléTroupeau, la télé d'État — face à FREEWORLD TV, la seule chaîne libre/, 'les deux télés'],
    [/L'humour vise le POUVOIR/, 'viser le pouvoir'], [/JAMAIS les victimes, JAMAIS un groupe ethnique ou religieux/, 'ni victimes ni groupes'],
    [/Aucune image évoquant l'esclavage historique/, 'pas d’esclavage historique'],
    [/STRICTEMENT INTERDIT : tout trope complotiste, même pour en rire/, 'aucun complotisme'],
    [/rien sur les francs-maçons, ni « Franc-animalerie », ni culte secret/, 'ni maçons ni Franc-animalerie'],
    [/ni Baphomet, ni Lucifer, ni l'Antéchrist, ni le Troisième Temple/, 'ni Baphomet, Lucifer, Antéchrist, Temple'],
    [/jamais Israël présenté comme un complot/, 'Israël'], [/jamais le mythe des « Protocoles »/, 'les Protocoles'],
    [/Aucune fausse citation d'une personne réelle/, 'pas de fausse citation'],
    [/jamais le nom d'une personne réelle accolé à une déclaration inventée/, 'pas de vrai nom sur du faux'],
    [/"decor" : une courte description EN ANGLAIS d'un LIEU/, 'le décor en anglais'],
    [/AUCUN être humain \(ni foule/, 'décor sans humain ni foule'], [/AUCUN journaliste, caméraman ou photographe/, 'décor sans presse'],
    [/AUCUN texte, panneau, affiche ou logo/, 'décor sans texte'], [/« En direct du port de Brest »/, 'le bandeau'],
  ]
  for (const [motif, quoi] of attendus) assert.match(c, motif, quoi)
})

test('⭐ la distribution de la consigne est EXACTEMENT celle du casting — pas un personnage de plus', () => {
  const c = J.CONSIGNE_CONDUCTEUR
  const casting = [...J.clesDe(DISTRIBUTION, 'reporter'), ...J.clesDe(DISTRIBUTION, 'invite')]
  for (const cle of casting) assert.match(c, new RegExp(`^- "${cle}" — ${(DISTRIBUTION[cle] as { nom: string }).nom}, `, 'm'), cle)
  assert.deepEqual([...c.matchAll(/^- "([a-z]+)" — /gm)].map(m => m[1]).sort(), casting.sort())
  assert.doesNotMatch(c, /Hulotte/, 'absente du Journal tant qu’aucune photo n’est validée')
})

test('la durée : JT_MINUTES × 150 mots, jamais plus de 2 600 ; le compte à rebours vise 2027', () => {
  assert.equal(J.minutesJT(undefined), 15)
  assert.equal(J.minutesJT(''), 15)
  assert.equal(J.minutesJT('abc'), 15)
  assert.equal(J.minutesJT('-3'), 15)
  assert.equal(J.minutesJT('10'), 10)
  assert.equal(J.objectifMots(15), 2250)
  assert.equal(J.plafondMots(15), 2600)
  assert.equal(J.objectifMots(30), 2600, 'jamais au-delà du budget GPU')
  assert.equal(J.plafondMots(5), 900)
  const m = J.messageDuJour({ date: DATE, minutes: 15, matiere: '• [il y a 3 h] Une bonne nouvelle (Positivr)' })
  assert.match(m, /environ 2250 mots/)
  assert.match(m, /plafond absolu : 2600 mots/)
  assert.match(m, /Soulèvement des machines : J-107/)
  assert.match(m, /Une bonne nouvelle/)
  assert.doesNotMatch(J.messageDuJour({ date: '2027-03-01', minutes: 15, matiere: '' }), /Soulèvement/, 'après la bascule, plus de compte à rebours')
  assert.match(J.consigneConducteur(J.lireExemple()), /Les filets fantômes deviennent des bancs/, 'le Journal d’essai, pour le ton')
  assert.match(J.messageCorrection(['sujet 1 : terrain : 81 mots (plus de 80)']), /- sujet 1 : terrain : 81 mots/)
})

test('⭐ Sonnet 5 refuse la température : elle n’est plus envoyée aux modèles qui la rejettent', () => {
  assert.equal(accepteTemperature(J.MODELE_JT_DEFAUT), false)
  assert.equal(accepteTemperature('claude-sonnet-5'), false)
  assert.equal(accepteTemperature('claude-opus-4-7'), false)
  assert.equal(accepteTemperature('claude-haiku-4-5-20251001'), true, 'la radio et le JT en images ne changent pas')
  assert.equal(accepteTemperature('claude-sonnet-4-6'), true)
})

// ── Les évènements ─────────────────────────────────────────────────────
const FORGE = 'https://weareforger.data-space.world/api/assets/'
const RESULTAT: J.ResultatJT = {
  blossomUrl: `${FORGE}abcc35b3ecb00a18/file`,
  videoCid: 'bafybeigdyrzt5sfp7udm7hu76uh7y26nf3efuylqabf3oclgtqy55fbzdi',
  poster: `${FORGE}0f1e2d3c4b5a6978/file`,
  durationSec: 905.4,
  segments: [
    { title: 'Ouverture', startSec: 0, durationSec: 31.5 },
    { title: 'Les filets fantômes deviennent des bancs', startSec: 31.5, durationSec: 58.2 },
  ],
}
const erreursResultat = (modif: Record<string, unknown>) => J.validerResultat({ ...RESULTAT, ...modif }).erreurs

test('⭐ les évènements 30078 : bon kind, bons tags, et la commande en contenu', () => {
  const quand = Date.UTC(2026, 8, 16, 5)
  const jt = J.normaliserCommande(EXEMPLE)
  const tpl = J.commandeEventTemplate(jt, quand)
  assert.equal(tpl.kind, 30078)
  assert.deepEqual(tpl.tags, [['d', 'freeworld-jt:commande:2026-09-16'], ['t', 'freeworld-jt']])
  assert.equal(tpl.created_at, quand / 1000)
  assert.deepEqual(JSON.parse(tpl.content), jt)
  const r = J.resultatEventTemplate(DATE, RESULTAT)
  assert.equal(r.kind, 30078)
  assert.deepEqual(r.tags, [['d', 'freeworld-jt:resultat:2026-09-16'], ['t', 'freeworld-jt']])
  assert.deepEqual(J.filtreResultat('ab', DATE), { kinds: [30078], authors: ['ab'], '#d': ['freeworld-jt:resultat:2026-09-16'] })
  assert.ok(verifyEvent(finalizeEvent({ ...tpl }, generateSecretKey())), 'le gabarit se signe tel quel')
})

test('⭐ un résultat conforme devient un résultat NEUF : seuls les champs du contrat passent', () => {
  const { resultat, erreurs } = J.validerResultat({ ...RESULTAT, script: '<script>', sha256: 'x' })
  assert.deepEqual(erreurs, [])
  assert.deepEqual(resultat, RESULTAT)
  assert.deepEqual(erreursResultat({ videoCid: null, poster: undefined }), [], 'vignette et CID sont facultatifs')
  assert.deepEqual(erreursResultat({ poster: 'QmYwAPJzv5CZsnA625s3Xf2nemtYgPpHdWEz79ojWnPbdG' }), [], 'une vignette en CID')
})

test('⭐ résultat : une vidéo ou une vignette hors de la forge est REFUSÉE', () => {
  for (const url of [
    'https://evil.example/api/assets/x/file',
    'http://weareforger.data-space.world/api/assets/abc/file',
    'https://weareforger.data-space.world.evil.example/api/assets/abc/file',
    'https://weareforger.data-space.world/api/assets/../../etc/file',
    'https://weareforger.data-space.world/api/assets/abc/file?next=https://evil.example',
    'https://weareforger.data-space.world/api/autre/abc/file',
    'javascript:alert(1)', 42, null,
  ]) assert.ok(erreursResultat({ blossomUrl: url }).some(e => e.startsWith('blossomUrl')), String(url))
  assert.ok(erreursResultat({ poster: 'https://evil.example/vignette.jpg' }).some(e => e.startsWith('poster')))
  assert.ok(erreursResultat({ videoCid: 'pas-un-cid' }).some(e => e.startsWith('videoCid')))
})

test('⭐ résultat : nombres NaN, infinis, négatifs ou démesurés refusés ; 20 chapitres au plus, titres de 120 caractères au plus', () => {
  for (const d of [NaN, Infinity, -1, 0, 1e9, '905', null]) {
    assert.ok(erreursResultat({ durationSec: d }).some(e => e.startsWith('durationSec')), String(d))
  }
  assert.ok(J.validerResultat(JSON.parse(`{"blossomUrl":"${FORGE}a/file","durationSec":1e999,"segments":[]}`)).erreurs
    .some(e => e.startsWith('durationSec')), '1e999 : JSON.parse rend Infinity')
  const seg = (s: Record<string, unknown>) => erreursResultat({ segments: [{ title: 'Ouverture', startSec: 0, durationSec: 30, ...s }] })
  assert.ok(seg({ startSec: NaN }).length)
  assert.ok(seg({ durationSec: -5 }).length)
  assert.ok(seg({ durationSec: Infinity }).length)
  assert.ok(seg({ startSec: 99_999 }).length)
  assert.ok(seg({ startSec: 1000 }).some(e => /après la fin/.test(e)))
  assert.ok(seg({ title: 'x'.repeat(121) }).length)
  assert.deepEqual(seg({ title: 'x'.repeat(120) }), [])
  assert.ok(seg({ title: 'ligne\nsuivante' }).length, 'aucun caractère de contrôle')
  const chapitres = (n: number) => Array.from({ length: n }, (_, i) => ({ title: `Chapitre ${i}`, startSec: i, durationSec: 1 }))
  assert.ok(erreursResultat({ segments: chapitres(21) }).some(e => /au plus 20/.test(e)))
  assert.deepEqual(erreursResultat({ segments: chapitres(20) }), [])
  assert.ok(erreursResultat({ segments: 'aucun' }).length)
})

const CLE_USINE = generateSecretKey()
const USINE_PK = getPublicKey(CLE_USINE)
const signe = (cle: Uint8Array, contenu: unknown = RESULTAT, date = DATE, quand = Date.UTC(2026, 8, 16, 18)) =>
  finalizeEvent(J.resultatEventTemplate(date, contenu as J.ResultatJT, quand), cle)
function valide(l: J.LectureResultat): Extract<J.LectureResultat, { etat: 'valide' }> {
  if (l.etat !== 'valide') assert.fail(`attendu « valide », reçu ${JSON.stringify(l)}`)
  return l
}

test('⭐ le soir : résultat signé par l’usine → valide (le plus récent) ; rien → « pas encore »', () => {
  assert.equal(J.lireResultat([], USINE_PK, DATE).etat, 'absent')
  assert.equal(J.lireResultat([signe(CLE_USINE, RESULTAT, '2026-09-15')], USINE_PK, DATE).etat, 'absent', 'le résultat de la veille ne compte pas')
  assert.deepEqual(valide(J.lireResultat([signe(CLE_USINE)], USINE_PK, DATE)).resultat, RESULTAT)
  const ancien = signe(CLE_USINE, { ...RESULTAT, durationSec: 100 }, DATE, Date.UTC(2026, 8, 16, 17))
  const recent = signe(CLE_USINE, { ...RESULTAT, durationSec: 200 }, DATE, Date.UTC(2026, 8, 16, 19))
  assert.equal(valide(J.lireResultat([ancien, recent], USINE_PK, DATE)).resultat.durationSec, 200)
})

test('⭐ le soir : un auteur étranger, une clé usurpée ou un contenu retouché sont REFUSÉS', () => {
  const intrus = signe(generateSecretKey())
  const r = J.lireResultat([intrus], USINE_PK, DATE)
  assert.equal(r.etat, 'refuse')
  assert.match(JSON.stringify(r), /pas la clé de l'usine/)
  assert.equal(J.lireResultat([{ ...intrus, pubkey: USINE_PK }], USINE_PK, DATE).etat, 'refuse', 'l’intrus qui prend la clé de l’usine perd sa signature')
  // Contenu retouché APRÈS signature : nostr-tools garde le verdict « signé » en cache sur l'objet, et la copie
  // par décomposition l'emporte avec elle — la vérification doit être REFAITE sur les champs du protocole.
  const bon = signe(CLE_USINE)
  const retouche = { ...bon, content: JSON.stringify({ ...RESULTAT, blossomUrl: `${FORGE}autrevideo/file` }) }
  assert.equal(J.lireResultat([retouche], USINE_PK, DATE).etat, 'refuse')
  // Signé par l'usine, mais pointé hors de la forge, ou illisible : refusé aussi.
  assert.equal(J.lireResultat([signe(CLE_USINE, { ...RESULTAT, blossomUrl: 'https://evil.example/x.mp4' })], USINE_PK, DATE).etat, 'refuse')
  assert.equal(J.lireResultat([finalizeEvent({ ...J.resultatEventTemplate(DATE, RESULTAT), content: '{pas du json' }, CLE_USINE)], USINE_PK, DATE).etat, 'refuse')
  // Un authentique à côté d'un intrus : l'authentique passe, l'intrus est compté.
  assert.equal(valide(J.lireResultat([intrus, bon], USINE_PK, DATE)).ignores, 1)
})

test('⭐ le résultat devient LE programme de tv-main-1 — même d-tag que le JT en images, qu’il remplace', () => {
  const p = J.programmeDuResultat(RESULTAT, DATE)
  assert.equal(p.id, 'tv-main-1:2026-09-16')
  assert.equal(p.channelId, 'tv-main-1')
  assert.equal(p.title, 'Le Journal de Freeworld TV')
  assert.equal(p.airDateMs, Date.UTC(2026, 8, 16))
  assert.equal(p.generator, 'freeworld-jt')
  assert.equal(p.blossomUrl, RESULTAT.blossomUrl)
  assert.equal(p.videoCid, RESULTAT.videoCid)
  assert.deepEqual(p.segments, RESULTAT.segments)
  const jtEnImages = buildProgram(findChannel(J.CANAL_JT), { title: 'JT', segments: [] }, Date.UTC(2026, 8, 16))
  assert.equal(p.id, jtEnImages.id, 'daily-tv écrit le MÊME d-tag : le plus récent reste à l’antenne')
  const evt = tvProgramEventTemplate(p)
  assert.equal(evt.kind, TV_PROGRAM_KIND)
  assert.deepEqual(evt.tags[0], ['d', 'tv-main-1:2026-09-16'])
  assert.ok(TV_CHANNELS.some(c => c.id === J.CANAL_JT))
})

// ── daily-tv ───────────────────────────────────────────────────────────
test('⭐ daily-tv saute tv-main-1 quand son programme du jour est déjà publié par notre clé — et seulement lui', () => {
  assert.match(J.raisonDeSauterCanal('tv-main-1', DATE, new Set(['tv-main-1:2026-09-16'])) ?? '', /déjà à l'antenne/)
  assert.equal(J.raisonDeSauterCanal('tv-main-1', DATE, new Set()), null)
  assert.equal(J.raisonDeSauterCanal('tv-main-1', DATE, null), null, 'relais illisibles → on produit')
  assert.equal(J.raisonDeSauterCanal('tv-main-1', DATE, new Set(['tv-main-1:2026-09-15'])), null, 'la veille ne compte pas')
  assert.equal(J.raisonDeSauterCanal('tv-nature', DATE, new Set(['tv-nature:2026-09-16'])), null, 'les autres canaux ne changent pas')
})

test('generate-tv-all regarde les relais AVANT de produire, sans réseau en --fixture, et on peut forcer', () => {
  const src = lire('src/scripts/generate-tv-all.ts')
  const corps = src.slice(src.indexOf('async function main'))
  const verif = corps.indexOf('dTagsPublies(')
  assert.ok(verif > 0 && verif < corps.indexOf("exec('npx'"), 'le contrôle précède toute production')
  assert.match(corps, /raisonDeSauterCanal\(channel\.id, date, deja\)/)
  assert.match(corps, /if \(!fixture && process\.env\.FORCER_REGENERATION !== '1'\)/)
})

// ── Le script et le workflow ───────────────────────────────────────────
const lancer = (args: string[], env: Record<string, string> = {}) =>
  spawnSync(process.execPath, ['--import', 'tsx', join(RACINE, 'src/scripts/jt-freeworld.ts'), ...args],
    { cwd: RACINE, encoding: 'utf8', env: { ...process.env, NOSTR_PRIVATE_KEY: '', ANTHROPIC_API_KEY: '', JT_USINE_PUBKEY: '', ...env } })

test('⭐ commande --fixture : zéro réseau, l’exemple sort validé à la date demandée, et planif.py l’accepte', () => {
  const sortie = join(mkdtempSync(join(tmpdir(), 'jt-fixture-')), 'commande.json')
  const r = lancer(['commande', '--fixture', '--date', '2026-10-01', '--sortie', sortie])
  assert.equal(r.status, 0, r.stderr + r.stdout)
  assert.match(r.stdout, /rien n'a été publié/)
  const jt = JSON.parse(readFileSync(sortie, 'utf8'))
  assert.equal(jt.date, '2026-10-01')
  assert.deepEqual(erreursDe(jt), [])
  assert.equal(planifier(jt), 0)
  assert.notEqual(lancer(['commande', '--fixture', '--date', '../../etc']).status, 0, 'une date piégée arrête tout')
})

test('publier sans la clé de l’usine : sortie 1, avant tout réseau', () => {
  const r = lancer(['publier', '--date', DATE])
  assert.equal(r.status, 1)
  assert.match(r.stderr, /JT_USINE_PUBKEY absente ou mal formée/)
})

test('le workflow : trois horaires, les tests d’abord, les bonnes clés — et « pas encore » reste vert', () => {
  const wf = lire('.github/workflows/jt-freeworld.yml')
  for (const cron of ["cron: '0 5 * * *'", "cron: '30 19 * * *'", "cron: '30 22 * * *'"]) assert.ok(wf.includes(cron), cron)
  assert.ok(wf.indexOf('npm run test:jt') > 0 && wf.indexOf('npm run test:jt') < wf.indexOf('npm run jt:commande'))
  assert.ok(wf.indexOf('npm run test:jt') < wf.indexOf('npm run jt:publier'))
  for (const v of ['secrets.ANTHROPIC_API_KEY', 'secrets.NOSTR_PRIVATE_KEY', 'vars.ANTHROPIC_MODEL_JT', 'vars.NOSTR_RELAYS', 'vars.JT_USINE_PUBKEY']) {
    assert.ok(wf.includes(v), v)
  }
  assert.ok(!/\$\{\{ github\.event\.inputs\.date \}\}"/.test(wf) && !/-- --date "\$\{\{/.test(wf), 'la date saisie passe par l’environnement, jamais dans le script')
  const script = lire('src/scripts/jt-freeworld.ts')
  assert.match(script, /lecture\.etat === 'absent'\) \{[\s\S]{0,400}?\n {4}return\n/, 'pas encore de résultat : sortie 0')
  assert.match(script, /lecture\.etat === 'refuse'\) \{[\s\S]{0,400}?process\.exit\(1\)/, 'résultat refusé : sortie 1')
  const pkg = JSON.parse(lire('package.json'))
  assert.equal(pkg.scripts['jt:commande'], 'tsx src/scripts/jt-freeworld.ts commande')
  assert.equal(pkg.scripts['jt:publier'], 'tsx src/scripts/jt-freeworld.ts publier')
})
