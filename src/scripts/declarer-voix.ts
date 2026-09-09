#!/usr/bin/env tsx
/**
 * @module InfinityScheduler/Scripts/DeclarerVoix
 * @description Déclare les voix envoyées dans le catalogue de data-space.
 *
 *   Contrat donné le 02/09/2026 :
 *     POST /api/v1/upload            → rend un CID          (envoyer-voix.ts)
 *     POST /api/v1/gpu/voix/catalogue {nom, cid}            (CE script)
 *   La réponse rend le **nom normalisé** — et c'est sous ce nom EXACT qu'il
 *   faudra demander la synthèse.
 *
 *   ── POURQUOI CE SECOND PAS EXISTE ──
 *   Envoyer un fichier ne le déclare pas. Tant que le catalogue est vide,
 *   toute requête de synthèse rend `404 voice_not_found` — un service
 *   parfaitement sain qui ne connaît simplement aucune de nos voix. Nous
 *   avions envoyé les 29 fichiers sans faire ce pas, et nous l'aurions
 *   découvert la nuit de l'essai.
 *
 *   ⚠️ LE NOM RENDU FAIT AUTORITÉ. Notre client ajoutait `.wav` au nom
 *   demandé ; si leur normalisation diffère, chaque requête échouerait sur
 *   un 404 qu'on prendrait pour une panne. Ce script imprime donc la
 *   correspondance exacte à recopier dans la configuration.
 *
 *   Usage :
 *     tsx src/scripts/declarer-voix.ts <cids.json>            # à blanc
 *     tsx src/scripts/declarer-voix.ts <cids.json> --executer
 *
 *   Le fichier JSON est celui rendu par `envoyer-voix.ts` : { "<nom>.wav": "<cid>" }.
 *   Exige DATASPACE_API_KEY.
 */

import 'dotenv/config'
import { readFileSync } from 'node:fs'

const URL_CATALOGUE = 'https://data-space.world/api/v1/gpu/voix/catalogue'

interface Declaration { nom: string; cid: string }

async function declarer(d: Declaration, cle: string): Promise<string> {
  const res = await fetch(URL_CATALOGUE, {
    method:  'POST',
    headers: {
      'Content-Type':  'application/json',
      Authorization:   `Bearer ${cle}`,
    },
    body:   JSON.stringify({ nom: d.nom, cid: d.cid }),
    signal: AbortSignal.timeout(60_000),
  })
  const texte = await res.text()
  if (!res.ok) throw new Error(`HTTP ${res.status} : ${texte.slice(0, 200)}`)
  // Le nom normalisé peut vivre à plusieurs endroits selon leur schéma ;
  // on le cherche largement plutôt que de supposer, et on DIT si on ne le
  // trouve pas — un nom deviné ferait échouer chaque synthèse ensuite.
  try {
    const j = JSON.parse(texte) as Record<string, unknown>
    const nom = j.nom ?? j.name ?? j.voix ?? j.voice
      ?? (j.data as Record<string, unknown> | undefined)?.nom
    if (typeof nom === 'string' && nom.length > 0) return nom
  } catch { /* réponse non JSON */ }
  throw new Error(`déclarée, mais NOM NORMALISÉ introuvable dans : ${texte.slice(0, 200)}`)
}

async function main() {
  const fichier = process.argv[2]
  if (!fichier) {
    console.error('Usage : tsx src/scripts/declarer-voix.ts <cids.json> [--executer]')
    process.exit(1)
  }
  const executer = process.argv.includes('--executer')
  const cle = process.env.DATASPACE_API_KEY ?? ''

  const brut = JSON.parse(readFileSync(fichier, 'utf8')) as Record<string, string>
  // Les clés du manifeste portent l'extension (`ranouna.wav`) ; le catalogue
  // reçoit le nom NU, et c'est lui qui décide de la forme finale.
  const decls: Declaration[] = Object.entries(brut)
    .map(([f, cid]) => ({ nom: f.replace(/\.[a-z0-9]+$/i, ''), cid }))
    .sort((a, b) => a.nom.localeCompare(b.nom))

  console.log(`\n${decls.length} voix à déclarer\n`)
  for (const d of decls) console.log(`  ${d.nom.padEnd(30)} ${d.cid}`)

  if (!executer) {
    console.log('\n· Mode à blanc. Relancer avec --executer pour déclarer.')
    return
  }
  if (!cle) {
    console.error('\n❌ DATASPACE_API_KEY manquante — rien déclaré.')
    process.exit(1)
  }

  console.log('\n📇 Déclaration…\n')
  const rendus: Array<[string, string]> = []
  const echecs: string[] = []
  for (const d of decls) {
    try {
      const nomRendu = await declarer(d, cle)
      rendus.push([d.nom, nomRendu])
      const pareil = nomRendu === d.nom
      console.log(`   ✓ ${d.nom.padEnd(30)} → ${nomRendu}${pareil ? '' : '   ⚠️ NOM DIFFÉRENT'}`)
    } catch (err) {
      const m = err instanceof Error ? err.message : String(err)
      echecs.push(`${d.nom} — ${m}`)
      console.error(`   ✗ ${d.nom.padEnd(30)} ${m}`)
    }
  }

  console.log(`\n${rendus.length} déclarée(s), ${echecs.length} échec(s)`)
  const differents = rendus.filter(([envoye, rendu]) => envoye !== rendu)
  if (differents.length > 0) {
    console.log(`\n🔴 ${differents.length} nom(s) normalisé(s) DIFFÉREMMENT — la synthèse doit`)
    console.log(`   demander le nom de DROITE, sinon 404 voice_not_found :\n`)
    for (const [envoye, rendu] of differents) console.log(`   ${envoye}  →  ${rendu}`)
  } else if (rendus.length > 0) {
    console.log('✅ Tous les noms sont rendus à l\'identique — rien à adapter côté client.')
  }
  if (echecs.length && rendus.length === 0) process.exit(1)
}

main().catch(err => {
  console.error('\n❌ Échec :', err instanceof Error ? err.message : err)
  process.exit(1)
})
