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

test('⭐ contrat : chaque présentation reprend la fiche d’aide de l’application (une seule vérité)', (t) => {
  const fiche = new URL('../../../../infinity/src/components/module-help/module-help-content.ts', import.meta.url)
  if (!existsSync(fiche)) {
    t.skip('dépôt infinity absent de cette machine — contrat NON vérifié (sauté, pas réussi)')
    return
  }
  const app = readFileSync(fiche, 'utf8')
  // Les formules-clés de chaque fiche doivent se retrouver mot pour mot côté application.
  for (const cle of [
    "Manifestactions Hors de l'Enclos", "actions d'entraide communautaire concrètes",
    "L'économie d'entraide et le financement participatif du collectif",
    "L'espace de gouvernance biocratique",
  ]) assert.ok(app.includes(cle), `« ${cle} » a disparu des fiches de l'application — mettre à jour sujets-ecosysteme.ts`)
})
