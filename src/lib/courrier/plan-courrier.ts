/**
 * @module InfinityScheduler/Courrier/Plan
 * @description OÙ passent, dans l'émission, le vrai courrier et les appels (pur, déterministe).
 *
 *   · Le premier vrai message écrit prend la place du courrier INVENTÉ (`planHumain`, tour
 *     « courrier ») ; les suivants prennent d'autres tours ordinaires.
 *   · Un vocal ou un appel occupe DEUX tours ordinaires consécutifs : l'animateur annonce (tour i),
 *     l'auditeur passe (vocal diffusé, ou auditeur joué — inséré entre i et i+1), l'animateur
 *     réagit (tour i+1).
 *   · Jamais sur l'ouverture, la clôture, un tour d'invité ou autour d'une pause (`exclus`), ni sur
 *     une réaction courte. Répartis dans l'émission. Ce qui ne trouve pas de place n'est PAS
 *     diffusé (et reste donc dans la fenêtre pour le lendemain).
 */
import type { CourrierDuJour } from './courrier-du-jour'
import type { TourCourrier } from './consignes-courrier'

export type Place =
  | { type: 'texte'; k: number }
  | { type: 'vocal-intro'; k: number }
  | { type: 'vocal-reaction'; k: number }
  | { type: 'appel-intro'; k: number }
  | { type: 'appel-reaction'; k: number }

export function planCourrier(o: {
  nbTours:        number
  exclus:         ReadonlySet<number>
  courts:         ReadonlySet<number>
  /** Tour du courrier inventé (`planHumain`), ou null. */
  courrierHumain: number | null
  nbTextes:       number
  nbVocaux:       number
  nbAppels:       number
}): Map<number, Place> {
  const plan = new Map<number, Place>()
  const libre = (i: number) => i >= 1 && i <= o.nbTours - 2 && !o.exclus.has(i) && !o.courts.has(i) && !plan.has(i)
  const items: Array<{ type: 'texte' | 'vocal' | 'appel'; k: number }> = [
    ...Array.from({ length: Math.max(0, o.nbTextes) }, (_, k) => ({ type: 'texte' as const, k })),
    ...Array.from({ length: Math.max(0, o.nbVocaux) }, (_, k) => ({ type: 'vocal' as const, k })),
    ...Array.from({ length: Math.max(0, o.nbAppels) }, (_, k) => ({ type: 'appel' as const, k })),
  ]
  if (items.length === 0) return plan
  // Le premier texte prend la place du courrier inventé.
  let reste = items
  if (o.nbTextes > 0 && o.courrierHumain !== null && libre(o.courrierHumain)) {
    plan.set(o.courrierHumain, { type: 'texte', k: 0 })
    reste = items.slice(1)
  }
  reste.forEach((it, j) => {
    const cible = Math.round(((j + 1) * o.nbTours) / (reste.length + 1))
    // Les positions les plus proches de la cible d'abord.
    const ordre = Array.from({ length: o.nbTours }, (_, i) => i).sort((a, b) => Math.abs(a - cible) - Math.abs(b - cible) || a - b)
    for (const i of ordre) {
      if (it.type === 'texte') {
        if (libre(i) && !plan.has(i - 1) && !plan.has(i + 1)) { plan.set(i, { type: 'texte', k: it.k }); return }
        continue
      }
      if (libre(i) && libre(i + 1) && !plan.has(i - 1) && !plan.has(i + 2)) {
        plan.set(i, { type: `${it.type}-intro`, k: it.k } as Place)
        plan.set(i + 1, { type: `${it.type}-reaction`, k: it.k } as Place)
        return
      }
    }
  })
  return plan
}

/**
 * La consigne d'un tour placé, ou `null` s'il doit redevenir un tour ordinaire : réaction à un
 * vocal ou à un appel qui n'a finalement pas été inséré (tour d'annonce sauté). Pur.
 */
export function tourDeCourrier(
  place: Place, c: Pick<CourrierDuJour, 'textes' | 'vocaux' | 'auditeursInventes'>, inseres: ReadonlySet<string>,
): TourCourrier | null {
  switch (place.type) {
    case 'texte': {
      const t = c.textes[place.k]
      return t ? { type: 'courrier-reel', message: t.message } : null
    }
    case 'vocal-intro': {
      const v = c.vocaux[place.k]
      return v ? { type: 'vocal-intro', message: v.message } : null
    }
    case 'vocal-reaction': {
      const v = c.vocaux[place.k]
      return v && inseres.has(`vocal:${place.k}`) ? { type: 'vocal-reaction', message: v.message, ...(v.transcription ? { transcription: v.transcription } : {}) } : null
    }
    case 'appel-intro': {
      const a = c.auditeursInventes[place.k]
      return a ? { type: 'appel-intro', auditeur: a } : null
    }
    case 'appel-reaction': {
      const a = c.auditeursInventes[place.k]
      return a && inseres.has(`appel:${place.k}`) ? { type: 'appel-reaction', auditeur: a } : null
    }
  }
}
