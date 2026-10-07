/**
 * @module InfinityScheduler/Lib/RepriseEmission
 * @description 🔁 Tour par tour : garder ce qui est réussi, réécouter, et REPORTER ce qui manque
 *   plutôt que de le dire en voix robotique.
 *
 *   ── LE DIAGNOSTIC QUI L'A FAIT NAÎTRE (journaux du 21/09 au 06/10/2026) ──
 *   Sur 2 171 tours qui ont perdu leur voix de personnage, 1 919 (88 %) l'ont perdue sur
 *   « échéance de la NUIT dépassée » : generate-all n'accordait que 150 minutes de voix clonée à
 *   toute la nuit, et le GPU de data-space met 15 à 60 minutes par station (il calcule à peu près
 *   en temps réel : ~20 min d'audio par émission, l'attente « file pleine » n'est que le relevé
 *   régulier d'un travail en cours). Les 3 à 5 premières stations consommaient tout ; les 9 à 11
 *   suivantes partaient ENTIÈRES en Piper. Le reste : coupures réseau du Mac (141 tours), jeton
 *   data-space indérivable pendant ces coupures → 401 sur toute une station (81 tours).
 *
 *   Rien de tout cela n'est définitif : quelques heures plus tard, le GPU est libre et le réseau
 *   revenu. D'où ce module :
 *     · un tour dit par sa voix de personnage (et accepté par l'oreille) est GARDÉ dans le
 *       chantier (chantier.ts) : il ne sera jamais redemandé ;
 *     · un tour qui l'a perdue n'est PAS synthétisé en Piper tant que ce n'est pas la dernière
 *       chance : il est noté MANQUANT, et l'émission est reportée (code 75) ;
 *     · à la reprise, seuls les manquants repartent chez data-space ;
 *     · à la dernière chance, le repli Piper reprend son rôle, et la règle de publication
 *       (regle-publication.ts) décide de publier ou de garder la veille.
 *
 *   L'oreille (oreille.ts) passe sur chaque tour cloné NEUF : un tour incompréhensible est
 *   régénéré tout de suite (`OREILLE_ESSAIS`, 1), puis reporté comme un tour manquant.
 */
import type { DecodedWav } from './audio'
import type { Chantier, TextesChantier } from './chantier'
import type { Jugement, Oreille } from './oreille'
import { ArretVolontaire, CODE_A_REPRENDRE, type EtatEmission } from './regle-publication'

export interface MoteursReprise {
  /** Nouvelle synthèse du tour en voix de personnage (essai 1, 2… : réglages plus prudents). */
  clone(texte: string, voix: string, essai: number): Promise<DecodedWav>
  /** Synthèse en voix locale (Piper / Kokoro). */
  locale(texte: string, voix: string): Promise<DecodedWav>
}

export interface OptionsReprise<Tour, Plan extends { texte: string }> {
  chantier:       Chantier<Tour, Plan> | null
  derniereChance: boolean
  oreille:        Oreille | null
  langue:         string
  moteurs:        MoteursReprise
  /** Régénérations immédiates d'un tour refusé par l'oreille (défaut `OREILLE_ESSAIS`, 1). */
  essaisOreille?: number
  log?:           (ligne: string) => void
}

export type StatutTour = 'clone' | 'repris' | 'repli' | 'locale' | 'manquant' | 'incompris'

export interface TourFini {
  i:              number
  texte:          string
  voixPersonnage: string | null
  voixLocale:     string
  wav:            DecodedWav
  /** Le WAV vient-il RÉELLEMENT de la voix de personnage (et pas d'un secours) ? */
  viaClone:       boolean
}

export type IssueTour = { wav: DecodedWav; aReprendre?: false } | { aReprendre: true }

export class RepriseEmission<Tour = unknown, Plan extends { texte: string } = { texte: string }> {
  private readonly statuts = new Map<number, StatutTour>()
  private readonly motifs = new Map<number, string>()
  private attendus = 0
  private ecoutes = 0
  private refaitsOreille = 0
  private readonly log: (l: string) => void
  private readonly essaisOreille: number

  constructor(private readonly o: OptionsReprise<Tour, Plan>) {
    this.log = o.log ?? (l => console.log(l))
    const n = Number.parseInt(process.env.OREILLE_ESSAIS ?? '', 10)
    this.essaisOreille = o.essaisOreille ?? (Number.isFinite(n) && n >= 0 ? n : 1)
  }

  get derniereChance(): boolean { return this.o.derniereChance }

  /** Les textes d'un passage précédent : si présents, on n'écrit RIEN. */
  textesRepris(): TextesChantier<Tour, Plan> | null {
    return this.o.chantier?.textes() ?? null
  }

  enregistrerTextes(turns: Tour[], plans: Plan[]): void {
    this.attendus = plans.filter(p => !!(p as { voixPersonnage?: unknown }).voixPersonnage).length
    try { this.o.chantier?.enregistrerTextes(turns, plans) } catch (err) {
      this.log(`    ⚠ chantier illisible en écriture (${(err as Error).message.slice(0, 80)}) — pas de reprise possible pour cette émission`)
    }
  }

  /** Le tour i est-il déjà fait (gardé d'un passage précédent) ? Il ne repart pas chez data-space. */
  dejaFait(i: number): boolean { return this.o.chantier?.aLeTour(i) ?? false }

  /** Le WAV gardé du tour i (null s'il faut le faire). */
  reprendreTour(i: number): DecodedWav | null {
    const wav = this.o.chantier?.lireTour(i) ?? null
    if (wav) this.statuts.set(i, 'repris')
    return wav
  }

  /** Un tour sans voix de personnage peut-il être laissé pour plus tard au lieu d'être dit en Piper ? */
  reporterLesManques(): boolean {
    return !this.o.derniereChance && this.o.chantier !== null
  }

  manque(i: number, motif: string): void {
    this.statuts.set(i, 'manquant')
    this.motifs.set(i, motif)
  }

  private garder(i: number, wav: DecodedWav): void {
    try { this.o.chantier?.enregistrerTour(i, wav) } catch (err) {
      this.log(`    ⚠ tour ${i + 1} non gardé (${(err as Error).message.slice(0, 80)})`)
    }
  }

  private async ecouter(wav: DecodedWav, texte: string): Promise<Jugement | null> {
    if (!this.o.oreille) return null
    const j = await this.o.oreille.ecouter(wav, texte, this.o.langue)
    if (j) this.ecoutes++
    return j
  }

  /**
   * Le tour i est synthétisé et contrôlé (signal) : on décide de son sort. Rend le WAV à monter,
   * ou `aReprendre` (le tour sera refait à un passage suivant ; rien à monter pour lui).
   */
  async apresTour(t: TourFini): Promise<IssueTour> {
    const tete = `    🔁 tour ${t.i + 1}`
    if (!t.voixPersonnage) {
      this.statuts.set(t.i, 'locale')
      return { wav: t.wav }
    }
    if (this.statuts.get(t.i) === 'repris') return { wav: t.wav }

    if (!t.viaClone) {
      if (this.reporterLesManques()) {
        this.manque(t.i, 'voix de personnage perdue')
        this.log(`${tete} : voix de personnage perdue → à reprendre plus tard (pas de Piper)`)
        return { aReprendre: true }
      }
      this.statuts.set(t.i, 'repli')
      this.motifs.set(t.i, 'voix de personnage perdue')
      return { wav: t.wav }
    }

    // Voix de personnage obtenue : l'oreille juge.
    let wav = t.wav
    let j = await this.ecouter(wav, t.texte)
    for (let essai = 1; j?.verdict === 'mauvais' && essai <= this.essaisOreille; essai++) {
      this.log(`    👂 tour ${t.i + 1} : ${j.motif} → régénération (essai ${essai})`)
      try {
        const nouveau = await this.o.moteurs.clone(t.texte, t.voixPersonnage, essai + 1)
        const j2 = await this.ecouter(nouveau, t.texte)
        if (j2?.verdict !== 'mauvais') {
          this.refaitsOreille++
          wav = nouveau
          j = j2
          this.log(`    👂 tour ${t.i + 1} : ${j2 ? j2.motif : 'pas d\'avis'} après régénération — gardé`)
          break
        }
        j = j2
      } catch (err) {
        this.log(`    👂 tour ${t.i + 1} : régénération impossible (${(err as Error).message.split('\n')[0].slice(0, 90)})`)
        break
      }
    }

    if (j?.verdict === 'mauvais') {
      if (this.reporterLesManques()) {
        this.manque(t.i, `incompréhensible (${j.motif})`)
        this.log(`    👂 tour ${t.i + 1} : toujours incompréhensible (${j.motif}) → à refaire plus tard`)
        return { aReprendre: true }
      }
      // Dernière chance : une voix locale intelligible plutôt qu'une réplique incompréhensible.
      try {
        const local = await this.o.moteurs.locale(t.texte, t.voixLocale)
        this.statuts.set(t.i, 'repli')
        this.motifs.set(t.i, `incompréhensible (${j.motif}), dit en voix locale`)
        this.log(`    👂 tour ${t.i + 1} : incompréhensible (${j.motif}) → voix locale ${t.voixLocale}`)
        return { wav: local }
      } catch (err) {
        this.statuts.set(t.i, 'incompris')
        this.motifs.set(t.i, `incompréhensible (${j.motif}), voix locale impossible`)
        this.log(`    👂 tour ${t.i + 1} : incompréhensible ET voix locale impossible (${(err as Error).message.slice(0, 80)}) — gardé tel quel`)
        return { wav }
      }
    }

    this.statuts.set(t.i, 'clone')
    this.garder(t.i, wav)
    return { wav }
  }

  /** Tours laissés pour plus tard. */
  manquants(): number[] {
    return [...this.statuts.entries()].filter(([, s]) => s === 'manquant').map(([i]) => i).sort((a, b) => a - b)
  }

  /** À la fin de la synthèse : s'il manque des tours, l'émission est REPORTÉE (lève). */
  verifierManques(): void {
    const m = this.manquants()
    if (m.length === 0) return
    const gardes = this.o.chantier?.toursGardes().length ?? 0
    throw new ArretVolontaire(
      `⏭  émission REPORTÉE : ${m.length} tour(s) sans voix de personnage (${m.map(i => i + 1).join(', ')} — `
      + `${[...new Set(m.map(i => this.motifs.get(i)))].join(' ; ')}). ${gardes} tour(s) gardé(s) dans le chantier ; `
      + `seuls les manquants seront refaits à la reprise.`,
      CODE_A_REPRENDRE,
    )
  }

  /** Reporter l'émission ENTIÈRE (service injoignable avant le premier tour). */
  reporterTout(motif: string): never {
    throw new ArretVolontaire(`⏭  émission REPORTÉE avant toute synthèse : ${motif}`, CODE_A_REPRENDRE)
  }

  etat(): EtatEmission {
    const compter = (s: StatutTour) => [...this.statuts.values()].filter(x => x === s).length
    const attendus = this.attendus || [...this.statuts.values()].filter(s => s !== 'locale').length
    return {
      attendus,
      repli:     compter('repli') + compter('manquant'),
      incompris: compter('incompris'),
      derniereChance: this.o.derniereChance,
    }
  }

  ligneBilan(): string {
    const c = (s: StatutTour) => [...this.statuts.values()].filter(x => x === s).length
    const ind = this.o.oreille?.indisponible()
    const oreille = !this.o.oreille ? 'oreille non branchée'
      : ind ? `oreille INDISPONIBLE (${ind}) — signal seul`
      : `oreille : ${this.ecoutes} écoute(s), ${this.refaitsOreille} tour(s) refait(s)`
    return `🔁 Voix : ${c('clone')} clonée(s) neuve(s), ${c('repris')} reprise(s) du chantier, `
      + `${c('repli')} en repli, ${c('manquant')} à reprendre, ${c('incompris')} incompréhensible(s) · ${oreille}`
  }

  /** L'émission est publiée (ou la veille gardée) : le chantier n'a plus d'objet. */
  clore(): void {
    try { this.o.chantier?.supprimer() } catch { /* sans importance */ }
  }
}
