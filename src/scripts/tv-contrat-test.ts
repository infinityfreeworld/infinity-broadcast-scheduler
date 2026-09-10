/**
 * @module InfinityScheduler/TV/contrat
 * @description 🧪 LE PROGRAMME PUBLIÉ DOIT ÊTRE LU PAR LA TÉLÉ. Test hors ligne.
 *
 *   Le générateur (ce dépôt) écrit un event NOSTR ; le module TV d'Infinity
 *   (autre dépôt) le lit. Personne ne tient les deux bouts : c'est le point où
 *   les deux peuvent diverger en silence. Un champ ajouté ici et pas là-bas ne
 *   casse aucun test, ne lève aucune erreur — le programme part, et la télé
 *   affiche autre chose, ou rien.
 *
 *   Ce test compare les deux sources. Il exige donc le dépôt Infinity à côté :
 *   quand il est absent (l'exécuteur d'intégration continue, par exemple), il
 *   s'annonce IGNORÉ plutôt que de se déguiser en vert.
 *
 *   npx tsx src/scripts/tv-contrat-test.ts   [INFINITY_REPO=/chemin/vers/infinity]
 */
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { homedir } from 'node:os'
import { TV_PROGRAM_KIND, tvProgramEventTemplate } from '../lib/tv-nostr'
import type { TvProgram } from '../lib/tv-types'
import { TV_CHANNELS } from '../data/seed-tv-channels'

let pass = true
const chk = (label: string, cond: boolean) => {
  pass = pass && cond
  console.log(`${cond ? '✅' : '❌'} ${label}`)
}

// Le programme réellement produit le 09/09/2026 par `--fixture` (chaîne
// complète, forge locale). Une fixture prise sur le vrai chemin, pas inventée.
const PROGRAMME: TvProgram = {
  id: 'tv-jt-fr:2026-09-09',
  channelId: 'tv-jt-fr',
  title: 'JT INFINITY — épisode de démonstration',
  blossomUrl: 'http://localhost:5400/api/assets/abcc35b3ecb00a18/file',
  durationSec: 19.3,
  airDateMs: 1788912000000,
  segments: [
    { title: 'Ouverture', startSec: 0, durationSec: 4.84 },
    { title: 'Initiative locale', startSec: 4.84, durationSec: 7.76 },
    { title: 'Technologie libre', startSec: 12.6, durationSec: 6.74 },
  ],
  generator: 'ffmpeg-compose+llm+piper:fr_FR-tom-medium',
}

console.log('— Ce que le générateur met dans l’event —')
const evt = tvProgramEventTemplate(PROGRAMME)
const contenu = JSON.parse(evt.content) as Record<string, unknown>
const tags = Object.fromEntries(evt.tags.map(t => [t[0], t[1]]))
{
  chk(`le kind est 30184 (${TV_PROGRAM_KIND})`, TV_PROGRAM_KIND === 30184)
  chk('le d-tag porte l’identifiant du programme', tags.d === PROGRAMME.id)
  chk('le tag `channel` permet de filtrer par chaîne', tags.channel === PROGRAMME.channelId)
  chk('`published_at` est en SECONDES (pas en ms)', tags.published_at === String(Math.floor(PROGRAMME.airDateMs / 1000)))
  chk('la vidéo voyage hors de l’event (url ou cid, jamais le fichier)',
    !JSON.stringify(contenu).includes('base64') && (!!contenu.blossomUrl || !!contenu.videoCid))
  // ⭐ Sans vidéo NI cid, le player ignore le programme (`use-tv-programs` :
  //    « sans vidéo → ignoré »). Un JT produit mais injouable est pire qu'absent.
  chk('⭐ le programme porte de quoi être joué', !!(contenu.blossomUrl || contenu.videoCid))
  chk('le chapitrage part de 0 et progresse',
    Array.isArray(contenu.segments) && (contenu.segments as { startSec: number }[])[0].startSec === 0)
}

console.log('\n— Les deux dépôts doivent parler de la MÊME chose —')
{
  const candidats = [
    process.env.INFINITY_REPO,
    join(process.cwd(), '..', 'infinity'),
    join(homedir(), 'infinity'),
  ].filter(Boolean) as string[]
  const repo = candidats.find(p => existsSync(join(p, 'src/modules/tv/tv-program-codec.ts')))

  if (!repo) {
    console.log('SKIP tv-contrat — dépôt Infinity introuvable (INFINITY_REPO=/chemin pour l’exercer)')
    console.log(pass ? '\n🎉 contrat TV : vert (comparaison inter-dépôts ignorée)' : '\n💥 contrat TV : échec')
    process.exit(pass ? 0 : 1)
  }

  const codec = readFileSync(join(repo, 'src/modules/tv/tv-program-codec.ts'), 'utf8')
  const kinds = readFileSync(join(repo, 'packages/protocol/src/nostr.ts'), 'utf8')

  const kindApp = /TV_PROGRAM:\s*(\d+)/.exec(kinds)?.[1]
  chk(`⭐ le kind d’Infinity (${kindApp}) est celui du générateur (${TV_PROGRAM_KIND})`,
    kindApp === String(TV_PROGRAM_KIND))

  // Tout ce que le générateur écrit doit être lu en face. L'inverse est permis
  // (un champ que l'app sait lire mais qu'on n'envoie pas encore).
  const luParLApp = new Set(
    [...codec.matchAll(/\bc\.([A-Za-z0-9_]+)/g)].map(m => m[1]),
  )
  const ecrits = Object.keys(contenu).filter(k => contenu[k] !== undefined)
  for (const champ of ecrits) {
    chk(`« ${champ} » est lu par le codec d’Infinity`, luParLApp.has(champ))
  }

  // Les tags aussi : le player filtre les programmes d'une chaîne par `channel`.
  for (const tag of ['d', 'channel']) {
    chk(`le tag « ${tag} » est attendu côté Infinity`,
      new RegExp(`getTag\\(event,\\s*'${tag}'\\)`).test(codec) || codec.includes(`['${tag}',`))
  }
  chk('le codec d’Infinity sait ignorer un programme retiré (tombstone)', /deleted\s*===\s*true/.test(codec))

  // ⭐ CHAQUE CANAL DU GÉNÉRATEUR DOIT EXISTER CÔTÉ INFINITY. Un programme publié sur un
  // identifiant que l'application ne connaît pas n'apparaît NULLE PART, sans aucune erreur.
  // C'est arrivé deux fois : `tv-jt-fr` le 09/09/2026, `tv-nature` le 10/09 — produit, publié,
  // avec le son, invisible. Tous les autres contrôles de ce fichier étaient verts les deux fois.
  const socle = readFileSync(join(repo, 'src/modules/tv/tv-channels.ts'), 'utf8')
  const idsSocle = new Set([...socle.matchAll(/id:\s*'([^']+)'/g)].map(m => m[1]))
  for (const ch of TV_CHANNELS) {
    chk(`⭐ le canal « ${ch.id} » (${ch.name}) existe dans le socle d’Infinity`, idsSocle.has(ch.id))
  }
}

console.log(pass ? '\n🎉 contrat TV : tout est vert' : '\n💥 contrat TV : échec')
process.exit(pass ? 0 : 1)
