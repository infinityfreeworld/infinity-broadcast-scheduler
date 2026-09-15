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
import { chmodSync, copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
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
    if (p.image_ouverture) writeFileSync(join(d, p.image_ouverture), 'PNG')
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
  for (const f of ['planif.py', 'montage.py', 'voix_jt.py', 'voix_simulee.py', 'nettoyage.py', 'images_jt.py', 'lc_lot.py', 'restant.py']) {
    const r = spawnSync('python3', ['-c', 'import ast,sys; ast.parse(open(sys.argv[1]).read())', join(J, f)])
    assert.equal(r.status, 0, `${f} : ${r.stderr}`)
  }
  for (const f of ['travail.sh', 'animer.sh', 'jt-du-jour.sh', 'purge.sh']) assert.equal(spawnSync('bash', ['-n', join(J, f)]).status, 0, f)
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

test('⭐ le budget d’une machine compte la BANDE PASSANTE et des heures au dixième (1er essai réel du 15/09)', () => {
  const j = lire('jt-du-jour.sh')
  assert.match(j, /heures = max\(1\.0, round\(/, 'au dixième d’heure : arrondi à l’heure, un petit essai sortait de son budget')
  assert.match(j, /machine = round\(heures \* 1\.8 \+ 1\.0, 1\)/, 'jusqu’à 1,8 $/h, + bande passante et disque')
  assert.ok(!/\$\(\( *HEURES/.test(j), 'des heures décimales : jamais d’arithmétique entière bash dessus')
  assert.ok(!/base_model_int8/.test(lire('travail.sh').split('\n').filter(l => !/^\s*#/.test(l)).join('\n')), 'aucun Go inutile téléchargé')
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
  // 1er essai réel (15/09) : « TV news interview » avait fait dessiner un faux bandeau en lettres illisibles, sur deux photos collées.
  for (const i of images) assert.match(i.consigne, /Absolutely no text anywhere/, `${i.cle} : aucun texte`)
  for (const i of images) assert.ok(!/TV news/i.test(i.consigne), `${i.cle} : « TV news » appelle des bandeaux`)
  assert.match(images.find((i: any) => i.cle === 's02-interview').consigne, /ONE single continuous photograph \(not a split screen/)
  const verif = lire('images_jt.py')
  for (const regle of ['"humain"', '"texte"', '"decoupe"', '"interdit"']) assert.ok(verif.includes(regle), `contrôle ${regle} par Qwen2.5-VL`)
  assert.match(lire('jt-du-jour.sh'), /for k in \("humain", "texte", "decoupe", "interdit"\)/, 'chaque faute d’image alerte')
  for (const f of ['travail.sh', 'montage.json', 'entrees/refs/iggy.wav', 'entrees/persos/gaston.png', 'entrees/lc_lot.py', 'entrees/animer.sh']) {
    assert.ok(existsSync(join(dossier, f)), f)
  }
})

test('⭐ ouverture plus large, angles variés, interview TIRÉE du terrain, plans de coupe dans le cadre du fondateur (15/09)', () => {
  const avecCoupe = structuredClone(EXEMPLE)
  avecCoupe.sujets[1].coupe = 'a farmyard seen from above, humans in beige overalls in straw pens, a pig supervisor with a clipboard'
  const { r, dossier } = planifier(avecCoupe)
  assert.equal(r.status, 0, r.stderr)
  const plans = JSON.parse(readFileSync(join(dossier, 'entrees/plans.json'), 'utf8'))
  assert.equal(plans[0].image, 'entrees/persos/iggy-ouverture.png', 'Iggy cadré plus large : la caméra finit son avancée pendant qu’il parle')
  assert.ok(existsSync(join(dossier, 'entrees/persos/iggy-ouverture.png')))
  assert.ok(existsSync(join(dossier, 'entrees/nettoyage.py')), 'le nettoyage des voix part avec le travail')
  const images = JSON.parse(readFileSync(join(dossier, 'entrees/images.json'), 'utf8'))
  assert.deepEqual(images.map((i: any) => i.cle), ['s01-terrain', 's02-terrain', 's02-coupe', 's02-interview'],
    'le terrain d’abord : la coupe et l’interview en sont tirées')
  assert.equal(images.find((i: any) => i.cle === 's02-interview').sources[0], 'resultats/images/s02-terrain.png')
  const cp = images.find((i: any) => i.cle === 's02-coupe')
  assert.equal(cp.sorte, 'coupe')
  assert.match(cp.consigne, /never chained, never hurt, never naked, no children/)
  assert.notEqual(images[0].consigne.split(':')[0], images[1].consigne.split(':')[0], 'deux sujets, deux angles de caméra')
  assert.equal(JSON.parse(readFileSync(join(dossier, 'montage.json'), 'utf8')).deroule[2].coupe, 's02-coupe')
  for (const hors of ['children playing', 'humans in chains', 'a slave auction', 'blood on the floor']) {
    const jt = structuredClone(EXEMPLE); jt.sujets[0].coupe = `a quiet harbour, ${hors}`
    assert.notEqual(planifier(jt).r.status, 0, `« ${hors} » : hors du cadre fixé par le fondateur`)
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
  // Fondateur, 15/09 : « des mots et paroles coupés » → un mot de travers par tranche de dix, et la FIN de chaque phrase entendue.
  assert.match(lire('voix_jt.py'), /permis = max\(1, n \/\/ 10\) \/ max\(1, n\)/)
  assert.match(lire('voix_jt.py'), /attendus\[-1\] in entendu\[-4:\]/)
  // … et un sigle ou un nom de Freeworld écrit « à la Whisper » (NAW → Nao) n'est pas un mot perdu (2e essai réel, 15/09).
  assert.match(lire('voix_jt.py'), /def souples\(texte\)/)
  assert.match(lire('voix_jt.py'), /"fins_avalees": fins, "douteux": douteux/)
  // 2e essai réel (15/09) : un sommaire de plus de 30 s réécouté d'un bloc a fait planter Whisper — et les 26 voix avec.
  const vj = lire('voix_jt.py')
  assert.doesNotMatch(vj, /ecouter\(ligne/, 'plus de réécoute de la réplique entière')
  assert.match(vj, /return_timestamps=len\(son\) > 28 \* tts\.sr/)
  assert.match(vj, /except Exception as e:\n\s+ratees\.append\(r\["cle"\]\)/, 'une réplique qui plante ne fait sauter que son plan')
  // … et voix_simulee.py le rejoue hors GPU (Chatterbox, Whisper et torch simulés) là où il y a numpy — sur le hub.
  if (spawnSync('python3', ['-c', 'import numpy']).status === 0) {
    const sim = spawnSync('python3', [join(J, 'voix_simulee.py'), J], { encoding: 'utf8' })
    assert.equal(sim.status, 0, sim.stdout + sim.stderr)
  }
  assert.match(lire('images_jt.py'), /if not os\.path\.exists\(f"resultats\/images\/\{t\['cle'\]\}\.png"\)/)
  const lot = lire('lc_lot.py')
  assert.match(lot, /continue {3}# REPRISE/)
  assert.match(lot, /os\.replace\(partiel \+ "\.mp4"/, 'un plan n’apparaît qu’ENTIÈREMENT écrit')
  assert.match(lire('travail.sh'), /touch "\$RES\/FINI"/)
})

test('⭐ plusieurs cartes : des lots d’égale durée de voix, et animer.sh lance UN lc_lot.py PAR CARTE (hors GPU)', () => {
  const S = mkdtempSync(join(tmpdir(), 'jt-animer-'))
  for (const d of ['entrees', 'resultats/voix', 'resultats/images', 'resultats/clips', 'LongCat-Video', 'bin']) mkdirSync(join(S, d), { recursive: true })
  // Un .wav flottant (comme ceux de torchaudio : le module wave ne les lit pas), à 100 Hz pour rester petit.
  const wav = (s: number) => {
    const n = Math.round(s * 100) * 4, b = Buffer.alloc(44 + n)
    b.write('RIFF', 0); b.writeUInt32LE(36 + n, 4); b.write('WAVE', 8); b.write('fmt ', 12); b.writeUInt32LE(16, 16)
    b.writeUInt16LE(3, 20); b.writeUInt16LE(1, 22); b.writeUInt32LE(100, 24); b.writeUInt32LE(400, 28); b.writeUInt16LE(4, 32)
    b.writeUInt16LE(32, 34); b.write('data', 36); b.writeUInt32LE(n, 40)
    return b
  }
  const durees: Record<string, number> = { a: 30, b: 12, c: 11, d: 10, e: 8, z: 5 }
  const plans = Object.keys(durees).map(cle => ({ cle, image: `resultats/images/${cle}.png`, voix: [`resultats/voix/${cle}.wav`] }))
  plans.push({ cle: 'x', image: 'resultats/images/x.png', voix: ['resultats/voix/x-absente.wav'] })   // voix ratée : impossible
  for (const [cle, s] of Object.entries(durees)) { writeFileSync(join(S, `resultats/voix/${cle}.wav`), wav(s)); writeFileSync(join(S, `resultats/images/${cle}.png`), 'PNG') }
  writeFileSync(join(S, 'resultats/images/x.png'), 'PNG')
  writeFileSync(join(S, 'resultats/clips/z.mp4'), '')   // déjà rendu par une machine précédente
  writeFileSync(join(S, 'entrees/plans.json'), JSON.stringify(plans))
  copyFileSync(join(J, 'restant.py'), join(S, 'restant.py'))
  assert.equal(spawnSync('python3', ['restant.py', 'lots', '2'], { cwd: S, encoding: 'utf8' }).stdout.trim(), '2')
  const lot = (k: number) => JSON.parse(readFileSync(join(S, `entrees/lots/lot-${k}.json`), 'utf8')).map((p: { cle: string }) => p.cle)
  const somme = (k: number) => lot(k).reduce((t: number, c: string) => t + durees[c], 0)
  assert.deepEqual([...lot(0), ...lot(1)].sort(), ['a', 'b', 'c', 'd', 'e'], 'chaque plan à faire dans UN lot ; ni le rendu, ni l’impossible')
  assert.ok(Math.abs(somme(0) - somme(1)) <= 12, `lots équilibrés : ${somme(0)} s et ${somme(1)} s`)
  assert.equal(spawnSync('python3', ['restant.py', 'lots', '8'], { cwd: S, encoding: 'utf8' }).stdout.trim(), '5', 'jamais plus de lots que de plans')
  // Deux cartes simulées : nvidia-smi et torchrun factices ; le faux torchrun « rend » les plans de son lot.
  writeFileSync(join(S, 'bin/nvidia-smi'), '#!/bin/bash\necho "GPU 0: H100 (UUID: a)"\necho "GPU 1: H100 (UUID: b)"\n')
  writeFileSync(join(S, 'bin/python3.10'), '#!/bin/bash\nexec python3 "$@"\n')
  writeFileSync(join(S, 'bin/torchrun'), [
    '#!/bin/bash', 'lot=; sortie=',
    'while [ $# -gt 0 ]; do case "$1" in --lot) lot=$2; shift;; --sortie) sortie=$2; shift;; esac; shift; done',
    'echo "carte=$CUDA_VISIBLE_DEVICES tmp=$LOT_TMP lot=$(basename "$lot")" >> "$sortie/../appels.txt"',
    'python3 -c "import json,os,sys; [open(os.path.join(sys.argv[2], p[\'cle\'] + \'.mp4\'), \'w\').close() for p in json.load(open(sys.argv[1]))]" "$lot" "$sortie"',
  ].join('\n') + '\n')
  for (const f of ['nvidia-smi', 'python3.10', 'torchrun']) chmodSync(join(S, 'bin', f), 0o755)
  const r = spawnSync('bash', [join(J, 'animer.sh'), S, join(S, 'poids')],
    { encoding: 'utf8', env: { ...process.env, PATH: `${join(S, 'bin')}:${process.env.PATH}`, ANIMER_ESPACEMENT: '0' } })
  assert.equal(r.status, 0, r.stderr)
  for (const cle of ['a', 'b', 'c', 'd', 'e']) assert.ok(existsSync(join(S, `resultats/clips/${cle}.mp4`)), `${cle} rendu`)
  const appels = readFileSync(join(S, 'resultats/appels.txt'), 'utf8').trim().split('\n').sort()
  assert.deepEqual(appels, ['carte=0 tmp=./audio_temp_file_0 lot=lot-0.json', 'carte=1 tmp=./audio_temp_file_1 lot=lot-1.json'],
    'un processus par carte, chacun son dossier temporaire')
  assert.match(readFileSync(join(S, 'resultats/journal.txt'), 'utf8'), /sur 2 carte\(s\)/)
  // Le câblage : travail.sh passe la main à animer.sh, lc_lot.py prend son dossier temporaire, jt-du-jour.sh partage l'animation.
  assert.match(lire('travail.sh'), /bash entrees\/animer\.sh "\$S" "\$W"/)
  assert.match(lire('lc_lot.py'), /os\.environ\.get\("LOT_TMP", "\.\/audio_temp_file"\)/)
  assert.match(lire('jt-du-jour.sh'), /USINE_ANIM_H="\$ANIM" USINE_FIXE_H="\$FIXE"/)
  assert.match(lire('jt-du-jour.sh'), /"num_gpus":\{"gte":1,"lte":4\}/)
})

test('⭐ restant.py compte ce qui reste — un plan sans voix n’est pas « à faire »', () => {
  const { dossier } = planifier(EXEMPLE)
  const compte = (q: string) => spawnSync('python3', [join(dossier, 'entrees/restant.py'), q], { cwd: dossier, encoding: 'utf8' }).stdout.trim()
  assert.equal(compte('voix'), '8')
  assert.equal(compte('images'), '3')
  assert.equal(compte('plans'), '0', 'aucune voix encore : aucun plan n’est faisable')
  // … mais sept plans restent à rendre : c'est CE compte qui décide d'installer LongCat. Le 1er essai réel (15/09) a
  // décidé sur « plans » (0 sur une machine neuve), sauté l'installation, et l'a attendue pour toujours.
  assert.equal(compte('plans-tous'), '7')
  assert.match(lire('travail.sh'), /RP=\$\(python3\.10 restant\.py plans-tous\)/)
  mkdirSync(join(dossier, 'resultats/voix'), { recursive: true })
  writeFileSync(join(dossier, 'resultats/voix/ouverture.wav'), 'RIFF')
  assert.equal(compte('voix'), '7')
  assert.equal(compte('plans'), '1', 'l’ouverture a sa voix et son image (la photo d’Iggy)')
})

test('le montage suit les pilotes validés : générique du fondateur, avancée vers Iggy, aucune mention à l’écran', () => {
  const m = lire('montage.py')
  assert.match(m, /G_BASCULE, G_NOIR = 15\.0, 16\.4/)
  assert.match(m, /CADRE_OUVERTURE = \(48, 168, 783, 437\)/, 'la caméra finit sur le cadrage exact du plan d’ouverture')
  // Fondateur, 15/09 : Iggy parle AVANT la fin du zoom — dès que son plan paraît, et la caméra finit son avancée sur lui.
  assert.match(m, /T_VOIX = T_PARLE\b/)
  // … sans « léger changement d'image » (fondateur, 15/09) : UNE avancée sur le plan large où la PREMIÈRE image du plan
  // animé est incrustée ; il y reste figé jusqu'à ce qu'Iggy parle, et la caméra s'arrête pile sur lui.
  assert.match(m, /ZOOM_TOTAL = ZOOM_DUREE \+ ZOOM_CLIP_DUREE/)
  assert.match(m, /tpad=start_duration=\{ZOOM_DUREE\}:start_mode=clone/)
  assert.match(m, /\[anime\]\[masque\]alphamerge\[incruste\]/)
  // La porte de bruit rognait des débuts et fins de mots (0,5 s sur l'essai) : les voix sont nettoyées en amont.
  assert.doesNotMatch(m, /agate/)
  // … et des caméras dynamiques : aucun plan fixe, un 2e cadrage sur les plans longs, l'interview suit la parole.
  assert.match(m, /def mouvement\(d, geste, ancre, serre=True\)/)
  assert.match(m, /if serre and d > 12:/)
  assert.match(m, /def interview\(clip, sortie, dq, bandeaux=""\)/)
  assert.match(m, /def inserer_coupe\(/, 'les plans de coupe du lieu, sous la voix du reporter')
  assert.match(m, /comment=Images et voix créées avec l’IA/, 'l’IA est signalée dans les métadonnées')
  const code = m.split('\n').filter(l => !/^\s*#/.test(l) && !/^\s*"""|^[A-ZÀ-Ü]/.test(l)).join('\n')
  assert.ok(!/fiction satirique/i.test(code), 'aucune mention à l’écran (fondateur, 15/09)')
  assert.match(m, /manquants\.append/, 'un plan manquant saute : le Journal se monte sans lui')
})
