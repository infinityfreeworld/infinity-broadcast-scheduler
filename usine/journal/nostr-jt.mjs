#!/usr/bin/env node
// 📡 Le Journal de FREEWORLD TV — le hub et le générateur se parlent par des messages NOSTR SIGNÉS (kind 30078).
//
// Le générateur (GitHub) tient les clés et le LLM : chaque matin il publie la COMMANDE du jour, signée par sa clé.
// Le hub tient l'usine : il la lit, VÉRIFIE l'auteur et la signature, fabrique le Journal, puis publie le RÉSULTAT
// signé par SA clé — que le générateur vérifie à son tour avant de le mettre à l'antenne. Aucune clé ne voyage,
// aucun accès nouveau n'est ouvert sur le hub.
//
//   node nostr-jt.mjs cle                               crée la clé de l'usine (root, 600) si besoin ; affiche la PUBLIQUE
//   node nostr-jt.mjs commande <AAAA-MM-JJ> <sortie>     écrit la commande du jour (code 0), code 2 si elle n'est pas encore là
//   node nostr-jt.mjs resultat <AAAA-MM-JJ> <fichier>    signe et publie le résultat du jour
import { chmodSync, existsSync, readFileSync, writeFileSync } from 'node:fs'
import { finalizeEvent, generateSecretKey, getPublicKey, verifyEvent } from 'nostr-tools/pure'
import { SimplePool } from 'nostr-tools/pool'

// La clé qui signe la radio et la TV (la même que scripts/veille-diffusion.mjs).
const GENERATEUR = '9a8098f002e03b14260cdced2a18e4068678880814f96ebb46ce7d1993bcbecd'
const CLE = process.env.JT_CLE_USINE || '/root/usine/journal/cle-usine.hex'
// Les relais par défaut du générateur (src/lib/nostr.ts) : il publie et relit sur les mêmes.
const RELAIS = (process.env.JT_RELAIS || [
  'wss://infinity-radio-relay.digitalforlifeagency.workers.dev', 'wss://relay.damus.io', 'wss://nos.lol',
  'wss://relay.snort.social', 'wss://relay.nostr.band', 'wss://nostr.mom', 'wss://relay.primal.net',
].join(',')).split(',').map(s => s.trim()).filter(Boolean)
const KIND = 30078
const [, , action, date, fichier] = process.argv

function fin(msg, code = 1) { console.error(msg); process.exit(code) }
function jour() { if (!/^\d{4}-\d{2}-\d{2}$/.test(date || '')) fin(`date attendue AAAA-MM-JJ, reçu « ${date} »`, 64) }

function cleUsine() {
  if (!existsSync(CLE)) {
    writeFileSync(CLE, Buffer.from(generateSecretKey()).toString('hex') + '\n', { mode: 0o600 })
    chmodSync(CLE, 0o600)
  }
  return Uint8Array.from(Buffer.from(readFileSync(CLE, 'utf8').trim(), 'hex'))
}

async function commande() {
  jour()
  const pool = new SimplePool()
  const evts = await pool.querySync(RELAIS, { kinds: [KIND], authors: [GENERATEUR], '#d': [`freeworld-jt:commande:${date}`] }, { maxWait: 15000 })
  pool.close(RELAIS)
  // L'auteur ET la signature : un relais peut servir n'importe quoi, seul ce que le générateur a signé compte.
  const bons = evts.filter(e => e.pubkey === GENERATEUR && verifyEvent(e)).sort((a, b) => b.created_at - a.created_at)
  if (!bons.length) {
    console.log(`pas encore de commande pour le ${date} (${evts.length} événement(s) lu(s) sur ${RELAIS.length} relais)`)
    process.exit(2)
  }
  const jt = JSON.parse(bons[0].content)
  if (jt.date !== date) fin(`commande datée du ${jt.date}, attendue pour le ${date}`)
  writeFileSync(fichier, JSON.stringify(jt, null, 1))
  console.log(`commande du ${date} reçue (${bons[0].id.slice(0, 12)}…, ${bons[0].content.length} octets)`)
}

async function resultat() {
  jour()
  const contenu = JSON.parse(readFileSync(fichier, 'utf8'))
  const ev = finalizeEvent({
    kind: KIND, created_at: Math.floor(Date.now() / 1000),
    tags: [['d', `freeworld-jt:resultat:${date}`], ['t', 'freeworld-jt']], content: JSON.stringify(contenu),
  }, cleUsine())
  const pool = new SimplePool()
  const issues = await Promise.allSettled(pool.publish(RELAIS, ev))
  pool.close(RELAIS)
  const ok = issues.filter(i => i.status === 'fulfilled').length
  if (!ok) fin(`résultat du ${date} : AUCUN relais ne l'a accepté (${issues.map(i => String(i.reason?.message || i.reason)).join(' ; ').slice(0, 300)})`)
  console.log(`résultat du ${date} publié sur ${ok}/${RELAIS.length} relais (${ev.id.slice(0, 12)}…)`)
}

if (action === 'cle') console.log(getPublicKey(cleUsine()))
else if (action === 'commande') await commande()
else if (action === 'resultat') await resultat()
else fin('usage : node nostr-jt.mjs cle | commande <AAAA-MM-JJ> <sortie> | resultat <AAAA-MM-JJ> <fichier>', 64)
