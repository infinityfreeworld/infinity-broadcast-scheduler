#!/usr/bin/env tsx
/**
 * @module InfinityScheduler/Scripts/ViderEmissions
 * @description 🧹 Retirer des RELAIS les émissions (kind 30093) de plus de N jours — préparé le 12/10/2026,
 *   JAMAIS EXÉCUTÉ. Complète `purger-emissions.ts`, qui dépingle déjà leur AUDIO du dépôt data-space.
 *
 *   À BLANC par défaut : lit les relais et affiche ce qui serait retiré. Pour exécuter, il faut LES DEUX :
 *     --executer   ET   VIDAGE_CONFIRME_PAR_MED=oui
 *   (décision de Med requise avant tout vidage).
 *
 *   Usage : NOSTR_PRIVATE_KEY=… tsx src/scripts/vider-emissions.ts [--jours=10] [--executer]
 *   L'audio : `tsx src/scripts/purger-emissions.ts` (à blanc), puis `--executer`.
 */
import 'dotenv/config'
import { SimplePool } from 'nostr-tools/pool'
import { getRelays, pubkeyDe, publierEvenement, RADIO_BROADCAST_KIND } from '../lib/nostr'
import { aRetirer, demandesSuppression, type EmissionRelais } from '../lib/vidage-emissions'

async function main() {
  const cle = process.env.NOSTR_PRIVATE_KEY
  if (!cle) { console.error('NOSTR_PRIVATE_KEY absente : impossible de reconnaître nos émissions.'); process.exit(1) }
  const jours = Number.parseInt(process.argv.find(a => a.startsWith('--jours='))?.slice(8) ?? '10', 10)
  const executer = process.argv.includes('--executer') && process.env.VIDAGE_CONFIRME_PAR_MED === 'oui'
  const moi = pubkeyDe(cle)
  const pool = new SimplePool()
  const relais = getRelays()
  // Page par page, relais par relais : un relais plafonne chaque réponse (500 sur data-space) — sans pagination on ne
  // voyait que 517 émissions sur 1 350 (12/10/2026).
  const parD = new Map<string, EmissionRelais>()
  for (const r of relais) {
    let until: number | undefined
    for (let page = 0; page < 50; page++) {
      const evs = await pool.querySync([r], { kinds: [RADIO_BROADCAST_KIND], authors: [moi], limit: 500, ...(until ? { until } : {}) }, { maxWait: 20_000 })
      for (const e of evs) { const d = e.tags.find(t => t[0] === 'd')?.[1] ?? ''; parD.set(d, { pubkey: e.pubkey, d }) }
      if (evs.length === 0) break
      const plusVieux = Math.min(...evs.map(e => e.created_at))
      if (until !== undefined && plusVieux >= until) break
      until = plusVieux - 1
      if (evs.length < 100) break
    }
  }
  pool.close(relais)
  const lues: EmissionRelais[] = [...parD.values()]
  const aujourdhui = new Date().toISOString().slice(0, 10)
  const liste = aRetirer(lues, moi, aujourdhui, jours)
  console.log(`${lues.length} émission(s) lue(s) · ${liste.length} de plus de ${jours} jours à retirer`)
  const paquets = demandesSuppression(liste, Math.floor(Date.now() / 1000), 40) // 40 : le relais radio refuse un paquet de 100 (trop d’étiquettes)
  if (!executer) {
    console.log(`· À BLANC. ${paquets.length} demande(s) de suppression NIP-09 seraient publiées.`)
    console.log('  Pour exécuter (accord de Med) : VIDAGE_CONFIRME_PAR_MED=oui … --executer')
    return
  }
  for (const p of paquets) {
    const r = await publierEvenement(p, cle)
    console.log(`  ✓ ${r.eventId.slice(0, 12)}… (${p.tags.length - 1} émission(s)) — ${r.relays.filter(x => x.ok).length}/${r.relays.length} relais`)
  }
}

main().then(() => process.exit(0), e => { console.error(e); process.exit(1) })
