/**
 * Copie des tests de l'app Infinity (`ai/__tests__/slogan-radio.test.ts`, 04/10/2026).
 * Seule différence : la forme parlée française est écrite déjà francisée ici ; l'étape
 * frenchify des moteurs (04/10/2026) la laisse intacte.
 */
import { describe, it, expect } from './vitest-cale'
import {
  appliquerSlogan, compterSlogans, consigneSloganPourTour, directiveSloganSysteme,
  domaineParle, phraseSlogan, prononcerDomaine, retirerSlogansEnTrop,
  DOMAINE_INFINITY, MAX_SLOGANS_PAR_EMISSION, type PositionTour,
} from '../slogan-radio'
import { sanitizeForSpeech } from '../tts-sanitize'
import { frenchifyEnglishWords } from '../frenchify-english'
import type { StationLanguage } from '../types'

const LANGUES: StationLanguage[] = ['fr', 'en', 'es', 'it', 'pt', 'hi', 'ja', 'zh', 'ru']

describe('phraseSlogan', () => {
  it('dit exactement la phrase demandée par le Bâtisseur en français', () => {
    expect(phraseSlogan('Radio Pirate', 'fr')).toBe('Rejoignez Radio Pirate sur Infinity-freeworld.com.')
  })

  it.each(LANGUES)('%s : contient le nom de la station et le domaine écrit', (l) => {
    const p = phraseSlogan('WTF Radio', l)
    expect(p).toContain('WTF Radio')
    expect(p).toContain(DOMAINE_INFINITY)
    expect(compterSlogans(p)).toBe(1)
  })

  it('a un repli quand la station n’a pas de nom', () => {
    expect(phraseSlogan('  ', 'fr')).toBe('Rejoignez Infinity Radio sur Infinity-freeworld.com.')
  })
})

describe('compterSlogans', () => {
  it.each([
    ['Rejoignez X sur Infinity-freeworld.com.', 1],
    ['rendez-vous sur infinity-freeworld.com et sur Infinity-Freeworld.com', 2],
    ['https://www.infinity-freeworld.com/ ici', 1],
    ['infinity freeworld point com', 1],
    ['Infinity Freeworld dot com', 1],
    ['Infinity Freeworld, le réseau', 0],
    ['rien à voir', 0],
  ])('%j → %i', (t, n) => {
    expect(compterSlogans(t)).toBe(n)
  })
})

describe('prononcerDomaine (texte envoyé à la synthèse)', () => {
  it('remplace la forme écrite par la forme parlée, tiret compris', () => {
    expect(prononcerDomaine('Rejoignez X sur Infinity-freeworld.com.', 'fr'))
      .toBe('Rejoignez X sur Infiniti tiret Friwourld point com.')
    expect(prononcerDomaine('Join X on Infinity-freeworld.com.', 'en'))
      .toBe('Join X on Infinity dash Freeworld dot com.')
  })

  it('attrape aussi l’adresse complète avec protocole', () => {
    expect(prononcerDomaine('Allez sur https://www.infinity-freeworld.com/ !', 'fr'))
      .toBe('Allez sur Infiniti tiret Friwourld point com !')
  })

  it.each(LANGUES)('%s : la forme parlée ne contient plus ni point ni tiret', (l) => {
    const dit = prononcerDomaine(phraseSlogan('Station', l), l)
    expect(dit).toContain(domaineParle(l))
    expect(dit).not.toMatch(/freeworld\.com|Infinity-/i)
  })

  it('survit au nettoyage des moteurs, sans un symbole, déjà francisée', () => {
    const t = sanitizeForSpeech(prononcerDomaine(phraseSlogan('Radio Pirate', 'fr'), 'fr'))
    expect(t).toBe('Rejoignez Radio Pirate sur Infiniti tiret Friwourld point com.')
    // pas de seconde francisation : c'est aussi ce que dit la voix de l'app
    expect(frenchifyEnglishWords(t)).toBe('Rejoignez Radio Pirate sur Infiniti tiret Friwourld point com.')
  })
})

describe('retirerSlogansEnTrop', () => {
  it('garde les premières mentions, retire les phrases suivantes', () => {
    const t = 'Bienvenue. Rejoignez X sur Infinity-freeworld.com. On parle vote. Rejoignez X sur Infinity-freeworld.com !'
    expect(retirerSlogansEnTrop(t, 1)).toBe('Bienvenue. Rejoignez X sur Infinity-freeworld.com. On parle vote.')
    expect(retirerSlogansEnTrop(t, 0)).toBe('Bienvenue. On parle vote.')
    expect(retirerSlogansEnTrop(t, 2)).toBe(t)
  })

  it('ne coupe pas la phrase au point de « freeworld.com »', () => {
    const t = 'Allez sur Infinity-freeworld.com pour tout savoir. Et ensuite ?'
    expect(retirerSlogansEnTrop(t, 0)).toBe('Et ensuite ?')
  })

  it('ne rend jamais une réplique vide', () => {
    const t = 'Rejoignez X sur Infinity-freeworld.com.'
    expect(retirerSlogansEnTrop(t, 0)).toBe(t)
  })
})

/** Simule une émission : chaque tour du modèle passe par `appliquerSlogan`. */
function emission(tours: string[], langue: StationLanguage = 'fr'): { textes: string[]; total: number } {
  let dits = 0
  const textes: string[] = []
  tours.forEach((texte, i) => {
    const premier = i === 0
    const dernier = i === tours.length - 1
    const position: PositionTour = premier && dernier ? 'unique' : premier ? 'ouverture' : dernier ? 'cloture' : 'milieu'
    const r = appliquerSlogan({ texte, nomStation: 'Radio Libre', langue, dejaDits: dits, position })
    dits = r.dits
    textes.push(r.texte)
  })
  const total = textes.reduce((n, t) => n + compterSlogans(t), 0)
  expect(total).toBe(dits)
  return { textes, total }
}

describe('appliquerSlogan — la garantie', () => {
  it('modèle muet : ajoutée à l’ouverture ET à la clôture (2 mentions)', () => {
    const { textes, total } = emission(['Salut à tous.', 'Le sujet du jour.', 'On en reparle.', 'À demain'])
    expect(total).toBe(2)
    expect(textes[0]).toBe('Salut à tous. Rejoignez Radio Libre sur Infinity-freeworld.com.')
    expect(textes[3]).toBe('À demain. Rejoignez Radio Libre sur Infinity-freeworld.com.')
    expect(textes[1]).toBe('Le sujet du jour.')
  })

  it('modèle bavard : jamais plus de 2, quel que soit le nombre de tours', () => {
    const bavard = 'Rejoignez Radio Libre sur Infinity-freeworld.com. Et on continue.'
    for (const n of [1, 2, 3, 5, 12, 40]) {
      const { total } = emission(Array.from({ length: n }, () => bavard))
      expect(total, `${n} tours`).toBeLessThanOrEqual(MAX_SLOGANS_PAR_EMISSION)
      expect(total, `${n} tours`).toBeGreaterThanOrEqual(1)
    }
  })

  it('modèle qui la dit déjà à l’ouverture : rien n’est ajouté en double', () => {
    const { textes, total } = emission([
      'Bonsoir ! Rejoignez Radio Libre sur Infinity-freeworld.com.', 'Suite.', 'Fin.',
    ])
    expect(textes[0]).toBe('Bonsoir ! Rejoignez Radio Libre sur Infinity-freeworld.com.')
    expect(total).toBe(2)
  })

  it('émission d’UN seul tour : une seule mention', () => {
    const { textes, total } = emission(['Flash rapide'])
    expect(total).toBe(1)
    expect(textes[0]).toBe('Flash rapide. Rejoignez Radio Libre sur Infinity-freeworld.com.')
  })

  it('émission de deux tours : ouverture + clôture', () => {
    expect(emission(['Un.', 'Deux.']).total).toBe(2)
  })

  it('le modèle la glisse au milieu : la clôture complète jusqu’à 2, pas plus', () => {
    const { total, textes } = emission([
      'Bonjour.', 'Au fait, Rejoignez Radio Libre sur Infinity-freeworld.com. Bref.', 'Fin.',
    ])
    expect(total).toBe(2)
    expect(textes[2]).toBe('Fin.')
  })

  it('respecte la ponctuation existante en fin de réplique', () => {
    const r = appliquerSlogan({ texte: 'Quelle soirée !', nomStation: 'R', langue: 'fr', dejaDits: 0, position: 'ouverture' })
    expect(r.texte).toBe('Quelle soirée ! Rejoignez R sur Infinity-freeworld.com.')
    expect(r.ajoute).toBe(true)
  })

  it.each(LANGUES)('%s : la phrase ajoutée est celle de la langue de la station', (l) => {
    const r = appliquerSlogan({ texte: 'x', nomStation: 'R', langue: l, dejaDits: 0, position: 'ouverture' })
    expect(r.texte.endsWith(phraseSlogan('R', l))).toBe(true)
  })
})

describe('consignes au modèle', () => {
  it('ouverture/clôture : demande la phrase mot pour mot', () => {
    expect(consigneSloganPourTour('R', 'fr', 'ouverture')).toContain('« Rejoignez R sur Infinity-freeworld.com. »')
    expect(consigneSloganPourTour('R', 'en', 'cloture')).toContain('« Join R on Infinity-freeworld.com. »')
  })

  it('milieu : interdit de la dire', () => {
    expect(consigneSloganPourTour('R', 'fr', 'milieu')).toMatch(/Ne dis PAS/)
  })

  it('directive système : nomme la phrase et la réserve aux consignes', () => {
    const d = directiveSloganSysteme('R', 'fr')
    expect(d).toContain('Rejoignez R sur Infinity-freeworld.com.')
    expect(d).toMatch(/QUE si la consigne/)
  })
})
