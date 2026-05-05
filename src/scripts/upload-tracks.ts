#!/usr/bin/env tsx
/**
 * @module InfinityScheduler/Scripts/UploadTracks
 * @description Upload bulk de fichiers musicaux sur Pinata IPFS et génère
 *   le tableau `tracks: TrackRef[]` à coller dans seed-stations.ts.
 *
 *   Usage :
 *     tsx src/scripts/upload-tracks.ts <stationId> <dossier-musiques>
 *
 *   Exemple :
 *     tsx src/scripts/upload-tracks.ts wtf-radio ./musics/wtf
 *
 *   Le script :
 *     1. Liste les fichiers audio (.mp3 .wav .ogg .flac .m4a) du dossier
 *     2. Les upload un par un sur Pinata via PINATA_JWT
 *     3. Imprime sur stdout le tableau `tracks` formaté en TypeScript,
 *        prêt à coller dans seed-stations.ts pour la station ciblée
 *
 *   Convention nommage : le filename (sans extension) devient le `title`.
 *   Idée : noms parlants comme "01 - artiste - titre.mp3" pour ordre
 *   alphabétique stable.
 */

import 'dotenv/config'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, basename, extname } from 'node:path'
import { pinataPinFile } from '../lib/pinata'

const AUDIO_EXTS = ['.mp3', '.wav', '.ogg', '.flac', '.m4a']

const MIME_BY_EXT: Record<string, string> = {
  '.mp3':  'audio/mpeg',
  '.wav':  'audio/wav',
  '.ogg':  'audio/ogg',
  '.flac': 'audio/flac',
  '.m4a':  'audio/mp4',
}

async function main(): Promise<void> {
  const stationId = process.argv[2]
  const dir = process.argv[3]
  if (!stationId || !dir) {
    console.error('Usage : tsx src/scripts/upload-tracks.ts <stationId> <dossier-musiques>')
    console.error('Exemple : tsx src/scripts/upload-tracks.ts wtf-radio ./musics/wtf')
    process.exit(1)
  }

  const jwt = process.env.PINATA_JWT
  if (!jwt) {
    console.error('❌ Variable d\'env PINATA_JWT manquante (.env)')
    process.exit(1)
  }

  if (!statSync(dir).isDirectory()) {
    console.error(`❌ Pas un dossier : ${dir}`)
    process.exit(1)
  }

  const files = readdirSync(dir)
    .filter(f => AUDIO_EXTS.includes(extname(f).toLowerCase()))
    .sort()

  if (files.length === 0) {
    console.error(`❌ Aucun fichier audio dans ${dir} (extensions cherchées : ${AUDIO_EXTS.join(', ')})`)
    process.exit(1)
  }

  console.log(`\n🎵  Upload de ${files.length} fichier(s) pour station ${stationId}\n`)
  const tracks: { title: string; cid: string; sizeMB: number }[] = []

  for (let i = 0; i < files.length; i++) {
    const file = files[i]
    const path = join(dir, file)
    const data = readFileSync(path)
    const sizeMB = data.byteLength / 1024 / 1024
    const title = basename(file, extname(file))
    const mime = MIME_BY_EXT[extname(file).toLowerCase()] ?? 'audio/octet-stream'

    process.stdout.write(`  [${i + 1}/${files.length}] ${file} (${sizeMB.toFixed(1)} MB) → `)
    try {
      const result = await pinataPinFile(data, file, mime, jwt)
      console.log(result.cid)
      tracks.push({ title, cid: result.cid, sizeMB })
    } catch (err) {
      console.log(`❌ ${err instanceof Error ? err.message : String(err)}`)
    }
  }

  const totalMB = tracks.reduce((s, t) => s + t.sizeMB, 0)
  console.log(`\n✅ ${tracks.length}/${files.length} fichiers uploadés (${totalMB.toFixed(1)} MB total)\n`)

  // Snippet TS prêt à coller
  console.log(`// À coller dans src/data/seed-stations.ts pour la station '${stationId}' :`)
  console.log('    tracks: [')
  for (const t of tracks) {
    const escTitle = JSON.stringify(t.title)
    console.log(`      { title: ${escTitle}, cid: '${t.cid}' },`)
  }
  console.log('    ],')
}

main().catch(err => {
  console.error('\n❌ Échec :', err instanceof Error ? err.message : err)
  process.exit(1)
})
