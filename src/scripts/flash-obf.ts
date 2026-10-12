#!/usr/bin/env tsx
/**
 * @module InfinityScheduler/Scripts/FlashObf
 * @description ⚡ Le flash spécial OBF (lib/flash-obf.ts explique tout) : lit les alertes OBF graves
 *   récentes, et s'il y en a une NOUVELLE, fabrique un bulletin d'une à deux minutes, le dépose sur
 *   data-space et le publie en événement distinct (kind 30093, `stationId: 'obf-radio-flash'`).
 *
 *   🔴 ÉTEINT PAR DÉFAUT : ne fait RIEN sans `FLASH_OBF=1`.
 *
 *   Usage :
 *     tsx src/scripts/flash-obf.ts                 # vrai passage (si FLASH_OBF=1)
 *     tsx src/scripts/flash-obf.ts --repetition    # lit les relais, fabrique le son, ne publie RIEN
 *     tsx src/scripts/flash-obf.ts --essai         # répétition sur une alerte FICTIVE (aucune lecture)
 *
 *   La voix est Piper (voix locale de l'animatrice de la station) : immédiate et sûre. La voix clonée
 *   demanderait de réveiller le GPU de data-space (15 à 30 min) — incompatible avec « dans l'heure ».
 *
 *   Sortie : 0 (flash publié, rien à annoncer, ou interrupteur éteint) · 1 (échec).
 */
import 'dotenv/config'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { SimplePool } from 'nostr-tools/pool'
import { SEED_STATIONS } from '../data/seed-stations'
import { readWav, encodeWav, durationOf } from '../lib/audio'
import { encadrerDeSilence } from '../lib/musique'
import { normaliserEmission, reglagesLoudness } from '../lib/loudness'
import { encoderEmission, FORMAT_EMISSION } from '../lib/opus'
import { synthesize } from '../lib/piper'
import { voixPourLangue } from '../lib/voix'
import { dataspacePinFile } from '../lib/dataspace'
import { jetonDataspace } from '../lib/dataspace-jeton'
import { getRelays, publierEvenement, pubkeyDe, RADIO_BROADCAST_KIND } from '../lib/nostr'
import { alertesObfRetenues } from '../lib/stations-thema-relais'
import {
  reglagesFlash, alertesPourFlash, flashPermis, texteFlash, contenuFlash, tagsFlash, lireFlashsPrecedents,
  FLASH_DE, STATION_FLASH,
} from '../lib/flash-obf'
import type { AlerteObf } from '../lib/sujets-obf'

async function flashsPrecedents(pubkey: string, maintenant: number): Promise<ReturnType<typeof lireFlashsPrecedents> | null> {
  const relays = getRelays()
  const pool = new SimplePool()
  try {
    const ev = await pool.querySync(relays, { kinds: [RADIO_BROADCAST_KIND], authors: [pubkey], since: Math.floor(maintenant / 1000) - 26 * 3600, limit: 200 }, { maxWait: 10_000 })
    return lireFlashsPrecedents(ev)
  } catch {
    return null
  } finally {
    try { pool.close(relays) } catch { /* rien */ }
  }
}

async function main(): Promise<number> {
  const args = process.argv.slice(2)
  const essai = args.includes('--essai')
  const repetition = essai || args.includes('--repetition')
  const r = reglagesFlash()
  if (!r.actif && !repetition) {
    console.log('⚡ Flash OBF : interrupteur ÉTEINT (FLASH_OBF≠1) — rien à faire.')
    return 0
  }
  const maintenant = Date.now()
  const station = SEED_STATIONS.find(s => s.id === FLASH_DE)
  if (!station) { console.error(`station ${FLASH_DE} introuvable`); return 1 }

  // 1. Les alertes graves, nouvelles, de confiance.
  let choisies: AlerteObf[]
  const cle = process.env.NOSTR_PRIVATE_KEY ?? ''
  if (essai) {
    choisies = [{ cle: 'essai', auteur: 'essai', eventId: 'essai', niveau: 'critical', lieu: 'près de Lyon', le: maintenant - 12 * 60_000, terminee: false }]
    console.log('⚡ ESSAI : alerte fictive (rouge, près de Lyon, il y a 12 min) — rien ne sera publié.')
  } else {
    const precedents = cle ? await flashsPrecedents(pubkeyDe(cle), maintenant) : { instants: [], empreintes: new Set<string>() }
    if (!precedents) {
      // Sans savoir ce qui a déjà été annoncé, on risquerait d'annoncer deux fois : on s'abstient.
      console.log('⚡ Flash OBF : relais illisibles pour nos flashs précédents — on s\'abstient ce tour-ci.')
      return 0
    }
    const permis = flashPermis(precedents.instants, maintenant, r)
    if (!permis.permis) { console.log(`⚡ Flash OBF : pas maintenant — ${permis.raison}.`); return 0 }
    let lecture: Awaited<ReturnType<typeof alertesObfRetenues>>
    try {
      lecture = await alertesObfRetenues(maintenant, Math.ceil(r.fenetreMin / 60) + 2)
    } catch (err) {
      console.log(`⚡ Flash OBF : relais injoignables (${(err as Error).message.slice(0, 100)}) — on s'abstient.`)
      return 0
    }
    choisies = alertesPourFlash(lecture.retenues, maintenant, precedents.empreintes, r)
    console.log(`⚡ Flash OBF : ${lecture.lues} alerte(s) lue(s), ${lecture.lisibles} publique(s), ${lecture.retenues.length} de confiance, ${choisies.length} à annoncer (niveaux ${r.niveaux.join('+')}, ${r.fenetreMin} min).`)
    if (choisies.length === 0) return 0
  }

  // 2. Le texte (gabarit, pas de modèle de langue) et la voix.
  const texte = texteFlash(choisies, maintenant)
  console.log(`    « ${texte.slice(0, 160)}… » (${texte.split(/\s+/).length} mots)`)
  const animateur = station.hosts[0]
  const voix = voixPourLangue('fr', animateur.gender, animateur.id)
  if (!voix) { console.error('aucune voix locale française'); return 1 }
  const wav = readWav(await synthesize(texte, voix))
  const encadre = { samples: encadrerDeSilence(wav.samples, wav.sampleRate, 0.4, 0.8), sampleRate: wav.sampleRate }
  const { cible, crete } = reglagesLoudness()
  const sonie = normaliserEmission(encadre.samples, encadre.sampleRate, cible, crete)
  const durationSec = durationOf(encadre)
  console.log(`    🎙 ${animateur.name} (${voix}) · ${durationSec.toFixed(0)} s · ${sonie.apresLufs.toFixed(1)} LUFS`)
  const wavBuf = encodeWav(encadre)
  const opus = await encoderEmission(wavBuf, 32)

  if (repetition) {
    const dossier = process.env.REPETITION_DIR ?? tmpdir()
    mkdirSync(dossier, { recursive: true })
    const f = join(dossier, `flash-obf-${new Date(maintenant).toISOString().slice(0, 16).replace(':', 'h')}.${FORMAT_EMISSION.extension}`)
    writeFileSync(f, opus)
    console.log(`\n🎧 RÉPÉTITION — rien n'a été déposé ni publié. Fichier : ${f}`)
    return 0
  }
  if (!cle) { console.error('NOSTR_PRIVATE_KEY manquante'); return 1 }

  // 3. Dépôt data-space, puis événement distinct.
  const jeton = await jetonDataspace()
  const dep = await dataspacePinFile(opus, `${STATION_FLASH}-${maintenant}.${FORMAT_EMISSION.extension}`, FORMAT_EMISSION.mime, jeton)
  const pub = await publierEvenement({
    kind: RADIO_BROADCAST_KIND,
    created_at: Math.floor(maintenant / 1000),
    tags: tagsFlash(maintenant, process.env.PRODUCTEUR || 'github-flash'),
    content: contenuFlash({ maintenant, texte, durationSec, audioCid: dep.cid, audioMime: FORMAT_EMISSION.mime, animateur, alertes: choisies }),
  }, cle)
  console.log(`✅ Flash OBF publié (${pub.eventId.slice(0, 12)}…, ${pub.relays.filter(x => x.ok).length}/${pub.relays.length} relais), CID ${dep.cid}`)
  return 0
}

main().then(code => process.exit(code), err => { console.error(err); process.exit(1) })
