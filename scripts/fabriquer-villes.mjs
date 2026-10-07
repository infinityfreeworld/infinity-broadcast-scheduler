#!/usr/bin/env node
/**
 * Fabrique `src/data/villes.ts` — la table des villes qui permet à la radio de dire OÙ se passe
 * une Manifestaction, une Agora ou un Biogame SANS JAMAIS être plus précise que la ville.
 *
 * Source : `packages/geo/src/cities.ts` du dépôt Infinity (GeoNames cities15000, CC BY 4.0,
 * https://geonames.org). On garde les villes ≥ 15 000 habitants des pays francophones et les villes
 * ≥ 100 000 habitants du reste du monde, sans les morceaux de ville (arrondissements…) ; coordonnées
 * arrondies à 0,01° ; population en milliers.
 *
 * Usage : node scripts/fabriquer-villes.mjs "<chemin du dépôt infinity>"
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const depot = process.argv[2]
if (!depot) { console.error('usage : node scripts/fabriquer-villes.mjs <dépôt infinity>'); process.exit(1) }
const src = readFileSync(join(depot, 'packages/geo/src/cities.ts'), 'utf8')
const villes = JSON.parse(src.slice(src.indexOf('[{'), src.lastIndexOf(']') + 1))

const FRANCOPHONES = new Set([
  'FR', 'BE', 'CH', 'LU', 'MC', 'CA', 'MA', 'DZ', 'TN', 'SN', 'CI', 'ML', 'BF', 'NE', 'CM', 'CD', 'CG',
  'GA', 'BJ', 'TG', 'GN', 'MG', 'HT', 'RE', 'GP', 'MQ', 'GF', 'YT', 'NC', 'PF', 'MU', 'DJ', 'TD', 'CF',
  'RW', 'BI', 'KM',
])
// Un nom avec un chiffre est un MORCEAU de ville (« Lyon 05 », « Paris 15 Vaugirard », « Sector 3 »,
// « Zürich (Kreis 11) ») : plus fin que la ville, donc écarté — la ville entière est dans la table.
const gardees = villes
  .filter(v => (FRANCOPHONES.has(v.c) || v.p >= 100) && !/\d/.test(v.n))
  .map(v => `${v.n.replace(/[|;]/g, ' ')}|${v.c}|${v.lat.toFixed(2)}|${v.lng.toFixed(2)}|${v.p}`)

const sortie = `/**
 * @module InfinityScheduler/Data/Villes
 * @description FICHIER FABRIQUÉ par \`scripts/fabriquer-villes.mjs\` — ne pas éditer à la main.
 *
 *   ${gardees.length} villes : ≥ 15 000 habitants dans les pays francophones, ≥ 100 000 ailleurs, sans arrondissements.
 *   Données GeoNames (cities15000), CC BY 4.0 — https://geonames.org — via le paquet
 *   \`@infinity/geo\` du dépôt Infinity. Format : « nom|pays|lat|lng|population (milliers) », séparées par « ; ».
 */
export const VILLES_BRUTES = ${JSON.stringify(gardees.join(';'))}
`
writeFileSync(new URL('../src/data/villes.ts', import.meta.url), sortie)
console.log(`${gardees.length} villes écrites`)
