/**
 * @module InfinityScheduler/Lib/News/Tests
 * @description Les titres d'actualité arrivent jusqu'aux animateurs, puis
 *   jusqu'à la synthèse vocale. Un titre abîmé s'ENTEND — et ne lève
 *   aucune erreur.
 *
 *   Lancer :  npx tsx --test src/lib/__tests__/news-nettoyage.test.ts
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { cleanText } from '../news'

test('les entités NUMÉRIQUES sont décodées, pas laissées telles quelles', () => {
  // Cas réels relevés le 01/09/2026 sur Le Monde Diplomatique.
  assert.equal(
    cleanText("L'offensive culturelle de l'arm&#233;e fran&#231;aise"),
    "L'offensive culturelle de l'armée française",
  )
  assert.equal(cleanText('Interpol et la r&#233;pression politique'),
               'Interpol et la répression politique')
  // Hexadécimal aussi.
  assert.equal(cleanText('caf&#xe9;'), 'café')
})

test('les entités NOMMÉES sont décodées, pas remplacées par un espace', () => {
  // Le défaut d'avant : `.replace(/&[a-z]+;/gi, ' ')` coupait le mot.
  assert.equal(cleanText('arm&eacute;e'), 'armée')
  assert.notEqual(cleanText('arm&eacute;e'), 'arm e')
  assert.equal(cleanText('l&rsquo;h&ocirc;tel'), 'l’hôtel')
  assert.equal(cleanText('&laquo; libert&eacute; &raquo;'), '« liberté »')
})

test('les balises HTML disparaissent, leur contenu reste', () => {
  assert.equal(cleanText('<p>Un <b>titre</b> en gras</p>'), 'Un titre en gras')
})

test('le HTML DOUBLEMENT encodé est démêlé', () => {
  // Certains flux publient `&amp;#233;` : une seule passe ne révèle que
  // `&#233;`, qui resterait visible dans le prompt.
  assert.equal(cleanText('arm&amp;#233;e'), 'armée')
  // Une balise cachée derrière une entité ne doit pas ressortir en clair.
  assert.equal(cleanText('avant &lt;b&gt;gras&lt;/b&gt; après'), 'avant gras après')
})

test('une entité inconnue ou aberrante est LAISSÉE, jamais remplacée par un caractère faux', () => {
  // Mieux vaut un `&zzz;` visible qu'un caractère inventé : on voit le
  // défaut au lieu de lire une lettre fausse.
  assert.equal(cleanText('&zzz; reste'), '&zzz; reste')
  assert.equal(cleanText('&#99999999; reste'), '&#99999999; reste')
  assert.equal(cleanText('&#0; reste'), '&#0; reste')
})

test('un texte propre traverse INCHANGÉ', () => {
  // Témoin : si le nettoyage abîmait du texte normal, tous les tests
  // ci-dessus pourraient passer pour de mauvaises raisons.
  const propre = 'Après l’été caniculaire : « C’est le moment »'
  assert.equal(cleanText(propre), propre)
})

test('les espaces multiples sont réduits, le texte est ébarbé', () => {
  assert.equal(cleanText('  trop   d\'espaces  '), "trop d'espaces")
  assert.equal(cleanText('insécable&nbsp;ici'), 'insécable ici')
})
