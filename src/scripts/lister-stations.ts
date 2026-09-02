#!/usr/bin/env tsx
/**
 * @module InfinityScheduler/Scripts/ListerStations
 * @description Imprime les identifiants des stations seed en JSON, pour
 *   alimenter la matrice du workflow (un job par station).
 *
 *   Une seule source : la liste vit dans `seed-stations.ts` et nulle part
 *   ailleurs. La recopier dans le YAML serait une valeur périssable de
 *   plus — on ajouterait une station et elle ne serait jamais diffusée,
 *   sans que rien ne le dise.
 */

import { SEED_STATIONS } from '../data/seed-stations'

const ids = SEED_STATIONS.map(s => s.id)
if (process.argv.includes('--lisible')) {
  for (const s of SEED_STATIONS) console.log(`${s.id}\t${s.language ?? 'fr'}\t${s.name}`)
} else {
  process.stdout.write(JSON.stringify(ids))
}
