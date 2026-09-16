/**
 * @module InfinityScheduler/Lib/Jingles
 * @description Les jingles des stations, insérés dans les émissions.
 *
 *   Demande du fondateur (16/09/2026) : les jingles vivent sur data-space ; il
 *   colle leur CID dans l'IHL (fiche de la station, « 📯 Jingles », kind 30091),
 *   et l'émission les place « au bon endroit ».
 *
 *   ── OÙ ──
 *   Un jingle : au DÉBUT et à la FIN. Deux ou plus : un troisième passage au
 *   MILIEU, entre deux répliques (jamais au milieu d'une phrase). Les jingles
 *   tournent dans l'ordre de la liste : 1er au début, 2e au milieu, 3e à la fin
 *   (ou le 1er, s'il n'y en a que deux).
 *
 *   ── CE QUI NE DOIT PAS CASSER ──
 *   Le transcript horodaté (`turns`) était aligné sur l'audio PAR L'INDICE.
 *   Un jingle glissé dans la file décalait tous les tours suivants : le texte
 *   affiché n'aurait plus correspondu à la voix. Le montage produit donc la
 *   correspondance EXPLICITE tour → entrée, et les jingles sont publiés à part
 *   (`segments`), que les anciennes versions de l'application ignorent.
 *
 *   ── SI ÇA RATE ──
 *   Un jingle introuvable ou illisible est SAUTÉ, avec un avertissement :
 *   l'émission part quand même. Un habillage manquant ne vaut pas une antenne
 *   muette.
 */
import { SimplePool } from 'nostr-tools/pool'
import { execFile } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { getRelays } from './nostr'
import { resoudreParAuteur } from './host-voice-mappings'
import type { ConcatEntry, DecodedWav } from './audio'
import type { TrackRef } from './types'

export const KIND_STATION = 30091
const ENV_KEY = 'RADIO_JINGLES_JSON'
const LIMITE_REQUETE = 500
/** Un jingle est court : au-delà, c'est une erreur de CID (un morceau entier). */
export const DUREE_MAX_JINGLE_S = 30

export interface SegmentJingle {
  type:   'jingle'
  cid?:   string
  url?:   string
  title?: string
  tStart: number
  tEnd:   number
}

function adminPubkeys(): Set<string> | null {
  const raw = process.env.RADIO_ADMIN_PUBKEYS
  if (!raw) return null
  const set = new Set(raw.split(',').map(s => s.trim().toLowerCase()).filter(Boolean))
  return set.size > 0 ? set : null
}

const CID = /^(Qm[1-9A-HJ-NP-Za-km-z]{44}|b[a-z2-7]{20,})$/

/** Jingles lisibles d'une fiche de station (contenu JSON du kind 30091). */
export function jinglesDeLaFiche(contenu: string): TrackRef[] {
  try {
    const o = JSON.parse(contenu) as { jingles?: unknown }
    if (!Array.isArray(o.jingles)) return []
    const sortie: TrackRef[] = []
    for (const j of o.jingles) {
      if (!j || typeof j !== 'object') continue
      const r = j as Record<string, unknown>
      const cid = typeof r.cid === 'string' ? r.cid.trim() : undefined
      const url = typeof r.url === 'string' && /^https:\/\//.test(r.url) ? r.url : undefined
      if (!(cid && CID.test(cid)) && !url) continue
      sortie.push({
        title: typeof r.title === 'string' ? r.title : 'Jingle',
        ...(cid && CID.test(cid) ? { cid } : {}),
        ...(url ? { url } : {}),
      })
    }
    return sortie
  } catch {
    return []
  }
}

/** Lit les fiches 30091 publiées par l'IHL : stationId → jingles. */
export async function fetchStationJingles(timeoutMs = 8000): Promise<Record<string, TrackRef[]>> {
  const relays = getRelays()
  const pool = new SimplePool()
  try {
    const events = await pool.querySync(relays, { kinds: [KIND_STATION], limit: LIMITE_REQUETE }, { maxWait: timeoutMs })
    const retenus = resoudreParAuteur(events, adminPubkeys(), process.env.NOSTR_PUBLIC_KEY?.toLowerCase() ?? '')
    const sortie: Record<string, TrackRef[]> = {}
    for (const [stationId, e] of retenus) {
      const j = jinglesDeLaFiche(e.content)
      if (j.length > 0) sortie[stationId] = j
    }
    return sortie
  } catch (err) {
    console.warn('[jingles] lecture échouée :', err instanceof Error ? err.message : err)
    return {}
  } finally {
    pool.close(relays)
  }
}

export function exportJinglesToEnv(j: Record<string, TrackRef[]>): void {
  process.env[ENV_KEY] = JSON.stringify(j)
}

export function jinglesDepuisEnv(stationId: string): TrackRef[] {
  const brut = process.env[ENV_KEY]
  if (!brut) return []
  try {
    const o = JSON.parse(brut) as Record<string, unknown>
    const l = o[stationId]
    return Array.isArray(l) ? (l as TrackRef[]) : []
  } catch {
    return []
  }
}

export function sourceDuJingle(j: TrackRef): string | null {
  if (j.cid) return `https://data-space.world/api/ipfs/${j.cid}`
  return j.url ?? null
}

/** Télécharge un jingle et le convertit en WAV PCM 16 bits MONO au taux des voix. */
export async function chargerJingle(
  j: TrackRef,
  tauxCible: number,
  decoder: (chemin: string) => DecodedWav,
  telecharger: (url: string) => Promise<Uint8Array> = telechargerHttp,
): Promise<DecodedWav | null> {
  const url = sourceDuJingle(j)
  if (!url) return null
  const dossier = mkdtempSync(join(tmpdir(), 'jingle-'))
  try {
    const brut = join(dossier, 'source')
    writeFileSync(brut, await telecharger(url))
    const wav = join(dossier, 'jingle.wav')
    await ffmpeg(['-y', '-loglevel', 'error', '-i', brut,
      '-t', String(DUREE_MAX_JINGLE_S), '-ac', '1', '-ar', String(tauxCible), '-sample_fmt', 's16', wav])
    const d = decoder(wav)
    if (d.samples.length === 0) return null
    return d
  } catch (err) {
    console.warn(`  ⚠ jingle « ${j.title ?? j.cid ?? j.url} » sauté : ${(err as Error).message.slice(0, 140)}`)
    return null
  } finally {
    rmSync(dossier, { recursive: true, force: true })
  }
}

async function telechargerHttp(url: string): Promise<Uint8Array> {
  const r = await fetch(url, { signal: AbortSignal.timeout(30_000) })
  if (!r.ok) throw new Error(`HTTP ${r.status}`)
  const b = new Uint8Array(await r.arrayBuffer())
  if (b.byteLength < 1000) throw new Error(`fichier trop petit (${b.byteLength} o)`)
  return b
}

function ffmpeg(args: string[]): Promise<void> {
  return new Promise((ok, ko) => {
    execFile('ffmpeg', args, (err, _o, stderr) => err ? ko(new Error(`ffmpeg : ${String(stderr).slice(0, 200) || err.message}`)) : ok())
  })
}

/** Où placer les jingles : indices dans la file des RÉPLIQUES (0 = avant la 1re). */
export function planJingles(nbJingles: number, nbTours: number): Array<{ avantTour: number; jingle: number }> {
  if (nbJingles <= 0 || nbTours <= 0) return []
  const plan = [{ avantTour: 0, jingle: 0 }]
  if (nbJingles >= 2 && nbTours >= 2) plan.push({ avantTour: Math.round(nbTours / 2), jingle: 1 })
  plan.push({ avantTour: nbTours, jingle: nbJingles >= 3 ? 2 : 0 })
  return plan
}

export interface Montage {
  entrees:   ConcatEntry[]
  /** entrees[indexTour[i]] est la réplique i. */
  indexTour: number[]
  /** entrees[j] → le jingle placé là, pour les `segments`. */
  jingleEn:  Map<number, TrackRef>
}

/** Intercale les jingles CHARGÉS entre les répliques, sans perdre l'alignement. */
export function monter(
  voix: ConcatEntry[],
  jingles: TrackRef[],
  audios: Array<DecodedWav | null>,
): Montage {
  const plan = planJingles(jingles.length, voix.length)
    .filter(p => audios[p.jingle])
  const entrees: ConcatEntry[] = []
  const indexTour: number[] = []
  const jingleEn = new Map<number, TrackRef>()
  const poser = (avant: number) => {
    for (const p of plan) {
      if (p.avantTour !== avant) continue
      jingleEn.set(entrees.length, jingles[p.jingle])
      entrees.push({ wav: audios[p.jingle]! })
    }
  }
  for (let i = 0; i < voix.length; i++) {
    poser(i)
    indexTour.push(entrees.length)
    entrees.push(voix[i])
  }
  poser(voix.length)
  return { entrees, indexTour, jingleEn }
}

/** Segments à publier, une fois `concatWavs` passé sur `montage.entrees`. */
export function segmentsDuMontage(m: Montage): SegmentJingle[] {
  const out: SegmentJingle[] = []
  for (const [j, ref] of [...m.jingleEn.entries()].sort((a, b) => a[0] - b[0])) {
    const e = m.entrees[j]
    out.push({
      type: 'jingle',
      ...(ref.cid ? { cid: ref.cid } : {}),
      ...(ref.url ? { url: ref.url } : {}),
      ...(ref.title ? { title: ref.title } : {}),
      tStart: e.tStart ?? 0,
      tEnd:   e.tEnd ?? 0,
    })
  }
  return out
}

/** Débit Opus : la voix tient en 32 kb/s, la musique d'un jingle non. */
export function debitEmission(avecJingles: boolean): number {
  return avecJingles ? 64 : 32
}
