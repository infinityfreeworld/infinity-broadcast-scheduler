#!/usr/bin/env tsx
/**
 * @module InfinityScheduler/Scripts/DeposerArchive
 * @description Chiffre une archive, la dépose chez data-space, et PROUVE
 *   qu'un anonyme n'en tire rien.
 *
 *   ── POURQUOI LE CHIFFREMENT N'EST PAS OPTIONNEL ──
 *   Nous avions déposé notre archive git en clair, en croyant la
 *   sauvegarder. Vérification faite le 08/09/2026 : `curl` sans aucun
 *   jeton rendait 200 et 321 557 octets, clonables, 62 commits lisibles.
 *
 *   data-space nous a montré pire encore : leur DHT annonce le CID à tout
 *   le réseau IPFS mondial — deux fournisseurs, Lauterbourg et Singapour.
 *   Fermer leur passerelle publique ne protégerait donc rien. Leur phrase :
 *   « nous préférons vous le dire que vous vendre une porte sur une maison
 *   sans murs. »
 *
 *   🔴 Un contenu publié une fois doit être considéré comme public à
 *   jamais. La seule protection qui ne dépende de personne est de ne
 *   jamais déposer de clair.
 *
 *   La clé ne quitte JAMAIS cette machine. Sans elle, l'archive est un
 *   bloc opaque — y compris pour data-space.
 *
 *   Usage : tsx src/scripts/deposer-archive.ts <fichier>
 */
import 'dotenv/config'
import { readFileSync, writeFileSync, existsSync, mkdirSync, chmodSync } from 'node:fs'
import { basename, join, dirname } from 'node:path'
import { homedir, tmpdir } from 'node:os'
import { randomBytes, createHash } from 'node:crypto'
import { chiffrer, dechiffrer } from '../lib/coffre'
import { dataspacePinFile } from '../lib/dataspace'
import { jetonDataspace } from '../lib/dataspace-jeton'

const FICHIER_CLE = join(homedir(), '.infinity', 'cles', 'archive-scheduler.aes256.key')

/** La clé de coffre — créée une fois, jamais transmise. */
function cleDeCoffre(): Buffer {
  if (existsSync(FICHIER_CLE)) return Buffer.from(readFileSync(FICHIER_CLE, 'utf8').trim(), 'hex')
  mkdirSync(dirname(FICHIER_CLE), { recursive: true })
  const k = randomBytes(32)
  writeFileSync(FICHIER_CLE, k.toString('hex'), { mode: 0o600 })
  chmodSync(FICHIER_CLE, 0o600)
  console.log(`  🔑 clé de coffre CRÉÉE : ${FICHIER_CLE}`)
  console.log(`     ⚠️ à sauvegarder AILLEURS que vos copies hors ligne —`)
  console.log(`     sans elle l'archive est irrécupérable.`)
  return k
}


async function main() {
  const chemin = process.argv[2]
  if (!chemin) { console.error('Usage : tsx src/scripts/deposer-archive.ts <fichier>'); process.exit(1) }
  const clair = readFileSync(chemin)
  const cle = cleDeCoffre()
  const paquet = chiffrer(clair, cle)

  // 🔴 Aller-retour LOCAL avant de déposer : un chiffrement qu'on ne sait
  // pas défaire est une perte de données déguisée en sécurité.
  const rendu = dechiffrer(paquet, cle)
  const h = (b: Buffer) => createHash('sha256').update(b).digest('hex')
  if (h(rendu) !== h(clair)) throw new Error('déchiffrement local FAUX — rien ne sera déposé')
  console.log(`  ✅ chiffré et redéchiffré à l'identique (${(paquet.length / 1024).toFixed(0)} Ko)`)

  const jeton = await jetonDataspace()
  if (!jeton) throw new Error('jeton data-space indisponible')
  const r = await dataspacePinFile(paquet, basename(chemin) + '.aes', 'application/octet-stream', jeton)
  console.log(`  ✅ déposé et relu — ${r.cid}`)

  // 🔴 LA PREUVE : un anonyme obtient-il du clair ? Nous ne le supposons pas.
  const anon = await fetch(`https://data-space.world/api/ipfs/${r.cid}`)
  const octetsAnon = Buffer.from(await anon.arrayBuffer())
  const lisible = octetsAnon.subarray(0, 16).toString('ascii')
  const estGit = lisible.includes('# v2 git bundle')
  console.log(`  anonyme : HTTP ${anon.status} · ${octetsAnon.length} o · en-tête « ${lisible.replace(/[^\x20-\x7e]/g, '.')} »`)
  if (estGit) {
    console.error('  🔴 UN ANONYME LIT ENCORE DU GIT — le dépôt est un échec')
    process.exit(1)
  }
  console.log('  ✅ un anonyme ne récupère que de l\'opaque')
  const local = join(tmpdir(), basename(chemin) + '.aes')
  writeFileSync(local, paquet)
  console.log(`     copie chiffrée locale : ${local}`)
}
main().catch(e => { console.error('  🔴', e.message.slice(0, 220)); process.exit(1) })
