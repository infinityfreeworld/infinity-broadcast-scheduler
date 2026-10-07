#!/usr/bin/env node
/**
 * Fabrique `src/data/campagnes-abondance.ts` — les campagnes de soutien qu'Abondance met en avant
 * (`src/modules/abondance/campagnes-soutien.ts` et l'annuaire KiFaitKoi
 * `src/modules/abondance/donnees/initiatives-kifaitkoi.json` du dépôt Infinity), pour que la station
 * Abondance puisse en parler à tour de rôle. On ne garde que ce qui se DIT : identifiant, titre,
 * porteur, résumé, description, piliers. Jamais un lien, jamais un montant (Abondance n'en affiche pas).
 *
 * Usage : node scripts/fabriquer-campagnes-abondance.mjs "<chemin du dépôt infinity>"
 * Un test (`sujets-abondance.test.ts`) compare les identifiants à ceux de l'application.
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const depot = process.argv[2]
if (!depot) { console.error('usage : node scripts/fabriquer-campagnes-abondance.mjs <dépôt infinity>'); process.exit(1) }
const dossier = join(depot, 'src/modules/abondance')
const src = readFileSync(join(dossier, 'campagnes-soutien.ts'), 'utf8')
const kifaitkoi = JSON.parse(readFileSync(join(dossier, 'donnees/initiatives-kifaitkoi.json'), 'utf8'))

/** Les campagnes écrites à la main : blocs `{ id: '…', get titre() { return t`…` } … }` de `TOUTES`. */
function campagnesEcrites(texte) {
  const debut = texte.indexOf('const TOUTES')
  const fin = texte.indexOf('...(INITIATIVES_KIFAITKOI', debut)
  const zone = texte.slice(debut, fin)
  const champ = (bloc, nom) => {
    const m = new RegExp(`get ${nom}\\(\\)\\s*\\{\\s*return t\`([^\`]*)\``).exec(bloc)
    return m ? m[1].trim() : ''
  }
  return zone.split(/\n {2}\{\n/).slice(1).map(bloc => ({
    id: /id: '([^']+)'/.exec(bloc)?.[1] ?? '',
    titre: champ(bloc, 'titre'), porteur: champ(bloc, 'porteur'),
    resume: champ(bloc, 'resume'), description: champ(bloc, 'description'),
    piliers: [...(/piliers: \[([^\]]*)\]/.exec(bloc)?.[1] ?? '').matchAll(/'([^']+)'/g)].map(m => m[1]),
  })).filter(c => c.id && c.titre)
}

const toutes = [
  ...campagnesEcrites(src),
  ...kifaitkoi.map(i => ({ id: i.id, titre: i.titre, porteur: i.porteur, resume: i.resume, description: i.description, piliers: i.piliers })),
]
const ids = new Set()
for (const c of toutes) {
  if (ids.has(c.id)) throw new Error(`campagne en double : ${c.id}`)
  ids.add(c.id)
  for (const k of ['titre', 'resume', 'description']) if (/https?:\/\//.test(c[k] ?? '')) throw new Error(`lien dans ${c.id}.${k}`)
}

const sortie = `/**
 * @module InfinityScheduler/Data/CampagnesAbondance
 * @description FICHIER FABRIQUÉ par \`scripts/fabriquer-campagnes-abondance.mjs\` — ne pas éditer à la main.
 *
 *   ${toutes.length} campagnes de soutien qu'Abondance met en avant (choisies par l'équipe d'Infinity, et
 *   l'annuaire KiFaitKoi), copiées du dépôt Infinity (\`src/modules/abondance/campagnes-soutien.ts\`). Le don
 *   se fait chez l'organisme : ni lien ni montant ici, rien qui ne se dise à l'antenne.
 */
export interface CampagneAbondance {
  id: string
  titre: string
  porteur: string
  resume: string
  description: string
  piliers: string[]
}

export const CAMPAGNES_ABONDANCE: readonly CampagneAbondance[] = ${JSON.stringify(toutes, null, 1)}
`
writeFileSync(new URL('../src/data/campagnes-abondance.ts', import.meta.url), sortie)
console.log(`${toutes.length} campagnes écrites`)
