/**
 * Règle d'or (Bâtisseur, 04/10/2026) : une station anglaise ne produit JAMAIS de voix française ni
 * de tour en français ; une station française reste française.
 *
 * Cause mesurée sur Free Press FM (émissions 30093 du 29/09 au 04/10/2026) : 11 à 19 tours sur 22
 * en français, à partir du premier « De retour sur Free Press FM… » ou « un auditeur nous écrit »
 * — exemples FRANÇAIS que les consignes de tour donnaient à recopier.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { consigneTour, type GenreTour } from '../consignes-tour'
import { horsLangue } from '../langue-station'
import { buildHostSystemPrompt, buildGuestSystemPrompt } from '../personas'
import { voixPourLangue } from '../voix'
import { voixAdminCompatible, resoudreVoix } from '../chatterbox'
import type { HostKB, StationLanguage } from '../types'

const GENRES: GenreTour[] = [
  { type: 'invite-reponse-1' }, { type: 'invite-reponse-2' },
  { type: 'pre-invite', invite: 'Donald Trompe', bio: 'caricature satirique' },
  { type: 'relance-invite', invite: 'Donald Trompe' }, { type: 'post-invite', invite: 'Donald Trompe' },
  { type: 'ouverture' }, { type: 'cloture' },
  { type: 'avant-pause', morceau: 'Default Track 08' },
  { type: 'retour-pause', morceau: 'Default Track 08', station: 'Free Press FM' },
  { type: 'court' }, { type: 'courrier', anonyme: false }, { type: 'courrier', anonyme: true },
  { type: 'courant' },
]

test('station anglaise : AUCUNE consigne de tour ne contient de français à recopier', () => {
  for (const g of GENRES) {
    const c = consigneTour(g, 'en')
    assert.equal(horsLangue(c, 'en'), null, `${g.type} : ${c}`)
    for (const exemple of ['De retour sur', 'nous écrit', "on s'écoute", 'je vous laisse']) {
      assert.ok(!c.includes(exemple), `${g.type} contient l'exemple français « ${exemple} »`)
    }
    assert.match(c, /Never speak French\.$/, `${g.type} : la consigne de langue doit venir EN DERNIER`)
  }
})

test('station française : les consignes de tour restent en français', () => {
  for (const g of GENRES) {
    const c = consigneTour(g, 'fr')
    assert.equal(horsLangue(c, 'fr'), null, `${g.type} : ${c}`)
    assert.match(c, /Dis TOUT en français/, g.type)
  }
  assert.match(consigneTour({ type: 'retour-pause', morceau: 'X', station: 'WTF Radio' }, 'fr'), /De retour sur WTF Radio/)
})

test('autres langues : exemples « traduits dans la langue de la station » et consigne native', () => {
  const c = consigneTour({ type: 'retour-pause', morceau: 'X', station: 'Voces Libres' }, 'es')
  assert.match(c, /translated into the station's language/)
  assert.match(c, /Di TODO en español/)
  assert.ok(!c.includes('De retour'))
})

test('la phrase d\'appel passe AVANT la consigne de langue', () => {
  const c = consigneTour({ type: 'ouverture' }, 'en', 'Termine ta réplique en disant, mot pour mot : « Join Free Press FM on Infinity-freeworld.com. »')
  assert.ok(c.indexOf('Join Free Press FM') < c.indexOf('LANGUAGE:'))
})

const KB: HostKB = { hostId: 'fp-sarah', stationId: 'free-press-fm', personality: '', entries: [], updatedAt: 0 }
const SARAH = { id: 'fp-sarah', name: 'Sarah', gender: 'female' as const, trait: 'investigative journalist', color: '#3b82f6', avatar: '🎤' }

test('prompt système d\'une station anglaise : en-tête de langue, interjections anglaises, consigne finale', () => {
  const p = buildHostSystemPrompt({
    host: SARAH, kb: KB, selectedEntries: [], stationName: 'Free Press FM', language: 'en',
    otherHosts: [], currentTurn: 3, totalTurns: 22,
  })
  assert.match(p, /^# LANGUAGE OF THE STATION: ENGLISH/)
  assert.ok(!p.includes('« ouais »'), 'les interjections françaises ne doivent plus être proposées')
  assert.match(p, /"yeah"/)
  assert.match(p, /Never speak French/)
  const g = buildGuestSystemPrompt({
    guest: { displayName: 'Donald Trompe', gender: 'male', bio: 'caricature', instructions: 'Parle fort.', behavior: 'neutral' },
    stationName: 'Free Press FM', language: 'en', hostsRecap: 'Sarah, Malik', behaviorDirective: 'calme',
  })
  assert.match(g, /^# LANGUAGE OF THE STATION: ENGLISH/)
  assert.match(g, /Never speak French/)
})

test('prompt système d\'une station française : inchangé en tête, interjections françaises', () => {
  const p = buildHostSystemPrompt({
    host: { ...SARAH, id: 'wtf-marina', name: 'Marina' }, kb: KB, selectedEntries: [], stationName: 'WTF Radio',
    language: 'fr', otherHosts: [],
  })
  assert.match(p, /^Tu es Marina/)
  assert.match(p, /« ouais »/)
})

test('station anglaise : jamais de voix Piper française', () => {
  for (const genre of ['male', 'female', 'androgyn'] as const) {
    for (const hote of ['fp-sarah', 'fp-malik', 'wtf-marina', undefined]) {
      const v = voixPourLangue('en', genre, hote)
      assert.ok(v && v.startsWith('en_'), `${genre}/${hote} → ${v}`)
    }
  }
  for (const l of ['es', 'ru'] as StationLanguage[]) {
    assert.ok(!voixPourLangue(l, 'female', 'fw-leila')!.startsWith('fr_'), l)
  }
  assert.ok(voixPourLangue('fr', 'female', 'fw-leila')!.startsWith('fr_'))
})

test('voix attribuée dans l\'admin pour une AUTRE langue : sautée', () => {
  assert.equal(voixAdminCompatible('fr', 'en'), false)
  assert.equal(voixAdminCompatible('en', 'en'), true)
  assert.equal(voixAdminCompatible('en-GB', 'en'), true)
  assert.equal(voixAdminCompatible(undefined, 'en'), true, 'rien de déclaré : gardée')
  assert.equal(voixAdminCompatible('fr', 'fr'), true)
  // Le saut laisse répondre la source suivante (la voix inventée de la station).
  assert.equal(resoudreVoix({ admin: null, inventee: 'inv-fp-sarah' }, 'en'), 'inv-fp-sarah')
})

test('le générateur contrôle la langue de CHAQUE tour, réécrit, puis écarte', () => {
  const src = readFileSync(new URL('../../scripts/generate-broadcast.ts', import.meta.url), 'utf8')
  assert.match(src, /let ailleurs = horsLangue\(turnText, language\)/)
  assert.match(src, /for \(let essai = 1; ailleurs && essai <= MAX_REECRITURES_LANGUE; essai\+\+\)/)
  assert.match(src, /demandeReecriture\(language, ailleurs\)/)
  assert.match(src, /if \(ailleurs\) \{[\s\S]{0,200}continue/)
  assert.match(src, /content: consigneTour\(genreTour, language, consigneSlogan\)/)
  // Le contrôle passe AVANT l'entrée dans l'historique (turns.push) : un tour étranger n'entraîne pas la suite.
  assert.ok(src.indexOf('let ailleurs = horsLangue') < src.indexOf('turns.push(turn)'))
  // Plus aucun exemple français en dur dans la boucle.
  assert.ok(!src.includes('`On REVIENT d\'une pause musicale'))
})

test('frenchify réservé au français (Piper et voix clonée)', () => {
  const ch = readFileSync(new URL('../chatterbox.ts', import.meta.url), 'utf8')
  assert.match(ch, /text: langueVoix === 'fr' \? frenchifyEnglishWords\(propre\) : propre/)
  const pi = readFileSync(new URL('../piper.ts', import.meta.url), 'utf8')
  assert.match(pi, /return estVoixPiperFrancaise\(voiceId\) \? frenchifyEnglishWords\(propre\) : propre/)
  const gb = readFileSync(new URL('../../scripts/generate-broadcast.ts', import.meta.url), 'utf8')
  assert.match(gb, /synthesizeWithChatterbox\(\{\s*voice:\s+plansVoix\[j\]\.voixPersonnage as string,\s*text:\s+plansVoix\[j\]\.texte,\s*language,/)
})
