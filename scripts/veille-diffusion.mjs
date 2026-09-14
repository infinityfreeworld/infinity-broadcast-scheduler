#!/usr/bin/env node
// 🌅 VEILLE DU MATIN — chaque radio et chaque canal TV a-t-il son émission du jour ? (14/09/2026)
//
// Demande du fondateur : « le système doit fonctionner même si le poste A ou B est fermé, de façon
// autonome ». Ce script tourne sur le hub (timer systemd, 06:00 et 09:00 UTC) et ne fait que LIRE
// les relais NOSTR publics, par le protocole public — jamais une base de données. Il n'a aucune clé.
// Il écrit un état (etat.json, historique.jsonl) et prévient par le canal de la sonde DATASPACE
// (alerte-canal.sh, qui garde le jeton Telegram pour lui).
//
//   node scripts/veille-diffusion.mjs [AAAA-MM-JJ] [--sec]     (--sec : n'envoie aucune alerte)
//
// Sortie : 0 tout est à l'antenne · 1 il manque des émissions · 2 veille aveugle (aucun relais).
import { appendFileSync, mkdirSync, writeFileSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { pathToFileURL } from 'node:url'

// Clé publique qui signe la radio ET la TV (constaté sur les relais le 14/09/2026).
export const AUTEUR = '9a8098f002e03b14260cdced2a18e4068678880814f96ebb46ce7d1993bcbecd'
export const RELAIS = [
  'wss://infinity-radio-relay.digitalforlifeagency.workers.dev',
  'wss://nos.lol',
  'wss://relay.damus.io',
  'wss://relay.primal.net',
]
// ⚠️ Doivent rester égales à `seed-stations.ts` et `seed-tv-channels.ts` : un test le vérifie.
export const RADIOS = [
  'wtf-radio', 'freeworld-radio', 'mindctrl-radio', 'hydrogene-radio', 'g1-radio',
  'deglingos-radio', 'diginomad-radio', 'tech-radio', 'pirate-radio', 'oasis-fm', 'free-press-fm',
  'voces-libres', 'svoboda-fm', 'zi-you-zhi-sheng',
]
export const CANAUX_TV = ['tv-main-1', 'tv-nature']
export const KIND_RADIO = 30093
export const KIND_TV = 30184

const DOSSIER = process.env.VEILLE_DOSSIER || '/root/veille-diffusion'
const ALERTE = process.env.VEILLE_ALERTE || '/opt/nostr-relay-platform/scripts/alerte-canal.sh'

/** Interroge un relais ; rend les `d` trouvés signés par AUTEUR, ou null si le relais n'a pas répondu. */
export function interroger(url, filtres, delaiMs = 10000) {
  return new Promise((resolve) => {
    const trouves = new Set()
    let ouvert = false
    let fini = false
    const finir = (valeur) => { if (fini) return; fini = true; clearTimeout(minuteur); try { ws.close() } catch { /* déjà fermé */ } resolve(valeur) }
    const minuteur = setTimeout(() => finir(ouvert ? trouves : null), delaiMs)
    let ws
    try { ws = new WebSocket(url) } catch { finir(null); return }
    const sub = `veille-${Math.random().toString(36).slice(2, 8)}`
    ws.onopen = () => { ouvert = true; ws.send(JSON.stringify(['REQ', sub, ...filtres])) }
    ws.onmessage = (m) => {
      let msg
      try { msg = JSON.parse(String(m.data)) } catch { return }
      if (msg[0] === 'EVENT' && msg[1] === sub && msg[2]?.pubkey === AUTEUR) {
        const d = (msg[2].tags || []).find((t) => t[0] === 'd')?.[1]
        if (d) trouves.add(d)
      } else if (msg[0] === 'EOSE' && msg[1] === sub) {
        finir(trouves)
      }
    }
    ws.onerror = () => finir(ouvert ? trouves : null)
    ws.onclose = () => finir(ouvert ? trouves : null)
  })
}

/**
 * La date du programme TV à attendre un jour donné : la VEILLE. Le JT est fabriqué à ~20:15 UTC et
 * daté du jour de sa fabrication (TV_AIR_MS = ce jour-là, 00:00 UTC) ; la radio, elle, est fabriquée
 * la veille au soir et datée du jour où elle passe. Vérifié sur les relais le 14/09/2026 : sans ce
 * décalage, la veille aurait crié « TV 0/2 » chaque matin.
 */
export function veilleDe(date) {
  return new Date(Date.parse(`${date}T00:00:00Z`) - 86_400_000).toISOString().slice(0, 10)
}

/** Bilan d'une date : ce qui est à l'antenne, ce qui manque, combien de relais ont répondu. */
export async function bilan(date, relais = RELAIS, interrogerFn = interroger) {
  const dateTv = veilleDe(date)
  const dRadio = RADIOS.map((s) => `${s}:${date}`)
  const dTv = CANAUX_TV.map((c) => `${c}:${dateTv}`)
  const filtres = [
    { kinds: [KIND_RADIO], authors: [AUTEUR], '#d': dRadio },
    { kinds: [KIND_TV], authors: [AUTEUR], '#d': dTv },
  ]
  const reponses = await Promise.all(relais.map((r) => interrogerFn(r, filtres)))
  const vus = new Set()
  let relaisOk = 0
  for (const r of reponses) if (r) { relaisOk++; for (const d of r) vus.add(d) }
  return {
    date,
    relaisOk,
    relaisTotal: relais.length,
    radios: { ok: RADIOS.filter((s) => vus.has(`${s}:${date}`)), manquantes: RADIOS.filter((s) => !vus.has(`${s}:${date}`)) },
    dateTv,
    tv: { ok: CANAUX_TV.filter((c) => vus.has(`${c}:${dateTv}`)), manquants: CANAUX_TV.filter((c) => !vus.has(`${c}:${dateTv}`)) },
  }
}

/** Le message à envoyer (ou null : rien à dire à cette heure-là). */
export function message(b, heureUtc) {
  const manque = b.radios.manquantes.length + b.tv.manquants.length
  const resume = `Radio ${b.radios.ok.length}/${RADIOS.length} · TV ${b.tv.ok.length}/${CANAUX_TV.length}`
  if (b.relaisOk === 0) {
    return { titre: `Veille diffusion ${b.date} : AVEUGLE`, corps: `Aucun relais n'a répondu (${b.relaisTotal} essayés) : impossible de vérifier l'antenne.`, priorite: 'default' }
  }
  if (manque > 0) {
    const liste = [...b.radios.manquantes, ...b.tv.manquants].join(', ')
    return {
      titre: `Diffusion ${b.date} : il manque ${manque} émission(s)`,
      corps: `${resume}. Manquent : ${liste}.${heureUtc >= 9 ? ' Toujours absentes à 9 h UTC : le rattrapage n’a pas suffi.' : ' Le secours GitHub de 01:30 UTC aurait dû les produire.'}`,
      priorite: heureUtc >= 9 ? 'high' : 'default',
    }
  }
  // Tout est là : un seul bilan par jour (celui du matin), pas de bruit à 9 h.
  return heureUtc < 8 ? { titre: `Diffusion ${b.date} : tout est à l'antenne`, corps: `${resume} ✓`, priorite: 'low' } : null
}

async function main() {
  const args = process.argv.slice(2)
  const sec = args.includes('--sec')
  const date = args.find((a) => /^\d{4}-\d{2}-\d{2}$/.test(a)) || new Date().toISOString().slice(0, 10)
  const b = await bilan(date)
  const etat = { ...b, verifieLe: new Date().toISOString() }
  try {
    mkdirSync(DOSSIER, { recursive: true })
    writeFileSync(`${DOSSIER}/etat.json`, JSON.stringify(etat, null, 1))
    appendFileSync(`${DOSSIER}/historique.jsonl`, JSON.stringify(etat) + '\n')
  } catch (e) { console.error('état non écrit :', e.message) }
  const m = message(b, new Date().getUTCHours())
  console.log(JSON.stringify(etat))
  if (m) {
    console.log(`→ ${m.titre} — ${m.corps}`)
    if (!sec) {
      try { execFileSync(ALERTE, [m.titre, m.corps, m.priorite], { stdio: 'inherit', timeout: 30000 }) }
      catch (e) { console.error('alerte non envoyée :', e.message) }
    }
  }
  process.exit(b.relaisOk === 0 ? 2 : (b.radios.manquantes.length + b.tv.manquants.length) > 0 ? 1 : 0)
}

// Importé par un test : ne rien lancer. Exécuté : la veille tourne.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main()
