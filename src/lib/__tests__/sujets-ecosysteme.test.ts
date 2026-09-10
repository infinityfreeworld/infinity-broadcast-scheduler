/**
 * @module InfinityScheduler/TV/SujetsEcosysteme/Tests
 * @description 🧭 Quand l'application n'a rien de réel à raconter, elle se présente — avec SES mots.
 *
 *   Lancer :  npx tsx --test src/lib/__tests__/sujets-ecosysteme.test.ts
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import { choisirSujetsEcosysteme, SUJETS_ECOSYSTEME, SOURCE_PRESENTATION } from '../../data/sujets-ecosysteme'

test('les trois sujets demandés par le Bâtisseur sont là : Manifestactions, Abondance, DAV', () => {
  const titres = SUJETS_ECOSYSTEME.map(s => s.title).join(' | ')
  assert.match(titres, /Manifestactions/)
  assert.match(titres, /Abondance/)
  assert.match(titres, /DAV/)
})

test('⭐ une présentation se déclare comme telle (le conducteur ne doit pas en faire un événement)', () => {
  for (const s of SUJETS_ECOSYSTEME) {
    assert.equal(s.sourceTitle, SOURCE_PRESENTATION)
    assert.equal(s.publishedAt, undefined, 'une présentation n’a pas de date : rien n’a eu lieu')
  }
})

test('le choix tourne d’un jour à l’autre, et reste le même dans une journée', () => {
  const lundi = new Date(Date.UTC(2026, 8, 14, 20))
  const mardi = new Date(Date.UTC(2026, 8, 15, 20))
  assert.notEqual(choisirSujetsEcosysteme(1, lundi)[0].title, choisirSujetsEcosysteme(1, mardi)[0].title)
  assert.deepEqual(choisirSujetsEcosysteme(2, lundi), choisirSujetsEcosysteme(2, new Date(Date.UTC(2026, 8, 14, 3))))
})

test('les bornes : zéro demandé → rien ; trop demandé → tout, sans doublon', () => {
  assert.equal(choisirSujetsEcosysteme(0).length, 0)
  const tout = choisirSujetsEcosysteme(10)
  assert.equal(tout.length, SUJETS_ECOSYSTEME.length)
  assert.equal(new Set(tout.map(s => s.title)).size, tout.length)
})

test('⭐ le générateur présente l’application AVANT de puiser à l’extérieur, et borne l’extérieur à deux', () => {
  const gen = readFileSync(new URL('../../scripts/generate-tv-program.ts', import.meta.url), 'utf8')
  assert.match(gen, /choisirSujetsEcosysteme\(Math\.max\(0, 3 - sujets\.length\)\)/)
  assert.match(gen, /fetchNewsForStation\(\{ sources: channel\.sources \} as RadioStation, 2\)/)
  assert.match(gen, /\[\.\.\.sujets, \.\.\.presentation, \.\.\.news\]/, 'ordre : réel, présentation, extérieur')
})

const CLES = [
  "Manifestactions Hors de l'Enclos", "actions d'entraide communautaire concrètes",
  "L'économie d'entraide et le financement participatif du collectif",
  "L'espace de gouvernance biocratique",
]

test('⭐ aucune présentation n’est tronquée par le conducteur (180 caractères au plus)', () => {
  // `formatNewsForPrompt` coupe le résumé à 180 : la 1re version y perdait la phrase qui dit
  // À QUOI sert le module.
  for (const s of SUJETS_ECOSYSTEME) {
    assert.ok((s.summary ?? '').length <= 180, `${s.title} : ${(s.summary ?? '').length} caractères`)
  }
})

test('⭐ contrat, NOTRE côté : les formules-clés sont bien dans nos présentations', () => {
  // Sans ce contrôle, le contrat ne vérifiait que l'application : nos textes pouvaient dériver
  // librement sans que rien ne le signale.
  const nous = SUJETS_ECOSYSTEME.map(s => `${s.title} ${s.summary}`).join(' ')
  for (const cle of CLES) assert.ok(nous.includes(cle), `« ${cle} » manque à nos présentations`)
})

test('⭐ contrat, CÔTÉ APPLICATION : les mêmes formules sont dans ses fiches d’aide', (t) => {
  const fiche = new URL('../../../../infinity/src/components/module-help/module-help-content.ts', import.meta.url)
  if (!existsSync(fiche)) {
    t.skip('dépôt infinity absent de cette machine — contrat NON vérifié (sauté, pas réussi)')
    return
  }
  const app = readFileSync(fiche, 'utf8')
  for (const cle of CLES) {
    assert.ok(app.includes(cle), `« ${cle} » a disparu des fiches de l'application — mettre à jour sujets-ecosysteme.ts`)
  }
})
