/**
 * @module InfinityScheduler/Lib/QualiteVoix
 * @description Contrôle de qualité AUDIO d'une réplique synthétisée, juste après la synthèse et
 *   AVANT le montage : on mesure le PCM du tour, sans dépendance, en quelques millisecondes.
 *
 *   🔴 04/10/2026 — le Bâtisseur, à l'écoute réelle : « des vides sonores avec des chuchotements
 *   au milieu des répliques », et sur 自由之声 « parfois les animateurs parlent étrangement, mais
 *   pas chinois ».
 *
 *   ── LE DÉFAUT MESURÉ (émissions 30093 publiées de 自由之声, 11/09 → 04/10/2026) ──
 *   Débit des tours en caractères chinois par seconde (tEnd − tStart) :
 *     · nuits en Kokoro (voix locale)          : 3,8 à 6,7 car/s, jamais hors bornes ;
 *     · nuits en voix clonée (Chatterbox, zh)  : 0,4 à 20,6 car/s. Par émission, 7 à 11 tours sur
 *       22 au-dessus de 9 car/s (texte non dit : la synthèse s'arrête en route), 1 à 3 sous
 *       2 car/s (20 caractères étirés sur 38 s : souffle, chuchotis, babillage), et des tours
 *       coupés NET à 40,0 s (plafond de génération du modèle).
 *   Le garde-fou de data-space (refus au-delà de 25 car/s) est aveugle au chinois, qui se parle à
 *   ~5 car/s : un tour amputé de moitié passe.
 *
 *   ── CE QUE L'ON MESURE ──
 *   Sur des trames de 32 ms (pas de 16 ms), après un sous-échantillonnage à ~8 kHz :
 *     · l'énergie (dB), le taux de passage par zéro, la platitude spectrale (FFT 256) ;
 *     · le VOISEMENT : pic d'autocorrélation normalisée entre 70 et 400 Hz (une voix parlée a une
 *       fréquence fondamentale ; un chuchotement, un souffle, non).
 *   D'où cinq défauts :
 *     · `debit`        : durée parlée incompatible avec la longueur du texte (bornes par langue) ;
 *     · `silence`      : un blanc INTERNE plus long que `SEUILS.silenceS` ;
 *     · `chuchotement` : une plage non voisée, bruitée (plate / sifflante), plus faible que la
 *                        voix, au-delà de `SEUILS.chuchotementS` d'un seul tenant ;
 *     · `ecretage`     : trop d'échantillons à pleine échelle ;
 *     · `muet`         : (presque) rien de voisé pour un texte non vide.
 *
 *   Module PUR (aucune E/S) : la boucle de correction vit dans `controle-voix.ts`.
 */

/** Une trame analysée. */
export interface Trame {
  db:        number
  voisee:    boolean
  zcr:       number
  platitude: number
}

export type TypeDefaut = 'debit-lent' | 'debit-rapide' | 'silence' | 'chuchotement' | 'ecretage' | 'muet'

export interface Defaut {
  type:   TypeDefaut
  /** Valeur mesurée (secondes, car/s ou fraction selon le type). */
  valeur: number
  /** Une ligne lisible pour le journal de la nuit. */
  detail: string
}

export interface MesuresTour {
  dureeS:            number
  /** Durée entre la première et la dernière trame non silencieuse. */
  dureeParleeS:      number
  /** Unités de texte (caractères CJK, lettres latines/cyrilliques…) par seconde parlée. */
  debit:             number
  unites:            number
  silenceInterneMaxS: number
  chuchotementMaxS:  number
  chuchotementTotalS: number
  voiseS:            number
  ecretage:          number
  niveauDb:          number
}

export interface Analyse {
  mesures: MesuresTour
  defauts: Defaut[]
  /** Gravité cumulée (0 = sain) : sert à garder le MOINS mauvais des essais. */
  gravite: number
  /** Plages [début, fin] en secondes : blancs internes et chuchotements, pour le rognage. */
  plages:  { silences: Array<[number, number]>; chuchotements: Array<[number, number]> }
}

/**
 * Débit admissible, en unités par seconde parlée. Une « unité » = un caractère CJK (une syllabe) ;
 * pour les langues alphabétiques, une lettre.
 *
 * Calibrage RÉEL (émissions publiées, tEnd − tStart, cf. le rapport du 04/10/2026) :
 *   · zh : Kokoro 3,8–6,7 car/s sur 110 tours sains (audio décodé du 03/10 : 4,2–5,2) ; la voix
 *     clonée en défaut descend à 0,5 et monte à 21 car/s ;
 *   · fr/en/es/ru : 1 756 tours de 7 stations (23/09 → 04/10) : p1 6,4–9,0 lettres/s, p99
 *     15,1–18,2. Avec la marge de 1,5 s, ces bornes signalent 8 tours sur 1 756 (dont 4 sur
 *     WTF Radio, où l'audio montre bien des blancs et des chuchotements).
 */
export const DEBIT_PAR_LANGUE: Record<string, { min: number; max: number }> = {
  zh: { min: 2.2, max: 7.0 },
  ja: { min: 3.0, max: 12.0 },
  fr: { min: 7.0, max: 22.0 },
  en: { min: 7.0, max: 22.0 },
  es: { min: 7.0, max: 22.0 },
  it: { min: 7.0, max: 22.0 },
  pt: { min: 7.0, max: 22.0 },
  ru: { min: 6.0, max: 21.0 },
  hi: { min: 6.0, max: 21.0 },
}

/** Seuils des détecteurs (secondes, dB). Voir le rapport de calibrage dans `controle-voix.ts`. */
export const SEUILS = {
  /** Un blanc interne au-delà de cette durée est un défaut (les pauses naturelles d'un TTS font < 0,7 s). */
  silenceS:        1.5,
  /** Une plage chuchotée d'un seul tenant au-delà de cette durée est un défaut. */
  chuchotementS:   0.8,
  /** … ou un cumul de plages chuchotées (≥ 0,3 s chacune) au-delà de cette durée. */
  chuchotementTotalS: 2.0,
  /** Marge absolue (s) accordée à la durée attendue d'après le texte, pour les tours courts. */
  margeDebitS:     1.5,
  /** Fraction d'échantillons à pleine échelle au-delà de laquelle on parle d'écrêtage. */
  ecretage:        0.002,
  /** Silence : sous (niveau de la voix − 35 dB), ou sous −55 dBFS. */
  silenceRelDb:    35,
  silenceAbsDb:    -55,
  /** Chuchotement : au moins 6 dB SOUS le niveau de la voix (une fricative forte n'en est pas un). */
  chuchotementRelDb: 6,
  /** Pic d'autocorrélation normalisée au-delà duquel la trame est voisée. */
  voisement:       0.45,
  /** Platitude spectrale ou taux de passage par zéro qui signent un bruit (souffle, chuchotis). */
  platitude:       0.18,
  zcr:             0.28,
}

const TAUX_ANALYSE = 8000
const TRAME = 256
const PAS = 128

/** Unités de texte prononcées (cf. `DEBIT_PAR_LANGUE`). Crochets (« [Sarah] ») ignorés. */
export function unitesTexte(texte: string, langue: string): number {
  const t = texte.replace(/\[[^\]\n]*\]/g, ' ')
  if (langue === 'zh' || langue === 'ja') {
    let n = 0
    for (const ch of t) if (/[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]/u.test(ch)) n++
    // Un mot latin ou un nombre se dit en ~1-2 syllabes : on le compte pour 1,5.
    const latins = t.match(/[A-Za-z]+|\d+/g) ?? []
    return n + Math.round(latins.length * 1.5)
  }
  let n = 0
  for (const ch of t) if (/[\p{L}\p{N}]/u.test(ch)) n++
  return n
}

/** Sous-échantillonne (moyenne glissante, facteur entier) vers ~8 kHz. */
function sousEchantillonner(samples: Float32Array, rate: number): { x: Float32Array; taux: number } {
  const f = Math.max(1, Math.round(rate / TAUX_ANALYSE))
  if (f === 1) return { x: samples, taux: rate }
  const n = Math.floor(samples.length / f)
  const x = new Float32Array(n)
  for (let i = 0; i < n; i++) {
    let s = 0
    for (let k = 0; k < f; k++) s += samples[i * f + k]
    x[i] = s / f
  }
  return { x, taux: rate / f }
}

/** Puissances d'une FFT réelle de 256 points (radix 2, en place). */
function spectre(trame: Float32Array): Float64Array {
  const n = trame.length
  const re = new Float64Array(n)
  const im = new Float64Array(n)
  for (let i = 0; i < n; i++) re[i] = trame[i] * (0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (n - 1)))
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1
    for (; j & bit; bit >>= 1) j ^= bit
    j ^= bit
    if (i < j) { [re[i], re[j]] = [re[j], re[i]]; [im[i], im[j]] = [im[j], im[i]] }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = (-2 * Math.PI) / len
    for (let i = 0; i < n; i += len) {
      for (let k = 0; k < len / 2; k++) {
        const c = Math.cos(ang * k), s = Math.sin(ang * k)
        const a = i + k, b = i + k + len / 2
        const tr = re[b] * c - im[b] * s
        const ti = re[b] * s + im[b] * c
        re[b] = re[a] - tr; im[b] = im[a] - ti
        re[a] += tr; im[a] += ti
      }
    }
  }
  const p = new Float64Array(n / 2)
  for (let k = 0; k < n / 2; k++) p[k] = re[k] * re[k] + im[k] * im[k] + 1e-12
  return p
}

/** Analyse trame par trame (exportée pour les tests et le calibrage). */
export function trames(samples: Float32Array, rate: number): { trames: Trame[]; pasS: number } {
  const { x, taux } = sousEchantillonner(samples, rate)
  const lagMin = Math.max(2, Math.floor(taux / 400))
  const lagMax = Math.min(TRAME - 8, Math.ceil(taux / 70))
  const out: Trame[] = []
  const buf = new Float32Array(TRAME)
  for (let debut = 0; debut + TRAME <= x.length; debut += PAS) {
    let e = 0, zc = 0, moy = 0
    for (let i = 0; i < TRAME; i++) moy += x[debut + i]
    moy /= TRAME
    for (let i = 0; i < TRAME; i++) {
      const v = x[debut + i] - moy
      buf[i] = v
      e += v * v
      if (i > 0 && (v >= 0) !== (buf[i - 1] >= 0)) zc++
    }
    const rms = Math.sqrt(e / TRAME)
    const db = 20 * Math.log10(rms + 1e-9)
    // Voisement : pic de l'autocorrélation normalisée dans la plage de la voix parlée.
    let pic = 0
    if (db > -60) {
      for (let lag = lagMin; lag <= lagMax; lag++) {
        let r = 0, e1 = 0, e2 = 0
        for (let i = 0; i + lag < TRAME; i++) {
          r += buf[i] * buf[i + lag]
          e1 += buf[i] * buf[i]
          e2 += buf[i + lag] * buf[i + lag]
        }
        const c = r / Math.sqrt(e1 * e2 + 1e-12)
        if (c > pic) pic = c
      }
    }
    let platitude = 0
    if (db > -60) {
      const p = spectre(buf)
      let sLog = 0, s = 0
      for (let k = 1; k < p.length; k++) { sLog += Math.log(p[k]); s += p[k] }
      const m = p.length - 1
      platitude = Math.exp(sLog / m) / (s / m)
    }
    out.push({ db, voisee: pic >= SEUILS.voisement, zcr: zc / TRAME, platitude })
  }
  return { trames: out, pasS: PAS / taux }
}

function percentile(v: number[], p: number): number {
  if (v.length === 0) return -120
  const s = [...v].sort((a, b) => a - b)
  return s[Math.min(s.length - 1, Math.max(0, Math.floor((p / 100) * (s.length - 1))))]
}

/** Plages contiguës d'un prédicat (en indices de trame), en tolérant `trou` trames isolées. */
function plages(n: number, pred: (i: number) => boolean, trou = 0): Array<[number, number]> {
  const res: Array<[number, number]> = []
  let debut = -1, dernier = -1
  for (let i = 0; i < n; i++) {
    if (pred(i)) {
      if (debut < 0) debut = i
      else if (i - dernier - 1 > trou) { res.push([debut, dernier]); debut = i }
      dernier = i
    }
  }
  if (debut >= 0) res.push([debut, dernier])
  return res
}

const fmt = (x: number, d = 1) => x.toFixed(d).replace('.', ',')

/**
 * Analyse un tour synthétisé. `texte` = ce qui devait être dit ; `langue` = langue de la station.
 */
export function analyserTour(samples: Float32Array, rate: number, texte: string, langue: string): Analyse {
  const dureeS = samples.length / rate
  const { trames: tr, pasS } = trames(samples, rate)
  const n = tr.length
  const actifs = tr.map(t => t.db).filter(d => d > -70)
  const niveauDb = percentile(actifs, 90)
  const seuilSilence = Math.max(SEUILS.silenceAbsDb, niveauDb - SEUILS.silenceRelDb)
  const silencieuse = (i: number) => tr[i].db < seuilSilence

  // Écrêtage, sur le signal d'origine.
  let pleins = 0
  for (let i = 0; i < samples.length; i++) if (Math.abs(samples[i]) >= 0.999) pleins++
  const ecretage = samples.length ? pleins / samples.length : 0

  let premier = 0
  while (premier < n && silencieuse(premier)) premier++
  let dernier = n - 1
  while (dernier >= 0 && silencieuse(dernier)) dernier--
  const dureeParleeS = dernier >= premier ? (dernier - premier + 1) * pasS + (TRAME - PAS) * pasS / PAS : 0

  // Blancs internes.
  const silences = plages(n, i => i > premier && i < dernier && silencieuse(i))
    .map(([a, b]) => [a * pasS, (b + 1) * pasS] as [number, number])
  const silenceInterneMaxS = silences.reduce((m, [a, b]) => Math.max(m, b - a), 0)

  // Chuchotements : non silencieux, non voisés, nettement sous la voix, et bruités.
  const chuchotee = (i: number) => {
    const t = tr[i]
    return i >= premier && i <= dernier && !silencieuse(i) && !t.voisee
      && t.db < niveauDb - SEUILS.chuchotementRelDb
      && (t.platitude >= SEUILS.platitude || t.zcr >= SEUILS.zcr)
  }
  const chuchotements = plages(n, chuchotee, 2)
    .map(([a, b]) => [a * pasS, (b + 1) * pasS] as [number, number])
    .filter(([a, b]) => b - a >= 0.3)
  const chuchotementMaxS = chuchotements.reduce((m, [a, b]) => Math.max(m, b - a), 0)
  const chuchotementTotalS = chuchotements.reduce((s, [a, b]) => s + (b - a), 0)

  const voiseS = tr.filter((t, i) => t.voisee && !silencieuse(i)).length * pasS
  const unites = unitesTexte(texte, langue)
  const debit = dureeParleeS > 0 ? unites / dureeParleeS : 0

  const defauts: Defaut[] = []
  let gravite = 0
  if (unites >= 3 && (voiseS < 0.3 || niveauDb < -45)) {
    defauts.push({ type: 'muet', valeur: voiseS, detail: `quasi muet (${fmt(voiseS)} s de voix pour ${unites} unités de texte)` })
    gravite += 10
  } else {
    const bornes = DEBIT_PAR_LANGUE[langue] ?? DEBIT_PAR_LANGUE.en
    if (unites >= 4 && dureeParleeS > 0) {
      const maxS = unites / bornes.min + SEUILS.margeDebitS
      const minS = Math.max(0, unites / bornes.max - SEUILS.margeDebitS / 3)
      if (dureeParleeS > maxS) {
        defauts.push({ type: 'debit-lent', valeur: debit, detail: `trop long pour son texte (${fmt(dureeParleeS)} s pour ${unites} unités, ${fmt(debit)}/s)` })
        gravite += 3 + Math.min(5, (dureeParleeS - maxS) / 2)
      } else if (dureeParleeS < minS) {
        defauts.push({ type: 'debit-rapide', valeur: debit, detail: `trop court pour son texte — texte non dit (${fmt(dureeParleeS)} s pour ${unites} unités, ${fmt(debit)}/s)` })
        gravite += 4 + Math.min(5, (minS - dureeParleeS) / 2)
      }
    }
    if (silenceInterneMaxS > SEUILS.silenceS) {
      defauts.push({ type: 'silence', valeur: silenceInterneMaxS, detail: `blanc de ${fmt(silenceInterneMaxS)} s` })
      gravite += 2 + silenceInterneMaxS
    }
    if (chuchotementMaxS > SEUILS.chuchotementS || chuchotementTotalS > SEUILS.chuchotementTotalS) {
      defauts.push({ type: 'chuchotement', valeur: chuchotementMaxS, detail: `chuchotement ${fmt(chuchotementMaxS)} s (total ${fmt(chuchotementTotalS)} s)` })
      gravite += 2 + chuchotementTotalS
    }
  }
  if (ecretage > SEUILS.ecretage) {
    defauts.push({ type: 'ecretage', valeur: ecretage, detail: `écrêtage ${fmt(ecretage * 100, 2)} % des échantillons` })
    gravite += 1
  }

  return {
    mesures: { dureeS, dureeParleeS, debit, unites, silenceInterneMaxS, chuchotementMaxS, chuchotementTotalS, voiseS, ecretage, niveauDb },
    defauts, gravite,
    plages: { silences, chuchotements },
  }
}

/**
 * Dernier recours : raccourcit les blancs internes trop longs et retire les chuchotements, en
 * laissant à leur place une respiration de `garderS` secondes (fondue, pour ne pas cliquer).
 * Le début et la fin du tour ne sont pas touchés. Rend un NOUVEAU tampon.
 */
export function rognerDefauts(samples: Float32Array, rate: number, analyse: Analyse, garderS = 0.3): { samples: Float32Array; retireS: number } {
  const coupes = [
    ...analyse.plages.silences.filter(([a, b]) => b - a > SEUILS.silenceS * 0.7),
    ...analyse.plages.chuchotements.filter(([a, b]) => b - a > garderS + 0.1),
  ].sort((p, q) => p[0] - q[0])
  // Fusion des plages qui se chevauchent.
  const fusion: Array<[number, number]> = []
  for (const [a, b] of coupes) {
    const d = fusion[fusion.length - 1]
    if (d && a <= d[1]) d[1] = Math.max(d[1], b)
    else fusion.push([a, b])
  }
  if (fusion.length === 0) return { samples, retireS: 0 }
  const garder = Math.round(garderS * rate)
  const fondu = Math.min(Math.round(0.02 * rate), Math.floor(garder / 2))
  const morceaux: Float32Array[] = []
  let curseur = 0
  let retire = 0
  for (const [a, b] of fusion) {
    const ia = Math.round(a * rate), ib = Math.round(b * rate)
    if (ib - ia <= garder) continue
    // On garde la moitié de la respiration de chaque côté de la coupe.
    const finAvant = ia + Math.floor(garder / 2)
    const repriseApres = ib - Math.ceil(garder / 2)
    const avant = samples.slice(curseur, finAvant)
    for (let k = 0; k < fondu && k < avant.length; k++) avant[avant.length - 1 - k] *= k / fondu
    morceaux.push(avant)
    retire += repriseApres - finAvant
    curseur = repriseApres
  }
  morceaux.push(samples.slice(curseur))
  // Fondu d'entrée de chaque morceau après le premier (des copies : l'original n'est pas touché).
  for (let m = 1; m < morceaux.length; m++) {
    const p = morceaux[m]
    for (let k = 0; k < fondu && k < p.length; k++) p[k] *= k / fondu
  }
  const total = morceaux.reduce((s, p) => s + p.length, 0)
  const out = new Float32Array(total)
  let o = 0
  for (const p of morceaux) { out.set(p, o); o += p.length }
  return { samples: out, retireS: retire / rate }
}
