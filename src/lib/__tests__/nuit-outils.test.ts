/**
 * La nuit vérifie ses outils d'encodage AVANT de produire : sans opusenc ni
 * ffmpeg, chaque station échouerait à la toute fin, son heure de programme
 * déjà écrite et synthétisée.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const CODE = readFileSync(resolve(process.cwd(), 'scripts/nuit-locale.sh'), 'utf8')
  .split('\n').map(l => l.replace(/(^|\s)#.*$/, '')).join('\n')

test('opusenc et ffmpeg sont exigés, et leur absence arrête la nuit', () => {
  assert.match(CODE, /for outil in opusenc ffmpeg; do/)
  assert.match(CODE, /command -v "\$outil" >\/dev\/null \|\| \{[^}]*exit 1; \}/)
})

test('le contrôle précède la génération', () => {
  const iOutils = CODE.indexOf('for outil in opusenc ffmpeg')
  const iGen = CODE.indexOf('generate-all.ts')
  assert.ok(iOutils > 0 && iGen > 0 && iOutils < iGen, 'un contrôle après la génération ne protège rien')
})
