/**
 * @module InfinityScheduler/TV/Nostr
 * @description Publie un PROGRAMME TV sur NOSTR (kind TV_PROGRAM = 30184,
 *   parameterized replaceable, d-tag = programId). Réutilise la même mécanique
 *   que la radio (`nostr.ts`) : signature nostr-tools, publish multi-relais,
 *   filtrage du faux positif « connection failure ».
 *
 *   ⚠ Le CONTENU/TAGS doivent coller EXACTEMENT à `tv-program-codec.ts` de l'app
 *   (`parseTvProgramEvent`) pour que le player décode le programme.
 */
import { publierEvenement, type BilanPublication } from './nostr'
import type { TvProgram } from './tv-types'

export const TV_PROGRAM_KIND = 30184

/** Construit le d-tag d'un programme (= clé replaceable). */
export function programDTag(channelId: string, airDateISO: string): string {
  return `${channelId}:${airDateISO}`
}

/** Template d'event TV_PROGRAM (aligné sur le codec app). Exporté pour test. */
export function tvProgramEventTemplate(p: TvProgram) {
  return {
    kind:       TV_PROGRAM_KIND,
    created_at: Math.floor(Date.now() / 1000),
    tags: [
      ['d',            p.id],
      ['channel',      p.channelId],
      ['published_at', String(Math.floor(p.airDateMs / 1000))],
    ],
    content: JSON.stringify({
      channelId:   p.channelId,
      title:       p.title,
      videoCid:    p.videoCid,
      blossomUrl:  p.blossomUrl,
      sha256:      p.sha256,
      durationSec: p.durationSec,
      airDateMs:   p.airDateMs,
      poster:      p.poster,
      segments:    p.segments,
      generator:   p.generator,
    }),
  }
}

/**
 * Publie un programme TV sur tous les relais. Renvoie le pubkey signataire.
 * @param program  Programme complet (videoCid déjà obtenu de WAF).
 * @param privKeyHex  Clé privée hex 64 chars (env NOSTR_PRIVATE_KEY).
 */
export async function publishTvProgram(program: TvProgram, privKeyHex: string): Promise<BilanPublication> {
  return publierEvenement(tvProgramEventTemplate(program), privKeyHex)
}
