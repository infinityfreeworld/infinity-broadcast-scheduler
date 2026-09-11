#!/usr/bin/env tsx
/**
 * @module InfinityScheduler/Scripts/ReemballerWebm
 * @description Republie la DERNIÈRE émission de chaque station en WebM.
 *
 *   Toutes les émissions publiées jusqu'au 11/09/2026 sont en Ogg/Opus, un
 *   format que WebKit — Safari et l'app macOS — refuse (« Decoding failed »).
 *   La nuit suivante produira du WebM ; ce script rend audible ce qui est
 *   déjà à l'antenne, sans attendre.
 *
 *   Pour chaque station : télécharge l'Ogg, change l'emballage sans
 *   réencoder, dépose le WebM sur data-space (relu et vérifié), puis
 *   republie l'événement kind:30093 — même d-tag, même contenu, seuls
 *   `audioCid`, `audioMime` et `generatedAt` changent. Un événement qui ne se
 *   reconstruirait pas à l'identique est laissé tel quel, et signalé.
 *
 *   Lecture : data-space d'abord ; Pinata et ipfs.io seulement en repli,
 *   pour les émissions anciennes qui n'existent que là. Le DÉPÔT, lui, se
 *   fait uniquement sur data-space.
 *
 *   Usage :
 *     npx tsx src/scripts/reemballer-webm.ts --essai [--garder <dossier>]
 *     npx tsx src/scripts/reemballer-webm.ts --station pirate-radio
 *     npx tsx src/scripts/reemballer-webm.ts
 *
 *   --essai   télécharge et réemballe, mais ne dépose et ne publie RIEN
 *   --garder  écrit les WebM produits dans ce dossier (pour les écouter)
 *   --sauf    stations à laisser de côté, séparées par des virgules
 *
 *   `generatedAt` est TOUJOURS avancé : l'application départage deux
 *   versions d'une émission sur ce champ, et à valeur égale garde la
 *   première reçue — souvent l'ancienne, en Ogg. Une émission déjà
 *   republiée avec son horodatage d'origine est rehorodatée sans rien
 *   redéposer (voir horodatageDeRepublication, lib/reemballage).
 *
 *   Code de sortie : 1 si au moins une station a échoué.
 */

import 'dotenv/config'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { SimplePool } from 'nostr-tools/pool'
import { getPublicKey } from 'nostr-tools/pure'
import { hexToBytes } from '@noble/hashes/utils'
import { getRelays, RADIO_BROADCAST_KIND, publishBroadcast } from '../lib/nostr'
import { oggOpusVersWebm, estWebm, FORMAT_EMISSION } from '../lib/opus'
import { dataspacePinFile } from '../lib/dataspace'
import { jetonDataspace } from '../lib/dataspace-jeton'
import {
  choisirDernieres, pourquoiNonReconstructible, aReemballer, aRehorodater, horodatageDeRepublication,
  type EvenementNostr,
} from '../lib/reemballage'
import type { RadioBroadcast } from '../lib/types'

const SOURCES = [
  'https://data-space.world/ipfs/',
  'https://gateway.pinata.cloud/ipfs/',
  'https://ipfs.io/ipfs/',
]

function option(nom: string): string | undefined {
  const i = process.argv.indexOf(nom)
  return i > 0 ? process.argv[i + 1] : undefined
}
const ESSAI = process.argv.includes('--essai')
const SEULE = option('--station')
const GARDER = option('--garder')
const SAUF = new Set((option('--sauf') ?? '').split(',').map(s => s.trim()).filter(Boolean))

async function telecharger(cid: string): Promise<{ octets: Buffer; source: string }> {
  const causes: string[] = []
  for (const passerelle of SOURCES) {
    const hote = new URL(passerelle).host
    try {
      const r = await fetch(passerelle + cid, { signal: AbortSignal.timeout(180_000) })
      if (!r.ok) { causes.push(`${hote} HTTP ${r.status}`); continue }
      const octets = Buffer.from(await r.arrayBuffer())
      if (octets.subarray(0, 4).toString('latin1') !== 'OggS') {
        causes.push(`${hote} : ${octets.length} octets qui ne sont pas de l'Ogg`)
        continue
      }
      return { octets, source: hote }
    } catch (err) {
      causes.push(`${hote} ${(err as Error).message}`)
    }
  }
  throw new Error(`introuvable — ${causes.join(' | ')}`)
}

async function main(): Promise<number> {
  const priv = process.env.NOSTR_PRIVATE_KEY
  if (!priv) throw new Error('NOSTR_PRIVATE_KEY absente du .env')
  const nous = getPublicKey(hexToBytes(priv))

  const relais = getRelays()
  const pool = new SimplePool()
  const evenements = await pool.querySync(
    relais, { kinds: [RADIO_BROADCAST_KIND], authors: [nous], limit: 1000 }, { maxWait: 15_000 },
  ) as EvenementNostr[]
  pool.close(relais)

  const dernieres = [...choisirDernieres(evenements, nous)].sort(([a], [b]) => a.localeCompare(b))
  console.log(`${evenements.length} événements de ${nous.slice(0, 8)}… · ${dernieres.length} stations`
    + (ESSAI ? ' · ESSAI : rien ne sera déposé ni publié' : ''))

  let jeton = ''
  if (!ESSAI) {
    jeton = await jetonDataspace()
    if (!jeton) throw new Error('Aucun jeton data-space (DATASPACE_NOSTR_KEY ou DATASPACE_API_KEY)')
  }
  if (GARDER) mkdirSync(GARDER, { recursive: true })

  let echecs = 0
  for (const [station, e] of dernieres) {
    if (SEULE && station !== SEULE) continue
    if (SAUF.has(station)) { console.log(`  · ${station.padEnd(18)} laissée de côté (--sauf)`); continue }
    const c = JSON.parse(e.content) as Record<string, unknown> & { date: string; audioCid: string }
    const etiquette = `${station.padEnd(18)} ${c.date}`

    const rehorodater = !aReemballer(c) && aRehorodater(e)
    if (!aReemballer(c) && !rehorodater) { console.log(`  = ${etiquette}  déjà en ${FORMAT_EMISSION.mime}`); continue }
    const raison = pourquoiNonReconstructible(e)
    if (raison) { console.log(`  ⚠ ${etiquette}  LAISSÉE telle quelle : ${raison}`); echecs++; continue }
    const generatedAt = horodatageDeRepublication(c.generatedAt, Math.floor(Date.now() / 1000))

    if (rehorodater) {
      if (ESSAI) { console.log(`  ✓ ${etiquette}  à rehorodater : generatedAt ${c.generatedAt} → ${generatedAt}`); continue }
      try {
        const pub = await publishBroadcast({ ...c, generatedAt, generatedBy: '' } as unknown as RadioBroadcast, priv)
        const notreRelais = pub.relays.find(r => r.url.includes('infinity-radio-relay'))
        if (!notreRelais?.ok) throw new Error(`notre relais a refusé : ${notreRelais?.reason ?? 'absent'}`)
        console.log(`  ⏱ ${etiquette}  rehorodatée (${c.generatedAt} → ${generatedAt}) · ${pub.relays.filter(r => r.ok).length}/${pub.relays.length} relais`)
      } catch (err) {
        echecs++
        console.log(`  🔴 ${etiquette}  ${(err as Error).message.slice(0, 220)}`)
      }
      continue
    }

    try {
      const { octets, source } = await telecharger(c.audioCid)
      const webm = await oggOpusVersWebm(octets)
      if (!estWebm(webm)) throw new Error('le réemballage n\'a pas rendu du WebM')
      const nom = `broadcast-${station}-${c.date}.${FORMAT_EMISSION.extension}`
      if (GARDER) writeFileSync(join(GARDER, nom), webm)
      const tailles = `${(octets.length / 1048576).toFixed(1)} Mo Ogg (${source}) → ${(webm.length / 1048576).toFixed(1)} Mo WebM`
      if (ESSAI) { console.log(`  ✓ ${etiquette}  ${tailles}`); continue }

      const dep = await dataspacePinFile(webm, nom, FORMAT_EMISSION.mime, jeton)
      const emission = { ...c, audioCid: dep.cid, audioMime: FORMAT_EMISSION.mime, generatedAt, generatedBy: '' } as unknown as RadioBroadcast
      const pub = await publishBroadcast(emission, priv)
      const ok = pub.relays.filter(r => r.ok).length
      const notreRelais = pub.relays.find(r => r.url.includes('infinity-radio-relay'))
      if (!notreRelais?.ok) throw new Error(`notre relais a refusé : ${notreRelais?.reason ?? 'absent'}`)
      console.log(`  ✅ ${etiquette}  ${tailles} · CID ${dep.cid} · ${ok}/${pub.relays.length} relais`)
    } catch (err) {
      echecs++
      console.log(`  🔴 ${etiquette}  ${(err as Error).message.slice(0, 220)}`)
    }
  }
  console.log(echecs ? `\n${echecs} station(s) en échec.` : '\nTerminé sans échec.')
  return echecs ? 1 : 0
}

main()
  .then(code => process.exit(code))
  .catch(err => { console.error(`🔴 ${(err as Error).message}`); process.exit(1) })
