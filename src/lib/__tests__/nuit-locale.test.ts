/**
 * @module InfinityScheduler/Lib/NuitLocale/Tests
 * @description 🔴 Quatorze occasions de diffuser, annulées par du code mort.
 *
 *   Le 08/09/2026, la tâche du soir a dit « on y va » QUATORZE fois. À
 *   chaque fois, un bloc laissé après un remaniement s'exécutait juste
 *   après : il appelait `dans_la_fenetre`, fonction supprimée depuis que
 *   la décision avait été extraite dans `decider()`.
 *
 *   Un appel introuvable rend un code non nul. La condition tombait donc
 *   à faux, puis le `else` sortait — en silence.
 *
 *   `dans_la_fenetre: command not found` criait dans le journal à chaque
 *   réveil depuis deux jours. Personne ne l'a lu.
 *
 *   Lancer : npx tsx --test src/lib/__tests__/nuit-locale.test.ts
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const SCRIPT = fileURLToPath(new URL('../../../scripts/nuit-locale.sh', import.meta.url))

/** Décision du script pour une heure donnée, sans rien exécuter d'autre. */
function decision(heure: number, derniere = '', ecoule = 0): { sortie: string; erreurs: string } {
  const src = readFileSync(SCRIPT, 'utf8')
  const fn = /^decider\(\) \{[\s\S]*?\n\}/m.exec(src)?.[0] ?? ''
  assert.ok(fn, 'decider() introuvable dans le script')
  const res = execFileSync('bash', ['-c',
    `${fn}\ndecider "${heure}" "${derniere}" "${ecoule}" "2026-09-09"`,
  ], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })
  return { sortie: res.trim(), erreurs: '' }
}

test('🔴 une exécution de décision n\'écrit RIEN sur stderr', () => {
  // LE garde qui manquait. `command not found` est un message de stderr,
  // et un script qui en produit un a une branche morte ou une faute de
  // frappe. Le silence sur stderr est la seule preuve qu'aucun appel ne
  // s'évapore.
  const r = execFileSync('bash', [SCRIPT, '--decision'],
    { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })
  assert.ok(r.includes('->'), 'la décision doit être imprimée')
  // execFileSync lève si le code est non nul ; on vérifie ici l'absence
  // de bruit, ce que `bash -n` ne détecte pas.
  const avecErr = execFileSync('bash', ['-c',
    `bash "${SCRIPT}" --decision 2>&1 >/dev/null`,
  ], { encoding: 'utf8' })
  assert.equal(avecErr.trim(), '', `stderr non vide :\n${avecErr}`)
})

test('aucun appel à une fonction supprimée ne subsiste', () => {
  const src = readFileSync(SCRIPT, 'utf8')
  assert.ok(!src.includes('dans_la_fenetre'),
    'la fonction supprimée ne doit plus être ni définie ni appelée')
})

test('la décision est juste aux 24 heures', () => {
  for (const h of [0, 3, 7, 12, 14, 18, 19]) {
    assert.equal(decision(h).sortie, 'ATTENDRE', `${h}h devrait attendre`)
  }
  for (const h of [20, 21, 22, 23]) {
    assert.equal(decision(h).sortie, 'FENETRE', `${h}h est dans la fenêtre`)
  }
})

test('un premier lancement n\'est PAS un retard', () => {
  // Sans témoin, une installation à 14 h se croyait en retard de 9 999 h
  // et publiait quinze émissions sur-le-champ.
  assert.equal(decision(14, '', 9999).sortie, 'ATTENDRE')
  // Mais avec un témoin ancien, le rattrapage doit bien s'armer.
  assert.equal(decision(14, '2026-09-01', 99).sortie, 'RATTRAPAGE')
})

test('une nuit déjà produite ne se refait pas', () => {
  assert.equal(decision(21, '2026-09-09', 0).sortie, 'DEJA_FAIT')
})

// ─────────────────────────────────────────────────────────────────────
// 🔴 LE MAC DORMAIT PENDANT LA NUIT RADIO
//
//   Nuit du 09/09 : 11 h 51 du début à la fin, pour ~3 h 15 de travail
//   réel. `pmset -g log` montre un Deep Idle en boucle de 22 h 15 à
//   6 h 53 — le Mac dormait, et le processus avec lui. Quatre émissions
//   ont donc été publiées entre 7 h et 7 h 48 du matin.
//
//   Ce poste est réglé sur `sleep 1` sur batterie : une minute suffit.
//   Sans `caffeinate`, la fenêtre 20 h–minuit ne veut rien dire.
// ─────────────────────────────────────────────────────────────────────

const SOURCE = readFileSync(SCRIPT, 'utf8')
/** Le script sans ses commentaires : une garde ne doit pas se satisfaire
 *  d'un mot trouvé dans une explication. */
const CODE = SOURCE.split('\n').map(l => l.replace(/(^|\s)#.*$/, '')).join('\n')

test('🔴 le Mac est empêché de dormir pendant la nuit', () => {
  assert.match(CODE, /caffeinate/, 'sans caffeinate, le Mac s’endort au bout d’une minute sur batterie')
})

test('la veille est tenue par le SCRIPT lui-même, pas laissée derrière', () => {
  // `-w $$` : caffeinate meurt avec le script. Sans lui, un script tué
  // laisserait la machine éveillée indéfiniment.
  assert.match(CODE, /caffeinate[^\n]*-w \$\$/, 'caffeinate doit être adossé au PID du script')
  assert.match(CODE, /caffeinate[^\n]*&\s*$/m, 'caffeinate doit tourner en tâche de fond, sinon il bloque la nuit')
})

test('la veille est demandée APRÈS la décision, jamais avant', () => {
  // launchd nous réveille toutes les 15 minutes. Si caffeinate précédait
  // le `case`, chaque sondage retiendrait la machine : veille permanente.
  const iCase = CODE.indexOf('RATTRAPAGE)')
  const iCaf  = CODE.indexOf('caffeinate')
  const iGen  = CODE.indexOf('generate-all.ts')
  assert.ok(iCase > 0 && iCaf > 0 && iGen > 0, 'repères introuvables')
  assert.ok(iCaf > iCase, 'caffeinate avant la décision = veille permanente')
  assert.ok(iCaf < iGen, 'caffeinate après la génération ne protège rien')
})

test('les verdicts qui ne diffusent pas sortent AVANT la veille', () => {
  const avant = CODE.slice(0, CODE.indexOf('caffeinate'))
  assert.match(avant, /DEJA_FAIT\)[^\n]*exit 0/, 'une nuit déjà faite doit sortir avant de retenir la machine')
  assert.match(avant, /ATTENDRE\)[^\n]*exit 0/, 'hors fenêtre, on ne retient pas la machine')
})

test('l’écran n’est PAS maintenu allumé (batterie)', () => {
  const ligne = /caffeinate[^\n]*/.exec(CODE)?.[0] ?? ''
  assert.ok(!/-\w*d/.test(ligne.replace('-w $$', '')), `-d allumerait l’écran toute la nuit : « ${ligne.trim()} »`)
})

test('🔴 un sondage de décision ne retient JAMAIS la machine', () => {
  // Test de comportement, pas de lecture : on met un faux `caffeinate` en
  // tête de PATH et on vérifie qu'il n'est pas appelé.
  const marqueur = `/tmp/caf-marqueur-${process.pid}-${Date.now()}`
  const faux = `/tmp/faux-bin-${process.pid}-${Date.now()}`
  execFileSync('bash', ['-c',
    `mkdir -p "${faux}" && printf '#!/bin/sh\\ntouch "${marqueur}"\\n' > "${faux}/caffeinate" && chmod +x "${faux}/caffeinate"`,
  ])
  try {
    execFileSync('bash', ['-c', `PATH="${faux}:$PATH" bash "${SCRIPT}" --decision`],
      { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })
    const appele = execFileSync('bash', ['-c', `[ -e "${marqueur}" ] && echo oui || echo non`], { encoding: 'utf8' }).trim()
    assert.equal(appele, 'non', 'le sondage des 15 minutes ne doit pas bloquer la veille')
  } finally {
    execFileSync('bash', ['-c', `rm -rf "${faux}" "${marqueur}"`])
  }
})
