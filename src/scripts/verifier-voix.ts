#!/usr/bin/env tsx
/**
 * @module InfinityScheduler/Scripts/VerifierVoix
 * @description Croise les voix que NOS stations vont demander avec le
 *   catalogue RÉEL de data-space, et refuse en bloc s'il en manque une.
 *
 *   ── POURQUOI CET OUTIL EXISTE ──
 *   Le 02/09/2026, en préparant l'essai commun, `pirate-radio` demandait
 *   la voix « alain ». Le catalogue contient « alain-morale ». Notre
 *   client aurait demandé « alain.wav » et reçu un `404 voice_not_found`
 *   — un service parfaitement sain, une voix parfaitement envoyée, et un
 *   nom qui ne correspond à rien.
 *
 *   🔴 Ce défaut ne se voit d'AUCUN côté pris séparément : notre
 *   configuration est cohérente avec elle-même, leur catalogue est
 *   complet, et c'est la COUTURE entre les deux qui est fausse. Il fallait
 *   confronter les deux listes pour qu'il apparaisse.
 *
 *   Un 404 la nuit de la diffusion aurait fait chercher du côté du
 *   service — d'autant qu'un chemin d'API inconnu rend le même chiffre.
 *
 *   Usage :
 *     tsx src/scripts/verifier-voix.ts
 *   Exige DATASPACE_API_KEY et CHATTERBOX_TTS_URL.
 *   Sort en 1 si une seule voix manque : c'est un feu ROUGE, pas un avis.
 */

import 'dotenv/config'
import { SEED_STATIONS } from '../data/seed-stations'
import { getChatterboxVoiceForHost } from '../lib/chatterbox'
import { fetchHostVoiceMappings, exportHostVoiceMappingsToEnv } from '../lib/host-voice-mappings'
import {
  fetchRadioPersonas, exportRadioPersonasToEnv,
  unifiedGuestsForStation, resolvePersonaForStation,
} from '../lib/radio-personas'
import { nomDemande, catalogueDistant } from '../lib/voix-catalogue'

async function main() {
  const ids = SEED_STATIONS.map(s => s.id)
  exportHostVoiceMappingsToEnv(await fetchHostVoiceMappings())
  exportRadioPersonasToEnv(await fetchRadioPersonas(ids))
  const connues = await catalogueDistant()
  console.log(`\ncatalogue data-space : ${connues.size} voix\n`)

  let manquantes = 0
  for (const st of SEED_STATIONS) {
    const lg = st.language ?? 'fr'
    const voix = new Set<string>()
    for (const h of st.hosts) {
      const v = getChatterboxVoiceForHost(st.id, h.id, lg)
      if (v) voix.add(v)
    }
    for (const i of unifiedGuestsForStation(st.id, lg)) {
      const v = resolvePersonaForStation(i, st.id).voiceName
      if (v) voix.add(v)
    }
    if (voix.size === 0) continue

    const absentes = [...voix].filter(v => !connues.has(nomDemande(v)))
    manquantes += absentes.length
    const etat = absentes.length === 0 ? '✅' : '🔴'
    console.log(`${etat} ${st.id.padEnd(18)} ${voix.size} voix` +
      (absentes.length ? `  — INTROUVABLES : ${absentes.map(nomDemande).join(', ')}` : ''))
    for (const a of absentes) {
      // Suggérer le voisin le plus proche : neuf fois sur dix c'est un
      // préfixe, et nommer le candidat évite de fouiller 29 entrées.
      const proche = [...connues].filter(c => c.startsWith(a.split('-')[0]))
      if (proche.length) console.log(`     candidat probable : ${proche.join(' ou ')}`)
    }
  }

  if (manquantes > 0) {
    console.error(`\n❌ ${manquantes} voix demandée(s) absente(s) du catalogue.`)
    console.error(`   Chacune rendrait un 404 voice_not_found la nuit de la diffusion.`)
    process.exit(1)
  }
  console.log('\n✅ Toute voix demandée existe dans le catalogue.')
}

main().catch(err => {
  console.error('\n❌ Échec :', err instanceof Error ? err.message : err)
  process.exit(1)
})
