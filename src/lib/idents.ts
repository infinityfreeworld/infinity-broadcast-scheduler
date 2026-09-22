/**
 * @module InfinityScheduler/Idents
 * @description L'ident d'antenne : « Vous écoutez Radio Pirate. » dit par le premier animateur,
 *   à l'ouverture et à la fermeture de l'émission. Décision du fondateur (22/09/2026, idée n° 3).
 *
 *   ── RÈGLES ──
 *   · seulement quand la station n'a AUCUN jingle déposé : le jingle du fondateur passe devant ;
 *   · la voix de personnage (Chatterbox) d'abord, Piper ensuite, sinon RIEN — jamais bloquant ;
 *   · dans la langue de la station ; `IDENTS=false` coupe tout pour une nuit.
 */

import { readWav, type DecodedWav } from './audio'
import type { ConcatEntry } from './audio'
import { getChatterboxVoiceForHost, synthesizeWithChatterbox, chatterboxBranche } from './chatterbox'
import { synthesize } from './piper'
import { voixPourLangue } from './voix'
import { estVoixKokoro } from './kokoro'
import { ajusterNiveau, encadrerDeSilence } from './musique'
import type { RadioStation } from './types'
import { decodeWav } from './audio'

export const IDENT_TITRE = 'Ident'

/** Les phrases, par langue. `{n}` = nom de la station. */
export const PHRASES_IDENT: Record<string, { ouverture: string; fermeture: string }> = {
  fr: { ouverture: 'Vous écoutez {n}.',          fermeture: 'C\'était {n}. À tout de suite.' },
  en: { ouverture: 'You\'re listening to {n}.',   fermeture: 'That was {n}. Stay with us.' },
  es: { ouverture: 'Estás escuchando {n}.',       fermeture: 'Esto fue {n}. Seguimos en breve.' },
  ru: { ouverture: 'Вы слушаете {n}.',            fermeture: 'Это было {n}. Оставайтесь с нами.' },
  zh: { ouverture: '您正在收听{n}。',               fermeture: '以上是{n}，稍后回来。' },
}

/** La phrase d'ident pour une langue (repli : français). Pure. */
export function phraseIdent(langue: string | undefined, nom: string, quoi: 'ouverture' | 'fermeture'): string {
  const p = PHRASES_IDENT[langue ?? 'fr'] ?? PHRASES_IDENT.fr
  return p[quoi].replace('{n}', nom)
}

async function direAvecVoix(station: RadioStation, texte: string): Promise<DecodedWav | null> {
  const langue = station.language ?? 'fr'
  const hote = station.hosts[0]
  if (!hote) return null
  const voixPersonnage = chatterboxBranche() ? getChatterboxVoiceForHost(station.id, hote.id, langue) : null
  if (voixPersonnage) {
    try {
      const buf = await synthesizeWithChatterbox({ voice: voixPersonnage, text: texte, language: langue, format: 'wav' })
      return decodeWav(buf, 'ident')
    } catch (err) {
      console.warn(`    ⚠ ident en voix de ${hote.name} impossible (${(err as Error).message.slice(0, 90)}) — Piper`)
    }
  }
  const voixPiper = voixPourLangue(langue, hote.gender, hote.id)
  if (!voixPiper || estVoixKokoro(voixPiper)) return null   // le chinois sans Chatterbox : pas d'ident
  try {
    return readWav(await synthesize(texte, voixPiper))
  } catch (err) {
    console.warn(`    ⚠ ident Piper impossible : ${(err as Error).message.slice(0, 90)}`)
    return null
  }
}

/**
 * Les deux idents d'une station, prêts à entrer dans le montage (niveau de la voix de
 * l'émission, silences autour). Chaque ident manquant est `null`, jamais une erreur.
 */
export async function identsDeStation(
  station: RadioStation, sampleRate: number, voixRmsDb: number,
): Promise<{ ouverture: ConcatEntry | null; fermeture: ConcatEntry | null }> {
  if (process.env.IDENTS === 'false') return { ouverture: null, fermeture: null }
  const preparer = async (quoi: 'ouverture' | 'fermeture'): Promise<ConcatEntry | null> => {
    const wav = await direAvecVoix(station, phraseIdent(station.language, station.name, quoi))
    if (!wav || wav.samples.length < wav.sampleRate * 0.5) return null
    let s = ajusterNiveau(wav.samples, voixRmsDb)
    s = encadrerDeSilence(s, wav.sampleRate, quoi === 'ouverture' ? 0.2 : 0.6, quoi === 'ouverture' ? 0.7 : 0.4)
    return { wav: { samples: s, sampleRate: wav.sampleRate } }
  }
  const ouverture = await preparer('ouverture')
  const fermeture = await preparer('fermeture')
  const n = (ouverture ? 1 : 0) + (fermeture ? 1 : 0)
  if (n > 0) console.log(`    🎙 ${n} ident(s) d'antenne en voix de ${station.hosts[0]?.name ?? '?'} (« ${phraseIdent(station.language, station.name, 'ouverture')} »)`)
  void sampleRate
  return { ouverture, fermeture }
}
