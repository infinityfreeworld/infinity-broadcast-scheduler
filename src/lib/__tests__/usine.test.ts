/**
 * @module InfinityScheduler/Usine/Tests
 * @description 🏭 L'usine de nuit loue des machines qui FACTURENT : ses garde-fous sont vérifiés ici.
 *   Chacun a été appris à nos dépens (cf. usine/LISEZMOI.md).
 *
 *   Lancer :  npx tsx --test src/lib/__tests__/usine.test.ts
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
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

test('⭐ modèles : Hugging Face d’abord, ModelScope en secours', () => {
  assert.ok(TELE.indexOf('hf download') < TELE.indexOf('modelscope download'))
  assert.match(TELE, /return 1/)
})
