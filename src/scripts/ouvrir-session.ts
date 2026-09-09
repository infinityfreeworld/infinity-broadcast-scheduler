#!/usr/bin/env tsx
/**
 * @module InfinityScheduler/Scripts/OuvrirSession
 * @description Annonce à data-space que nous allons diffuser, AVANT tout
 *   le reste.
 *
 *   ── POURQUOI SI TÔT ──
 *   data-space (08/09/2026) : « notre alerte se déclenche sur l'ouverture
 *   de la session, pas sur votre première tentative. Ouvrez donc la
 *   session tôt même si vous ne diffusez que tard : c'est ce qui nous
 *   laisse le temps de rattraper une panne d'allumage avant qu'elle ne
 *   devienne la vôtre. »
 *
 *   Auparavant la session s'ouvrait au milieu de `generate-broadcast`,
 *   après l'écriture des dialogues — soit une dizaine de minutes trop
 *   tard. Ici elle est le PREMIER geste de la nuit : leur station chauffe
 *   pendant que nous écrivons, et leur veille a le temps d'agir.
 *
 *   🔴 Ne fait JAMAIS échouer la nuit. Sans session, la synthèse marche —
 *   elle attend seulement plus longtemps.
 */
import 'dotenv/config'
import { ouvrirSessionDiffusion, preparerAccesChatterbox, etatSession } from '../lib/chatterbox'

async function main() {
  if (!process.env.CHATTERBOX_TTS_URL && !process.env.DATASPACE_NOSTR_KEY) {
    console.log('  · aucun service de voix clonée configuré — rien à ouvrir.')
    return
  }
  await preparerAccesChatterbox()
  const minutes = Number.parseInt(process.env.CHATTERBOX_SESSION_MINUTES ?? '300', 10)

  // 🔴 LE PLAFOND COURT DEPUIS L'OUVERTURE, pas depuis le chauffage.
  // data-space, 08/09/2026 :
  //     fin = min(chaude + demandées, ouverture + 360)
  // Ouvrir TÔT raccourcit donc la couverture au lieu de l'allonger. Une
  // ouverture à 17 h finit à 22 h 35 — une heure et demie avant la fin de
  // notre fenêtre — et notre garde accuserait leur station d'être morte,
  // sur une session que NOUS aurions ouverte trop tôt en croyant bien
  // faire. C'est la troisième fois cette semaine que le même piège se
  // présente : un désaccord de configuration qui accuse le partenaire.
  const CHAUFFE_MIN = Number.parseInt(process.env.CHATTERBOX_CHAUFFE_MIN ?? '35', 10)
  const PLAFOND_MIN = Number.parseInt(process.env.CHATTERBOX_PLAFOND_MIN ?? '360', 10)
  const FIN_FENETRE_H = Number.parseInt(process.env.FENETRE_FIN_H ?? '23', 10)

  const now = new Date()
  const finReelle = new Date(now.getTime()
    + Math.min(CHAUFFE_MIN + minutes, PLAFOND_MIN) * 60_000)
  const finFenetre = new Date(now)
  finFenetre.setHours(FIN_FENETRE_H, 59, 59, 0)
  if (finFenetre < now) finFenetre.setDate(finFenetre.getDate() + 1)

  const heure = (d: Date) => `${String(d.getHours()).padStart(2, '0')}h${String(d.getMinutes()).padStart(2, '0')}`
  if (finReelle < finFenetre) {
    const manque = Math.round((finFenetre.getTime() - finReelle.getTime()) / 60_000)
    console.warn(`  🔴 OUVERTURE TROP TÔT — la session finirait à ${heure(finReelle)},`)
    console.warn(`     soit ${manque} min AVANT la fin de la fenêtre (${heure(finFenetre)}).`)
    console.warn(`     Le plafond de ${PLAFOND_MIN} min court depuis l'ouverture, pas depuis le chauffage.`)
    console.warn(`     Session NON ouverte : une session qui expire en cours de nuit ferait`)
    console.warn(`     accuser leur station alors que le tort serait chez nous.`)
    return
  }
  console.log(`  couverture : jusqu'à ${heure(finReelle)} · fenêtre close à ${heure(finFenetre)} ✅`)

  await ouvrirSessionDiffusion(minutes)
  const e = await etatSession()
  if (e) {
    console.log(`  session : ouverte=${e.open} · préchauffage=${e.warming}`
      + ` · station prête=${e.station_ready} · ${e.minutes_left ?? '?'} min restantes`)
  }
}
main().catch(e => {
  // Jamais bloquant : une nuit sans session vaut mieux qu'une nuit sans émission.
  console.warn(`  ⚠️ ouverture de session impossible (${(e as Error).message.slice(0, 120)}) — on continue`)
})
