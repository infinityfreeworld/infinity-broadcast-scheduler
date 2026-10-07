/**
 * @module InfinityScheduler/Courrier/RepriseCourrier
 * @description 🔁 Le courrier des auditeurs face à la REPRISE DE NUIT (lib/reprise-emission.ts) et
 *   au RATTRAPAGE DES HÉSITATIONS (lib/disfluences.ts). Pur, sans réseau ni disque.
 *
 *   ── (a) LE SON D'UN VOCAL N'EST PAS GARDÉ DANS LE CHANTIER ──
 *   Le chantier garde le TEXTE de l'émission (JSON) et les tours dits en voix de personnage. Le son
 *   d'un auditeur n'y a pas sa place : un `Float32Array` passé à `JSON.stringify` devient un objet
 *   de centaines de milliers de clés, illisible comme son à la relecture. On le retire donc avant
 *   d'écrire (`plansPourChantier`), on garde sa RÉFÉRENCE, et à la reprise on le recolle depuis le
 *   courrier du jour relevé de nouveau (re-téléchargé, déchiffré : `restaurerCourrier`). Introuvable
 *   (fichier expiré, relais muet) : le vocal est SAUTÉ proprement, avec l'annonce et la réaction de
 *   l'animateur qui l'encadrent — jamais remplacé par du silence ni par une voix de synthèse, et il
 *   n'est pas marqué « diffusé » (il reste dans la fenêtre pour une émission suivante).
 *
 *   ── (b) LE VOCAL D'UN AUDITEUR ÉCHAPPE À L'OREILLE ET AU REPORT ──
 *   Sa voix est la sienne : ni contrôle de voix, ni oreille de contrôle (whisper), ni règle « tour en
 *   repli = reporter ». `sortDuTourCourrier` le fait passer AVANT tout cela dans la boucle de synthèse.
 *
 *   ── (c) LES HÉSITATIONS NE TOUCHENT NI UN MESSAGE LU, NI UN APPEL ──
 *   `hesitationPermise` : jamais sur un tour de courrier (message lu mot pour mot, annonce ou réaction
 *   d'un appel). `permisPourRattrapage` : jamais sur un tour d'auditeur, et tout refusé si les permis
 *   ne sont plus alignés sur les tours (mieux vaut aucune hésitation qu'une hésitation au mauvais tour).
 */
import type { DecodedWav } from '../audio'

/** Ce que le courrier ajoute au plan d'un tour (gardé dans le chantier, sauf `audio`). */
export interface MarquesCourrier {
  /** Le son d'un vocal d'auditeur (jamais écrit dans le chantier). */
  audio?:       DecodedWav
  /** Indice de boucle d'où vient le tour (un vocal ou un appel s'insère APRÈS son annonce). */
  boucle?:      number
  /** Message d'auditeur RÉELLEMENT passé par ce tour (texte lu, ou vocal diffusé). */
  refCourrier?: string
  /** Ce tour EST le vocal de cet auditeur (son à recoller à la reprise). */
  vocalRef?:    string
  /** Ce tour annonce le vocal ou y réagit : il tombe avec lui si le vocal est perdu. */
  lieAuVocal?:  string
  /** Tour d'animateur qui porte le courrier (message lu, annonce ou réaction d'un vocal ou d'un appel). */
  porteCourrier?: true
}

/** Préfixe de `hostId` des tours d'auditeurs (vocal : `auditeur` ; joué : `auditeur-joue-k`). */
export function estTourAuditeur(hostId: string): boolean {
  return hostId === 'auditeur' || hostId.startsWith('auditeur-joue-')
}

/** Le plan tel qu'il s'écrit au chantier : sans le son des auditeurs. */
export function plansPourChantier<P extends MarquesCourrier>(plans: readonly P[]): P[] {
  return plans.map(p => {
    if (!('audio' in p)) return p
    const { audio: _son, ...reste } = p
    return reste as P
  })
}

export interface CourrierRestaure<P> {
  plans:        P[]
  /** Tours à sauter (vocal introuvable, et les tours d'animateur qui l'encadrent). */
  sautes:       Set<number>
  indexBoucle:  number[]
  refsCourrier: string[]
}

/**
 * À la reprise : recolle le son de chaque vocal depuis le courrier relevé de nouveau, retrouve
 * l'alignement des pauses et les messages passés. Un vocal introuvable est sauté avec ses tours liés.
 */
export function restaurerCourrier<P extends MarquesCourrier>(
  plans: readonly P[], vocaux: ReadonlyArray<{ ref: string; wav: DecodedWav }> | null | undefined,
): CourrierRestaure<P> {
  const sons = new Map((vocaux ?? []).map(v => [v.ref, v.wav]))
  const perdus = new Set<string>()
  const out = plans.map(p => {
    if (!p.vocalRef) return p
    const wav = sons.get(p.vocalRef)
    if (!wav || wav.samples.length === 0) { perdus.add(p.vocalRef); return p }
    return { ...p, audio: wav }
  })
  const sautes = new Set<number>()
  out.forEach((p, k) => {
    if ((p.vocalRef && perdus.has(p.vocalRef)) || (p.lieAuVocal && perdus.has(p.lieAuVocal))) sautes.add(k)
  })
  return {
    plans:        out,
    sautes,
    indexBoucle:  out.map((p, k) => p.boucle ?? k),
    refsCourrier: out.flatMap((p, k) => (p.refCourrier && !sautes.has(k) ? [p.refCourrier] : [])),
  }
}

export type SortTourCourrier = { monter: DecodedWav } | { sauter: true }

/**
 * Dans la boucle de synthèse, AVANT la reprise du chantier, le contrôle de voix et l'oreille :
 *   · un tour à sauter (vocal perdu et ses tours liés) → `sauter` (ni synthèse, ni silence) ;
 *   · le vocal d'un auditeur → `monter` SON son, tel quel ;
 *   · tout autre tour → null (il suit le chemin ordinaire, reprise et oreille comprises).
 * Un vocal sans son (jamais attendu ici) est sauté : jamais de Piper sur un texte vide.
 */
export function sortDuTourCourrier(plan: MarquesCourrier, i: number, sautes: ReadonlySet<number>): SortTourCourrier | null {
  if (sautes.has(i)) return { sauter: true }
  if (plan.audio) return { monter: plan.audio }
  if (plan.vocalRef) return { sauter: true }
  return null
}

/** Garde les seuls éléments dont l'indice n'est pas sauté (tours, plans, indices de boucle). */
export function sansSautes<T>(xs: readonly T[], sautes: ReadonlySet<number>): T[] {
  return sautes.size === 0 ? [...xs] : xs.filter((_, k) => !sautes.has(k))
}

/** Genres de tour ordinaires où une hésitation est la bienvenue. */
const GENRES_HESITANTS = new Set(['courant', 'pre-invite', 'relance-invite', 'post-invite', 'invite-reponse-1', 'invite-reponse-2'])

/** Un tour d'animateur peut-il recevoir une hésitation ? Jamais s'il porte le courrier ou un appel. */
export function hesitationPermise(genre: string, tourCourrier: unknown): boolean {
  return !tourCourrier && GENRES_HESITANTS.has(genre)
}

/** Les tours remis au rattrapage des hésitations, avec les gardes du courrier. */
export function permisPourRattrapage(
  turns: ReadonlyArray<{ text: string; hostId: string }>, permis: readonly boolean[],
): Array<{ texte: string; permis: boolean }> {
  const aligne = permis.length === turns.length
  return turns.map((t, k) => ({ texte: t.text, permis: aligne && permis[k] === true && !estTourAuditeur(t.hostId) }))
}

/**
 * ── (d) JAMAIS UN LIEN D'AUDITEUR À L'ÉCRAN DES LIENS ──
 * L'écran des liens (kind 30093, champ `liens`) et les liens d'action sont une LISTE FERMÉE
 * (décision de Med, 07/10/2026). Une adresse glissée par un auditeur — dans un message lu à
 * l'antenne, la transcription d'un vocal, ou la réplique d'un auditeur joué — n'y entre jamais.
 * Rend les seuls tours dont on peut lire les liens. Plans désalignés : AUCUN tour (pas de lien
 * plutôt qu'un lien d'auditeur).
 */
export function paroleAuditeur(t: { hostId: string }, plan: MarquesCourrier | undefined): boolean {
  return estTourAuditeur(t.hostId) || !!plan?.vocalRef || !!plan?.refCourrier || !!plan?.lieAuVocal || !!plan?.porteCourrier
}

export function toursPourLiens<T extends { hostId: string }>(turns: readonly T[], plans: readonly MarquesCourrier[]): T[] {
  if (plans.length !== turns.length) return []
  return turns.filter((t, k) => !paroleAuditeur(t, plans[k]))
}
