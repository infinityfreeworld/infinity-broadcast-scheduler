/**
 * @module InfinityScheduler/TV/test
 * @description 🧪 LA VOIX ET L'IMAGE NE DOIVENT PAS DÉRIVER. Test hors ligne :
 *   aucun réseau, aucun Piper, aucune clé.
 *
 *   Ce qu'il protège :
 *     · le JT partait MUET — le conducteur écrivait une narration que rien ne
 *       lisait, et le montage n'a jamais reçu de piste audio.
 *     · une fois la voix branchée, le vrai piège est le DÉCALAGE : le LLM
 *       propose « 8 s » sans savoir combien de temps sa phrase prend à dire.
 *       Le montage cale la vidéo sur la durée de l'audio ; si les durées de
 *       plans ne sont pas celles de la voix, le bandeau du sujet 3 s'affiche
 *       pendant le commentaire du sujet 4, et l'écart grandit à chaque sujet.
 *
 *   npx tsx src/scripts/tv-voice-test.ts
 */
import { timingsFromEntries, silence, withTail, DEFAULT_TV_VOICE } from '../lib/tv-voice'
import { applyTimings, buildEpg, buildShots, totalDuration, buildProgram } from '../lib/tv-assemble'
import { isVoiceSupported } from '../lib/piper'
import { voixCommercialisable, licenceDe } from '../lib/voix-licences'
import { readFileSync } from 'node:fs'
import type { TvConductor, TvChannelConfig } from '../lib/tv-types'

let pass = true
const chk = (label: string, cond: boolean) => {
  pass = pass && cond
  console.log(`${cond ? '✅' : '❌'} ${label}`)
}
const proche = (a: number, b: number, tol = 0.011) => Math.abs(a - b) <= tol

const conducteur: TvConductor = {
  title: 'JT du jour',
  segments: [
    { title: 'Ouverture', imagePrompt: 'sunrise', durationSec: 6 },
    { title: 'Sujet 1', imagePrompt: 'garden', narration: 'Une phrase courte.', durationSec: 8 },
    { title: 'Sujet 2', imagePrompt: 'workshop', narration: 'Une autre phrase.', durationSec: 7 },
  ],
}

console.log('— Le minutage sort de la bande, pas des intentions du LLM —')
{
  // Trois plans concaténés avec 0,10 s de silence entre eux (cf. audio.ts).
  const entries = [
    { tStart: 0, tEnd: 4 },
    { tStart: 4.1, tEnd: 9.2 },
    { tStart: 9.3, tEnd: 12.5 },
  ]
  const total = 12.5
  const t = timingsFromEntries(entries, total)
  chk('un minutage par plan', t.length === 3)
  chk('le premier plan démarre à 0', t[0].startSec === 0)
  chk('chaque plan démarre là où sa phrase démarre', t[1].startSec === 4.1 && t[2].startSec === 9.3)
  // ⭐ L'invariant qui compte : rien ne se perd entre les plans. Si la durée
  // d'un plan était sa seule longueur audio (4 s au lieu de 4,1), les 0,1 s de
  // silence disparaîtraient de l'image et le décalage s'accumulerait.
  const somme = t.reduce((a, x) => a + x.durationSec, 0)
  chk(`⭐ la somme des plans = la durée de la bande (${somme} = ${total})`, proche(somme, total))
  chk('le dernier plan va jusqu’au bout de la bande', proche(t[2].startSec + t[2].durationSec, total))
  chk('le temps parlé est distinct du temps à l’écran', t[1].spokenSec === 5.1 && t[1].durationSec === 5.2)
}

console.log('\n— Les durées mesurées REMPLACENT celles du conducteur —')
{
  const t = timingsFromEntries([{ tStart: 0, tEnd: 5 }, { tStart: 5.1, tEnd: 11 }, { tStart: 11.1, tEnd: 14 }], 14)
  const ajuste = applyTimings(conducteur, t)
  chk('⭐ la durée proposée à l’aveugle (6 s) cède la place à la mesure (5,1 s)', ajuste.segments[0].durationSec === 5.1)
  chk('le reste du segment est intact (titre, prompt, narration)',
    ajuste.segments[1].title === 'Sujet 1' && ajuste.segments[1].narration === 'Une phrase courte.')
  chk('le conducteur d’origine n’est pas muté', conducteur.segments[0].durationSec === 6)
  chk('la durée totale suit la bande', proche(totalDuration(ajuste), 14))

  // L'EPG (le guide des programmes) est dérivé des mêmes durées : il pointe
  // donc sur les bons instants, sinon « à suivre » annonce le mauvais sujet.
  const epg = buildEpg(ajuste)
  chk('⭐ le chapitrage EPG tombe sur les vrais départs', epg[1].startSec === 5.1 && epg[2].startSec === 11.1)
  const shots = buildShots(ajuste, ['a', 'b', 'c'])
  chk('les plans du montage portent les durées mesurées', shots[0].durationSec === 5.1 && shots[2].durationSec === 2.9)
  chk('le mouvement Ken Burns alterne', shots[0].motion === 'in' && shots[1].motion === 'out')
}

console.log('\n— Les briques audio —')
{
  const s = silence(2, 22050)
  chk('un silence a la bonne longueur', s.samples.length === 44100 && s.sampleRate === 22050)
  chk('un silence est vraiment muet', s.samples.every(v => v === 0))
  const parle = { samples: new Float32Array(22050).fill(0.5), sampleRate: 22050 }
  const avec = withTail(parle, 0.6)
  chk('la respiration allonge le plan sans toucher à la voix',
    avec.samples.length === 22050 + 13230 && avec.samples[0] === 0.5 && avec.samples[30000] === 0)
  chk('une respiration nulle ne copie rien', withTail(parle, 0).samples.length === 22050)
  chk(`la voix par défaut (${DEFAULT_TV_VOICE}) existe dans le registre Piper`, isVoiceSupported(DEFAULT_TV_VOICE))
  // ⭐ Être PRÉSENTE ne suffit pas : la voix du JT part à l'antenne d'un service
  // commercial. Le défaut de ce module a été `fr_FR-tom-medium` jusqu'au
  // 09/09/2026 — AGPLv3, écartée par l'audit du 04/08. Elle passait le test
  // ci-dessus tant qu'elle était au registre ; celui-ci l'aurait arrêtée.
  const lic = licenceDe(DEFAULT_TV_VOICE)
  chk(`⭐ la voix du JT est COMMERCIALISABLE (${lic?.licence ?? 'licence inconnue'})`,
    voixCommercialisable(DEFAULT_TV_VOICE))
}

console.log('\n— Un segment MUET tient quand même sa place —')
{
  // Le plan d'ouverture n'a pas de narration : s'il disparaissait de la bande,
  // toute l'image se décalerait de sa durée.
  const t = timingsFromEntries([{ tStart: 0, tEnd: 6 }, { tStart: 6.1, tEnd: 11 }], 11)
  chk('⭐ le plan sans voix garde sa durée dans la bande', t[0].durationSec === 6.1)
  chk('il est marqué comme non parlé une fois mesuré', t[0].spokenSec === 6)
}

console.log('\n— La chaîne complète reste branchée —')
{
  const src = readFileSync(new URL('./generate-tv-program.ts', import.meta.url), 'utf8')
  const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
  // ⚠️ On lit le CORPS de `main`, pas les `import` en tête : l'ordre des
  // imports ne dit rien de l'ordre d'exécution (première version de ce test,
  // qui accusait un code correct).
  const corps = code.slice(code.indexOf('async function main'))
  chk('⭐ la piste est passée au montage', /audio:\s*audioAssetId\s*\?\s*\{\s*assetId:\s*audioAssetId\s*\}/.test(corps))
  chk('la voix est synthétisée avant les images', corps.indexOf('synthesizeConductor') < corps.indexOf('generateImage'))
  chk('les durées mesurées sont appliquées avant le montage', corps.indexOf('applyTimings') < corps.indexOf('buildShots'))
  chk('la piste est déposée dans la forge (pas chez un tiers)', /uploadMedia\(/.test(code) && !/pinata/i.test(code))
  chk('le mode --muet reste possible (repli)', /arg\('--muet'\)/.test(code))
  chk('le mode hors-ligne --plan ne synthétise rien', /!plan\s*&&\s*!muet/.test(code))

  const prog = buildProgram({ id: 'tv-jt-fr', name: 'JT' } as TvChannelConfig, conducteur, 0, undefined, {
    generator: 'ffmpeg-compose+llm+piper:fr_FR-tom-medium',
  })
  chk('le programme dit avec quelle voix il a été fait', prog.generator?.includes('piper:') === true)

  // ⭐ ÉCRAN NOIR DU 10/09 : avec un CID, l'URL de la forge disparaissait du programme ; il ne
  // restait que la passerelle IPFS, qui type mal les plages au milieu (Chrome les bloque).
  const deux = buildProgram({ id: 'tv-main-1', name: 'JT' } as TvChannelConfig, conducteur, 0,
    { id: 'r1', url: 'https://forge/api/assets/r1/file', ipfs: 'QmCID', durationSec: 10 })
  chk('⭐ avec un CID, l’URL directe de la forge est QUAND MÊME publiée', deux.blossomUrl === 'https://forge/api/assets/r1/file')
  chk('… et le CID aussi (survivre au domaine)', deux.videoCid === 'QmCID')
}

console.log(pass ? '\n🎉 voix TV : tout est vert' : '\n💥 voix TV : échec')
process.exit(pass ? 0 : 1)
