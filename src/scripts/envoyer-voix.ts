#!/usr/bin/env tsx
/**
 * @module InfinityScheduler/Scripts/EnvoyerVoix
 * @description Envoie les échantillons de voix vers data-space, qui les
 *   épingle et nous rend un CID par fichier.
 *
 *   Contrat donné par data-space le 02/09/2026 :
 *     POST https://data-space.world/api/v1/upload
 *     Authorization: Bearer <clé>
 *     multipart, champ « file », 100 Mo max par fichier
 *     → rend le CID ; épinglé ×2 sur leur grappe
 *
 *   ── POURQUOI CET OUTIL EXISTE ──
 *   Nos 14 CID précédents ne répondaient plus sur AUCUNE passerelle : nous
 *   les avions publiés sans jamais les épingler. Sur IPFS, publier n'est
 *   pas conserver. Cet envoi-ci est épinglé chez eux, en double.
 *
 *   ── LE NOM COMPTE AUTANT QUE LE FICHIER ──
 *   Le serveur Chatterbox retrouve une voix par son NOM DE FICHIER, et
 *   notre client demande toujours `<nom>.wav`. Un fichier envoyé sous un
 *   autre nom — ou une autre extension — est introuvable, et l'échec
 *   ressemble à une panne du service. L'outil normalise donc, et REFUSE
 *   d'envoyer ce qu'il ne peut pas nommer correctement.
 *
 *   Usage :
 *     tsx src/scripts/envoyer-voix.ts [dossier]              # à blanc
 *     tsx src/scripts/envoyer-voix.ts [dossier] --executer   # envoie
 *
 *   Exige DATASPACE_API_KEY.
 */

import 'dotenv/config'
import { readdirSync, statSync, readFileSync } from 'node:fs'
import { join, extname, basename } from 'node:path'

const URL_ENVOI = 'https://data-space.world/api/v1/upload'
const DOSSIER_DEFAUT = '/Users/med/Desktop/Voice'
const TAILLE_MAX = 100 * 1024 * 1024

/** Nom canonique attendu par le champ `voice` : minuscules, sans accents. */
export function nomCanonique(fichier: string): string {
  return basename(fichier, extname(fichier))
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
}

interface Candidat {
  chemin:  string
  fichier: string
  nom:     string
  octets:  number
  refus?:  string
}

function inventorier(dossier: string): Candidat[] {
  return readdirSync(dossier)
    .filter(f => /\.(wav|mp3|flac|ogg)$/i.test(f))
    .sort()
    .map(f => {
      const chemin = join(dossier, f)
      const octets = statSync(chemin).size
      const c: Candidat = { chemin, fichier: f, nom: nomCanonique(f) + '.wav', octets }
      // ⚠️ Notre client demande TOUJOURS `<nom>.wav`. Un MP3 envoyé tel
      // quel serait introuvable — et l'échec ressemblerait à une panne du
      // service au lieu d'une coquille chez nous. On refuse franchement
      // plutôt que d'envoyer quelque chose qui ne sera jamais trouvé.
      if (!/\.wav$/i.test(f)) {
        c.refus = `format ${extname(f)} — convertir en WAV avant l'envoi `
          + `(notre client demande toujours « ${c.nom} »)`
      }
      if (octets > TAILLE_MAX) c.refus = `${(octets / 1048576).toFixed(0)} Mo > 100 Mo`
      return c
    })
}

async function envoyer(c: Candidat, cle: string): Promise<string> {
  const corps = new FormData()
  corps.append('file', new Blob([new Uint8Array(readFileSync(c.chemin))]), c.nom)
  const res = await fetch(URL_ENVOI, {
    method:  'POST',
    headers: { Authorization: `Bearer ${cle}` },
    body:    corps,
    signal:  AbortSignal.timeout(180_000),
  })
  const texte = await res.text()
  if (!res.ok) throw new Error(`HTTP ${res.status} : ${texte.slice(0, 200)}`)
  // ⚠️ data-space répond `{"files":[{"cid":"Qm…", "name":…, "size":…}]}`.
  // La première version ne cherchait le CID qu'à la RACINE : elle a
  // rapporté 29 échecs sur 29 réussites, le 02/09/2026. Un outil écrit
  // pour ne pas mentir sur un succès a menti sur un échec — on cherche
  // donc à tous les endroits plausibles, et on le dit si on ne trouve pas.
  try {
    const j = JSON.parse(texte) as Record<string, unknown>
    const premierFichier = Array.isArray(j.files) && j.files.length > 0
      ? (j.files[0] as Record<string, unknown>)
      : undefined
    const cid = premierFichier?.cid
      ?? j.cid ?? j.CID ?? j.Hash
      ?? (j.data as Record<string, unknown> | undefined)?.cid
    if (typeof cid === 'string' && cid.length > 0) return cid
  } catch { /* réponse non JSON */ }
  throw new Error(`réponse sans CID reconnaissable : ${texte.slice(0, 200)}`)
}

async function main() {
  const args = process.argv.slice(2).filter(a => a !== '--executer')
  const dossier = args[0] ?? DOSSIER_DEFAUT
  const executer = process.argv.includes('--executer')
  const cle = process.env.DATASPACE_API_KEY ?? ''

  const tous = inventorier(dossier)
  const bons = tous.filter(c => !c.refus)
  const refuses = tous.filter(c => c.refus)
  const total = bons.reduce((a, c) => a + c.octets, 0)

  console.log(`\n${dossier}`)
  console.log(`${tous.length} fichier(s) · ${bons.length} envoyable(s) · ${(total / 1048576).toFixed(0)} Mo\n`)
  console.log('fichier                              → nom demandé                       Mo')
  for (const c of bons) {
    console.log(`${c.fichier.slice(0, 36).padEnd(38)} ${c.nom.padEnd(34)} ${(c.octets / 1048576).toFixed(1).padStart(5)}`)
  }
  if (refuses.length) {
    console.log(`\n⚠️  ${refuses.length} fichier(s) NON envoyé(s) :`)
    for (const c of refuses) console.log(`   ${c.fichier} — ${c.refus}`)
  }

  if (!executer) {
    console.log(`\n· Mode à blanc. Relancer avec --executer pour envoyer.`)
    return
  }
  if (!cle) {
    console.error(`\n❌ DATASPACE_API_KEY manquante — rien n'a été envoyé.`)
    process.exit(1)
  }

  console.log(`\n📤 Envoi…\n`)
  const cids: Array<[string, string]> = []
  const echecs: string[] = []
  for (const c of bons) {
    try {
      const cid = await envoyer(c, cle)
      cids.push([c.nom, cid])
      console.log(`   ✓ ${c.nom.padEnd(34)} ${cid}`)
    } catch (err) {
      const m = err instanceof Error ? err.message : String(err)
      echecs.push(`${c.nom} — ${m}`)
      console.error(`   ✗ ${c.nom.padEnd(34)} ${m}`)
    }
  }

  console.log(`\n${cids.length} envoyée(s), ${echecs.length} échec(s)`)
  if (cids.length) {
    console.log(`\nCorrespondance à transmettre :\n`)
    console.log('| voix | CID |')
    console.log('|---|---|')
    for (const [nom, cid] of cids) console.log(`| \`${nom}\` | \`${cid}\` |`)
  }
  if (echecs.length && cids.length === 0) process.exit(1)
}

main().catch(err => {
  console.error('\n❌ Échec :', err instanceof Error ? err.message : err)
  process.exit(1)
})
