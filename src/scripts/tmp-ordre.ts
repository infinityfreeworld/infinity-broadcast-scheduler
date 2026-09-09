import 'dotenv/config'
import { SEED_STATIONS } from '../data/seed-stations'
import { getChatterboxVoiceForHost } from '../lib/chatterbox'
import { fetchHostVoiceMappings, exportHostVoiceMappingsToEnv } from '../lib/host-voice-mappings'
async function main() {
  exportHostVoiceMappingsToEnv(await fetchHostVoiceMappings())
  const gpu = SEED_STATIONS.filter(st => st.hosts
    .map(h => getChatterboxVoiceForHost(st.id, h.id, st.language ?? 'fr'))
    .some(v => !!v))
  console.log(`  ${gpu.length} en tête : ${gpu.map(s => s.id).join(', ')}`)
  console.log(`  puis les ${SEED_STATIONS.length - gpu.length} autres, en synthèse locale`)
}
main().catch(e => { console.error('ECHEC', e.message); process.exit(1) })
