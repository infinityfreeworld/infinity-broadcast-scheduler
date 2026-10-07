/**
 * @module InfinityScheduler/Lib/Chantier
 * @description 🧱 Le CHANTIER d'une émission : ce qui a déjà été fabriqué pour (station, date),
 *   gardé sur le disque pour qu'une reprise plus tard dans la nuit ne refasse QUE ce qui manque.
 *
 *   ── POURQUOI (diagnostic du 07/10/2026, journaux du 21/09 au 06/10) ──
 *   Une émission dont des tours avaient perdu leur voix de personnage partait en voix robotique.
 *   La refaire entièrement aurait recoûté l'écriture (le modèle de langue) ET les tours déjà
 *   réussis chez data-space — or c'est précisément le temps de GPU qui manque. Le chantier garde :
 *     · le TEXTE écrit (dialogue et plan des voix) : une reprise n'écrit rien, ne paie rien ;
 *     · chaque tour DÉJÀ DIT par sa voix de personnage, contrôlé et réécouté : jamais redemandé.
 *   Les tours en voix locale voulue (Piper/Kokoro) ne sont pas gardés : ils se refont en local.
 *
 *   Emplacement : `RADIO_CHANTIERS_DIR`, sinon …/infinity-radio/chantiers (à côté du témoin de nuit).
 *   Un chantier est supprimé dès que l'émission est publiée (ou que la veille est gardée) ;
 *   `purgerChantiers` efface ceux de plus de 3 jours (une nuit qui a planté).
 */
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { decodeWav, encodeWav, type DecodedWav } from './audio'

const VERSION = 1

export function dossierChantiers(env: NodeJS.ProcessEnv = process.env): string {
  if (env.RADIO_CHANTIERS_DIR) return env.RADIO_CHANTIERS_DIR
  const base = existsSync(join(homedir(), 'Library'))
    ? join(homedir(), 'Library', 'Application Support', 'infinity-radio')
    : join(env.XDG_STATE_HOME ?? join(homedir(), '.local', 'state'), 'infinity-radio')
  return join(base, 'chantiers')
}

/** Ce qu'une reprise doit retrouver de l'écriture : les tours (transcript) et le plan des voix. */
export interface TextesChantier<Tour, Plan> {
  turns: Tour[]
  plans: Plan[]
}

interface Fichier<Tour, Plan> extends TextesChantier<Tour, Plan> {
  version:   number
  stationId: string
  date:      string
  ecritLe:   string
  /** Nombre de passages déjà tentés (pour le journal). */
  passages:  number
}

/** Nom de fichier sûr pour une station et une date (aucun « / » ni « .. » ne passe). */
export function nomChantier(stationId: string, date: string): string {
  return `${stationId}-${date}`.replace(/[^\w.-]+/g, '_').replace(/\.{2,}/g, '_')
}

export class Chantier<Tour = unknown, Plan extends { texte: string } = { texte: string }> {
  readonly dossier: string

  constructor(readonly stationId: string, readonly date: string, racine = dossierChantiers()) {
    this.dossier = join(racine, nomChantier(stationId, date))
  }

  private get fichier(): string { return join(this.dossier, 'chantier.json') }
  private tourWav(i: number): string { return join(this.dossier, `tour-${String(i + 1).padStart(2, '0')}.wav`) }

  private lire(): Fichier<Tour, Plan> | null {
    try {
      const f = JSON.parse(readFileSync(this.fichier, 'utf8')) as Fichier<Tour, Plan>
      if (f.version !== VERSION || f.stationId !== this.stationId || f.date !== this.date) return null
      if (!Array.isArray(f.turns) || !Array.isArray(f.plans) || f.turns.length !== f.plans.length) return null
      return f
    } catch {
      return null
    }
  }

  /** Les textes déjà écrits, ou null (pas de chantier, ou illisible : on réécrit, c'est tout). */
  textes(): TextesChantier<Tour, Plan> | null {
    const f = this.lire()
    return f ? { turns: f.turns, plans: f.plans } : null
  }

  passages(): number { return this.lire()?.passages ?? 0 }

  enregistrerTextes(turns: Tour[], plans: Plan[]): void {
    mkdirSync(this.dossier, { recursive: true })
    const avant = this.lire()
    const f: Fichier<Tour, Plan> = {
      version: VERSION, stationId: this.stationId, date: this.date,
      ecritLe: new Date().toISOString(), passages: (avant?.passages ?? 0) + 1,
      turns, plans,
    }
    writeFileSync(this.fichier, JSON.stringify(f))
  }

  /** Le tour i a-t-il déjà été dit par sa voix de personnage (et gardé) ? */
  aLeTour(i: number): boolean { return existsSync(this.tourWav(i)) }

  /** Le WAV gardé du tour i, ou null (absent ou illisible — il sera refait). */
  lireTour(i: number): DecodedWav | null {
    try {
      return existsSync(this.tourWav(i)) ? decodeWav(readFileSync(this.tourWav(i)), this.tourWav(i)) : null
    } catch {
      // Illisible (écriture interrompue) : on l'efface, pour qu'il soit refait au lieu d'être
      // éternellement « déjà fait » sans rien à monter.
      rmSync(this.tourWav(i), { force: true })
      return null
    }
  }

  enregistrerTour(i: number, wav: DecodedWav): void {
    mkdirSync(this.dossier, { recursive: true })
    writeFileSync(this.tourWav(i), encodeWav(wav))
  }

  /** Indices des tours gardés. */
  toursGardes(): number[] {
    try {
      return readdirSync(this.dossier)
        .map(n => /^tour-(\d+)\.wav$/.exec(n)?.[1])
        .filter((n): n is string => !!n)
        .map(n => Number.parseInt(n, 10) - 1)
        .sort((a, b) => a - b)
    } catch {
      return []
    }
  }

  supprimer(): void {
    rmSync(this.dossier, { recursive: true, force: true })
  }
}

/** Efface les chantiers de plus de `maxJours` (défaut 3). Rend les noms effacés. Ne lève jamais. */
export function purgerChantiers(racine = dossierChantiers(), maxJours = 3, maintenant = Date.now()): string[] {
  const effaces: string[] = []
  try {
    for (const nom of readdirSync(racine)) {
      const chemin = join(racine, nom)
      try {
        if (maintenant - statSync(chemin).mtimeMs > maxJours * 86_400_000) {
          rmSync(chemin, { recursive: true, force: true })
          effaces.push(nom)
        }
      } catch { /* un chantier illisible n'arrête pas la purge */ }
    }
  } catch { /* pas encore de dossier */ }
  return effaces
}
