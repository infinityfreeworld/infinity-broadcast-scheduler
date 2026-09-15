/**
 * @module InfinityScheduler/Usine/Journal/Tests
 * @description 🎬 Le Journal de FREEWORLD TV fabriqué par l'usine. Le planificateur relit la commande du jour comme
 *   une entrée ÉTRANGÈRE (personnages de la distribution seulement, textes bornés) ; les scripts de la machine louée
 *   savent REPRENDRE après une interruption (machines interruptibles, fondateur, 15/09/2026).
 *
 *   Lancer :  npx tsx --test src/lib/__tests__/usine-journal.test.ts
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'

const J = new URL('../../../usine/journal/', import.meta.url).pathname
const lire = (f: string) => readFileSync(join(J, f), 'utf8')
const EXEMPLE = JSON.parse(lire('exemple-jt.json'))
const DISTRIBUTION: Record<string, any> = JSON.parse(lire('distribution.json'))

/** Les vraies voix et photos ne vivent que sur le hub : des fichiers factices suffisent au planificateur. */
function distributionFactice(): string {
  const d = mkdtempSync(join(tmpdir(), 'jt-distribution-'))
  for (const [cle, p] of Object.entries(DISTRIBUTION)) {
    if (cle.startsWith('_')) continue
    writeFileSync(join(d, p.voix), 'RIFF')
    writeFileSync(join(d, p.image), 'PNG')
  }
  return d
}

function planifier(jt: unknown) {
  const racine = mkdtempSync(join(tmpdir(), 'jt-travail-'))
  const commande = join(racine, 'jt.json')
  writeFileSync(commande, JSON.stringify(jt))
  const r = spawnSync('python3', [join(J, 'planif.py'), commande, join(racine, 'travail')],
    { env: { ...process.env, JT_DISTRIBUTION: distributionFactice() }, encoding: 'utf8' })
  return { r, dossier: join(racine, 'travail') }
}

test('les scripts du hub et de la machine louée sont syntaxiquement valides', () => {
  for (const f of ['planif.py', 'montage.py', 'voix_jt.py', 'images_jt.py', 'lc_lot.py', 'restant.py']) {
    const r = spawnSync('python3', ['-c', 'import ast,sys; ast.parse(open(sys.argv[1]).read())', join(J, f)])
    assert.equal(r.status, 0, `${f} : ${r.stderr}`)
  }
  for (const f of ['travail.sh', 'jt-du-jour.sh', 'purge.sh']) assert.equal(spawnSync('bash', ['-n', join(J, f)]).status, 0, f)
  const n = spawnSync(process.execPath, ['--check', join(J, 'nostr-jt.mjs')], { encoding: 'utf8' })
  assert.equal(n.status, 0, n.stderr)
})

test('⭐ la commande n’est acceptée que SIGNÉE par le générateur ; la clé de l’usine reste sur le hub', () => {
  const n = lire('nostr-jt.mjs')
  assert.match(n, /authors: \[GENERATEUR\]/)
  assert.match(n, /e\.pubkey === GENERATEUR && verifyEvent\(e\)/, 'un relais peut servir n’importe quoi : seule la signature compte')
  assert.match(n, /mode: 0o600/)
  assert.match(lire('../../scripts/veille-diffusion.mjs'), new RegExp(n.match(/const GENERATEUR = '([0-9a-f]{64})'/)![1]),
    'la même clé que celle que surveille la veille du matin')
})

test('⭐ la journée du hub : rien sans commande signée, montage BORNÉ, clé de la forge jamais en argument, pause possible', () => {
  const j = lire('jt-du-jour.sh')
  // Sur le CODE : l'en-tête raconte les étapes dans l'ordre, et l'ordre des commentaires ne prouve rien.
  const code = j.split('\n').filter(l => !/^\s*#/.test(l)).join('\n')
  assert.match(j, /\[ -f "\$ICI\/PAUSE" \]/, 'le fondateur garde la main')
  assert.ok(code.indexOf('nostr-jt.mjs" commande') < code.indexOf('planif.py'), 'rien ne se fabrique sans commande signée')
  assert.match(j, /USINE_INTERRUPTIBLE=1 USINE_REPRISES=/)
  assert.match(j, /-p CPUQuota=200% -p MemoryMax=2G/, 'condition DATASPACE : un vrai cgroup, pas nice seul')
  assert.match(j, /-H @"\$HDR"/, 'la clé de service passe par un fichier 600, jamais par la ligne de commande')
  assert.ok(!/Bearer \$CLE|-H "Authorization/.test(j))
})

test('⭐ un ESSAI ne publie jamais rien : commande posée à la main, résultat gardé sur le hub, étiquette à part', () => {
  const code = lire('jt-du-jour.sh').split('\n').filter(l => !/^\s*#/.test(l)).join('\n')
  const publie = code.indexOf('nostr-jt.mjs" resultat')
  const garde = code.lastIndexOf('if [ "$ESSAI" = 1 ]', publie)
  assert.ok(garde !== -1 && code.slice(garde, publie).includes('else'), 'la publication n’existe que dans la branche « pas un essai »')
  assert.match(code, /USINE_ETIQUETTE="usine-jt\$SUFFIXE-\$DATE"/, 'un essai ne détruit jamais la machine du vrai Journal')
  assert.match(lire('purge.sh'), /\(-essai\)\?\$/, 'les essais sont purgés comme les vrais jours')
})

test('la rétention tient la promesse faite à DATASPACE : travail 2 jours, vidéos de la forge 3 jours', () => {
  const p = lire('purge.sh')
  assert.match(p, /JT_GARDE_JOURS:-1\} days/, 'aujourd’hui et hier')
  assert.match(p, /JT_GARDE_FORGE:-3\}/)
  assert.match(p, /-X DELETE -H @"\$HDR"/)
  assert.match(lire('systemd/freeworld-jt-purge.timer'), /OnCalendar=/, 'un VRAI timer, pas une intention')
})

test('⭐ la commande d’exemple devient un travail d’usine complet', () => {
  const { r, dossier } = planifier(EXEMPLE)
  assert.equal(r.status, 0, r.stderr)
  const plans = JSON.parse(readFileSync(join(dossier, 'entrees/plans.json'), 'utf8'))
  assert.deepEqual(plans.map((p: any) => p.cle),
    ['ouverture', 's01-lancement', 's01-terrain', 's02-lancement', 's02-terrain', 's02-interview', 'fermeture'])
  const itw = plans.find((p: any) => p.cle === 's02-interview')
  assert.deepEqual(itw.voix, ['resultats/voix/s02-question.wav', 'resultats/voix/s02-reponse.wav'],
    'LongCat donne la voix 1 à la moitié GAUCHE : le reporter, puis l’invité à droite')
  assert.equal(itw.audio_type, 'add')
  const images = JSON.parse(readFileSync(join(dossier, 'entrees/images.json'), 'utf8'))
  for (const i of images) assert.match(i.consigne, /there are no human beings anywhere/, `${i.cle} : la règle des humains dans CHAQUE consigne`)
  for (const f of ['travail.sh', 'montage.json', 'entrees/refs/iggy.wav', 'entrees/persos/gaston.png', 'entrees/lc_lot.py']) {
    assert.ok(existsSync(join(dossier, f)), f)
  }
})

test('⭐ une commande étrangère est REFUSÉE : personnage inconnu, rôle usurpé, texte trop long, date piégée', () => {
  const avec = (modif: (jt: any) => void) => { const jt = structuredClone(EXEMPLE); modif(jt); return planifier(jt).r }
  let r = avec(jt => { jt.sujets[0].reporter = 'personne' })
  assert.notEqual(r.status, 0); assert.match(r.stderr, /n'est pas un reporter/)
  r = avec(jt => { jt.sujets[1].interview.invite = 'iggy' })
  assert.notEqual(r.status, 0, 'le présentateur n’est pas un invité de terrain')
  r = avec(jt => { jt.sujets[0].terrain = 'mot '.repeat(120) })
  assert.notEqual(r.status, 0); assert.match(r.stderr, /mots/)
  r = avec(jt => { jt.date = '../../etc' })
  assert.notEqual(r.status, 0)
})

test('⭐ reprise : chaque étape de la machine louée saute ce qui est déjà fait, et n’écrit jamais un fichier tronqué', () => {
  assert.match(lire('voix_jt.py'), /if not os\.path\.exists\(f"resultats\/voix\/\{r\['cle'\]\}\.wav"\)/)
  assert.match(lire('images_jt.py'), /if not os\.path\.exists\(f"resultats\/images\/\{t\['cle'\]\}\.png"\)/)
  const lot = lire('lc_lot.py')
  assert.match(lot, /continue {3}# REPRISE/)
  assert.match(lot, /os\.replace\(partiel \+ "\.mp4"/, 'un plan n’apparaît qu’ENTIÈREMENT écrit')
  assert.match(lire('travail.sh'), /touch "\$RES\/FINI"/)
})

test('⭐ restant.py compte ce qui reste — un plan sans voix n’est pas « à faire »', () => {
  const { dossier } = planifier(EXEMPLE)
  const compte = (q: string) => spawnSync('python3', [join(dossier, 'entrees/restant.py'), q], { cwd: dossier, encoding: 'utf8' }).stdout.trim()
  assert.equal(compte('voix'), '8')
  assert.equal(compte('images'), '3')
  assert.equal(compte('plans'), '0', 'aucune voix encore : aucun plan n’est faisable')
  mkdirSync(join(dossier, 'resultats/voix'), { recursive: true })
  writeFileSync(join(dossier, 'resultats/voix/ouverture.wav'), 'RIFF')
  assert.equal(compte('voix'), '7')
  assert.equal(compte('plans'), '1', 'l’ouverture a sa voix et son image (la photo d’Iggy)')
})

test('le montage suit les pilotes validés : générique du fondateur, avancée vers Iggy, aucune mention à l’écran', () => {
  const m = lire('montage.py')
  assert.match(m, /G_BASCULE, G_NOIR = 15\.0, 16\.4/)
  assert.match(m, /CADRE_B = \(92, 181, 681, 380\)/, 'la caméra finit sur le cadrage exact du plan qui parle')
  assert.match(m, /comment=Images et voix créées avec l’IA/, 'l’IA est signalée dans les métadonnées')
  const code = m.split('\n').filter(l => !/^\s*#/.test(l) && !/^\s*"""|^[A-ZÀ-Ü]/.test(l)).join('\n')
  assert.ok(!/fiction satirique/i.test(code), 'aucune mention à l’écran (fondateur, 15/09)')
  assert.match(m, /manquants\.append/, 'un plan manquant saute : le Journal se monte sans lui')
})
