#!/usr/bin/env tsx
/**
 * @module InfinityScheduler/Scripts/Jeton
 * @description Imprime un jeton data-space frais, dérivé de la clé NOSTR.
 *   Le jeton EXPIRE ; la clé non. Sert aux outils en ligne de commande.
 *   Usage : DATASPACE_NOSTR_KEY=… tsx src/scripts/jeton.ts
 */
import 'dotenv/config'
import { readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { deriverJeton } from '../lib/dataspace-jeton'

const CLE_LOCALE = join(homedir(), '.infinity', 'cles', 'biosenger-dataspace.nostr.key')

async function main() {
  const cle = process.env.DATASPACE_NOSTR_KEY
    ?? readFileSync(CLE_LOCALE, 'utf8').trim()
  process.stdout.write(await deriverJeton(cle))
}
main().catch(e => { console.error('ECHEC', e.message); process.exit(1) })
