#!/usr/bin/env tsx
/**
 * @module InfinityScheduler/Scripts/OuvrirSession
 * @description Annonce à data-space que nous allons diffuser, AVANT tout
 *   le reste.
 *
 *   ── POURQUOI SI TÔT ──
 *   data-space (08/09/2026) : « notre alerte se déclenche sur l'ouverture
 *   de la session, pas sur votre première tentative. Ouvrez donc la
 *   session tôt même si vous ne diffusez que tard : c'est ce qui nous
 *   laisse le temps de rattraper une panne d'allumage avant qu'elle ne
 *   devienne la vôtre. »
 *
 *   Auparavant la session s'ouvrait au milieu de `generate-broadcast`,
 *   après l'écriture des dialogues — soit une dizaine de minutes trop
 *   tard. Ici elle est le PREMIER geste de la nuit : leur station chauffe
 *   pendant que nous écrivons, et leur veille a le temps d'agir.
 *
 *   🔴 Ne fait JAMAIS échouer la nuit. Sans session, la synthèse marche —
 *   elle attend seulement plus longtemps.
 */
import 'dotenv/config'
import { ouvrirSessionDiffusion, preparerAccesChatterbox, etatSession } from '../lib/chatterbox'

async function main() {
  if (!process.env.CHATTERBOX_TTS_URL && !process.env.DATASPACE_NOSTR_KEY) {
    console.log('  · aucun service de voix clonée configuré — rien à ouvrir.')
    return
  }
  await preparerAccesChatterbox()
  const minutes = Number.parseInt(process.env.CHATTERBOX_SESSION_MINUTES ?? '220', 10)
  await ouvrirSessionDiffusion(minutes)
  const e = await etatSession()
  if (e) {
    console.log(`  session : ouverte=${e.open} · préchauffage=${e.warming}`
      + ` · station prête=${e.station_ready} · ${e.minutes_left ?? '?'} min restantes`)
  }
}
main().catch(e => {
  // Jamais bloquant : une nuit sans session vaut mieux qu'une nuit sans émission.
  console.warn(`  ⚠️ ouverture de session impossible (${(e as Error).message.slice(0, 120)}) — on continue`)
})
