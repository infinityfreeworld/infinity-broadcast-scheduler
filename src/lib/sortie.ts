/**
 * @module InfinityScheduler/Lib/Sortie
 * @description Terminer un script à coup sûr, sans perdre la fin de son journal.
 *
 *   ── CE QUI EST ARRIVÉ (11/09/2026) ──
 *   Free Press FM a publié son émission à 03:25. À 03:35 son processus
 *   tournait encore, à 0 % de CPU, avec une connexion ÉTABLIE vers
 *   nostr.mom — le relais dont la connexion avait « expiré » pendant la
 *   publication. nostr-tools abandonne le relais au bout de son délai,
 *   mais la tentative de connexion continue et aboutit plus tard, hors de
 *   la liste que `pool.close()` referme. Une seule socket orpheline suffit
 *   à garder Node en vie.
 *
 *   Et generate-all attendait chaque station SANS délai : une station qui
 *   ne rend pas la main retenait toute la nuit derrière elle.
 *
 *   ── LA RÈGLE ──
 *   Un script à usage unique qui a fini son travail SORT — après avoir
 *   vidé stdout et stderr : sur macOS un tube s'écrit en asynchrone, et un
 *   `process.exit` sec peut couper la dernière ligne du journal, celle qui
 *   dit « publié ».
 */

export function terminer(code: number): void {
  process.exitCode = code
  // Filet : si un flux ne se vide jamais (tube bouché), on sort quand même.
  setTimeout(() => process.exit(code), 5_000).unref()
  process.stdout.write('', () => {
    process.stderr.write('', () => process.exit(code))
  })
}

/**
 * Délai maximal accordé à UNE station par la nuit. Une émission prend 10
 * à 30 min ; les voix clonées peuvent attendre le GPU jusqu'à ~55 min
 * (CHATTERBOX_ECHEANCE_S). Réglable par DELAI_STATION_MIN.
 */
export function delaiStationMs(): number {
  const min = Number.parseInt(process.env.DELAI_STATION_MIN ?? '', 10)
  return (Number.isFinite(min) && min > 0 ? min : 90) * 60_000
}
