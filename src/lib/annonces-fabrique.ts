/**
 * @module InfinityScheduler/AnnoncesFabrique
 * @description La FABRICATION des annonces d'animateur (lib/annonces.ts décrit le pourquoi et le
 *   format). Pour chaque annonce prévue : empreinte → cache ; sinon, dans la limite de la nuit,
 *   voix clonée → silences rognés → sonie de l'antenne → Opus mono (WebM) → dépôt data-space.
 *
 *   ── RÈGLES ──
 *   · la voix clonée échoue → l'annonce n'existe pas. JAMAIS de repli Piper ;
 *   · deux échecs de voix d'affilée → on s'arrête pour cette station (service en panne : inutile
 *     d'user la nuit), les annonces déjà en cache restent publiées ;
 *   · au plus `nouvellesMax` nouvelles annonces par nuit et par station : le cache fait le reste,
 *     la liste se complète de nuit en nuit ;
 *   · jamais bloquant : une erreur ici ne fait jamais échouer l'émission.
 *
 *   Les effets (voix, encodage, dépôt) sont INJECTÉS : les tests éprouvent tout sans réseau.
 */

import { decodeWav, encodeWav, readWav, type DecodedWav } from './audio'
import { calerSurLufs, reglagesLoudness } from './loudness'
import {
  DUREE_MAX_ANNONCE_S, DUREE_MIN_ANNONCE_S, MIME_ANNONCE, empreinteAnnonce, planAnnonces,
  type AnnonceAntenne, type CacheAnnonces, type PisteDuDirect, type ReglagesAnnonces,
} from './annonces'

/** Les effets de la fabrication. */
export interface DependancesAnnonces {
  /** Fait dire `texte` à `voix` dans `langue`. Lève en cas d'échec (pas de repli). */
  synthetiser: (texte: string, voix: string, langue: string) => Promise<DecodedWav>
  /** WAV mono → fichier Opus (WebM). */
  encoder:     (wav: DecodedWav) => Promise<Buffer>
  /** Dépose le fichier, rend son CID (relu et vérifié). */
  epingler:    (donnees: Buffer, nomFichier: string, mime: string) => Promise<string>
  /** Horloge (tests). */
  maintenant?: () => number
}

export interface BilanAnnonces {
  annonces:    AnnonceAntenne[]
  prevues:     number
  reutilisees: number
  nouvelles:   number
  echecs:      number
  /** Prévues mais ni en cache ni fabriquées (limite de la nuit, ou voix arrêtée). */
  remises:     number
  dureeMs:     number
  /** Pourquoi on s'est arrêté avant la fin, s'il y a lieu. */
  arret?:      string
}

/**
 * Rogne les silences de tête et de queue : il reste au plus `margeS` (≤ 0,15 s) de chaque côté,
 * avec un fondu de 10 ms contre les clics. Seuil relatif à la crête (−40 dB). Pure.
 */
export function rognerSilences(samples: Float32Array, sampleRate: number, margeS = 0.1, seuilDb = -40): Float32Array {
  let crete = 0
  for (let i = 0; i < samples.length; i++) crete = Math.max(crete, Math.abs(samples[i]))
  if (crete === 0) return samples.slice(0, 0)
  const seuil = crete * Math.pow(10, seuilDb / 20)
  let debut = 0
  while (debut < samples.length && Math.abs(samples[debut]) < seuil) debut++
  let fin = samples.length - 1
  while (fin > debut && Math.abs(samples[fin]) < seuil) fin--
  const marge = Math.round(Math.min(0.15, margeS) * sampleRate)
  const out = samples.slice(Math.max(0, debut - marge), Math.min(samples.length, fin + 1 + marge))
  const fondu = Math.min(Math.round(0.01 * sampleRate), Math.floor(out.length / 2))
  for (let i = 0; i < fondu; i++) {
    const g = i / fondu
    out[i] *= g
    out[out.length - 1 - i] *= g
  }
  return out
}

/** Le son d'une annonce prêt à encoder : rogné, à la sonie de l'antenne. Pure. */
export function preparerSonAnnonce(wav: DecodedWav, sonie = reglagesLoudness()): DecodedWav {
  const rogne = rognerSilences(wav.samples, wav.sampleRate)
  return { samples: rogne.length ? calerSurLufs(rogne, wav.sampleRate, sonie.cible, sonie.crete) : rogne, sampleRate: wav.sampleRate }
}

/**
 * Les annonces d'une station pour cette nuit. `voix` = la voix du premier animateur (`null` :
 * aucune voix possible → aucune annonce). Le cache est MODIFIÉ en place (nouvelles entrées, date
 * de dernière utilisation) ; à l'appelant de l'écrire.
 */
export async function fabriquerAnnonces(opts: {
  station:  { id: string; name: string; language?: string; tagline?: string }
  pistes:   readonly PisteDuDirect[]
  voix:     { id: string; animateur: string } | null
  cache:    CacheAnnonces
  reglages: ReglagesAnnonces
  date:     string
  deps:     DependancesAnnonces
  sonie?:   { cible: number; crete: number }
  journal?: (ligne: string) => void
}): Promise<BilanAnnonces> {
  const maintenant = opts.deps.maintenant ?? Date.now
  const debut = maintenant()
  const dire = opts.journal ?? (() => {})
  const bilan: BilanAnnonces = { annonces: [], prevues: 0, reutilisees: 0, nouvelles: 0, echecs: 0, remises: 0, dureeMs: 0 }
  if (!opts.reglages.actif || !opts.voix) {
    bilan.dureeMs = maintenant() - debut
    return bilan
  }
  const langue = opts.station.language ?? 'fr'
  const sonie = opts.sonie ?? reglagesLoudness()
  const prevues = planAnnonces(opts.station, opts.pistes, opts.reglages.idents)
  bilan.prevues = prevues.length
  let echecsDeSuite = 0
  for (const p of prevues) {
    const empreinte = empreinteAnnonce(p.parle, opts.voix.id, langue, sonie)
    const base = { type: p.type, texte: p.texte, ...(p.piste ? { piste: p.piste } : {}), animateur: opts.voix.animateur, empreinte }
    const enCache = opts.cache[empreinte]
    if (enCache) {
      enCache.vu = opts.date
      bilan.annonces.push({ ...base, cid: enCache.cid, mime: enCache.mime, dureeSec: enCache.dureeSec })
      bilan.reutilisees++
      continue
    }
    if (bilan.arret || bilan.nouvelles >= opts.reglages.nouvellesMax) { bilan.remises++; continue }
    try {
      const son = preparerSonAnnonce(await opts.deps.synthetiser(p.parle, opts.voix.id, langue), sonie)
      const dureeSec = Math.round((son.samples.length / son.sampleRate) * 100) / 100
      if (dureeSec < DUREE_MIN_ANNONCE_S || dureeSec > DUREE_MAX_ANNONCE_S) {
        throw new Error(`durée ${dureeSec} s hors bornes (${DUREE_MIN_ANNONCE_S} à ${DUREE_MAX_ANNONCE_S} s)`)
      }
      const fichier = await opts.deps.encoder(son)
      const cid = await opts.deps.epingler(fichier, `annonce-${opts.station.id}-${empreinte}.webm`, MIME_ANNONCE)
      opts.cache[empreinte] = { cid, dureeSec, mime: MIME_ANNONCE, vu: opts.date }
      bilan.annonces.push({ ...base, cid, mime: MIME_ANNONCE, dureeSec })
      bilan.nouvelles++
      echecsDeSuite = 0
    } catch (err) {
      bilan.echecs++
      bilan.remises++
      dire(`    ⚠ annonce « ${p.texte.slice(0, 60)} » non fabriquée (${(err as Error).message.slice(0, 100)}) — pas de repli`)
      if (++echecsDeSuite >= 2) bilan.arret = 'deux échecs de suite : la voix clonée ne répond pas, on s\'en passe cette nuit'
    }
  }
  bilan.dureeMs = maintenant() - debut
  return bilan
}

/** Ligne de journal du bilan. Pure. */
export function ligneBilanAnnonces(stationId: string, b: BilanAnnonces): string {
  return `    🎙 annonces ${stationId} : ${b.annonces.length}/${b.prevues} prêtes (${b.reutilisees} du cache, ${b.nouvelles} nouvelles`
    + `${b.echecs ? `, ${b.echecs} échec(s)` : ''}${b.remises ? `, ${b.remises} remise(s) aux nuits suivantes` : ''}) en ${(b.dureeMs / 1000).toFixed(1)} s`
    + `${b.arret ? ` — arrêt : ${b.arret}` : ''}`
}

// ── Effets réels ─────────────────────────────────────────────────────────

/**
 * Les effets réels : voix clonée data-space (`language` toujours envoyé ; échéance et réponses
 * 429 / 500 gérées par lib/chatterbox.ts), Kokoro pour une voix `kokoro-zh:*` (voix d'antenne du
 * chinois), Opus 32 kbit/s en WebM, dépôt data-space relu et vérifié.
 */
export async function dependancesReelles(cleDataspace: string): Promise<DependancesAnnonces> {
  const { synthesizeWithChatterbox } = await import('./chatterbox')
  const { estVoixKokoro, synthesizeKokoro } = await import('./kokoro')
  const { encoderEmission } = await import('./opus')
  const { dataspacePinFile } = await import('./dataspace')
  return {
    synthetiser: async (texte, voix, langue) => {
      if (estVoixKokoro(voix)) return readWav(await synthesizeKokoro(texte, voix))
      const buf = await synthesizeWithChatterbox({ voice: voix, text: texte, language: langue, format: 'wav' })
      return decodeWav(buf, 'annonce')
    },
    encoder: wav => encoderEmission(encodeWav(wav), 32),
    epingler: async (donnees, nom, mime) => (await dataspacePinFile(donnees, nom, mime.split(';')[0], cleDataspace)).cid,
  }
}
