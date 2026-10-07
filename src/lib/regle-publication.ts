/**
 * @module InfinityScheduler/Lib/ReglePublication
 * @description ⚖️ Publier, reporter, ou garder l'émission de la veille ?
 *
 *   Décision du Bâtisseur (07/10/2026) : « si elle sonne robotique ou incompréhensible, elle est
 *   refabriquée au lieu d'être diffusée ». Une émission dont des tours ont perdu leur voix de
 *   personnage (repli Piper) ou ont été jugés incompréhensibles par l'oreille de contrôle n'est
 *   donc PAS publiée tant qu'il reste du temps dans la fenêtre de fabrication : elle est REPORTÉE,
 *   et la nuit la reprend plus tard (en ne refaisant que les tours manquants, cf. chantier.ts).
 *
 *   ── EN FIN DE FENÊTRE (dernière chance) ──
 *   `RADIO_REPLI_FINAL` choisit :
 *     · `garder-veille` (DÉFAUT) : on ne publie pas. L'application joue d'elle-même la plus récente
 *       émission de la station (findBroadcast : « aujourd'hui d'abord, puis la plus récente ») —
 *       l'auditeur entend l'émission d'hier, avec ses vraies voix, plutôt qu'une voix robotique.
 *       ⚠️ Garde-fou : s'il n'existe AUCUNE émission de la station sur les `RADIO_VEILLE_MAX_JOURS`
 *       derniers jours (défaut 2), ou si on ne peut pas le savoir (relais muets), on publie quand
 *       même, AVEC ALERTE : une antenne qui rejoue une émission vieille d'une semaine, ou se tait,
 *       est pire qu'un tour robotique ;
 *     · `publier-alerte` : on publie en repli et le journal le crie (comportement d'avant).
 *   `RADIO_REPLI_TOLERE` (défaut 0) : nombre de tours en repli acceptés sans rien reporter.
 */

/** Code de sortie d'une station REPORTÉE : à reprendre plus tard dans la nuit (EX_TEMPFAIL). */
export const CODE_A_REPRENDRE = 75
/** Code de sortie d'une station NON PUBLIÉE en fin de fenêtre : la veille reste à l'antenne. */
export const CODE_VEILLE_GARDEE = 76

/**
 * Un arrêt VOULU de generate-broadcast (reporter, garder la veille) : ce n'est pas une panne. Levé
 * n'importe où, rattrapé à la sortie du script qui sort avec `code`.
 */
export class ArretVolontaire extends Error {
  constructor(message: string, readonly code: number) {
    super(message)
    this.name = 'ArretVolontaire'
  }
}

export type ModeFinal = 'garder-veille' | 'publier-alerte'

export function modeFinal(env: NodeJS.ProcessEnv = process.env): ModeFinal {
  const v = (env.RADIO_REPLI_FINAL ?? '').trim().toLowerCase()
  return v === 'publier-alerte' || v === 'publier' ? 'publier-alerte' : 'garder-veille'
}

function entier(env: string | undefined, defaut: number, min = 0): number {
  const n = Number.parseInt(env ?? '', 10)
  return Number.isFinite(n) && n >= min ? n : defaut
}

export function reglesPublication(env: NodeJS.ProcessEnv = process.env) {
  return {
    mode:           modeFinal(env),
    tolere:         entier(env.RADIO_REPLI_TOLERE, 0),
    veilleMaxJours: entier(env.RADIO_VEILLE_MAX_JOURS, 2, 1),
  }
}

/**
 * Est-ce la DERNIÈRE CHANCE de cette émission ? Décidé par generate-all (`RADIO_DERNIERE_CHANCE`).
 * Un lancement à la main (variable absente) est une dernière chance : il n'y a pas de nuit
 * derrière lui pour le reprendre.
 */
export function estDerniereChance(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.RADIO_DERNIERE_CHANCE !== '0'
}

export interface EtatEmission {
  /** Tours qui devaient être dits par une voix de personnage. */
  attendus:    number
  /** Parmi eux, ceux qui sortent en voix locale (repli), quelle qu'en soit la raison. */
  repli:       number
  /** Tours jugés incompréhensibles par l'oreille et partis malgré tout (dernière chance). */
  incompris:   number
  derniereChance: boolean
}

export type ActionPublication = 'publier' | 'reporter' | 'garder-veille' | 'publier-alerte'

export interface DecisionPublication {
  action: ActionPublication
  raison: string
}

/**
 * LA règle. Pure. `veilleExiste` : une émission de la station est-elle à l'antenne sur les
 * derniers jours ? `null` = on ne sait pas (relais muets).
 */
export function deciderPublication(
  e: EtatEmission,
  regles: { mode: ModeFinal; tolere: number },
  veilleExiste: boolean | null,
): DecisionPublication {
  const defauts = e.repli + e.incompris
  if (defauts <= regles.tolere) {
    return { action: 'publier', raison: defauts === 0 ? 'toutes les voix de personnage sont là' : `${defauts} tour(s) en repli, toléré(s)` }
  }
  const constat = `${e.repli}/${e.attendus} tour(s) en voix de repli${e.incompris ? `, ${e.incompris} incompréhensible(s)` : ''}`
  if (!e.derniereChance) {
    return { action: 'reporter', raison: `${constat} — il reste du temps : reprise plus tard dans la nuit` }
  }
  if (regles.mode === 'publier-alerte') {
    return { action: 'publier-alerte', raison: `${constat} — fin de fenêtre, publiée en repli (RADIO_REPLI_FINAL=publier-alerte)` }
  }
  if (veilleExiste === true) {
    return { action: 'garder-veille', raison: `${constat} — fin de fenêtre : NON publiée, l'émission précédente reste à l'antenne` }
  }
  return {
    action: 'publier-alerte',
    raison: `${constat} — fin de fenêtre, et ${veilleExiste === false ? 'aucune émission récente à garder' : 'relais illisibles (émission précédente inconnue)'} : publiée en repli plutôt qu'un silence`,
  }
}

/** Les dates des `n` jours qui précèdent `date` (AAAA-MM-JJ), la plus proche d'abord. Pure. */
export function joursPrecedents(date: string, n: number): string[] {
  const [a, m, j] = date.split('-').map(x => Number.parseInt(x, 10))
  const sortie: string[] = []
  for (let k = 1; k <= n; k++) {
    const d = new Date(Date.UTC(a, m - 1, j - k))
    sortie.push(d.toISOString().slice(0, 10))
  }
  return sortie
}
