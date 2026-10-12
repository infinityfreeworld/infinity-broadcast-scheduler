/**
 * @module InfinityScheduler/Lib/Loudness
 * @description 🔊 LE NIVEAU SONORE PERÇU (EBU R128 / UIT-R BS.1770), pur, sans ffmpeg.
 *
 *   Demande du Bâtisseur (12/10/2026) : « niveau sonore égal entre voix, musique et jingles, avec des
 *   fondus propres ». Jusqu'ici, tout se calait sur le RMS (musique.ts : `ajusterNiveau`), qui ne
 *   mesure pas ce que l'oreille entend : une musique riche en graves sonne plus FORTE qu'une voix au
 *   même RMS, et une parole entrecoupée de silences paraît plus FAIBLE que son RMS. Le LUFS, lui,
 *   pondère les fréquences comme l'oreille (filtre K) et ignore les silences (portes).
 *
 *   ── LA MESURE AVANT (émissions réelles du 12/10/2026, ffmpeg ebur128) ──
 *     Biogame : voix −16,8 LUFS, musiques −22,7, jingles −16,3, émission entière −17,7 ;
 *     Свобода FM : voix −20,0, musiques −26,0, jingle −20,0, émission entière −21,3.
 *   La musique tombait 6 LU sous la voix (consigne « −4 dB » appliquée au RMS), et deux stations
 *   différaient de 3,6 LU : on montait le volume d'une station à l'autre.
 *
 *   ── CE QUE CE MODULE FAIT ──
 *     · `mesurerLufs` : sonie intégrée BS.1770-4 d'un tampon MONO (filtre K, blocs de 400 ms
 *       recouverts à 75 %, porte absolue −70 LUFS, porte relative −10 LU) ;
 *     · `calerSurLufs` : un gain pour atteindre une sonie cible, crête bornée (jamais d'écrêtage) ;
 *     · `limiterCretes` : limiteur à anticipation (5 ms) et relâchement doux, pour le mixage final ;
 *     · `normaliserEmission` : l'émission montée ramenée à la cible (−16 LUFS par défaut, la valeur
 *       courante des podcasts et radios en ligne), crêtes sous −1,5 dBFS.
 *
 *   Vérifié contre ffmpeg (filtre ebur128) dans les tests : écart ≤ 0,3 LU.
 *
 *   Réglages : RADIO_LUFS (cible de l'émission, défaut −16, entre −30 et −9) ;
 *              RADIO_CRETE_DB (plafond des crêtes, défaut −1,5 dBFS) ;
 *              HABILLAGE_LOUDNESS=off coupe la normalisation finale (retour au comportement d'avant).
 */

/** Cible par défaut de l'émission montée (LUFS). */
export const CIBLE_LUFS = -16
/** Plafond des crêtes par défaut (dBFS) : sous 0 pour laisser la place à l'encodage Opus. */
export const CRETE_DB = -1.5
/** Sonie d'un tampon sans rien d'audible. */
export const SILENCE_LUFS = -70

/** Un biquad (forme directe I), coefficients normalisés (a0 = 1). */
interface Biquad { b0: number; b1: number; b2: number; a1: number; a2: number }

/**
 * Les deux étages du filtre K (BS.1770-4) recalculés pour un taux quelconque — mêmes formules que
 * libebur128 / pyloudnorm, exactes à 48 kHz et valables à 16, 22,05 ou 24 kHz (Piper, Chatterbox).
 */
export function filtreK(sampleRate: number): [Biquad, Biquad] {
  // Étage 1 : plateau haut (+4 dB au-dessus de ~1,7 kHz : la tête qui « entend » les aigus).
  const f0 = 1681.974450955533, G = 3.999843853973347, Q = 0.7071752369554196
  const K = Math.tan(Math.PI * f0 / sampleRate)
  const Vh = Math.pow(10, G / 20), Vb = Math.pow(Vh, 0.4996667741545416)
  const a0 = 1 + K / Q + K * K
  const plateau: Biquad = {
    b0: (Vh + Vb * K / Q + K * K) / a0,
    b1: 2 * (K * K - Vh) / a0,
    b2: (Vh - Vb * K / Q + K * K) / a0,
    a1: 2 * (K * K - 1) / a0,
    a2: (1 - K / Q + K * K) / a0,
  }
  // Étage 2 : passe-haut (les graves comptent moins, ~38 Hz).
  const f1 = 38.13547087602444, Q1 = 0.5003270373238773
  const K1 = Math.tan(Math.PI * f1 / sampleRate)
  const d = 1 + K1 / Q1 + K1 * K1
  const passeHaut: Biquad = { b0: 1, b1: -2, b2: 1, a1: 2 * (K1 * K1 - 1) / d, a2: (1 - K1 / Q1 + K1 * K1) / d }
  return [plateau, passeHaut]
}

function filtrer(x: Float32Array, f: Biquad): Float64Array {
  const y = new Float64Array(x.length)
  let x1 = 0, x2 = 0, y1 = 0, y2 = 0
  for (let i = 0; i < x.length; i++) {
    const xi = x[i]
    const yi = f.b0 * xi + f.b1 * x1 + f.b2 * x2 - f.a1 * y1 - f.a2 * y2
    x2 = x1; x1 = xi; y2 = y1; y1 = yi
    y[i] = yi
  }
  return y
}

const versLufs = (energie: number) => (energie > 0 ? -0.691 + 10 * Math.log10(energie) : -Infinity)

/**
 * Sonie intégrée (LUFS) d'un tampon mono, selon BS.1770-4. Pure.
 * Rend `SILENCE_LUFS` pour un tampon trop court (< 400 ms) ou sans rien d'audible.
 */
export function mesurerLufs(samples: Float32Array, sampleRate: number): number {
  const bloc = Math.round(0.4 * sampleRate)
  const pas = Math.round(0.1 * sampleRate)
  if (samples.length < bloc) return SILENCE_LUFS
  const [k1, k2] = filtreK(sampleRate)
  // Deux passes : on garde un Float64Array intermédiaire (précision), puis les carrés cumulés.
  const etage1 = filtrer(samples, k1)
  const cumul = new Float64Array(samples.length + 1)
  {
    let x1 = 0, x2 = 0, y1 = 0, y2 = 0
    for (let i = 0; i < etage1.length; i++) {
      const xi = etage1[i]
      const yi = k2.b0 * xi + k2.b1 * x1 + k2.b2 * x2 - k2.a1 * y1 - k2.a2 * y2
      x2 = x1; x1 = xi; y2 = y1; y1 = yi
      cumul[i + 1] = cumul[i] + yi * yi
    }
  }
  const energies: number[] = []
  for (let debut = 0; debut + bloc <= samples.length; debut += pas) {
    energies.push((cumul[debut + bloc] - cumul[debut]) / bloc)
  }
  const audibles = energies.filter(e => versLufs(e) > -70)
  if (audibles.length === 0) return SILENCE_LUFS
  const moyenneAbs = audibles.reduce((a, b) => a + b, 0) / audibles.length
  const porteRelative = versLufs(moyenneAbs) - 10
  const retenus = audibles.filter(e => versLufs(e) > porteRelative)
  const moyenne = retenus.reduce((a, b) => a + b, 0) / retenus.length
  return Math.max(SILENCE_LUFS, versLufs(moyenne))
}

/** Crête d'échantillon (dBFS), −100 pour le silence. Pure. */
export function creteDb(samples: Float32Array): number {
  let c = 0
  for (let i = 0; i < samples.length; i++) { const a = Math.abs(samples[i]); if (a > c) c = a }
  return c > 0 ? Math.max(-100, 20 * Math.log10(c)) : -100
}

/**
 * Le gain (dB) qui amène un tampon à `cibleLufs`, borné pour que la crête reste sous `creteMaxDb`.
 * 0 pour un tampon muet. Pur.
 */
export function gainVersLufs(samples: Float32Array, sampleRate: number, cibleLufs: number, creteMaxDb = CRETE_DB): number {
  const actuel = mesurerLufs(samples, sampleRate)
  if (actuel <= SILENCE_LUFS) return 0
  const voulu = cibleLufs - actuel
  const marge = creteMaxDb - creteDb(samples)
  return Math.min(voulu, marge)
}

/**
 * Ramène un élément (musique, jingle, lit) à une sonie cible, sans écrêter. Rend un NOUVEAU tampon —
 * l'équivalent LUFS de `ajusterNiveau` (musique.ts), qui calait au RMS.
 */
export function calerSurLufs(samples: Float32Array, sampleRate: number, cibleLufs: number, creteMaxDb = CRETE_DB): Float32Array {
  const g = Math.pow(10, gainVersLufs(samples, sampleRate, cibleLufs, creteMaxDb) / 20)
  const out = new Float32Array(samples.length)
  for (let i = 0; i < samples.length; i++) out[i] = samples[i] * g
  return out
}

/**
 * Limiteur de crêtes EN PLACE : anticipation de `anticipationMs` (le gain baisse AVANT la crête),
 * relâchement exponentiel sur `relachementMs`. Garantit |x| ≤ plafond. Rend le nombre d'échantillons
 * touchés (pour le journal). Pur sur son entrée.
 */
export function limiterCretes(
  samples: Float32Array, sampleRate: number, plafondDb = CRETE_DB, anticipationMs = 5, relachementMs = 80,
): number {
  const plafond = Math.pow(10, plafondDb / 20)
  const n = samples.length
  const L = Math.max(1, Math.round(anticipationMs / 1000 * sampleRate))
  const rel = 1 - Math.exp(-1 / Math.max(1, relachementMs / 1000 * sampleRate))
  // Maximum glissant de |x| sur [i, i+L] (file monotone), parcouru d'avance.
  const file = new Int32Array(n + 1)
  let tete = 0, queue = 0
  let gain = 1
  let touches = 0
  const pousser = (j: number) => {
    const a = Math.abs(samples[j])
    while (queue > tete && Math.abs(samples[file[queue - 1]]) <= a) queue--
    file[queue++] = j
  }
  for (let j = 0; j < Math.min(n, L + 1); j++) pousser(j)
  for (let i = 0; i < n; i++) {
    while (file[tete] < i) tete++
    const maxi = Math.abs(samples[file[tete]])
    const voulu = maxi > plafond ? plafond / maxi : 1
    gain = voulu < gain ? voulu : gain + (voulu - gain) * rel
    if (gain > 0.99995 && voulu === 1) gain = 1   // l'exponentielle n'atteint jamais 1 : on la rattrape
    if (gain < 1) touches++
    let v = samples[i] * gain
    if (v > plafond) v = plafond; else if (v < -plafond) v = -plafond   // filet : jamais au-dessus
    samples[i] = v
    if (i + L + 1 < n) pousser(i + L + 1)
  }
  return touches
}

/**
 * Sonie d'un ensemble de tampons (les tours de voix d'une émission, éventuellement à des taux
 * différents) : moyenne d'énergie pondérée par la durée des tours audibles. Pure.
 */
export function lufsEnsemble(tampons: ReadonlyArray<{ samples: Float32Array; sampleRate: number }>): number {
  let energie = 0, duree = 0
  for (const t of tampons) {
    const l = mesurerLufs(t.samples, t.sampleRate)
    if (l <= SILENCE_LUFS) continue
    const d = t.samples.length / t.sampleRate
    energie += d * Math.pow(10, (l + 0.691) / 10)
    duree += d
  }
  return duree > 0 ? Math.max(SILENCE_LUFS, versLufs(energie / duree)) : SILENCE_LUFS
}

export interface NormalisationEmission {
  avantLufs:  number
  apresLufs:  number
  gainDb:     number
  creteDb:    number
  /** Part des échantillons où le limiteur a agi (0 à 1). */
  limite:     number
}

/** Lit la cible et le plafond dans l'environnement ; une valeur absurde retombe sur le défaut. */
export function reglagesLoudness(env: NodeJS.ProcessEnv = process.env): { cible: number; crete: number } {
  const lire = (v: string | undefined, d: number, min: number, max: number) => {
    const x = Number.parseFloat((v ?? '').replace(',', '.'))
    return Number.isFinite(x) && x >= min && x <= max ? x : d
  }
  return { cible: lire(env.RADIO_LUFS, CIBLE_LUFS, -30, -9), crete: lire(env.RADIO_CRETE_DB, CRETE_DB, -6, 0) }
}

/**
 * L'émission montée ramenée à la cible : gain, puis limiteur si les crêtes dépassent. EN PLACE.
 * Une émission muette n'est pas touchée.
 */
export function normaliserEmission(
  samples: Float32Array, sampleRate: number, cibleLufs = CIBLE_LUFS, creteMaxDb = CRETE_DB,
): NormalisationEmission {
  const avant = mesurerLufs(samples, sampleRate)
  if (avant <= SILENCE_LUFS) return { avantLufs: avant, apresLufs: avant, gainDb: 0, creteDb: creteDb(samples), limite: 0 }
  const gainDb = cibleLufs - avant
  const g = Math.pow(10, gainDb / 20)
  for (let i = 0; i < samples.length; i++) samples[i] *= g
  const touches = creteDb(samples) > creteMaxDb ? limiterCretes(samples, sampleRate, creteMaxDb) : 0
  return {
    avantLufs: avant,
    apresLufs: mesurerLufs(samples, sampleRate),
    gainDb,
    creteDb: creteDb(samples),
    limite: samples.length ? touches / samples.length : 0,
  }
}
