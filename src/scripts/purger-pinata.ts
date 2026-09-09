#!/usr/bin/env tsx
/**
 * @module InfinityScheduler/Scripts/PurgerPinata
 * @description Auto-purge des broadcasts trop vieux sur Pinata, isolée du
 *   reste de la génération.
 *
 *   Elle vivait dans `generate-all.ts`, qui traitait les 15 stations d'un
 *   bloc. Depuis que chaque station a son propre job, la purge doit
 *   tourner UNE FOIS avant tous — la lancer par station supprimerait le
 *   travail des stations précédentes.
 *
 *   Garde [hier, aujourd'hui, cible] : de quoi couvrir le chevauchement
 *   entre le jour courant et le lendemain, plus une marge pour l'auditeur
 *   qui reste des heures sur une page.
 *
 *   Usage : tsx src/scripts/purger-pinata.ts [YYYY-MM-DD]
 */

import 'dotenv/config'
import { purgeOldBroadcasts } from '../lib/pinata'

function isoLocal(decalageJours = 0): string {
  const d = new Date()
  d.setDate(d.getDate() + decalageJours)
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const j = String(d.getDate()).padStart(2, '0')
  return `${d.getFullYear()}-${m}-${j}`
}

async function main() {
  const jwt = process.env.PINATA_JWT
  if (!jwt) {
    console.log('· PINATA_JWT absent — purge sautée (ce n\'est pas une erreur).')
    return
  }
  // `||` et non `??` : le workflow passe une chaîne VIDE quand le cron
  // se déclenche sans saisie manuelle. Voir le bug du 2026-05-19.
  const cible = process.argv[2] || process.env.TARGET_DATE || isoLocal(1)
  const garder = new Set([isoLocal(-1), isoLocal(0), cible])

  console.log(`🧹 Purge Pinata — on garde [${[...garder].join(', ')}]`)
  const { pruned, freedBytes, errors } = await purgeOldBroadcasts(jwt, garder)
  console.log(`   ✓ ${pruned} pin(s) supprimé(s), ${(freedBytes / 1024 / 1024).toFixed(1)} Mo libéré(s)`)
  for (const e of errors.slice(0, 5)) console.warn(`   ⚠️  ${e}`)
}

main().catch(err => {
  // Une purge qui échoue ne doit PAS empêcher la nuit de diffuser.
  console.warn('⚠️  Purge échouée, on continue :', err instanceof Error ? err.message : err)
})
