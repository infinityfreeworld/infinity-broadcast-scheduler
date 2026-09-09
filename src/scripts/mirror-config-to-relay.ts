#!/usr/bin/env tsx
/**
 * @module InfinityScheduler/Scripts/MirrorConfigToRelay
 * @description Recopie la CONFIGURATION radio (personas, voix, invités,
 *   Pulse) des relais publics vers notre relais souverain.
 *
 *   ── POURQUOI ──
 *   Jusqu'au 01/09/2026, le relais souverain REFUSAIT ces kinds
 *   (« blocked: event kind 30104 not allowed »). Toute la configuration
 *   créée depuis le panneau Pirate n'a donc jamais pu y entrer : elle ne
 *   survit que sur des relais publics, qui purgent les kinds custom sans
 *   prévenir. 7 personas unifiées, 31 voix, et les réglages Pulse étaient
 *   dans cet état — à une purge près de disparaître.
 *
 *   ── CE QUE CE SCRIPT NE FAIT PAS ──
 *   Il ne RE-SIGNE rien. Les events sont renvoyés **tels quels**, octet
 *   pour octet, avec leur signature d'origine. Re-signer changerait
 *   l'auteur et fabriquerait de faux documents ; recopier préserve la
 *   preuve que c'est bien l'admin qui les a écrits.
 *
 *   ── USAGE ──
 *     tsx src/scripts/mirror-config-to-relay.ts            # à blanc (défaut)
 *     tsx src/scripts/mirror-config-to-relay.ts --executer # écrit vraiment
 *
 *   Le mode à blanc liste ce qui serait recopié, sans rien écrire.
 */

import 'dotenv/config'
import { SimplePool } from 'nostr-tools/pool'
import type { Event as NostrEvent } from 'nostr-tools/core'
import { getRelays } from '../lib/nostr'
import { SEED_STATIONS } from '../data/seed-stations'

const RELAIS_SOUVERAIN = 'wss://infinity-radio-relay.digitalforlifeagency.workers.dev'

/** Les kinds de CONFIGURATION. 30093 (les émissions) n'est pas ici : il
 *  était déjà accepté, et son volume est d'un autre ordre. */
const KINDS_CONFIG: Record<number, string> = {
  30092: 'base de connaissances animateur',
  30094: 'voix',
  30095: 'mapping animateur → voix',
  30096: 'persona animateur (legacy)',
  30098: 'invité (legacy)',
  30099: 'mapping invité → voix',
  30101: 'Pulse global',
  30102: 'Pulse override station',
  30103: 'Pulse override persona',
  30104: 'persona unifiée',
  30105: 'persona override per-station',
}

/** Cadence d'écriture : le relais limite le débit (« slow down there chief »). */
const DELAI_ENTRE_ENVOIS_MS = 900

const idsStations = new Set(SEED_STATIONS.map(s => s.id))

/**
 * Cet event est-il une configuration Infinity, et pas celle d'une autre
 * application qui partage le numéro de kind ?
 *
 * Deux indices, l'un suffit :
 *  - le d-tag désigne une de NOS stations (ou la contient),
 *  - le contenu porte un champ propre à nos codecs.
 * Un auteur explicite (`RADIO_ADMIN_PUBKEYS`) court-circuite tout.
 */
function ressembleAInfinity(e: NostrEvent, auteursConnus: Set<string> | null): boolean {
  if (auteursConnus) return auteursConnus.has(e.pubkey.toLowerCase())

  const dTag = e.tags.find(t => t[0] === 'd')?.[1] ?? ''
  for (const id of idsStations) {
    if (dTag === id || dTag.startsWith(`${id}:`) || dTag.endsWith(`:${id}`)) return true
  }
  if (dTag === 'global' || dTag.startsWith('host:') || dTag.startsWith('guest:') || dTag.startsWith('unified:')) {
    // `global` est trop courant pour suffire seul : on exige la forme.
    try {
      const c = JSON.parse(e.content) as Record<string, unknown>
      return typeof c.interventionRate === 'string'
          || typeof c.verbosity === 'string'
          || typeof c.personaKey === 'string'
    } catch { return false }
  }
  try {
    const c = JSON.parse(e.content) as Record<string, unknown>
    if (Array.isArray(c.stationRules)) {
      return (c.stationRules as Array<Record<string, unknown>>)
        .some(r => typeof r?.stationId === 'string' && idsStations.has(r.stationId as string))
    }
    // Une persona/voix nommée, portant nos champs caractéristiques.
    return typeof c.displayName === 'string' && typeof c.instructions === 'string'
  } catch { return false }
}

async function main() {
  const executer = process.argv.includes('--executer')
  const brut = process.env.RADIO_ADMIN_PUBKEYS
  const auteursConnus = brut
    ? new Set(brut.split(',').map(s => s.trim().toLowerCase()).filter(Boolean))
    : null

  console.log(`\n╔═══════════════════════════════════════════════════════════════╗`)
  console.log(`║  Miroir de la configuration radio → relais souverain          ║`)
  console.log(`║  Mode : ${(executer ? 'ÉCRITURE RÉELLE' : 'À BLANC (rien ne sera écrit)').padEnd(53)}║`)
  console.log(`╚═══════════════════════════════════════════════════════════════╝`)
  if (auteursConnus) console.log(`Filtre d'auteur actif : ${auteursConnus.size} pubkey(s)`)
  else console.log(`Pas de RADIO_ADMIN_PUBKEYS : filtrage par la FORME des events.`)

  // ── Récolte : tous les relais SAUF le souverain (c'est la cible) ──
  const sources = getRelays().filter(r => r !== RELAIS_SOUVERAIN)
  const pool = new SimplePool()
  const kinds = Object.keys(KINDS_CONFIG).map(Number)

  console.log(`\n📥 Récolte sur ${sources.length} relais publics…`)
  const trouves = await pool.querySync(sources, { kinds, limit: 500 }, { maxWait: 15000 })
  console.log(`   ${trouves.length} event(s) vus, tous kinds confondus`)

  // Le plus récent par (kind, d-tag) — sémantique replaceable.
  const retenus = new Map<string, NostrEvent>()
  for (const e of trouves) {
    if (!ressembleAInfinity(e, auteursConnus)) continue
    const dTag = e.tags.find(t => t[0] === 'd')?.[1]
    if (!dTag) continue
    const cle = `${e.kind}|${dTag}`
    const prec = retenus.get(cle)
    if (!prec || e.created_at > prec.created_at) retenus.set(cle, e)
  }

  // ── Ce que le relais souverain a DÉJÀ ──
  //
  // Comparé par IDENTIFIANT d'event, pas par (kind, d-tag, date) : l'id est
  // l'empreinte du document, c'est la seule clé qui ne peut pas rater une
  // correspondance. Une première version comparait le triplet et ne
  // reconnaissait rien — l'outil renvoyait alors « 37 échecs » sur une
  // recopie pourtant réussie, ce qui est pire qu'un silence.
  //
  // Interrogé kind par kind : une requête portant les 11 kinds d'un coup se
  // fait tronquer par le relais.
  const dejaLa = new Set<string>()
  for (const k of kinds) {
    const presents = await pool.querySync([RELAIS_SOUVERAIN], { kinds: [k], limit: 500 }, { maxWait: 8000 })
    for (const e of presents) dejaLa.add(e.id)
  }

  const aRecopier = [...retenus.values()].filter(e => !dejaLa.has(e.id))

  console.log(`\n📋 ${retenus.size} document(s) de configuration reconnus · ${aRecopier.length} à recopier\n`)
  const parKind = new Map<number, NostrEvent[]>()
  for (const e of aRecopier) parKind.set(e.kind, [...(parKind.get(e.kind) ?? []), e])
  for (const k of kinds) {
    const l = parKind.get(k) ?? []
    if (l.length === 0) continue
    console.log(`  kind ${k} — ${KINDS_CONFIG[k]} : ${l.length}`)
    for (const e of l) {
      console.log(`      ${(e.tags.find(t => t[0] === 'd')?.[1] ?? '?').padEnd(34)} ${new Date(e.created_at * 1000).toISOString().slice(0, 10)}  par ${e.pubkey.slice(0, 8)}`)
    }
  }

  pool.close(sources)
  pool.close([RELAIS_SOUVERAIN])

  if (!executer) {
    console.log(`\n· Mode à blanc — rien n'a été écrit. Relancer avec --executer pour recopier.`)
    return
  }
  if (aRecopier.length === 0) {
    console.log(`\n✅ Rien à recopier : le relais souverain a déjà tout.`)
    return
  }

  // ── Écriture, une par une, en lisant chaque réponse ──
  console.log(`\n📤 Recopie sur ${RELAIS_SOUVERAIN}…`)
  let ok = 0
  const echecs: string[] = []
  for (const e of aRecopier) {
    const dTag = e.tags.find(t => t[0] === 'd')?.[1] ?? '?'
    const reponse = await envoyer(e)
    // « duplicate » n'est pas un échec : le document EST sur le relais,
    // c'est-à-dire exactement le but recherché.
    const dejaPresent = /duplicate/i.test(reponse.message)
    if (reponse.accepte || dejaPresent) {
      ok++
      process.stdout.write(`   ✓ ${e.kind} ${dTag}${dejaPresent ? ' (déjà présent)' : ''}\n`)
    } else {
      echecs.push(`${e.kind} ${dTag} → ${reponse.message}`)
      process.stdout.write(`   ✗ ${e.kind} ${dTag} → ${reponse.message}\n`)
    }
    await new Promise(r => setTimeout(r, DELAI_ENTRE_ENVOIS_MS))
  }

  console.log(`\n╔═══════════════════════════════════════════════════════════════╗`)
  console.log(`║  ${String(ok).padStart(3)} en sûreté sur le relais · ${String(echecs.length).padStart(3)} échec(s)`.padEnd(64) + `║`)
  console.log(`╚═══════════════════════════════════════════════════════════════╝`)
  for (const f of echecs) console.log(`  - ${f}`)
  if (ok === 0 && echecs.length > 0) process.exit(1)
}

/** Envoie UN event et attend son accusé de réception nommé. */
function envoyer(e: NostrEvent): Promise<{ accepte: boolean; message: string }> {
  return new Promise(resolve => {
    const ws = new WebSocket(RELAIS_SOUVERAIN)
    let fini = false
    const finir = (accepte: boolean, message: string) => {
      if (fini) return
      fini = true
      try { ws.close() } catch { /* déjà fermé */ }
      resolve({ accepte, message })
    }
    const minuteur = setTimeout(() => finir(false, 'aucune réponse du relais (10 s)'), 10_000)
    ws.onopen = () => ws.send(JSON.stringify(['EVENT', e]))
    ws.onmessage = m => {
      const d = JSON.parse(String((m as MessageEvent).data)) as unknown[]
      if (d[0] === 'OK' && d[1] === e.id) {
        clearTimeout(minuteur)
        finir(d[2] === true, String(d[3] ?? ''))
      }
    }
    ws.onerror = () => { clearTimeout(minuteur); finir(false, 'erreur de connexion') }
  })
}

main().catch(err => {
  console.error('\n❌ Échec :', err)
  process.exit(1)
})
