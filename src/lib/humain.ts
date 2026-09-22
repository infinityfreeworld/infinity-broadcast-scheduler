/**
 * @module InfinityScheduler/Humain
 * @description Ce qui fait qu'une émission sonne comme une VRAIE antenne tenue par des humains,
 *   et non comme 22 fichiers collés : réactions courtes, courrier d'auditeur, silences variables,
 *   niveaux égalisés entre les voix, fond de salle, talk-over sur l'intro des musiques, lit
 *   musical sous l'ouverture et la fermeture. Demande du fondateur (22/09/2026) : « améliorer le
 *   côté réel, humain ». Tout est PUR (testable) sauf la date, qui dépend d'Intl.
 *
 *   ── RÈGLE ──
 *   Chaque touche est réglable par l'environnement (HABILLAGE_*) et DÉTERMINISTE par
 *   (station, date) : le Mac, le hub et le secours GitHub cuisent la même émission.
 */

import { prng } from './musique'

/** Le plan « humain » d'une émission : quels tours sont courts, lequel lit le courrier. */
export interface PlanHumain {
  /** Indices (0-based) des tours qui seront une réaction très courte (3 à 10 mots). */
  courts:   Set<number>
  /** Indice du tour qui lit un message d'auditeur, ou null. */
  courrier: number | null
}

/**
 * Choisit, parmi les tours « ordinaires » (ni ouverture, ni conclusion, ni invité, ni autour
 * d'une pause), environ un sur cinq pour une réaction courte, jamais deux de suite ; et un tour
 * du tiers central pour le courrier des auditeurs.
 */
export function planHumain(nbTours: number, exclus: Set<number>, graine: string): PlanHumain {
  const rand = prng(graine)
  const candidats: number[] = []
  for (let i = 1; i < nbTours - 1; i++) if (!exclus.has(i)) candidats.push(i)
  const courts = new Set<number>()
  if (nbTours >= 8) {
    const cible = Math.max(1, Math.round(candidats.length * 0.2))
    const ordre = [...candidats]
    for (let i = ordre.length - 1; i > 0; i--) { const j = Math.floor(rand() * (i + 1)); [ordre[i], ordre[j]] = [ordre[j], ordre[i]] }
    for (const i of ordre) {
      if (courts.size >= cible) break
      if (courts.has(i - 1) || courts.has(i + 1)) continue
      courts.add(i)
    }
  }
  let courrier: number | null = null
  if (nbTours >= 10) {
    const milieu = candidats.filter(i => i >= nbTours / 3 && i <= (2 * nbTours) / 3 && !courts.has(i))
    if (milieu.length > 0) courrier = milieu[Math.floor(rand() * milieu.length)]
  }
  return { courts, courrier }
}

/**
 * Le silence APRÈS un tour, en secondes : jamais le même, plus long après une question (l'autre
 * réfléchit), plus court après une réaction brève (on rebondit). Bornes 0,10-0,70 s.
 */
export function silenceApresTour(texte: string, court: boolean, rand: () => number): number {
  let s = 0.18 + rand() * 0.22
  if (/[?？]\s*$/.test(texte.trim())) s += 0.2
  if (court) s *= 0.6
  return Math.min(0.7, Math.max(0.1, Math.round(s * 100) / 100))
}

/** RMS en dBFS (copie locale pour rester sans dépendance circulaire). */
function rms(s: Float32Array): number {
  if (s.length === 0) return -100
  let acc = 0
  for (let i = 0; i < s.length; i++) acc += s[i] * s[i]
  const r = Math.sqrt(acc / s.length)
  return r > 0 ? Math.max(-100, 20 * Math.log10(r)) : -100
}

/**
 * Ramène chaque tour vers le niveau MÉDIAN de l'émission, à ±maxDb près, sans écrêter.
 * Piper et Chatterbox, et deux voix clonées entre elles, ne sortent pas au même niveau : à
 * l'oreille, c'est un animateur qui crie et l'autre qu'on n'entend pas. EN PLACE. Rend les
 * gains appliqués (dB), pour le journal et les tests.
 */
export function egaliserNiveaux(tampons: Float32Array[], maxDb = 6): number[] {
  const niveaux = tampons.map(rms).filter(n => n > -60)
  if (niveaux.length < 2) return tampons.map(() => 0)
  const tri = [...niveaux].sort((a, b) => a - b)
  const mediane = tri[Math.floor(tri.length / 2)]
  return tampons.map(s => {
    const n = rms(s)
    if (n <= -60) return 0
    let db = Math.min(maxDb, Math.max(-maxDb, mediane - n))
    let gain = Math.pow(10, db / 20)
    let crete = 0
    for (let i = 0; i < s.length; i++) { const a = Math.abs(s[i]); if (a > crete) crete = a }
    if (crete * gain > 0.97) { gain = 0.97 / crete; db = 20 * Math.log10(gain) }
    if (Math.abs(db) < 0.05) return 0
    for (let i = 0; i < s.length; i++) s[i] *= gain
    return Math.round(db * 10) / 10
  })
}

/**
 * Un fond de salle très faible dans une plage d'échantillons : un silence numérique parfait
 * sonne « mort », une vraie régie respire. Bruit rosâtre (moyenne de 4 tirages), niveau en dBFS.
 */
export function ajouterBruitDeFond(out: Float32Array, de: number, a: number, db: number, rand: () => number): void {
  const amp = Math.pow(10, db / 20) * 2
  for (let i = Math.max(0, de); i < Math.min(out.length, a); i++) {
    out[i] += amp * ((rand() + rand() + rand() + rand()) / 4 - 0.5)
  }
}

/**
 * TALK-OVER : la musique démarre SOUS les dernières secondes de l'animateur (à mi-niveau,
 * montant), comme quand un DJ lance un morceau. Rend le tampon fusionné et l'index où la voix
 * s'arrête (pour caler le transcript et le segment « 🎵 »). Crête bornée à 0,98.
 */
export function fusionTalkOver(voix: Float32Array, musique: Float32Array, chevauchement: number): { samples: Float32Array; finVoix: number } {
  const c = Math.max(0, Math.min(chevauchement, voix.length, musique.length))
  const out = new Float32Array(voix.length + musique.length - c)
  out.set(voix, 0)
  const debut = voix.length - c
  for (let i = 0; i < musique.length; i++) {
    // sous la voix : de −9 dB à 0 dB en rampe ; après : plein niveau (la musique a son propre fondu)
    const g = i < c ? 0.35 + 0.65 * (i / c) : 1
    out[debut + i] += musique[i] * g
  }
  let crete = 0
  for (let i = debut; i < debut + c; i++) { const a = Math.abs(out[i]); if (a > crete) crete = a }
  if (crete > 0.98) { const k = 0.98 / crete; for (let i = debut; i < debut + c; i++) out[i] *= k }
  return { samples: out, finVoix: voix.length }
}

/**
 * LIT MUSICAL sous une voix : mélange `lit` (déjà au bon niveau) sous `base`, sur toute la
 * longueur commune, avec un fondu de sortie (`debut`) ou d'entrée (`fin`) en secondes. EN PLACE
 * sur `base` ; crête bornée. Rend le nombre d'échantillons de lit consommés.
 */
export function superposerLit(base: Float32Array, lit: Float32Array, fonduS: number, rate: number, sens: 'debut' | 'fin', decalageLit = 0): number {
  const n = Math.min(base.length, Math.max(0, lit.length - decalageLit))
  if (n === 0) return 0
  const f = Math.min(Math.floor(fonduS * rate), n)
  for (let i = 0; i < n; i++) {
    let g = 1
    if (sens === 'debut' && i >= n - f) g = (n - i) / f          // fondu de sortie sur la fin de la plage
    if (sens === 'fin' && i < f) g = i / f                        // fondu d'entrée au début de la plage
    base[i] += lit[decalageLit + i] * g
  }
  let crete = 0
  for (let i = 0; i < n; i++) { const a = Math.abs(base[i]); if (a > crete) crete = a }
  if (crete > 0.98) { const k = 0.98 / crete; for (let i = 0; i < n; i++) base[i] *= k }
  return n
}

/** « mardi 23 septembre 2026 », dans la langue de la station (repli : français). */
export function dateLisible(dateISO: string, langue: string | undefined): string {
  const locales: Record<string, string> = { fr: 'fr-FR', en: 'en-GB', es: 'es-ES', ru: 'ru-RU', zh: 'zh-CN', it: 'it-IT', pt: 'pt-PT', ja: 'ja-JP', hi: 'hi-IN' }
  const [a, m, j] = dateISO.split('-').map(Number)
  if (!a || !m || !j) return dateISO
  const d = new Date(Date.UTC(a, m - 1, j, 12))
  try {
    return new Intl.DateTimeFormat(locales[langue ?? 'fr'] ?? 'fr-FR', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' }).format(d)
  } catch {
    return dateISO
  }
}

/** Un réglage d'habillage est actif sauf s'il vaut « off » / « false » / « non ». */
export function habillageActif(nom: string, env: NodeJS.ProcessEnv = process.env): boolean {
  const v = (env[nom] ?? '').trim().toLowerCase()
  return !(v === 'off' || v === 'false' || v === 'non' || v === '0')
}
