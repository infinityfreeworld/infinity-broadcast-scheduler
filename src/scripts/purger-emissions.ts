#!/usr/bin/env tsx
/**
 * @module InfinityScheduler/Scripts/PurgerEmissions
 * @description Fait disparaître les émissions de plus de N jours du dépôt
 *   data-space. Décision du Bâtisseur (07/09/2026) : **10 jours, puis
 *   elles libèrent la place.**
 *
 *   🔴 Ne supprime QUE ce qu'il reconnaît comme émission. Le même dépôt
 *   contient les 29 voix de référence et les 9 modèles Piper, qui sont
 *   PERMANENTS — une purge par âge seul les emporterait au bout de dix
 *   jours, et les originaux ne se retrouvent pas. Voir `lib/retention.ts`.
 *
 *   Usage :
 *     tsx src/scripts/purger-emissions.ts            # à blanc
 *     tsx src/scripts/purger-emissions.ts --executer
 *     RETENTION_JOURS=30 tsx src/scripts/purger-emissions.ts
 */
import 'dotenv/config'
import { readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { deriverJeton } from '../lib/dataspace-jeton'
import { trier, type FichierDepot } from '../lib/retention'

const BASE = 'https://data-space.world'
const CLE_LOCALE = join(homedir(), '.infinity', 'cles', 'biosenger-dataspace.nostr.key')

async function jeton(): Promise<string> {
  const direct = process.env.DATASPACE_API_KEY
  if (direct) return direct
  const cle = process.env.DATASPACE_NOSTR_KEY ?? readFileSync(CLE_LOCALE, 'utf8').trim()
  return deriverJeton(cle)
}

async function lister(t: string): Promise<FichierDepot[]> {
  const r = await fetch(`${BASE}/api/v1/files`, {
    headers: { Authorization: `Bearer ${t}` }, signal: AbortSignal.timeout(90_000),
  })
  if (!r.ok) throw new Error(`liste HTTP ${r.status}`)
  const j = await r.json() as { files?: FichierDepot[] }
  if (!Array.isArray(j.files)) throw new Error('réponse sans liste de fichiers')
  return j.files
}

/** Convention IPFS Pinning Service — vérifiée en ligne le 07/09/2026 (202). */
async function depingler(t: string, cid: string): Promise<void> {
  const r = await fetch(`${BASE}/api/pinning/pins/${cid}`, {
    method: 'DELETE', headers: { Authorization: `Bearer ${t}` }, signal: AbortSignal.timeout(60_000),
  })
  if (r.status !== 202 && r.status !== 200 && r.status !== 204) {
    throw new Error(`dépinglage HTTP ${r.status}`)
  }
}

async function main() {
  const executer = process.argv.includes('--executer')
  const jours = Number.parseInt(process.env.RETENTION_JOURS ?? '10', 10)
  const t = await jeton()
  const avant = await lister(t)
  const v = trier(avant, jours)

  console.log(`\n${avant.length} fichier(s) au dépôt · rétention ${jours} jours\n`)
  console.log(`  à supprimer  : ${v.aSupprimer.length}`)
  console.log(`  gardés       : ${v.gardes.length}`)
  if (v.indecidables.length) {
    console.log(`  ⚠️ indécidables (horodatage illisible, GARDÉS) : ${v.indecidables.length}`)
    for (const f of v.indecidables) console.log(`      ${f.name}`)
  }
  for (const f of v.aSupprimer) {
    console.log(`   − ${f.name.padEnd(46)} ${(f.size/1048576).toFixed(1)} Mo`)
  }

  if (!executer) { console.log('\n· Mode à blanc. Relancer avec --executer.'); return }
  if (v.aSupprimer.length === 0) { console.log('\nRien à faire.'); return }

  let ok = 0
  const echecs: string[] = []
  for (const f of v.aSupprimer) {
    try { await depingler(t, f.cid); ok++ }
    catch (e) { echecs.push(`${f.name} — ${(e as Error).message}`) }
  }

  // 🔴 Un 202 n'est pas une preuve. On RELIT la liste : c'est la seule
  // chose qui distingue « accepté » de « fait ».
  const apres = await lister(t)
  const restants = new Set(apres.map(f => f.cid))
  const survivants = v.aSupprimer.filter(f => restants.has(f.cid))
  console.log(`\n${ok} dépinglage(s) acceptés · ${echecs.length} échec(s)`)
  for (const e of echecs) console.log(`   ✗ ${e}`)
  if (survivants.length > 0) {
    console.error(`\n🔴 ${survivants.length} fichier(s) TOUJOURS PRÉSENTS après un 202 :`)
    for (const f of survivants) console.error(`   ${f.name}`)
    process.exit(1)
  }
  const libere = v.aSupprimer.reduce((a, f) => a + f.size, 0)
  console.log(`✅ vérifié par relecture — ${(libere/1048576).toFixed(0)} Mo libérés`)
}
main().catch(e => { console.error('\nÉCHEC :', e.message); process.exit(1) })
