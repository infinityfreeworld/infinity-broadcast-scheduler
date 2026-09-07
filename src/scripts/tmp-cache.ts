import 'dotenv/config'
import { deriverJeton } from '../lib/dataspace-jeton'
import { readFileSync, writeFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
// LA phrase de référence — celle qui rendait l'ancien fichier anglophone.
const TXT = "Bonjour, ici la radio Infinity. Bienvenue à l'antenne."
async function main() {
  const D = process.argv[2]
  const j = await deriverJeton(readFileSync(process.env.HOME+'/.infinity/cles/biosenger-dataspace.nostr.key','utf8').trim())

  console.log('═══ 1. le moteur est-il exposé ? ═══')
  const st = await (await fetch('https://data-space.world/api/v1/gpu/voix',
    { headers:{Authorization:`Bearer ${j}`} })).json() as Record<string, unknown>
  console.log(`  engine = ${st.engine ?? '🔴 CHAMP ABSENT'}`)
  console.log(`  ready = ${st.ready} · ${(st.voices as unknown[]??[]).length} voix`)

  console.log('\n═══ 2. usage : le champ sansTaille apparaît-il ? ═══')
  const fl = await (await fetch('https://data-space.world/api/v1/files',
    { headers:{Authorization:`Bearer ${j}`} })).json() as Record<string, any>
  console.log(`  usage = ${JSON.stringify(fl.usage)}`)
  const sansTaille = (fl.files ?? []).filter((f: any) => !f.size)
  console.log(`  entrées sans taille, comptées par nous : ${sansTaille.length}`)
  for (const f of sansTaille.slice(0,4)) console.log(`     ${f.name} (size=${JSON.stringify(f.size)})`)

  console.log('\n═══ 3. LA question : la phrase de référence a-t-elle changé ? ═══')
  const ancien = readFileSync(`${D}/H2 - cfg_weight 0.50.wav`)
  const hAncien = createHash('sha256').update(ancien).digest('hex')
  const t0 = Date.now(); let buf: Buffer|null = null; let tours = 0
  for (let i=0;i<100;i++) {
    const r = await fetch('https://data-space.world/api/v1/gpu/voix', { method:'POST',
      headers:{Authorization:`Bearer ${j}`,'content-type':'application/json'},
      body: JSON.stringify({ input: TXT, voice:'ranouna.wav', response_format:'wav',
        language:'fr', language_id:'fr', cfg_weight:0.50, emotion_exaggeration:0.5, temperature:0.7 }) })
    if (r.status===429) { tours++; await new Promise(x=>setTimeout(x,(Number(r.headers.get('retry-after'))||30)*1000)); continue }
    if (!r.ok) { console.log(`  🔴 HTTP ${r.status}`); return }
    buf = Buffer.from(await r.arrayBuffer()); break
  }
  if (!buf) { console.log('  abandon'); return }
  const hNeuf = createHash('sha256').update(buf).digest('hex')
  writeFileSync(`${D}/N - phrase de reference APRES correctif cache.wav`, buf)
  console.log(`  délai : ${((Date.now()-t0)/1000).toFixed(0)}s (${tours} relances)`)
  console.log(`  ancien : ${ancien.length} o · ${hAncien.slice(0,16)}`)
  console.log(`  neuf   : ${buf.length} o · ${hNeuf.slice(0,16)}`)
  console.log(`  ${hAncien !== hNeuf ? '✅ DIFFÉRENT — le cache est bien corrigé' : '🔴 IDENTIQUE — le cache rend encore l\'ancien'}`)
}
main().catch(e => { console.error('ECHEC', e.message.slice(0,200)); process.exit(1) })
