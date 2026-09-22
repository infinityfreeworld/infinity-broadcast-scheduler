#!/usr/bin/env tsx
/**
 * Épingle chez data-space les musiques et jingles des stations — sur demande.
 *
 * ── POURQUOI ──
 * Les 10 pistes par défaut (mai 2026) venaient d'un pin Pinata. Pinata est abandonné depuis
 * le 09/09/2026 ; le 22/09, data-space les SERVAIT encore (cache), mais aucun compte ne les
 * épinglait : elles pouvaient disparaître sans prévenir. Une musique cuite dans l'émission
 * doit être à nous. Ce script épingle tout ce que les stations déclarent (seed + IHL 30091)
 * sur le compte du générateur, sous un nom lisible `radio/<station>/<titre>`.
 *
 * Usage :  npx tsx src/scripts/epingler-pistes.ts [--executer] [--station <id>]
 * Sans `--executer` : inventaire seulement. Clé : DATASPACE_NOSTR_KEY (ou DATASPACE_API_KEY).
 */

import 'dotenv/config'
import { SEED_STATIONS } from '../data/seed-stations'
import { jetonDataspace } from '../lib/dataspace-jeton'
import { stationSelonIHL } from '../lib/station-reglages'
import type { TrackRef } from '../lib/types'

const URL_PIN = 'https://data-space.world/api/v1/pin'
const PASSERELLE = 'https://data-space.world/api/ipfs'

interface Cible { cid: string; nom: string; stations: string[] }

async function epingler(c: Cible, cle: string): Promise<string> {
  const corps = JSON.stringify({ cid: c.cid, name: c.nom })
  const appel = () => fetch(URL_PIN, {
    method: 'POST',
    headers: { Authorization: `Bearer ${cle}`, 'Content-Type': 'application/json' },
    body: corps,
    signal: AbortSignal.timeout(60_000),
  })
  let r = await appel()
  if (r.status === 400) {
    // « Taille indéterminable » : la passerelle ne l'a pas encore vu — on le fait venir, puis on réessaie.
    const lecture = await fetch(`${PASSERELLE}/${c.cid}`, { headers: { Range: 'bytes=0-0' }, signal: AbortSignal.timeout(120_000) })
    await lecture.arrayBuffer()
    r = await appel()
  }
  const texte = await r.text()
  if (!r.ok) throw new Error(`HTTP ${r.status} ${texte.slice(0, 160)}`)
  const j = JSON.parse(texte) as { entry?: { size?: number } }
  return `${((j.entry?.size ?? 0) / 1e6).toFixed(1)} Mo`
}

async function main() {
  const executer = process.argv.includes('--executer')
  const iStation = process.argv.indexOf('--station')
  const seule = iStation > 0 ? process.argv[iStation + 1] : null
  const cibles = new Map<string, Cible>()
  for (const seed of SEED_STATIONS) {
    if (seule && seed.id !== seule) continue
    const station = await stationSelonIHL(seed)
    const pistes: Array<[TrackRef, string]> = [
      ...(station.tracks ?? []).map(t => [t, 'musique'] as [TrackRef, string]),
      ...(station.jingles ?? []).map(t => [t, 'jingle'] as [TrackRef, string]),
    ]
    for (const [t, genre] of pistes) {
      if (!t.cid) continue
      const c = cibles.get(t.cid) ?? { cid: t.cid, nom: `radio/${genre}/${t.title}`.slice(0, 200), stations: [] }
      c.stations.push(station.id)
      cibles.set(t.cid, c)
    }
  }
  console.log(`${cibles.size} CID unique(s) à épingler${executer ? '' : ' (inventaire seulement — ajouter --executer)'}`)
  for (const c of cibles.values()) console.log(`  · ${c.cid.slice(0, 20)}… ${c.nom} ← ${c.stations.length} station(s)`)
  if (!executer) return
  const cle = await jetonDataspace()
  if (!cle) throw new Error('DATASPACE_NOSTR_KEY (ou DATASPACE_API_KEY) manquante')
  let ok = 0, ko = 0
  for (const c of cibles.values()) {
    try {
      const taille = await epingler(c, cle)
      ok++; console.log(`  ✓ ${c.cid.slice(0, 20)}… ${taille}`)
    } catch (err) {
      ko++; console.warn(`  ✗ ${c.cid.slice(0, 20)}… ${(err as Error).message}`)
    }
  }
  console.log(`\n${ok} épinglée(s), ${ko} échec(s)`)
  if (ko > 0) process.exitCode = 1
}

main().catch(err => { console.error(err); process.exit(1) })
