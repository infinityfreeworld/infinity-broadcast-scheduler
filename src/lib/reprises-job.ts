/**
 * @module InfinityScheduler/Lib/ReprisesJob
 * @description 🔁 Les REPRISES d'une station À L'INTÉRIEUR d'un job GitHub (pur, éprouvé sans réseau).
 *
 *   ── CE QUI NE MARCHAIT PAS (nuits du 08 au 12/10/2026) ──
 *   Sur la machine du Bâtisseur, generate-all fait plusieurs PASSAGES (fenetre-nuit.ts) : une station
 *   à qui des voix manquent est REPORTÉE (code 75) puis reprise, en ne refaisant que les tours manquants
 *   (chantier.ts). Le secours GitHub, lui, lançait `generate:one` UNE fois, sans `RADIO_DERNIERE_CHANCE`
 *   — donc toujours en « dernière chance » : au premier engorgement du GPU de data-space (« file pleine »
 *   en boucle, échéance de 45 min dépassée), les 4 à 8 derniers tours retombaient en Piper, la règle de
 *   publication (regle-publication.ts) refusait l'émission et gardait la veille : code 76, job rouge.
 *   Relevé le 11/10 : hydrogene-radio et mindctrl-radio ; le 12/10 : tech-radio (6/22 tours en repli),
 *   wtf-radio, deglingos-radio. Le GPU avait de la place quelques minutes plus tard.
 *
 *   ── CE QUI LE REMPLACE ──
 *   Le job fait lui aussi des passages : les premiers sont REPORTABLES (`RADIO_DERNIERE_CHANCE=0`), le
 *   chantier est gardé sur le disque du job entre deux passages, et seul le DERNIER applique la règle
 *   finale. La qualité voulue par le Bâtisseur ne bouge pas : une émission robotique n'est toujours pas
 *   publiée — on se donne seulement le temps de la refaire avec ses vraies voix.
 *
 *   Réglages (variables du dépôt) :
 *     · RADIO_JOB_PASSES (3)            passages au plus ;
 *     · RADIO_JOB_BUDGET_MIN (130)      durée totale accordée à la station (le job est tué à 150) ;
 *     · RADIO_JOB_PAUSE_MIN (8)         pause avant une reprise : laisse la file du GPU se vider ;
 *     · RADIO_JOB_MARGE_DERNIERE_MIN (50) un passage qui démarre avec moins que cela devant lui est
 *       le dernier (un passage complet peut prendre l'échéance de 45 min + le montage).
 */
import { classerSortie, type IssueStation } from './fenetre-nuit'
import { CODE_A_REPRENDRE, CODE_VEILLE_GARDEE } from './regle-publication'

export interface ReglagesReprisesJob {
  maxPasses:       number
  budgetMs:        number
  pauseMs:         number
  margeDerniereMs: number
}

function entier(v: string | undefined, defaut: number, min = 0): number {
  const n = Number.parseInt(v ?? '', 10)
  return Number.isFinite(n) && n >= min ? n : defaut
}

export function reglagesReprisesJob(env: NodeJS.ProcessEnv = process.env): ReglagesReprisesJob {
  return {
    maxPasses:       entier(env.RADIO_JOB_PASSES, 3, 1),
    budgetMs:        entier(env.RADIO_JOB_BUDGET_MIN, 130, 1) * 60_000,
    pauseMs:         entier(env.RADIO_JOB_PAUSE_MIN, 8) * 60_000,
    margeDerniereMs: entier(env.RADIO_JOB_MARGE_DERNIERE_MIN, 50) * 60_000,
  }
}

/**
 * Ce passage est-il le DERNIER (règle de publication finale) ? Oui quand c'est le dernier permis, ou
 * quand il reste moins que la marge d'un passage complet avant la fin du budget. Pure.
 */
export function passageFinal(passe: number, maintenantMs: number, debutMs: number, r: ReglagesReprisesJob): boolean {
  return passe >= r.maxPasses || debutMs + r.budgetMs - maintenantMs < r.margeDerniereMs
}

export type SuiteJob =
  | { suite: 'fin'; code: number; issue: IssueStation }
  | { suite: 'reprendre'; pauseMs: number }

/**
 * Après un passage : s'arrêter (avec quel code de sortie pour le job) ou reprendre (après quelle
 * pause). `code` = code de sortie du passage, `final` = ce passage était-il le dernier. Pure.
 *
 *   · publiée (0) ou veille gardée (76) : c'est une DÉCISION, on s'arrête ;
 *   · reportée (75) ou échec franc (réseau coupé pendant l'écriture…) : on reprend, sauf si ce
 *     passage était le dernier ;
 *   · la pause ne mord jamais sur la marge du dernier passage.
 */
export function apresPassage(
  code: number, final: boolean, maintenantMs: number, debutMs: number, r: ReglagesReprisesJob,
): SuiteJob {
  const issue = classerSortie(code)
  if (issue === 'publiee') return { suite: 'fin', code: 0, issue }
  if (issue === 'veille-gardee') return { suite: 'fin', code: CODE_VEILLE_GARDEE, issue }
  if (final) return { suite: 'fin', code: issue === 'a-reprendre' ? CODE_A_REPRENDRE : (code || 1), issue }
  const permise = Math.max(0, debutMs + r.budgetMs - r.margeDerniereMs - maintenantMs)
  return { suite: 'reprendre', pauseMs: Math.min(r.pauseMs, permise) }
}
