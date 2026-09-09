/**
 * @module InfinityScheduler/Lib/HostVoiceMappings
 * @description Phase C.3 (2026-05-20) — Lecture des mappings animateur Radio
 *   → voix Chatterbox publiés sur NOSTR (kind:30095) par l'IHL Infinity.
 *
 *   Aligné sur le codec Infinity main : `src/modules/ihl/host-voice-codec.ts`.
 *   D-tag = `<stationId>:<hostId>`, content JSON `{stationId, hostId,
 *   voiceName, language?, updatedAt}`.
 *
 *   Stratégie d'usage côté scheduler :
 *     1. `generate-all.ts` appelle `fetchHostVoiceMappings()` au démarrage,
 *        sérialise le résultat en JSON dans `process.env.HOST_VOICE_MAP_JSON`.
 *     2. Les sous-processus `generate-broadcast.ts` héritent de cette env var
 *        (via `execFile({ env: process.env })`) et la chargent en mémoire
 *        via `loadHostVoiceMappingsFromEnv()`.
 *     3. `getChatterboxVoiceForHost(stationId, hostId)` lit ce cache en
 *        priorité avant les fallbacks `CHATTERBOX_VOICE_MAP` (legacy) et
 *        `CHATTERBOX_DEFAULT_VOICE`.
 */

import { SimplePool } from 'nostr-tools/pool'
import type { Event as NostrEvent } from 'nostr-tools/core'
import { getRelays } from './nostr'

/**
 * ⚠️ UN RELAIS SEUL PEUT OMETTRE UN DOCUMENT QU'IL STOCKE POURTANT.
 *
 * Constaté le 01/09/2026 sur notre relais souverain : une requête large
 * `{kinds:[30104,30105]}` rendait 9 events là où une interrogation ciblée
 * par `#d` en trouvait un 10ᵉ, bien présent en base
 * (`godefroid-de-mont-delire`). Le résultat variait d'un appel à l'autre,
 * sans erreur ni avertissement.
 *
 * ⚠️ Une `limit` explicite est posée par prudence, mais elle NE GARANTIT
 * RIEN : le même appel avec `limit: 500` a omis le document que
 * `limit: 200` rapportait. Ce n'est donc pas la limite qui est en cause.
 *
 * Ce qui protège réellement, c'est la REDONDANCE : `getRelays()` interroge
 * 7 relais et l'union est complète (7 personas rendues, 4 essais sur 4).
 * ⇒ Ne jamais réduire la lecture de la configuration à un relais unique.
 */
const LIMITE_REQUETE = 500


export const KIND_HOST_VOICE_MAPPING = 30095

const ENV_KEY = 'HOST_VOICE_MAP_JSON'

/** Clé canonique du cache : `<stationId>:<hostId>` (= d-tag NOSTR). */
export function mappingKey(stationId: string, hostId: string): string {
  return `${stationId}:${hostId}`
}

/**
 * Fetch tous les mappings kind:30095 publiés sur les relays NOSTR
 * configurés. Retourne une Map<dTag, voiceName>. Si plusieurs events
 * partagent un d-tag (replaceable race condition), seul le plus récent
 * `created_at` est retenu.
 *
 * Robuste : timeout côté pool, erreur réseau → Map vide (le scheduler
 * tombera sur CHATTERBOX_DEFAULT_VOICE).
 */
/**
 * Auteurs reconnus pour la configuration radio, ou null si aucun n'est
 * déclaré. Même variable que `pulse.ts` et `radio-personas.ts` : une seule
 * liste pour les trois, sinon on en durcit un et on oublie les autres —
 * ce qui est exactement ce qui est arrivé à ce module-ci.
 */
function adminPubkeys(): Set<string> | null {
  const raw = process.env.RADIO_ADMIN_PUBKEYS
  if (!raw) return null
  const set = new Set(raw.split(',').map(s => s.trim().toLowerCase()).filter(Boolean))
  return set.size > 0 ? set : null
}

/**
 * Résout les events en « d-tag → event retenu », par AUTEUR.
 *
 * Pure et exportée : c'est la logique qui a laissé un tiers piloter notre
 * antenne, elle doit pouvoir être éprouvée sans réseau.
 */
export function resoudreParAuteur(
  events: NostrEvent[],
  allowed: Set<string> | null,
  nous: string,
): Map<string, NostrEvent> {
  // 🔴 Un event remplaçable est identifié par le TRIPLET (auteur, kind,
  // d-tag) — NIP-01. Cette fonction indexait par le d-tag SEUL et gardait
  // le plus récent : n'importe quel auteur pouvait donc écraser notre
  // configuration de voix en publiant après nous, et rien ne l'aurait dit.
  //
  // Constaté le 02/09/2026 : `pirate-radio:pi-hex` portait DEUX events, sur
  // `nos.lol` et `nostr.mom`, signés par deux clés différentes — un tiers
  // (`f1abc0b8…`, inconnu du dépôt) disant « alain », et la nôtre disant
  // « Layla ». Le tiers gagnait, parce qu'il était plus récent de 55 s.
  //
  // C'est le seul des trois modules de configuration radio qui n'avait
  // AUCUN filtre par auteur : `pulse.ts` et `radio-personas.ts` en ont un.
    const parAuteur = new Map<string, NostrEvent>()
  for (const e of events) {
    if (allowed && !allowed.has(e.pubkey.toLowerCase())) continue
    const dTag = e.tags.find(t => t[0] === 'd')?.[1]
    if (!dTag) continue
    const cle = `${e.pubkey.toLowerCase()}:${dTag}`
    const existing = parAuteur.get(cle)
    if (!existing || e.created_at > existing.created_at) parAuteur.set(cle, e)
  }

  // Regrouper par d-tag pour détecter les revendications concurrentes.
  const parDTag = new Map<string, NostrEvent[]>()
  for (const e of parAuteur.values()) {
    const dTag = e.tags.find(t => t[0] === 'd')![1]
    const l = parDTag.get(dTag); if (l) l.push(e); else parDTag.set(dTag, [e])
  }

    const latest = new Map<string, NostrEvent>()
  for (const [dTag, liste] of parDTag.entries()) {
    if (liste.length === 1) { latest.set(dTag, liste[0]); continue }
    // Plusieurs auteurs revendiquent le même d-tag. On ne choisit PAS en
    // silence : le plus récent n'a aucune autorité particulière.
    const mien = nous ? liste.find(e => e.pubkey.toLowerCase() === nous) : undefined
    const auteurs = liste.map(e => e.pubkey.slice(0, 8)).join(', ')
    if (mien) {
      console.warn(`[host-voice-mappings] « ${dTag} » revendiqué par ${liste.length} `
        + `auteurs (${auteurs}) — on retient LE NÔTRE.`)
      latest.set(dTag, mien)
    } else {
      // Aucun candidat de confiance : on n'en prend AUCUN. La voix
      // retombera sur Piper — moins beau, jamais piloté par un tiers.
      console.warn(`[host-voice-mappings] 🔴 « ${dTag} » revendiqué par ${liste.length} `
        + `auteurs (${auteurs}), aucun reconnu — mapping IGNORÉ, repli Piper. `
        + `Poser RADIO_ADMIN_PUBKEYS pour trancher.`)
    }
  }

  return latest
}

export async function fetchHostVoiceMappings(timeoutMs = 8000): Promise<Map<string, string>> {
  const relays = getRelays()
  const pool = new SimplePool()
  try {
    const events = await pool.querySync(
      relays,
      { kinds: [KIND_HOST_VOICE_MAPPING], limit: LIMITE_REQUETE },
      { maxWait: timeoutMs },
    )

    const latest = resoudreParAuteur(
      events, adminPubkeys(),
      process.env.NOSTR_PUBLIC_KEY?.toLowerCase() ?? '')

    const result = new Map<string, string>()
    for (const [dTag, event] of latest.entries()) {
      try {
        const content = JSON.parse(event.content) as { voiceName?: unknown }
        if (typeof content.voiceName === 'string' && content.voiceName.length > 0) {
          result.set(dTag, content.voiceName)
        }
      } catch {
        // content JSON cassé → ignore ce mapping
      }
    }
    return result
  } catch (err) {
    console.warn('[host-voice-mappings] fetch échec :', err instanceof Error ? err.message : err)
    return new Map()
  } finally {
    pool.close(relays)
  }
}

/**
 * Sérialise la Map en JSON et la met dans `process.env.HOST_VOICE_MAP_JSON`
 * (hérité par les sous-processus exec).
 */
export function exportHostVoiceMappingsToEnv(mappings: Map<string, string>): void {
  process.env[ENV_KEY] = JSON.stringify(Object.fromEntries(mappings))
}

/**
 * Cache en mémoire process. Chargé paresseusement à la 1ère lecture depuis
 * `process.env.HOST_VOICE_MAP_JSON` (généralement sérialisé par le parent
 * `generate-all.ts` puis hérité ici par `exec`).
 */
let cachedMap: Map<string, string> | null = null

export function loadHostVoiceMappingsFromEnv(): Map<string, string> {
  if (cachedMap) return cachedMap
  const json = process.env[ENV_KEY]
  if (!json) {
    cachedMap = new Map()
    return cachedMap
  }
  try {
    const obj = JSON.parse(json) as Record<string, string>
    cachedMap = new Map(Object.entries(obj))
  } catch (err) {
    console.warn('[host-voice-mappings] env JSON cassé, ignore :', (err as Error).message)
    cachedMap = new Map()
  }
  return cachedMap
}

/**
 * Lookup synchrone côté scheduler : retourne la voix Chatterbox configurée
 * pour `(stationId, hostId)` via NOSTR, ou null si pas de mapping.
 */
export function getNostrVoiceForHost(stationId: string, hostId: string): string | null {
  const map = loadHostVoiceMappingsFromEnv()
  return map.get(mappingKey(stationId, hostId)) ?? null
}
