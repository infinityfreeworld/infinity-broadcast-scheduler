/**
 * Copie des tests de l'app Infinity (`ai/__tests__/tts-sanitize.test.ts`, 04/10/2026) :
 * le même nettoyage, les mêmes cas. Lancer : npx tsx --test src/lib/__tests__/tts-sanitize.test.ts
 */
import { describe, it, expect } from './vitest-cale'
import { sanitizeForSpeech } from '../tts-sanitize'

describe('sanitizeForSpeech', () => {
  it('retire les astérisques (le bug « astérisque » prononcé)', () => {
    expect(sanitizeForSpeech('et là *** boom ***')).toBe('et là boom')
    // 04/10/2026 : une didascalie entre astérisques est RETIRÉE, pas lue.
    expect(sanitizeForSpeech('*rires* salut')).toBe('salut')
  })

  it('retire le gras/italique en gardant le texte', () => {
    expect(sanitizeForSpeech('c’est **important** et _vrai_')).toBe('c’est important et vrai')
    expect(sanitizeForSpeech('du `code` ici')).toBe('du code ici')
  })

  it('retire titres, citations et puces en début de ligne', () => {
    expect(sanitizeForSpeech('## Titre\n> citation\n- point')).toBe('Titre\ncitation\npoint')
  })

  it('transforme les liens Markdown en libellé', () => {
    expect(sanitizeForSpeech('voir [le site](https://x.y) maintenant')).toBe('voir le site maintenant')
  })

  it('retire les emojis', () => {
    expect(sanitizeForSpeech('trop bien 🔥🎉 non ?')).toBe('trop bien non ?')
  })

  it('préserve la ponctuation normale (intonation)', () => {
    const s = 'Vraiment ? Oui ! Bien sûr… « cité ».'
    expect(sanitizeForSpeech(s)).toBe(s)
  })

  it('ne touche pas à un texte déjà propre', () => {
    const s = 'Bonjour à toutes et à tous, bienvenue sur la radio.'
    expect(sanitizeForSpeech(s)).toBe(s)
  })

  it('préserve le cyrillique et les sinogrammes', () => {
    expect(sanitizeForSpeech('Привет, как дела?')).toBe('Привет, как дела?')
    expect(sanitizeForSpeech('你好，世界！')).toBe('你好，世界！')
  })

  // ── 04/10/2026 — « certains animateurs prononcent de la ponctuation » ──

  describe('didascalies', () => {
    it.each([
      ['Bon. *rit* On continue.', 'Bon. On continue.'],
      ['*soupir* Encore ce sujet ?', 'Encore ce sujet ?'],
      ['Alors *en chuchotant* écoutez bien.', 'Alors écoutez bien.'],
      ['Et voilà [musique] la suite.', 'Et voilà la suite.'],
      ['[Rires] Franchement, non.', 'Franchement, non.'],
      ['[Cyril] Je ne suis pas d’accord.', 'Je ne suis pas d’accord.'],
      ['Bon (pause) reprenons.', 'Bon reprenons.'],
      ['C’est fou (rires) vraiment.', 'C’est fou vraiment.'],
      ['Oui (en soupirant) pourquoi pas.', 'Oui pourquoi pas.'],
      ['Ok (laughs) fine.', 'Ok fine.'],
      ['Claro (risas) que sí.', 'Claro que sí.'],
      ['Да (смех) конечно.', 'Да конечно.'],
    ])('%j → %j', (entree, attendu) => {
      expect(sanitizeForSpeech(entree)).toBe(attendu)
    })

    it('un aparté normal entre parenthèses reste DIT (avec des virgules)', () => {
      expect(sanitizeForSpeech('Le vote (le troisième cette année) est passé.'))
        .toBe('Le vote, le troisième cette année, est passé.')
    })

    it('le gras double reste lu, seule la didascalie simple disparaît', () => {
      expect(sanitizeForSpeech('C’est **crucial** *rit* non ?')).toBe('C’est crucial non ?')
    })

    it('un tour qui n’est QU’UNE didascalie ne devient pas un silence', () => {
      expect(sanitizeForSpeech('*rires*')).toBe('rires')
      expect(sanitizeForSpeech('[musique]')).toBe('musique')
    })
  })

  describe('Markdown', () => {
    it.each([
      ['# Titre principal', 'Titre principal'],
      ['### Sous-titre', 'Sous-titre'],
      ['• premier\n• second', 'premier\nsecond'],
      ['* point un\n* point deux', 'point un\npoint deux'],
      ['+ plus un', 'plus un'],
      ['— tiret long en tête', 'tiret long en tête'],
      ['~~barré~~ gardé', 'barré gardé'],
      ['```\nbloc\n```', 'bloc'],
      ['un mot_clé ici', 'un mot clé ici'],
      ['__souligné__ fort', 'souligné fort'],
      ['>> double citation', 'double citation'],
      ['![image](https://x.y/i.png) texte', 'texte'],
    ])('%j → %j', (entree, attendu) => {
      expect(sanitizeForSpeech(entree)).toBe(attendu)
    })
  })

  describe('symboles isolés', () => {
    it.each([
      ['et/ou', 'et ou'],
      ['A | B', 'A B'],
      ['a > b', 'a b'],
      ['a < b', 'a b'],
      ['x = y', 'x y'],
      ['un \\ deux', 'un deux'],
      ['suivez @infinity', 'suivez infinity'],
      ['#liberté pour tous', 'liberté pour tous'],
      ['{accolades}', 'accolades'],
      ['§ 3 du texte', '3 du texte'],
      ['ça monte ^^', 'ça monte'],
    ])('%j → %j', (entree, attendu) => {
      expect(sanitizeForSpeech(entree)).toBe(attendu)
    })

    it('garde les nombres et leurs signes', () => {
      expect(sanitizeForSpeech('Ouvert 24/7, moitié 1/2.')).toBe('Ouvert 24/7, moitié 1/2.')
      expect(sanitizeForSpeech('2+2 font 4, appelez le +33 6.')).toBe('2+2 font 4, appelez le +33 6.')
      expect(sanitizeForSpeech('-5 degrés, 3,5 %, 12 € et 20 °C.')).toBe('-5 degrés, 3,5 %, 12 € et 20 °C.')
      expect(sanitizeForSpeech('En 2026, 1 200 Bâtisseurs.')).toBe('En 2026, 1 200 Bâtisseurs.')
    })

    it('garde & (lu « et ») et les apostrophes', () => {
      expect(sanitizeForSpeech('Recherche & développement, l’été d\'abord.'))
        .toBe('Recherche & développement, l’été d\'abord.')
    })
  })

  describe('URL', () => {
    it.each([
      ['Allez sur https://exemple.org/page?x=1 maintenant.', 'Allez sur maintenant.'],
      ['Voir http://a.b/c', 'Voir'],
      ['Le site www.exemple.org est bien.', 'Le site exemple.org est bien.'],
    ])('%j → %j', (entree, attendu) => {
      expect(sanitizeForSpeech(entree)).toBe(attendu)
    })
  })

  describe('emojis', () => {
    it.each([
      ['Bravo 👏🏽 !', 'Bravo !'],
      ['Famille 👨‍👩‍👧 au complet', 'Famille au complet'],
      ['Vive la France 🇫🇷', 'Vive la France'],
      ['Top ✅ ✨ ❤️', 'Top'],
      ['Suite → plus tard', 'Suite plus tard'],
      ['Note ① ★ ▶ ok', 'Note ① ok'],
      ['Marque™ déposée©', 'Marque déposée'],
    ])('%j → %j', (entree, attendu) => {
      expect(sanitizeForSpeech(entree)).toBe(attendu)
    })
  })

  describe('ponctuation de phrase préservée', () => {
    it.each([
      'Bonjour, ça va ? Très bien ; et toi : en forme !',
      'Il a dit « non »… puis « oui ».',
      'C’est l’heure — enfin, presque - de partir.',
      '"Citation" et \'apostrophe\'.',
      'Hola, ¿qué tal? ¡Muy bien!',
      'こんにちは、元気ですか？',
      'नमस्ते, आप कैसे हैं।',
    ])('%j inchangé', (s) => {
      expect(sanitizeForSpeech(s)).toBe(s)
    })
  })

  it('nettoie un tour réaliste complet', () => {
    const brut = '**Bon**, *rire nerveux* écoutez 🎙️ : [jingle] la loi (encore une !) passe — https://x.fr/loi #scandale'
    expect(sanitizeForSpeech(brut)).toBe('Bon, écoutez : la loi, encore une ! passe — scandale')
  })

  it('ne laisse jamais un astérisque, un dièse ni une barre', () => {
    const entrees = ['***', '* * *', '**a*b**', 'x * y', '#', '|||', '/ \\ /', '*[*]*', '(*)']
    for (const e of entrees) {
      const s = sanitizeForSpeech(`Début ${e} fin`)
      expect(s, e).not.toMatch(/[*#|\\/]/)
    }
  })
})
