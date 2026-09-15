/**
 * @module InfinityScheduler/Usine/Tests
 * @description 🏭 L'usine de nuit loue des machines qui FACTURENT : ses garde-fous sont vérifiés ici.
 *   Chacun a été appris à nos dépens (cf. usine/LISEZMOI.md).
 *
 *   Lancer :  npx tsx --test src/lib/__tests__/usine.test.ts
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'

const lire = (f: string) => readFileSync(new URL(`../../../usine/${f}`, import.meta.url), 'utf8')
const VAST = lire('vast.py')
const ORCH = lire('orchestre.sh')
const TELE = lire('telecharger.sh')

test('les scripts sont syntaxiquement valides', () => {
  const py = spawnSync('python3', ['-c', `import ast,sys; ast.parse(open(sys.argv[1]).read())`, new URL('../../../usine/vast.py', import.meta.url).pathname])
  assert.equal(py.status, 0, String(py.stderr))
  for (const f of ['orchestre.sh', 'telecharger.sh']) {
    const sh = spawnSync('bash', ['-n', new URL(`../../../usine/${f}`, import.meta.url).pathname])
    assert.equal(sh.status, 0, `${f} : ${sh.stderr}`)
  }
})

test('⭐ une étiquette OBLIGATOIRE par travail, et jamais celle des stations DATASPACE', () => {
  assert.match(VAST, /ETIQ = os\.environ\.get\("USINE_ETIQUETTE", ""\)\.strip\(\)\nif not ETIQ:/)
  assert.match(VAST, /ETIQ\.startswith\("dataspace"\)/)
  const r = spawnSync('python3', [new URL('../../../usine/vast.py', import.meta.url).pathname, 'info'], { env: { ...process.env, USINE_ETIQUETTE: 'dataspace-auto' } })
  assert.notEqual(r.status, 0, 'l’étiquette des stations doit être refusée AVANT tout appel')
  assert.match(String(r.stderr), /étiquette refusée/)
})

test('⭐ le crédit est lu AVANT de louer, et une lecture impossible REFUSE', () => {
  const louer = VAST.slice(VAST.indexOf('elif cmd == "louer":'), VAST.indexOf('elif cmd == "machine":'))
  assert.ok(louer.indexOf('credit()') < louer.indexOf('"PUT"'), 'crédit vérifié avant la moindre location')
  assert.match(louer, /CREDIT_ILLISIBLE/)
  assert.match(louer, /CREDIT_INSUFFISANT/)
  assert.match(VAST, /max\(CREDIT_MIN, 5 \* BUDGET\)/)
  // Compte Vast partagé avec les stations des clients payants de DATASPACE : leur marge d'abord.
  assert.match(VAST, /CREDIT_MIN = float\(os\.environ\.get\("USINE_CREDIT_MIN", "20"\)\)/)
})

test('⭐ les offres sont classées au COÛT TOTAL (heures + bande passante + disque), pas au tarif horaire', () => {
  // Les deux offres du 14/09/2026 : la moins chère à l'heure était la plus chère au total.
  const debut = VAST.indexOf('def pire_cas(')
  const def = VAST.slice(debut, VAST.indexOf('\n\n\n', debut))
  const py = `HEURES, GO, DISQUE = 2.0, 60.0, 120\n${def}\n`
    + `vietnam = {"dph_total": 0.182, "inet_down_cost": 0.04, "storage_cost": 0.1}\n`
    + `pays_bas = {"dph_total": 0.243, "inet_down_cost": 0.001, "storage_cost": 0.1}\n`
    + `print("ok" if pire_cas(pays_bas) < pire_cas(vietnam) else "ko")`
  const r = spawnSync('python3', ['-c', py])
  assert.equal(String(r.stdout).trim(), 'ok', String(r.stderr))
  const louer = VAST.slice(VAST.indexOf('elif cmd == "louer":'), VAST.indexOf('elif cmd == "machine":'))
  assert.match(louer, /for o in sorted\(offres, key=lambda o: \(pire_cas\(o\), o\["dph_total"\]\)\):/)
  assert.match(louer, /pire = pire_cas\(o\)/, 'le budget se juge avec le MÊME calcul que le tri')
})

test('⭐ destruction en v1 PUIS v0, vérifiée sur une liste fraîche', () => {
  const det = VAST.slice(VAST.indexOf('elif cmd == "detruire":'))
  assert.ok(det.indexOf('/api/v1/instances/') < det.indexOf('/api/v0/instances/'))
  assert.match(det, /if mienne\(\) is None:/)
  assert.match(det, /DESTRUCTION NON CONFIRMÉE/)
})

test('⭐ le filet systemd est armé dès la location, AVANT d’attendre le SSH', () => {
  const boucle = ORCH.slice(ORCH.indexOf('for tour in 1 2 3'))
  assert.ok(boucle.indexOf('  filet') < boucle.indexOf('ssh $O -p "$SP" "root@$SH" true'))
  assert.match(ORCH, /systemd-run --on-active="\$\{FILET_MIN\}m"/)
  assert.match(ORCH, /--setenv=USINE_ETIQUETTE="\$ETIQ"/, 'le filet détruit la BONNE étiquette')
})

test('⭐ la machine est détruite à la sortie, et une destruction non confirmée ALERTE', () => {
  assert.match(ORCH, /trap fin EXIT/)
  const fin = ORCH.slice(ORCH.indexOf('fin() {'), ORCH.indexOf('trap fin EXIT'))
  assert.match(fin, /DISPARUE \(vérifié\)/)
  assert.match(fin, /alerte "Usine \$ETIQ : destruction NON confirmée"/)
})

test('un refus de crédit arrête la nuit et prévient', () => {
  assert.match(ORCH, /\*CREDIT_\*\) alerte "Usine \$ETIQ : nuit refusée"/)
})

test('rien n’est câblé en dur : dossier et étiquette sont des paramètres', () => {
  assert.match(ORCH, /D=\$\{USINE_DOSSIER:\?/)
  assert.match(ORCH, /ETIQ=\$\{USINE_ETIQUETTE:\?/)
  // Sur le CODE seulement : les commentaires racontent d'où vient l'usine, et c'est voulu.
  const code = (ORCH + '\n' + VAST).split('\n').filter(l => !/^\s*#/.test(l)).join('\n')
  assert.ok(!/banc-jt|seance-jt/.test(code), 'aucune étiquette des essais du jour dans le code')
})

test('⭐ machines INTERRUPTIBLES : une enchère au-dessus du minimum, et c’est ELLE que jugent le tri et le budget', () => {
  assert.match(VAST, /if INTERRUPTIBLE:\n    FILTRE\["type"\] = "bid"/)
  const louer = VAST.slice(VAST.indexOf('elif cmd == "louer":'), VAST.indexOf('elif cmd == "machine":'))
  assert.ok(louer.indexOf('o["_enchere"] = enchere(o)') < louer.indexOf('for o in sorted(offres'), 'le prix proposé est posé AVANT le tri')
  assert.match(louer, /corps\["price"\] = o\["_enchere"\]/, 'sans prix, Vast louerait à la demande')
  const debut = VAST.indexOf('def enchere(')
  const def = VAST.slice(debut, VAST.indexOf('\n\n\n', debut))
  // L'offre H100 SXM du 15/09/2026 : enchère minimale 0,653 $/h.
  const r = spawnSync('python3', ['-c', `MARGE = 0.15\n${def}\nprint(enchere({"min_bid": 0.653, "dph_total": 0.661}))`])
  const e = Number(String(r.stdout).trim())
  assert.ok(e > 0.653 && e < 0.8, `enchère ${e} (stderr : ${r.stderr})`)
})

test('⭐ une machine INJOIGNABLE n’est pas un travail fini : on vérifie le SSH, puis Vast, avant de conclure', () => {
  const suivi = ORCH.slice(ORCH.indexOf('issue=termine; perdu=0'))
  assert.ok(suivi.indexOf('pgrep -f "^bash travail.sh"') < suivi.indexOf('elif R true; then'))
  assert.ok(suivi.indexOf('elif R true; then') < suivi.indexOf('etat "travail TERMINE"'), 'TERMINE seulement si la machine RÉPOND')
  assert.match(suivi, /if \[ "\$st" != running \] \|\| \[ \$perdu -ge 3 \]; then issue=interrompue/)
})

test('⭐ reprise : au fil de l’eau, les déjà-faits rapportés AVANT le lancement, un budget TOTAL', () => {
  assert.match(ORCH, /rsync -a --exclude='\.\*'/, 'un fichier en cours d’écriture (.partiel) n’est jamais rapatrié comme fini')
  const lancement = ORCH.slice(ORCH.indexOf("R 'mkdir -p /workspace/usine/entrees /workspace/usine/resultats'"))
  assert.ok(lancement.indexOf('rsync -a -e "ssh $O -p $SP" "$D/resultats/"') < lancement.indexOf('setsid nohup bash travail.sh'))
  assert.match(ORCH, /ABANDON : budget total épuisé/)
  assert.match(ORCH, /\[ -f "\$D\/resultats\/FINI" \]/)
  const suivi = ORCH.slice(ORCH.indexOf('issue=termine; perdu=0'))
  assert.ok(suivi.indexOf('V detruire') < suivi.indexOf('[ $machine -le $REPRISES ]; then continue'), 'l’ancienne machine est détruite AVANT d’en louer une autre')
  assert.match(ORCH, /export USINE_BUDGET=\$\(python3 -c "print\(min\(\$BUDGET_MACHINE, \$RESTE\)\)"\)/, 'chaque machine est jugée sur ce qui RESTE du budget')
})

test('⭐ modèles : Hugging Face d’abord, ModelScope en secours', () => {
  assert.ok(TELE.indexOf('hf download') < TELE.indexOf('modelscope download'))
  assert.match(TELE, /return 1/)
})

test('⭐ plusieurs cartes : chaque offre est jugée au coût du TRAVAIL (l’animation se partage), et une machine ne dépasse jamais son budget', () => {
  const dir = mkdtempSync(join(tmpdir(), 'usine-estimer-'))
  writeFileSync(join(dir, 'reglages.json'), '{"vastApiKey": ""}')
  // Une carte seule à 1,69 $/h (Émirats, 15/09/2026) contre une machine à DEUX cartes à 2,20 $/h.
  writeFileSync(join(dir, 'offres.json'), JSON.stringify([
    { id: 1, gpu_name: 'H100 PCIE', num_gpus: 1, dph_total: 1.69, min_bid: 1.47, inet_down_cost: 0.0026, storage_cost: 0.1, geolocation: 'AE' },
    { id: 2, gpu_name: 'H100 PCIE', num_gpus: 2, dph_total: 2.2, min_bid: 1.91, inet_down_cost: 0.0026, storage_cost: 0.1, geolocation: 'GB' },
  ]))
  const estimer = (env: Record<string, string>) => spawnSync('python3', [new URL('../../../usine/vast.py', import.meta.url).pathname, 'estimer'], {
    encoding: 'utf8',
    env: { ...process.env, USINE_ETIQUETTE: 'usine-test', USINE_REGLAGES: join(dir, 'reglages.json'), USINE_OFFRES: join(dir, 'offres.json'),
      USINE_INTERRUPTIBLE: '1', USINE_BUDGET: '9', USINE_HEURES: '3.6', USINE_GO: '150', USINE_DISQUE: '300', ...env },
  })
  const partage = estimer({ USINE_ANIM_H: '2.36', USINE_FIXE_H: '0.6' })
  assert.match(partage.stdout.split('\n')[0], /^2 H100 PCIE 2x .* 1\.78h /, partage.stdout + partage.stderr)
  const seul = estimer({})
  assert.match(seul.stdout.split('\n')[0], /^1 H100 PCIE 1x /, 'sans part partagée, la carte seule reste la moins chère au total')
  // … et le coût RÉEL d'une machine (tarif × durée) l'arrête avant son budget, même avant l'échéance.
  assert.match(ORCH, /depasse\(\) \{ python3 -c/)
  const suivi = ORCH.slice(ORCH.indexOf('issue=termine; perdu=0'))
  assert.ok(suivi.indexOf('if depasse; then') > 0 && suivi.indexOf('BUDGET de la machine atteint') > 0)
})

test('⭐ l’observatoire des prix : LECTURE SEULE, une ligne par relevé, le Journal de 15 min au meilleur nombre de cartes', () => {
  const OBS = lire('observatoire.py')
  assert.ok(!/"PUT"|\/asks\/|DELETE/.test(OBS), 'l’observatoire ne loue ni ne détruit jamais rien')
  const dir = mkdtempSync(join(tmpdir(), 'usine-obs-'))
  writeFileSync(join(dir, 'offres.json'), JSON.stringify([
    { type: 'bid', gpu_name: 'H100 PCIE', num_gpus: 1, gpu_ram: 81559, dph_total: 1.69, min_bid: 1.47, inet_down_cost: 0.0026, geolocation: 'AE' },
    { type: 'bid', gpu_name: 'H100 PCIE', num_gpus: 4, gpu_ram: 81559, dph_total: 1.6, min_bid: 1.39, inet_down_cost: 0.0026, geolocation: 'GB' },
    { type: 'bid', gpu_name: 'RTX 6000Ada', num_gpus: 1, gpu_ram: 49140, dph_total: 0.39, min_bid: 0.34, inet_down_cost: 0.01, geolocation: 'US' },
  ]))
  const env = { ...process.env, OBS_OFFRES: join(dir, 'offres.json'), OBS_FICHIER: join(dir, 'obs.jsonl') }
  const chemin = new URL('../../../usine/observatoire.py', import.meta.url).pathname
  for (let i = 0; i < 2; i++) assert.equal(spawnSync('python3', [chemin], { env, encoding: 'utf8' }).status, 0)
  const lignes = readFileSync(join(dir, 'obs.jsonl'), 'utf8').trim().split('\n').map(l => JSON.parse(l))
  assert.equal(lignes.length, 2, 'une ligne par relevé, les précédentes gardées')
  assert.equal(lignes[0].cat['h100x4-bid'].n, 4)
  assert.ok(lignes[0].cat['h100x4-bid'].journal15 < lignes[0].cat['h100x1-bid'].journal15, '4 cartes à 0,40 $/h battent une carte à 1,69 $/h')
  assert.ok(lignes[0].cat['48go-bid'].carte > 0 && lignes[0].cat['48go-bid'].journal15 === undefined, 'vitesse inconnue : le prix seul')
  const r = spawnSync('python3', [chemin, 'resume'], { env, encoding: 'utf8' })
  assert.match(r.stdout, /2 relevé\(s\)/)
  assert.match(r.stdout, /par heure UTC/)
  assert.match(lire('systemd/usine-observatoire.timer'), /OnCalendar=hourly/)
})
