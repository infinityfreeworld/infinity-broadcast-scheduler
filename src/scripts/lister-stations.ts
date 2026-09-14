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
import { pubkeyDe, broadcastDTag, getRelays, RADIO_BROADCAST_KIND } from '../lib/nostr'
import { dTagsPublies } from '../lib/deja-diffuse'
import { getChatterboxVoiceForHost, chatterboxBranche } from '../lib/chatterbox'
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
  if (!chatterboxBranche()) return ids
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

let ids = process.argv.includes('--brut')
  ? SEED_STATIONS.map(s => s.id)
  : await ordonnerParBesoinDeGpu()

// `--manquantes` : ne garder que les stations dont l'émission de TARGET_DATE n'est PAS encore à
// l'antenne (secours GitHub, 14/09/2026). Relais illisibles → on les garde toutes : mieux vaut
// produire deux fois qu'un soir de silence.
if (process.argv.includes('--manquantes')) {
  const date = process.env.TARGET_DATE || ''
  const cle = process.env.NOSTR_PRIVATE_KEY || ''
  if (date && cle) {
    const deja = await dTagsPublies(RADIO_BROADCAST_KIND, ids.map(i => broadcastDTag(i, date)), pubkeyDe(cle), getRelays())
    if (deja) {
      const avant = ids.length
      ids = ids.filter(i => !deja.has(broadcastDTag(i, date)))
      console.error(`[stations] ${avant - ids.length} déjà à l'antenne pour ${date} — ${ids.length} à produire`)
    } else {
      console.error('[stations] relais illisibles : on produit toutes les stations')
    }
  } else {
    console.error('[stations] --manquantes sans TARGET_DATE ni NOSTR_PRIVATE_KEY : liste complète')
  }
}
if (process.argv.includes('--lisible')) {
  for (const s of SEED_STATIONS) console.log(`${s.id}\t${s.language ?? 'fr'}\t${s.name}`)
} else {
  process.stdout.write(JSON.stringify(ids))
}
