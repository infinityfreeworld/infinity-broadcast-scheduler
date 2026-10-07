/**
 * @module InfinityScheduler/Lib/RepriseBranchement
 * @description Le BRANCHEMENT de la reprise, de l'oreille et de la règle de publication dans
 *   generate-broadcast — rassemblé ici pour que le script n'en porte que quelques lignes.
 *   Tout ce qui décide est pur et éprouvé ailleurs (reprise-emission, oreille, regle-publication) ;
 *   ce fichier ne fait que brancher les vrais moteurs, le vrai disque et les vrais relais.
 */
import type { DecodedWav } from './audio'
import { Chantier } from './chantier'
import { moteursReels, reglagesEssai } from './controle-voix'
import { Oreille, transcripteurWhisperCpp } from './oreille'
import {
  ArretVolontaire, CODE_A_REPRENDRE, CODE_VEILLE_GARDEE, deciderPublication, estDerniereChance, joursPrecedents,
  reglesPublication, type DecisionPublication,
} from './regle-publication'
import { RepriseEmission } from './reprise-emission'

/**
 * La reprise d'une émission. En RÉPÉTITION : ni chantier, ni report — tout se fait d'un trait,
 * comme avant (une répétition n'a pas de nuit derrière elle).
 */
export function preparerReprise<Tour, Plan extends { texte: string }>(
  stationId: string, date: string, langue: string, repetition: boolean,
): RepriseEmission<Tour, Plan> {
  const moteurs = moteursReels(langue)
  const oreille = new Oreille(transcripteurWhisperCpp())
  const reprise = new RepriseEmission<Tour, Plan>({
    chantier:       repetition ? null : new Chantier<Tour, Plan>(stationId, date),
    derniereChance: repetition || estDerniereChance(),
    oreille,
    langue,
    moteurs: {
      clone: (texte, voix, essai): Promise<DecodedWav> => moteurs.clone(texte, voix, reglagesEssai(essai, langue)),
      locale: (texte, voix) => moteurs.locale(texte, voix),
    },
  })
  const ind = oreille.indisponible()
  console.log(`    🔁 ${reprise.derniereChance ? 'DERNIÈRE CHANCE (la règle de publication finale s\'applique)' : 'passage reportable (un tour sans sa voix sera repris plus tard)'}`
    + ` · 👂 ${ind ? `oreille indisponible : ${ind}` : 'oreille de contrôle active'}`)
  return reprise
}

/**
 * La décision de publication, avec la consultation des relais SEULEMENT si elle compte (fin de
 * fenêtre, mode « garder la veille »). Lève `ArretVolontaire` pour un report ou une veille gardée.
 */
export async function deciderOuArreter(
  reprise: RepriseEmission<unknown, { texte: string }>,
  veilleALAntenne: (dates: string[]) => Promise<boolean | null>,
  date: string,
): Promise<DecisionPublication> {
  const regles = reglesPublication()
  const etat = reprise.etat()
  const aConsulter = etat.derniereChance && regles.mode === 'garder-veille' && etat.repli + etat.incompris > regles.tolere
  const veille = aConsulter ? await veilleALAntenne(joursPrecedents(date, regles.veilleMaxJours)) : null
  const d = deciderPublication(etat, regles, veille)
  if (d.action === 'reporter') reprise.verifierManques()   // lève (les manquants sont listés)
  if (d.action === 'reporter') throw new ArretVolontaire(`⏭  émission REPORTÉE : ${d.raison}`, CODE_A_REPRENDRE)
  if (d.action === 'garder-veille') {
    reprise.clore()
    throw new ArretVolontaire(`🛑 émission NON PUBLIÉE : ${d.raison}`, CODE_VEILLE_GARDEE)
  }
  return d
}
