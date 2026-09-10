/**
 * @module InfinityScheduler/TV/Voice
 * @description Donne sa VOIX au JT : la narration écrite par le conducteur est
 *   synthétisée (Piper, CPU), puis assemblée en UNE piste calée sur les plans.
 *
 *   Pourquoi ce module existe : le générateur TV produisait déjà une
 *   `narration` par segment — que rien ne lisait. Le programme partait donc
 *   muet à l'antenne, alors que le montage (`WAF /api/v1/render`) accepte une
 *   piste audio depuis le premier jour.
 *
 *   ⚠️ LE POINT QUI COMPTE : c'est la VOIX qui commande la durée du plan, pas
 *   l'inverse. Le LLM propose une durée à l'aveugle (« 8 s ») sans savoir
 *   combien de temps sa phrase prend à dire. Si on garde sa proposition, le
 *   montage tronque ou étire la vidéo pour coller à l'audio
 *   (cf. composeEngine : « vidéo tronquée/paddée à sa durée ») et TOUS les
 *   plans suivants glissent — le bandeau du sujet 3 s'affiche pendant le
 *   commentaire du sujet 4. On mesure donc chaque phrase après synthèse, et on
 *   réécrit les durées.
 *
 *   Piper (CPU, local, gratuit) est le défaut délibéré : la synthèse tourne
 *   dans GitHub Actions sans réveiller la moindre station GPU — la TV
 *   quotidienne ne doit rien coûter en calcul loué, ni entrer en concurrence
 *   avec la radio pour la même machine.
 */
import { synthesize, getVoiceSampleRate, ensurePiperBinary, ensureVoice, isVoiceSupported } from './piper'
import { readWav, concatWavs, encodeWav, durationOf, type ConcatEntry, type DecodedWav } from './audio'
import type { TvConductor } from './tv-types'

/**
 * Voix par défaut du JT.
 *
 * ⚠️ PAS `fr_FR-tom-medium` : elle est sous **AGPLv3** et a été écartée du
 * registre par l'audit de licences du 04/08/2026 (cf. `voix-licences.ts`). Elle
 * était pourtant le défaut de ce module jusqu'au 09/09/2026 — le JT aurait donc
 * été mis à l'antenne avec une voix non commercialisable, sous la règle même du
 * fondateur. C'est le rebasage sur la radio souveraine qui l'a fait apparaître.
 *
 * `siwis` est **CC BY 4.0, commercialement autorisée**, et demande une
 * attribution (portée par `voix-licences.ts`).
 */
export const DEFAULT_TV_VOICE = 'fr_FR-siwis-medium'

/**
 * Voix du TERRAIN — le second timbre, celui qui fait qu'on entend un ÉCHANGE.
 *
 * 🚨 Retour du Bâtisseur : « pas une vidéo construite avec des dialogues ». Une seule voix qui
 * récite quatre sujets s'entend comme une lecture. Deux rôles suffisent : le plateau présente
 * et relance, le terrain rapporte.
 *
 * `gilles` est **CC0**, donc commercialisable sans même une attribution — la règle du fondateur
 * est respectée sans dette. Elle échantillonne à 16 kHz quand `siwis` est à 22,05 : ce n'est PAS
 * un problème, `concatWavs` rééchantillonne vers la cadence de la PREMIÈRE entrée. Mais cela
 * veut dire que l'ordre compte, et qu'un JT qui commencerait par le terrain serait assemblé en
 * 16 kHz. Le plateau ouvre donc toujours (cf. `roleDuPlan`).
 */
export const VOIX_TERRAIN = 'fr_FR-gilles-low'

/**
 * Qui parle le plan `index` : le rôle demandé, sinon une ALTERNANCE plateau → terrain.
 *
 * ⚠️ LE PREMIER PLAN EST TOUJOURS AU PLATEAU. Deux raisons, et les deux comptent : un journal
 * s'ouvre en studio, et la première entrée fixe la cadence d'échantillonnage de toute la bande.
 */
export function roleDuPlan(role: 'plateau' | 'terrain' | undefined, index: number): 'plateau' | 'terrain' {
  if (index === 0) return 'plateau'
  return role ?? (index % 2 === 1 ? 'terrain' : 'plateau')
}

/** Temps laissé à l'image après la dernière syllabe, avant de couper le plan. */
const RESPIRATION_S = 0.6

/** Durée minimale d'un plan : en deçà, l'œil n'a pas le temps de lire le bandeau. */
const PLAN_MIN_S = 3

/** Minutage d'un plan, mesuré (pas prédit). */
export interface VoiceTiming {
  /** Index du segment dans le conducteur. */
  index: number
  /** Début du plan dans la piste finale (s). */
  startSec: number
  /** Durée du plan à l'écran (s) — somme = durée exacte de la piste. */
  durationSec: number
  /** Temps réellement parlé (hors respiration), 0 si segment muet. */
  spokenSec: number
}

export interface TvVoiceTrack {
  /** Piste complète, WAV PCM 16 bits mono, prête à déposer sur la forge. */
  wav: Buffer
  durationSec: number
  timings: VoiceTiming[]
  voiceId: string
  /** Nombre de segments réellement parlés (les autres sont du silence tenu). */
  spokenCount: number
}

/** Fabrique un silence de `sec` secondes. */
export function silence(sec: number, sampleRate: number): DecodedWav {
  return { samples: new Float32Array(Math.max(0, Math.round(sec * sampleRate))), sampleRate }
}

/** Rallonge un WAV d'un silence de queue (la respiration du plan). */
export function withTail(wav: DecodedWav, tailSec: number): DecodedWav {
  const extra = Math.max(0, Math.round(tailSec * wav.sampleRate))
  if (!extra) return wav
  const out = new Float32Array(wav.samples.length + extra)
  out.set(wav.samples, 0)
  return { samples: out, sampleRate: wav.sampleRate }
}

/**
 * Convertit des entrées concaténées en minutage de plans. FONCTION PURE
 * (testable hors ligne, sans Piper).
 *
 * La durée d'un plan est l'écart jusqu'au DÉBUT du suivant — pas sa propre
 * longueur audio. C'est ce qui garantit que la somme des durées vaut exactement
 * la durée de la piste : sans cela, les silences insérés entre les phrases
 * seraient perdus par le montage et l'image prendrait un plan de retard.
 */
export function timingsFromEntries(
  entries: Array<{ tStart?: number; tEnd?: number }>,
  totalSec: number,
): VoiceTiming[] {
  return entries.map((e, i) => {
    const startSec = e.tStart ?? 0
    const next = i + 1 < entries.length ? (entries[i + 1].tStart ?? totalSec) : totalSec
    return {
      index: i,
      startSec: round2(startSec),
      durationSec: round2(Math.max(0, next - startSec)),
      spokenSec: round2(Math.max(0, (e.tEnd ?? startSec) - startSec)),
    }
  })
}

function round2(n: number): number {
  return Math.round(n * 100) / 100
}

/**
 * Synthétise la narration de tout un conducteur en une piste unique.
 *
 * Un segment sans narration n'est pas sauté : il tient sa place par un silence
 * de la durée prévue. Sans cela, le plan muet disparaîtrait de la bande-son et
 * l'image se décalerait de sa durée.
 */
export async function synthesizeConductor(
  conductor: TvConductor,
  opts: { voiceId?: string; dialogue?: boolean } = {},
): Promise<TvVoiceTrack> {
  const voiceId = opts.voiceId ?? DEFAULT_TV_VOICE
  if (!isVoiceSupported(voiceId)) {
    throw new Error(`Voix TV non supportée : ${voiceId} (voir VOICE_REGISTRY de piper.ts)`)
  }
  // ⚠️ LE DIALOGUE EST UN CONFORT, JAMAIS UNE CONDITION. Si la seconde voix n'est pas
  // disponible (registre, licence, téléchargement impossible sur l'exécuteur), on n'échoue
  // PAS : on fait le JT à une voix. Un journal monocorde vaut mieux qu'un journal muet — et
  // c'est exactement l'erreur qu'on a déjà faite en laissant un repli masquer une panne, donc
  // on le DIT dans le journal d'exécution au lieu de le taire.
  const dialogue = opts.dialogue !== false && isVoiceSupported(VOIX_TERRAIN)
  if (opts.dialogue !== false && !dialogue) {
    console.log(`   ⚠️  voix du terrain (${VOIX_TERRAIN}) indisponible — JT à UNE voix`)
  }
  await ensurePiperBinary()
  await ensureVoice(voiceId)
  if (dialogue) await ensureVoice(VOIX_TERRAIN)
  const rate = getVoiceSampleRate(voiceId)

  const entries: ConcatEntry[] = []
  let spokenCount = 0
  for (const [index, seg] of conductor.segments.entries()) {
    const role = roleDuPlan(seg.role, index)
    const voixDuPlan = dialogue && role === 'terrain' ? VOIX_TERRAIN : voiceId
    const texte = (seg.narration ?? '').trim()
    if (!texte) {
      // Plan muet (illustration, ouverture) : il tient sa durée prévue.
      entries.push({ wav: silence(Math.max(PLAN_MIN_S, seg.durationSec || PLAN_MIN_S), rate) })
      continue
    }
    const wavPath = await synthesize(texte, voixDuPlan)
    const dit = readWav(wavPath)
    // Le plan ne peut pas être plus court que sa phrase : on part de la voix,
    // on ajoute la respiration, et on ne descend jamais sous le plancher de
    // lisibilité du bandeau.
    const parle = durationOf(dit)
    const cible = Math.max(parle + RESPIRATION_S, PLAN_MIN_S)
    entries.push({ wav: withTail(dit, cible - parle) })
    spokenCount++
  }

  const merged = concatWavs(entries)
  const durationSec = durationOf(merged)
  return {
    wav: encodeWav(merged),
    durationSec: round2(durationSec),
    timings: timingsFromEntries(entries, durationSec),
    voiceId,
    spokenCount,
  }
}
