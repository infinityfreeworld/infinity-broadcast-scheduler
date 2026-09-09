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

import 'dotenv/config'
import { SEED_STATIONS } from '../data/seed-stations'
import { getChatterboxVoiceForHost } from '../lib/chatterbox'
import { fetchHostVoiceMappings, exportHostVoiceMappingsToEnv } from '../lib/host-voice-mappings'
import {
  fetchRadioPersonas, exportRadioPersonasToEnv, unifiedGuestsForStation,
  resolvePersonaForStation,
} from '../lib/radio-personas'

/**
 * Les stations qui ont besoin du GPU passent EN PREMIER.
 *
 * ── POURQUOI L'ORDRE COMPTE ──
 * data-space éteint sa machine dès que la file se vide, et impose 5 min de
 * refroidissement puis ~12 min de démarrage avant une nouvelle location.
 * Or seules quelques stations ont des voix de personnage attribuées (4 sur
 * 15 au 02/09/2026) : dispersées dans la matrice, leurs salves seraient
 * séparées par des stations qui n'utilisent que Piper, la file se viderait
 * entre elles, et chacune paierait un réveil complet.
 *
 * Groupées en tête, leurs salves se suivent : une seule location.
 *
 * Si la récolte NOSTR échoue, on rend l'ordre de la seed — un ordre
 * imparfait vaut mieux qu'une liste vide.
 */
async function ordonnerParBesoinDeGpu(): Promise<string[]> {
  const ids = SEED_STATIONS.map(s => s.id)
  if (!process.env.CHATTERBOX_TTS_URL) return ids
  try {
    exportHostVoiceMappingsToEnv(await fetchHostVoiceMappings())
    exportRadioPersonasToEnv(await fetchRadioPersonas(ids))
    const avecGpu = new Set<string>()
    for (const st of SEED_STATIONS) {
      const lg = st.language ?? 'fr'
      const invites = unifiedGuestsForStation(st.id, lg)
      const parInvite = invites.length
        ? resolvePersonaForStation(invites[0], st.id).voiceName : undefined
      const parAnimateur = st.hosts
        .map(h => getChatterboxVoiceForHost(st.id, h.id, lg))
        .find((v): v is string => !!v)
      if (parInvite || parAnimateur) avecGpu.add(st.id)
    }
    return [...ids.filter(i => avecGpu.has(i)), ...ids.filter(i => !avecGpu.has(i))]
  } catch (err) {
    console.error('[stations] récolte échouée, ordre de la seed :', (err as Error).message)
    return ids
  }
}

const ids = process.argv.includes('--brut')
  ? SEED_STATIONS.map(s => s.id)
  : await ordonnerParBesoinDeGpu()
if (process.argv.includes('--lisible')) {
  for (const s of SEED_STATIONS) console.log(`${s.id}\t${s.language ?? 'fr'}\t${s.name}`)
} else {
  process.stdout.write(JSON.stringify(ids))
}
