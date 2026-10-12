/**
 * @module InfinityScheduler/Lib/NoteQualite
 * @description 🏷 LA NOTE DE QUALITÉ D'UNE ÉMISSION (12/10/2026, validé par le Bâtisseur).
 *
 *   Ce que le journal de la nuit sait déjà — voix clonées obtenues, voix de secours, défauts audio
 *   corrigés, oreille de contrôle, sonie — publié DANS l'émission (contenu JSON du kind 30093, champ
 *   `qualite`) pour qu'IHL › Radio puisse l'afficher sans aller lire les journaux GitHub.
 *
 *   ── CONTRAT (ADDITIF ET FACULTATIF) ──
 *   Le champ est absent des émissions d'avant le 12/10/2026 ; l'application actuelle l'ignore (son
 *   codec ne lit que les champs qu'il connaît). Un lecteur doit tolérer l'absence de chaque champ
 *   marqué `?` et ignorer les champs qu'il ne connaît pas (`version` augmentera si un sens change).
 *
 *     qualite: {
 *       version:          1,
 *       voixAttendues:    number,   // tours qui devaient être dits par une voix de personnage
 *       voixClonees:      number,   // …réellement dits par elle (neufs + repris d'un passage précédent)
 *       voixSecours:      number,   // …dits par une voix de secours (Piper / Kokoro) à la place
 *       incompris:        number,   // tours jugés incompréhensibles par l'oreille et diffusés quand même
 *       defautsDetectes:  number,   // défauts audio repérés (blanc, chuchotement, texte non dit, écrêtage…)
 *       defautsCorriges:  number,   // …dont corrigés (tour régénéré ou rogné)
 *       oreille:          'active' | 'absente' | 'coupee' | 'en-panne' | 'non-branchee',
 *       ecoutes?:         number,   // tours réécoutés par l'oreille (si active)
 *       refaitsOreille?:  number,   // tours refaits parce que l'oreille ne les comprenait pas
 *       hesitations?:     { ecrites: number, entendues: number },  // « euh » écrits / retrouvés à l'écoute (indice)
 *       lufs?:            number,   // sonie intégrée de l'émission publiée (EBU R128, 1 décimale)
 *       creteDb?:         number,   // crête d'échantillon (dBFS, 1 décimale)
 *       producteur?:      string,   // 'mac' | 'github-secours' | …
 *     }
 *
 *   Un résumé lisible (`resumeQualite`) sert au journal et pourra servir de texte d'infobulle.
 */

export type EtatOreilleNote = 'active' | 'absente' | 'coupee' | 'en-panne' | 'non-branchee'

export interface NoteQualite {
  version:          1
  voixAttendues:    number
  voixClonees:      number
  voixSecours:      number
  incompris:        number
  defautsDetectes:  number
  defautsCorriges:  number
  oreille:          EtatOreilleNote
  ecoutes?:         number
  refaitsOreille?:  number
  hesitations?:     { ecrites: number; entendues: number }
  lufs?:            number
  creteDb?:         number
  producteur?:      string
}

/** Ce que le générateur sait à la fin de la synthèse (tout facultatif sauf les compteurs de voix). */
export interface SourcesNote {
  voixAttendues: number
  voixObtenues:  number
  /** Compteurs de la reprise (reprise-emission.ts), s'il y en a une. */
  reprise?: { clone: number; repris: number; incompris: number } | null
  /** Bilan du contrôle de voix (controle-voix.ts). */
  controle?: { defectueux: number; regeneres: number; rognes: number } | null
  oreille?: { statut: EtatOreilleNote; ecoutes: number; refaits: number; hesitationsEcrites: number; hesitationsAvalees: number } | null
  sonie?: { apresLufs: number; creteDb: number } | null
  producteur?: string
}

const entier = (n: unknown): number => (typeof n === 'number' && Number.isFinite(n) && n > 0 ? Math.round(n) : 0)
const dixieme = (n: number) => Math.round(n * 10) / 10

/** La note, à partir de ce que le générateur sait. Pure. */
export function noteQualite(s: SourcesNote): NoteQualite {
  const attendues = entier(s.voixAttendues)
  // La reprise distingue les tours neufs et repris ; sans elle, le compteur du générateur fait foi.
  const clonees = Math.min(attendues, s.reprise ? entier(s.reprise.clone) + entier(s.reprise.repris) : entier(s.voixObtenues))
  const o = s.oreille
  const note: NoteQualite = {
    version: 1,
    voixAttendues: attendues,
    voixClonees: clonees,
    voixSecours: Math.max(0, attendues - clonees),
    incompris: entier(s.reprise?.incompris),
    defautsDetectes: entier(s.controle?.defectueux),
    defautsCorriges: Math.min(entier(s.controle?.defectueux), entier(s.controle?.regeneres) + entier(s.controle?.rognes)),
    oreille: o?.statut ?? 'non-branchee',
  }
  if (o && o.statut === 'active') {
    note.ecoutes = entier(o.ecoutes)
    note.refaitsOreille = entier(o.refaits)
    if (o.hesitationsEcrites > 0) {
      note.hesitations = { ecrites: entier(o.hesitationsEcrites), entendues: Math.max(0, entier(o.hesitationsEcrites) - entier(o.hesitationsAvalees)) }
    }
  }
  if (s.sonie && Number.isFinite(s.sonie.apresLufs) && s.sonie.apresLufs > -70) {
    note.lufs = dixieme(s.sonie.apresLufs)
    note.creteDb = dixieme(s.sonie.creteDb)
  }
  if (s.producteur) note.producteur = s.producteur.slice(0, 40)
  return note
}

/** Une ligne pour le journal (et une future infobulle). Pure. */
export function resumeQualite(n: NoteQualite): string {
  const morceaux = [
    n.voixAttendues > 0 ? `voix de personnage ${n.voixClonees}/${n.voixAttendues}${n.voixSecours ? ` (${n.voixSecours} en secours)` : ''}` : 'voix locales seulement',
    n.defautsDetectes ? `défauts ${n.defautsCorriges}/${n.defautsDetectes} corrigés` : 'aucun défaut audio',
    n.oreille === 'active' ? `oreille ${n.ecoutes ?? 0} écoute(s)${n.refaitsOreille ? `, ${n.refaitsOreille} refait(s)` : ''}` : `oreille ${n.oreille}`,
  ]
  if (n.hesitations) morceaux.push(`« euh » entendus ${n.hesitations.entendues}/${n.hesitations.ecrites}`)
  if (n.incompris) morceaux.push(`${n.incompris} incompris`)
  if (n.lufs !== undefined) morceaux.push(`${n.lufs} LUFS`)
  return `🏷 Qualité : ${morceaux.join(' · ')}`
}
