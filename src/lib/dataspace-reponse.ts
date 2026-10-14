/**
 * @module InfinityScheduler/Lib/DataspaceReponse
 * @description 🎙️ Ce que chaque réponse du service de voix de data-space nous dit d'elle-même
 *   (changement annoncé par data-space le 14/10/2026, après la panne du 12 au 14/10).
 *
 *   Chaque réponse de `/api/v1/gpu/voix` porte des en-têtes `x-ds-*` (et, quand il y a un corps
 *   JSON, les mêmes informations dedans) : identifiant du travail, moteur, modèle, langue
 *   APPLIQUÉE et si elle a été DÉDUITE, station, GPU, file, stations prêtes, relances.
 *
 *   ⚠️ La redirection 302 vers l'audio n'a PAS de corps : seuls ses en-têtes parlent. C'est pour
 *   cela que la synthèse ne suit plus la redirection à l'aveugle (cf. chatterbox.ts).
 *
 *   Ce module est PUR (aucun réseau) : lecture, mise en forme, contrôle de langue, et un petit
 *   bilan par exécution qui alimente la note de qualité de l'émission (`qualite.dataspace`).
 */

/** Les informations qu'une réponse data-space donne sur le travail. Tout est facultatif. */
export interface InfosDataspace {
  jobId?:          string
  moteur?:         string
  modele?:         string
  /** Langue réellement appliquée par data-space. */
  langue?:         string
  /** true : data-space a DÉDUIT la langue ; false : il a pris celle reçue. */
  langueDeduite?:  boolean
  station?:        string
  gpu?:            string
  /** Longueur de la file au moment de la réponse. */
  file?:           number
  stationsPretes?: string
  /** Nombre de relances automatiques déjà faites chez data-space pour ce travail. */
  relances?:       number
}

/** En-tête HTTP → (clé du corps JSON, clé de `InfosDataspace`). */
const CHAMPS: ReadonlyArray<[string, string, keyof InfosDataspace]> = [
  ['x-ds-job-id',             'job_id',            'jobId'],
  ['x-ds-engine',             'engine',            'moteur'],
  ['x-ds-model',              'model',             'modele'],
  ['x-ds-language',           'language',          'langue'],
  ['x-ds-language-inferred',  'language_inferred', 'langueDeduite'],
  ['x-ds-station',            'station',           'station'],
  ['x-ds-gpu',                'gpu',               'gpu'],
  ['x-ds-queue',              'queue',             'file'],
  ['x-ds-stations-ready',     'stations_ready',    'stationsPretes'],
  ['x-ds-retries',            'retries',           'relances'],
]

const NUMERIQUES = new Set<keyof InfosDataspace>(['file', 'relances'])

/**
 * Lit les en-têtes `x-ds-*` (prioritaires) puis, à défaut, les mêmes champs du corps JSON.
 * Une valeur absente ou illisible est simplement omise. Pure.
 */
export function lireInfosDataspace(
  entetes: Pick<Headers, 'get'> | null | undefined,
  corps?: unknown,
): InfosDataspace {
  const c = corps && typeof corps === 'object' ? corps as Record<string, unknown> : {}
  const infos: InfosDataspace = {}
  for (const [entete, cle, champ] of CHAMPS) {
    const brut: unknown = entetes?.get(entete) ?? c[cle]
    if (brut === undefined || brut === null || brut === '') continue
    if (champ === 'langueDeduite') {
      const v = String(brut).trim().toLowerCase()
      if (v === '1' || v === 'true') infos.langueDeduite = true
      else if (v === '0' || v === 'false') infos.langueDeduite = false
      continue
    }
    if (NUMERIQUES.has(champ)) {
      const n = Number(brut)
      if (Number.isFinite(n)) (infos as Record<string, unknown>)[champ] = n
      continue
    }
    if (champ === 'stationsPretes' && Array.isArray(brut)) {
      infos.stationsPretes = brut.join(',')
      continue
    }
    if (typeof brut === 'string' || typeof brut === 'number') {
      (infos as Record<string, unknown>)[champ] = String(brut).trim().slice(0, 120)
    }
  }
  return infos
}

/**
 * Une ligne citable : « job_id vx… · station st-3 · gpu RTX4090 · langue fr (déduite) · file 2 ·
 * relances 1 ». Les six repères demandés y figurent toujours (« ? » quand data-space ne l'a pas
 * dit), pour qu'une ligne de journal se lise toujours de la même façon. Pure.
 */
export function formaterInfosDataspace(i: InfosDataspace): string {
  const langue = i.langue
    ? `${i.langue}${i.langueDeduite === true ? ' (déduite)' : i.langueDeduite === false ? ' (reçue)' : ''}`
    : '?'
  return [
    `job_id ${i.jobId ?? '?'}`,
    `station ${i.station ?? '?'}`,
    `gpu ${i.gpu ?? '?'}`,
    `langue ${langue}`,
    `file ${i.file ?? '?'}`,
    `relances ${i.relances ?? '?'}`,
  ].join(' · ')
}

/** Vrai si data-space n'a rien dit du tout (pas d'en-tête, pas de champ). */
export function infosVides(i: InfosDataspace): boolean {
  return Object.keys(i).length === 0
}

const deuxLettres = (l: string) => l.trim().toLowerCase().slice(0, 2)

/**
 * Contrôle de langue : data-space recommande d'envoyer `language` pour CHAQUE voix — nous le
 * faisons. Si la langue appliquée diffère de celle envoyée, ou s'ils l'ont déduite alors que nous
 * l'avions envoyée, c'est un vrai problème (une voix française lisant de l'anglais, par exemple) :
 * on rend le texte de l'avertissement. null : rien à signaler. Pure.
 */
export function controleLangue(envoyee: string | undefined, i: InfosDataspace): string | null {
  if (!envoyee) return null
  const ref = i.jobId ? ` (job_id ${i.jobId})` : ''
  if (i.langue && deuxLettres(i.langue) !== deuxLettres(envoyee)) {
    return `⚠️ [chatterbox] LANGUE : nous avons envoyé « ${envoyee} », data-space a appliqué « ${i.langue} »`
      + `${i.langueDeduite ? ' (déduite)' : ''}${ref} — la voix risque de lire avec le mauvais accent`
  }
  if (i.langueDeduite === true) {
    return `⚠️ [chatterbox] LANGUE : data-space l'a DÉDUITE alors que nous l'avons envoyée (« ${envoyee} »)${ref}`
      + ' — notre champ language n\'a pas été lu'
  }
  return null
}

// ── Bilan de l'exécution (une émission = un processus generate-broadcast) ───────────────────

/** Résumé facultatif publié dans `qualite.dataspace` (kind 30093). */
export interface BilanDataspace {
  /** Stations data-space distinctes qui ont servi ou répondu. */
  stations:      string[]
  /** Travaux dont la langue a été déduite par data-space. */
  langueDeduite: number
  /** Relances automatiques faites chez data-space (la plus haute vue pour chaque travail, sommée). */
  retries:       number
  /** Travaux en échec FINAL (500 `synthesis_failed`, `final: true`). */
  echecsFinals:  number
}

let stations = new Set<string>()
let deduites = new Set<string>()
let relancesParTravail = new Map<string, number>()
let finals = new Set<string>()
let reponsesVues = 0
let anonymes = 0

/** Remet le bilan à zéro (tests, ou nouvelle émission dans le même processus). */
export function remettreBilanDataspace(): void {
  stations = new Set(); deduites = new Set(); relancesParTravail = new Map(); finals = new Set()
  reponsesVues = 0; anonymes = 0
}

/**
 * Note une réponse dans le bilan. Les 429 successifs d'un même travail portent le même job_id :
 * ils ne comptent qu'une fois. `final` : la réponse est un échec final.
 */
export function noterReponseDataspace(i: InfosDataspace, final = false): void {
  if (infosVides(i) && !final) return
  reponsesVues++
  const cle = i.jobId ?? `sans-id-${++anonymes}`
  if (i.station) stations.add(i.station)
  if (i.langueDeduite === true) deduites.add(cle)
  if (i.relances !== undefined && i.relances > 0) {
    relancesParTravail.set(cle, Math.max(relancesParTravail.get(cle) ?? 0, Math.round(i.relances)))
  }
  if (final) finals.add(cle)
}

/** Le bilan, ou null si data-space n'a jamais répondu avec ces informations (champ omis). */
export function bilanDataspace(): BilanDataspace | null {
  if (reponsesVues === 0) return null
  let retries = 0
  for (const n of relancesParTravail.values()) retries += n
  return {
    stations: [...stations].sort(),
    langueDeduite: deduites.size,
    retries,
    echecsFinals: finals.size,
  }
}
