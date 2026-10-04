/**
 * @module InfinityScheduler/Lib/ControleVoix
 * @description Contrôle de qualité de CHAQUE réplique synthétisée, AVANT le montage, puis
 *   correction — pour qu'aucun « vide avec des chuchotements » ni tour amputé ne parte à l'antenne.
 *
 *   🔴 04/10/2026 — le Bâtisseur, à l'écoute : « des vides sonores avec des chuchotements au milieu
 *   des répliques », sur toutes les stations ; sur 自由之声, « les animateurs parlent étrangement ».
 *
 *   ── CALIBRAGE (sur de VRAIES émissions publiées, audio décodé, cf. qualite-voix.ts) ──
 *     · 自由之声 03/10 (Kokoro, sain)            : 0 tour signalé sur 22 ; blanc interne max 0,66 s,
 *                                                  0 s de chuchotement, débit 4,2–5,2 car/s ;
 *     · 自由之声 02/10 et 04/10 (voix clonée, zh) : 16 et 17 tours signalés sur 22 — texte non dit
 *                                                  (jusqu'à 21 car/s), 20 caractères étirés sur 38 s,
 *                                                  blancs de 1,3 à 3,2 s, chuchotements jusqu'à 2,1 s ;
 *     · WTF Radio 04/10 (voix clonée, fr)        : 7 tours signalés (blancs de 1,5 à 3,7 s, 12 car/s
 *                                                  pour 3,3 attendus…) ;
 *     · Free Press FM 04/10 (en)                 : 0 tour signalé (blancs ≤ 1,33 s).
 *   Les seuils séparent ces deux familles ; aucun n'a été validé À L'OREILLE.
 *
 *   ── LA CORRECTION, DANS L'ORDRE ──
 *     (a) régénérer le tour avec la MÊME voix, réglages variés et texte en morceaux plus courts,
 *         jusqu'à `maxEssais` (2) ;
 *     (b) sinon, la voix NATIVE de la langue (Piper, Kokoro pour le chinois) ;
 *     (c) en dernier recours, garder le moins mauvais des essais et y RACCOURCIR les blancs et
 *         chuchotements anormaux.
 *   ⚠️ JAMAIS d'émission qui échoue à cause du contrôle : toute erreur rend le tour d'origine.
 *
 *   ── COÛT ──
 *   L'analyse coûte ~4 à 8 ms par seconde d'audio (4 à 8 s pour une émission de 15 min). Les régénérations
 *   coûtent une synthèse chacune : elles sont bornées par émission (`QUALITE_VOIX_MAX_REGEN`, 12)
 *   et en temps (`QUALITE_VOIX_BUDGET_S`, 900 s). Un COUPE-CIRCUIT évite de payer deux essais
 *   clonés par tour quand la voix clonée est instable sur toute l'émission (cas de 自由之声 :
 *   3 régénérations clonées ratées → passage direct à la voix native).
 *   `QUALITE_VOIX=0` désactive le contrôle.
 */
import type { DecodedWav } from './audio'
import { analyserTour, rognerDefauts, type Analyse, type TypeDefaut } from './qualite-voix'

export interface ReglagesRegeneration {
  temperature:   number
  cfgWeight:     number
  /** Taille maximale des morceaux envoyés au moteur. */
  maxCaracteres: number
}

/** Réglages de l'essai n (1, 2…) : plus prudents à chaque essai, morceaux plus courts. */
export function reglagesEssai(essai: number, langue: string): ReglagesRegeneration {
  const cjk = langue === 'zh' || langue === 'ja'
  return essai <= 1
    ? { temperature: 0.6, cfgWeight: 0.5, maxCaracteres: cjk ? 80 : 200 }
    : { temperature: 0.45, cfgWeight: 0.6, maxCaracteres: cjk ? 50 : 120 }
}

export interface MoteursControle {
  /** Re-synthèse en voix de PERSONNAGE (voix clonée). */
  clone(texte: string, voix: string, reglages: ReglagesRegeneration): Promise<DecodedWav>
  /** Synthèse en voix NATIVE locale (Piper / Kokoro). `maxCaracteres` : par morceaux. */
  locale(texte: string, voix: string, maxCaracteres?: number): Promise<DecodedWav>
}

export interface TourAControler {
  /** Numéro affiché (1 = premier tour). */
  numero:         number
  locuteur:       string
  /** Le texte envoyé à la voix. */
  texte:          string
  wav:            DecodedWav
  /** La voix de personnage a-t-elle produit ce WAV ? (false = Piper/Kokoro, voulu ou en repli) */
  viaClone:       boolean
  voixPersonnage: string | null
  voixLocale:     string
}

export interface OptionsControle {
  langue:            string
  moteurs:           MoteursControle
  maxEssais?:        number
  maxRegenerations?: number
  budgetS?:          number
  /** Régénérations clonées RATÉES avant de passer directement à la voix native. */
  coupeCircuit?:     number
  log?:              (ligne: string) => void
  maintenant?:       () => number
  actif?:            boolean
}

export interface BilanQualite {
  tours:        number
  defectueux:   number
  parType:      Partial<Record<TypeDefaut, number>>
  regeneres:    number
  secours:      number
  rognes:       number
  gardes:       number
  synthesesSup: number
  dureeS:       number
}

const fmt = (x: number, d = 1) => x.toFixed(d).replace('.', ',')

const NOM_TYPE: Record<TypeDefaut, string> = {
  'debit-lent': 'trop long', 'debit-rapide': 'texte non dit', silence: 'blanc',
  chuchotement: 'chuchotement', ecretage: 'écrêtage', muet: 'muet',
}

function entier(env: string | undefined, defaut: number): number {
  const n = Number.parseInt(env ?? '', 10)
  return Number.isFinite(n) && n >= 0 ? n : defaut
}

interface Candidat { wav: DecodedWav; analyse: Analyse; origine: string }

export class ControleQualiteVoix {
  private readonly o: Required<Omit<OptionsControle, 'log' | 'maintenant'>> & { log: (l: string) => void; maintenant: () => number }
  private readonly b: BilanQualite = { tours: 0, defectueux: 0, parType: {}, regeneres: 0, secours: 0, rognes: 0, gardes: 0, synthesesSup: 0, dureeS: 0 }
  private regenerations = 0
  private clonesRates = 0
  private clonesReussis = 0
  private budgetAnnonce = false

  constructor(opts: OptionsControle) {
    this.o = {
      langue:           opts.langue,
      moteurs:          opts.moteurs,
      maxEssais:        opts.maxEssais ?? 2,
      maxRegenerations: opts.maxRegenerations ?? entier(process.env.QUALITE_VOIX_MAX_REGEN, 12),
      budgetS:          opts.budgetS ?? entier(process.env.QUALITE_VOIX_BUDGET_S, 900),
      coupeCircuit:     opts.coupeCircuit ?? 3,
      log:              opts.log ?? (l => console.log(l)),
      maintenant:       opts.maintenant ?? (() => Date.now()),
      actif:            opts.actif ?? process.env.QUALITE_VOIX !== '0',
    }
  }

  bilan(): BilanQualite { return { ...this.b, parType: { ...this.b.parType } } }

  /** Le compteur de l'émission, en une ligne (vide si rien n'a été contrôlé). */
  ligneBilan(): string {
    const b = this.b
    if (b.tours === 0) return ''
    if (b.defectueux === 0) return `🔍 Contrôle qualité voix : ${b.tours} tours contrôlés, aucun défaut`
    const types = Object.entries(b.parType).map(([t, n]) => `${NOM_TYPE[t as TypeDefaut]} ${n}`).join(', ')
    return `🔍 Contrôle qualité voix : ${b.tours} tours · ${b.defectueux} défectueux (${types}) · `
      + `${b.regeneres} régénéré(s) · ${b.secours} en voix de secours · ${b.rognes} rogné(s) · ${b.gardes} gardé(s) tel quel · `
      + `${b.synthesesSup} synthèse(s) tentée(s) · ${fmt(b.dureeS, 0)} s`
  }

  private analyser(wav: DecodedWav, texte: string): Analyse {
    return analyserTour(wav.samples, wav.sampleRate, texte, this.o.langue)
  }

  private budgetEpuise(debutEmission: number): boolean {
    return this.regenerations >= this.o.maxRegenerations
      || this.b.dureeS + (this.o.maintenant() - debutEmission) / 1000 >= this.o.budgetS
  }

  /** Contrôle un tour et rend le WAV à monter (l'original s'il est sain ou si tout échoue). */
  async controler(tour: TourAControler): Promise<DecodedWav> {
    if (!this.o.actif) return tour.wav
    const debut = this.o.maintenant()
    const tete = `🔍 tour ${tour.numero} (${tour.locuteur})`
    try {
      const a0 = this.analyser(tour.wav, tour.texte)
      this.b.tours++
      if (a0.defauts.length === 0) return tour.wav
      this.b.defectueux++
      for (const d of a0.defauts) this.b.parType[d.type] = (this.b.parType[d.type] ?? 0) + 1
      const constat = a0.defauts.map(d => d.detail).join(' ; ')
      const candidats: Candidat[] = [{ wav: tour.wav, analyse: a0, origine: 'original' }]
      const essayer = async (origine: string, synth: () => Promise<DecodedWav>): Promise<Candidat | null> => {
        try {
          this.b.synthesesSup++
          const wav = await synth()
          const c: Candidat = { wav, analyse: this.analyser(wav, tour.texte), origine }
          candidats.push(c)
          return c
        } catch (err) {
          this.o.log(`${tete} : ${origine} impossible — ${(err as Error).message.split('\n')[0].slice(0, 100)}`)
          return null
        }
      }

      // (a) Régénérer avec la même voix.
      const cloneOuvert = tour.viaClone && !!tour.voixPersonnage
        && !(this.clonesRates >= this.o.coupeCircuit && this.clonesReussis === 0)
      const regenerable = tour.viaClone ? cloneOuvert : true
      if (tour.viaClone && !cloneOuvert) {
        this.o.log(`${tete} : voix clonée instable sur cette émission (${this.clonesRates} régénérations ratées) → voix native directement`)
      }
      for (let essai = 1; regenerable && essai <= this.o.maxEssais; essai++) {
        if (this.budgetEpuise(debut)) {
          if (!this.budgetAnnonce) {
            this.budgetAnnonce = true
            this.o.log(`${tete} : budget de régénération de l'émission épuisé (${this.regenerations} régénérations) — on passe à la voix de secours ou au rognage`)
          }
          break
        }
        this.regenerations++
        const r = reglagesEssai(essai, this.o.langue)
        const c = tour.viaClone
          ? await essayer(`régénération clonée (essai ${essai})`, () => this.o.moteurs.clone(tour.texte, tour.voixPersonnage as string, r))
          : await essayer(`régénération (essai ${essai})`, () => this.o.moteurs.locale(tour.texte, tour.voixLocale, r.maxCaracteres))
        if (c && c.analyse.defauts.length === 0) {
          if (tour.viaClone) this.clonesReussis++
          this.b.regeneres++
          this.o.log(`${tete} : ${constat} → régénéré (essai ${essai}) OK`)
          return c.wav
        }
        if (tour.viaClone) this.clonesRates++   // encore défectueux, ou moteur en panne : même verdict
        if (tour.viaClone && this.clonesRates >= this.o.coupeCircuit && this.clonesReussis === 0) break
      }

      // (b) La voix native de la langue, pour un tour qui était en voix clonée.
      if (tour.viaClone) {
        const c = await essayer(`voix de secours (${tour.voixLocale})`, () => this.o.moteurs.locale(tour.texte, tour.voixLocale))
        if (c && c.analyse.defauts.length === 0) {
          this.b.secours++
          this.o.log(`${tete} : ${constat} → voix de secours ${tour.voixLocale} OK`)
          return c.wav
        }
      }

      // (c) Le moins mauvais, blancs et chuchotements raccourcis.
      const meilleur = candidats.reduce((m, c) => (c.analyse.gravite < m.analyse.gravite ? c : m))
      const rogne = rognerDefauts(meilleur.wav.samples, meilleur.wav.sampleRate, meilleur.analyse)
      const reste = this.analyser({ samples: rogne.samples, sampleRate: meilleur.wav.sampleRate }, tour.texte)
      if (rogne.retireS > 0) {
        this.b.rognes++
        this.o.log(`${tete} : ${constat} → ${meilleur.origine}, blancs/chuchotements rognés (−${fmt(rogne.retireS)} s)`
          + `${reste.defauts.length ? ` ; reste : ${reste.defauts.map(d => d.detail).join(' ; ')}` : ' OK'}`)
        return { samples: rogne.samples, sampleRate: meilleur.wav.sampleRate }
      }
      this.b.gardes++
      this.o.log(`${tete} : ${constat} → aucune correction possible, ${meilleur.origine} gardé (le moins mauvais de ${candidats.length})`)
      return meilleur.wav
    } catch (err) {
      this.o.log(`${tete} : contrôle en échec (${(err as Error).message.slice(0, 100)}) — tour gardé tel quel`)
      return tour.wav
    } finally {
      this.b.dureeS += (this.o.maintenant() - debut) / 1000
    }
  }
}

/**
 * Les moteurs RÉELS du générateur (voix clonée data-space, Piper, Kokoro). Importés à la demande :
 * les tests du contrôle n'ont besoin ni du réseau ni des binaires.
 */
export function moteursReels(langue: string): MoteursControle {
  const local = async (texte: string, voix: string): Promise<DecodedWav> => {
    const { readWav } = await import('./audio')
    const { estVoixKokoro, synthesizeKokoro } = await import('./kokoro')
    const { synthesize } = await import('./piper')
    return readWav(estVoixKokoro(voix) ? await synthesizeKokoro(texte, voix) : await synthesize(texte, voix))
  }
  return {
    async clone(texte, voix, r) {
      const { synthesizeWithChatterbox } = await import('./chatterbox')
      const { decodeWav } = await import('./audio')
      const buf = await synthesizeWithChatterbox({
        voice: voix, text: texte, language: langue, format: 'wav',
        temperature: r.temperature, cfgWeight: r.cfgWeight, maxCaracteres: r.maxCaracteres,
      })
      return decodeWav(buf, `régénération ${voix}`)
    },
    async locale(texte, voix, maxCaracteres) {
      if (!maxCaracteres) return local(texte, voix)
      // Par morceaux (phrases) : un autre contexte prosodique, donc un autre rendu.
      const { decouperTexte } = await import('./chatterbox')
      const { concatWavs } = await import('./audio')
      const morceaux = decouperTexte(texte, maxCaracteres)
      if (morceaux.length <= 1) return local(texte, voix)
      const wavs: DecodedWav[] = []
      for (const m of morceaux) wavs.push(await local(m, voix))
      return concatWavs(wavs.map(wav => ({ wav, silenceApresS: 0.12 })))
    },
  }
}
