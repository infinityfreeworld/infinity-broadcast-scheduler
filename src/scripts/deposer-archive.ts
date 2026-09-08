#!/usr/bin/env tsx
/**
 * @module InfinityScheduler/Scripts/DeposerArchive
 * @description Dépose une archive git chez data-space, avec relecture.
 *
 *   🔴 Une sauvegarde non restaurée n'est pas une sauvegarde. Un paquet
 *   git fabriqué depuis un clone SUPERFICIEL a l'air parfaitement sain et
 *   ne contient rien — l'empreinte correspond au manifeste, et le clone
 *   échoue. C'est pourquoi l'appelant doit avoir cloné le paquet AVANT.
 *
 *   Le dépôt lui-même relit ses octets (`dataspacePinFile`, vérification
 *   par défaut) : un CID qui sert autre chose est refusé.
 */
import 'dotenv/config'
import { readFileSync } from 'node:fs'
import { basename } from 'node:path'
import { dataspacePinFile } from '../lib/dataspace'
import { jetonDataspace } from '../lib/dataspace-jeton'

async function main() {
  const chemin = process.argv[2]
  if (!chemin) { console.error('Usage : tsx src/scripts/deposer-archive.ts <fichier>'); process.exit(1) }
  const cle = await jetonDataspace()
  if (!cle) throw new Error('jeton data-space indisponible')
  const octets = readFileSync(chemin)
  const r = await dataspacePinFile(octets, basename(chemin), 'application/octet-stream', cle)
  console.log(`  ✅ déposé et relu — ${(r.size / 1024).toFixed(0)} Ko`)
  console.log(`     ${r.cid}`)
  console.log(`     https://data-space.world/api/ipfs/${r.cid}`)
}
main().catch(e => { console.error('  🔴', e.message.slice(0, 200)); process.exit(1) })
