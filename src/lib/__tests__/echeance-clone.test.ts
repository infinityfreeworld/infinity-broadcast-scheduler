/**
 * @module InfinityScheduler/Lib/EcheanceClone/Tests
 * @description 🔴 Une émission est restée bloquée 8 h 25 sur son PREMIER tour.
 *
 *   Deux budgets existaient pourtant. Celui du réveil (720 s) a
 *   correctement abandonné. Celui de la file (1800 s) n'a jamais parlé —
 *   pas une ligne « file pleine » dans le journal. L'appel était figé DANS
 *   un `fetch`, malgré son `AbortSignal` de 300 s, et nous n'avons pas
 *   établi pourquoi.
 *
 *   Un garde qui dépend de la bonne volonté du réseau n'est pas un garde.
 *   Celui-ci ne dépend que de l'horloge.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { ouvrirEcheanceClone, echeanceClonePassee, synthesizeWithChatterbox, avecEcheance } from '../chatterbox'

const SRC = new URL('../chatterbox.ts', import.meta.url)

test("sans échéance ouverte, rien n'est bloqué", () => {
  // TÉMOIN : un mur qui refuserait TOUJOURS passerait les tests suivants
  // sans rien garder d'utile.
  assert.equal(echeanceClonePassee(), false)
})

test("une échéance ouverte dans le futur ne bloque pas", () => {
  ouvrirEcheanceClone(60)
  assert.equal(echeanceClonePassee(), false)
})

test('🔴 une échéance dépassée BLOQUE, sans attendre le réseau', async () => {
  ouvrirEcheanceClone(-1)
  assert.equal(echeanceClonePassee(), true)
  // Et le refus est IMMÉDIAT : pas de fetch, donc pas de blocage possible.
  const t0 = Date.now()
  await assert.rejects(
    () => synthesizeWithChatterbox({ voice: 'x.wav', text: 'test' }),
    /échéance de synthèse clonée dépassée/,
  )
  assert.ok(Date.now() - t0 < 500, 'le refus doit être immédiat, pas après un appel réseau')
  ouvrirEcheanceClone(3600)   // on referme pour ne pas polluer les autres tests
})

test("le mur est consulté AVANT toute logique de reprise", () => {
  // S'il était consulté après, un fetch figé le contournerait — ce qui est
  // exactement le défaut qu'il répare.
  const src = readFileSync(SRC, 'utf8')
  const corps = /export async function synthesizeWithChatterbox[\s\S]{0,400}/.exec(src)?.[0] ?? ''
  assert.match(corps, /echeanceClonePassee\(\)/)
})

test("🔴 LE TEST QUI COMPTE : une promesse qui ne finit JAMAIS est interrompue", async () => {
  // La première version du mur vérifiait l'échéance AVANT l'appel. Elle
  // empêchait d'en démarrer un nouveau, mais pas de rester bloqué dedans :
  // une répétition est restée figée NEUF HEURES dans un appel commencé
  // avant l'expiration. Le mur n'a pas dit un mot — on ne le lui a jamais
  // redemandé.
  //
  // Une vérification n'est pas une garantie. Seule une course en est une.
  const jamais = new Promise<string>(() => { /* ne se résout ni ne rejette */ })
  const t0 = Date.now()
  await assert.rejects(
    () => avecEcheance(jamais, 300, 'appel figé'),
    /abandonné après/,
  )
  const ecoule = Date.now() - t0
  assert.ok(ecoule >= 250 && ecoule < 3000, `interrompu en ${ecoule} ms, attendu ~300`)
})

test('une promesse qui aboutit AVANT l\'échéance passe intacte', async () => {
  // TÉMOIN POSITIF : une course qui rejetterait toujours passerait le test
  // ci-dessus sans rien garder d'utile.
  const r = await avecEcheance(Promise.resolve('fini'), 5000, 'rapide')
  assert.equal(r, 'fini')
})

test("le minuteur est TOUJOURS nettoyé — sinon le processus ne rend jamais la main", async () => {
  // Un setTimeout non annulé garde la boucle d'événements vivante : le
  // script se terminerait… quand le minuteur expire. Sur 22 tours et un
  // mur de 20 minutes, c'est une nuit qui ne se termine pas.
  const src = readFileSync(SRC, 'utf8')
  const bloc = /export async function avecEcheance[\s\S]*?\n}/.exec(src)?.[0] ?? ''
  assert.ok(bloc.includes('finally'), 'le nettoyage doit être dans un finally')
  assert.ok(bloc.includes('clearTimeout'), 'le minuteur doit être annulé')
})

test("🔴 la course est BRANCHÉE dans la synthèse — pas seulement disponible", () => {
  // Le défaut d'origine n'était pas qu'un mécanisme manquait : c'est qu'il
  // n'était pas APPLIQUÉ à l'appel qui se bloquait. Un test qui éprouve
  // `avecEcheance` isolément passe même si la synthèse ne s'en sert pas —
  // vérifié par mutation, il ne mordait pas.
  const src = readFileSync(SRC, 'utf8')
  const corps = /export async function synthesizeWithChatterbox[\s\S]*?\n}/.exec(src)?.[0] ?? ''
  assert.ok(corps.length > 0, 'synthesizeWithChatterbox introuvable')
  assert.match(corps, /return avecEcheance\(/, "l'appel doit COURIR contre l'horloge")
  assert.ok(
    !/return synthetiserSansMur\(opts\)\s*\n?}/.test(corps),
    'la synthèse ne doit jamais être appelée sans course',
  )
})

test('🔴 le réveil consulte `warming` AVANT de tenter une synthèse', () => {
  // data-space (08/09/2026) : leur capacité apparaît dans l'inventaire
  // huit minutes AVANT d'être utilisable. Se fier à sa première
  // apparition, c'est marteler une station qui ne sait pas répondre —
  // et consommer des tentatives pour rien.
  //
  // Tant que `warming` est vrai, la fenêtre payée n'a pas commencé et
  // rien n'est consommé : attendre ne coûte rien, s'acharner coûte tout.
  const src = readFileSync(SRC, 'utf8')
  const bloc = /export async function reveillerEtVerifier[\s\S]*?\n}/.exec(src)?.[0] ?? ''
  assert.ok(bloc.length > 0, 'reveillerEtVerifier introuvable')
  const iWarming = bloc.indexOf('sess?.warming')
  const iSynth = bloc.indexOf('synthesizeWithChatterbox')
  assert.ok(iWarming > 0, 'le réveil doit consulter warming')
  assert.ok(iWarming < iSynth, 'warming doit être consulté AVANT la synthèse, pas après')
})

test("un état de session illisible ne bloque pas la nuit", () => {
  // Un indicateur est un confort. Le rendre bloquant ferait perdre une
  // émission pour une route de diagnostic en panne.
  const src = readFileSync(SRC, 'utf8')
  const bloc = /export async function etatSession[\s\S]*?\n}/.exec(src)?.[0] ?? ''
  assert.match(bloc, /return null/)
  assert.ok(!/\bthrow\b/.test(bloc), 'etatSession ne doit jamais lever')
})

test('🔴 la session couvre la fenêtre ENTIÈRE de production', () => {
  // data-space (08/09/2026) : « votre session de 120 minutes ne couvre pas
  // votre fenêtre de trois heures. Si vous ouvrez à 19h20 et produisez à
  // 22h50, la session aura expiré, la station sera froide, et votre
  // première phrase repaiera les 35 minutes d'allumage — à l'intérieur de
  // votre échéance de 55 minutes. Vous atteindriez votre garde-fou sans
  // qu'aucun défaut ne soit en cause. »
  //
  // Un garde qui se déclenche sur un réglage mal accordé accuse le
  // partenaire à tort. La session doit couvrir la fenêtre, marge comprise.
  const env = readFileSync(new URL('../../../.env', import.meta.url), 'utf8')
  const minutes = Number(/^CHATTERBOX_SESSION_MINUTES=(\d+)/m.exec(env)?.[1] ?? '0')
  const nuit = readFileSync(new URL('../../../scripts/nuit-locale.sh', import.meta.url), 'utf8')
  const debut = Number(/heure" -ge (\d+)/.exec(nuit)?.[1] ?? '0')
  const fin = Number(/heure" -le (\d+)/.exec(nuit)?.[1] ?? '0')
  const fenetreMin = (fin + 1 - debut) * 60
  assert.ok(fenetreMin > 0, 'fenêtre illisible')
  assert.ok(
    minutes >= fenetreMin,
    `session ${minutes} min < fenêtre ${fenetreMin} min : un déclenchement tardif trouverait la station froide`,
  )
})

test("la session s'ouvre AVANT l'écriture des dialogues", () => {
  // Leur alerte se déclenche à l'ouverture, pas à notre première requête.
  // Ouvrir tard, c'est leur retirer le temps de rattraper une panne.
  const nuit = readFileSync(new URL('../../../scripts/nuit-locale.sh', import.meta.url), 'utf8')
  const iSession = nuit.indexOf('ouvrir-session.ts')
  const iGen = nuit.indexOf('generate-all.ts')
  assert.ok(iSession > 0, 'la nuit doit ouvrir une session')
  assert.ok(iSession < iGen, "la session doit précéder la génération")
})

test("🔴 le plafond court depuis l'OUVERTURE — ouvrir tôt raccourcit la couverture", () => {
  // data-space, 08/09/2026 : fin = min(chaude + demandées, ouverture + 360).
  // Une ouverture à 17 h finit à 22h35 — une heure et demie AVANT la fin de
  // notre fenêtre. Notre garde accuserait leur station d'être morte, sur
  // une session que NOUS aurions ouverte trop tôt en croyant bien faire.
  //
  // Troisième occurrence du même piège cette semaine : un désaccord de
  // configuration qui accuse le partenaire.
  const src = readFileSync(new URL('../../scripts/ouvrir-session.ts', import.meta.url), 'utf8')
  assert.match(src, /PLAFOND_MIN/, 'le plafond doit être pris en compte')
  assert.match(src, /Math\.min\(CHAUFFE_MIN \+ minutes, PLAFOND_MIN\)/,
    "la fin réelle est le MINIMUM des deux, pas la durée demandée")
  // Et le refus doit précéder l'ouverture : ouvrir puis constater ne sert à rien.
  const iRefus = src.indexOf('Session NON ouverte')
  const iOuvre = src.indexOf('await ouvrirSessionDiffusion(minutes)')
  assert.ok(iRefus > 0 && iRefus < iOuvre, "le refus doit précéder l'ouverture")
})

test("🔴 une échéance PAR STATION ne borne pas la NUIT", () => {
  // `ouvrirEcheanceClone()` est appelée DANS chaque generate-broadcast :
  // chaque station repart avec ses 55 minutes. Quatre stations à voix
  // clonée = 220 min d'attente possible, plus les onze autres — une nuit
  // de 5 h 30 qui déborde sur le matin.
  //
  // Borner une station n'est pas borner la nuit. `generate-all` pose donc
  // un INSTANT ABSOLU que tous les enfants respectent.
  const src = readFileSync(SRC, 'utf8')
  assert.match(src, /export function echeanceNuitPassee/)
  // Et elle doit être consultée AVANT l'échéance de station : la nuit
  // l'emporte sur l'émission.
  const corps = /export async function synthesizeWithChatterbox[\s\S]*?\n}/.exec(src)?.[0] ?? ''
  const iNuit = corps.indexOf('echeanceNuitPassee')
  const iStation = corps.indexOf('echeanceClonePassee')
  assert.ok(iNuit > 0, 'la synthèse doit consulter l\'échéance de nuit')
  assert.ok(iNuit < iStation, 'la nuit doit primer sur la station')
})

test('les stations à voix clonée passent EN TÊTE de la nuit', () => {
  // Dispersées, chacune repaie un réveil de 35 min. Le tri existait pour
  // la matrice GitHub et n'était pas appliqué à la production locale —
  // un outil écrit puis oublié à l'endroit qui compte.
  const ga = readFileSync(new URL('../../scripts/generate-all.ts', import.meta.url), 'utf8')
  assert.match(ga, /const ordreNuit = \[/)
  assert.match(ga, /avecGpu\.has\(s\.id\)/)
  assert.ok(!/for \(const station of SEED_STATIONS\) \{/.test(ga),
    'la boucle ne doit plus parcourir la seed dans son ordre brut')
})

test("generate-all pose l'instant de fin AVANT de lancer les stations", () => {
  const ga = readFileSync(new URL('../../scripts/generate-all.ts', import.meta.url), 'utf8')
  const iFin = ga.indexOf('CHATTERBOX_FIN_NUIT')
  const iBoucle = ga.indexOf('for (const station of ordreNuit)')
  assert.ok(iFin > 0 && iFin < iBoucle, "l'instant de fin doit précéder la boucle")
})

test("🔴 le tri de nuit et celui de la matrice CONSULTENT LA MÊME CHOSE", () => {
  // Mon tri ne regardait que les animateurs. Les voix de personnage
  // viennent surtout des personas d'INVITÉS — et depuis que le
  // durcissement par auteur a écarté la seule association d'animateur
  // contestée, plus aucune station n'en avait.
  //
  // Le tri rendait donc ZÉRO station en tête. Il ne triait rien, sans
  // jamais échouer : les stations à voix clonée restaient dispersées et
  // repayaient chacune 35 minutes de réveil.
  //
  // `lister-stations.ts` tenait le critère juste depuis le début. Deux
  // endroits doivent s'accorder — un accord tacite finit par diverger.
  const ga = readFileSync(new URL('../../scripts/generate-all.ts', import.meta.url), 'utf8')
  const ls = readFileSync(new URL('../../scripts/lister-stations.ts', import.meta.url), 'utf8')
  for (const [nom, src] of [['generate-all', ga], ['lister-stations', ls]] as const) {
    assert.match(src, /unifiedGuestsForStation\(st\.id, lg\)/,
      `${nom} doit consulter les invités`)
    assert.match(src, /getChatterboxVoiceForHost\(st\.id, h\.id, lg\)/,
      `${nom} doit consulter les animateurs`)
    assert.match(src, /parInvite \|\| parAnimateur/,
      `${nom} doit retenir une station si l'un OU l'autre a une voix`)
  }
})
