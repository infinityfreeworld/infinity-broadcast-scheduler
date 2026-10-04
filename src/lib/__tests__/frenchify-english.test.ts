/**
 * ⚠️ DEUX COPIES — GARDER IDENTIQUES : ce fichier (app, vitest) et
 * `src/lib/__tests__/frenchify-english.test.ts` du générateur
 * (infinity-broadcast-scheduler, même texte, importé via `./vitest-cale`).
 */
import { describe, it, expect } from './vitest-cale'
import { frenchifyEnglishWords, releverMotsAnglaisInconnus, DICTIONNAIRE } from '../frenchify-english'

const f = frenchifyEnglishWords

describe('frenchifyEnglishWords — phrases d’animateur réelles', () => {
  it.each([
    ['Bienvenue sur What The Fuck Radio !', 'Bienvenue sur Ouatte ze feuk Radio !'],
    ['Breaking news : Elon Musk rachète Twitter.', 'Bréïkigne niouze : Ilone Meuske rachète Touiteur.'],
    ['Ce soir on parle de start-up, de crowdfunding et de fair-play.',
      'Ce soir on parle de starte eupe, de kraoudfeunndigne et de fère pléï.'],
    ['Les hackers ont percé le cloud de Google ; l’update arrive.',
      'Les hakeurs ont percé le klaoude de Gougueul ; l’eupdéïte arrive.'],
    ['Il a liké le post, puis il a streamé en live sur Netflix.',
      'Il a laïké le pôste, puis il a strîmé en laïve sur Nètflixe.'],
    ['Donald Trump à la White House, thank you so much.',
      'Donalde Treumpe à la Ouaïte Haousse, sènnke iou sô meutche.'],
    ['Le jazz, le blues, le groove et la playlist du DJ.',
      'Le djaze, le blouze, le grouve et la pléïliste du Dîdjéï.'],
    ['Un best-of hip-hop, un talk-show en prime time.',
      'Un bèste ove hipe hope, un tôke chô en praïme taïme.'],
    ['Le fair trade et le zero waste, c’est le green new deal.',
      'Le fère tréïde et le ziro ouéïste, c’est le grîne niou dîle.'],
    ['De New York à Silicon Valley, les fake news circulent.',
      'De Niou York à Silikeune Vali, les féïke niouze circulent.'],
  ])('%s', (entree, attendu) => {
    expect(f(entree)).toBe(attendu)
  })
})

describe('frenchifyEnglishWords — homographes français : JAMAIS touchés', () => {
  it.each([
    'Pour son bus, il prend plus fort le pain au chat du coin, sur le four.',
    'Il a un but : une fin de date, une place, une rose, une page, une table.',
    'On a vu Nice, une fine équipe, une sale race, une cave, un rat, en mars.',
    'Le rythme catholique du thon à Nancy, l’alcool au zoo, un wagon, un kilo, le jury.',
    'Le stockage, la transhumance, le poing, le coing, le shampooing du coach.',
    'Il a noté, touché, bandé ; les parties riches ; une durée, un entree, l’INSEE.',
    'Elle lit, il fit, il met, il sent le vent ; or, si, me, on, a, as, an, in, do, us.',
    'Une station, une information, une image, un message, un service, une question.',
    'Une Agora post-apocalyptique, un microorganisme, une coopérative, un film hollywoodien.',
    'Ils boostent, nous partageons, vous liez.',
  ])('%s', (fr) => {
    expect(f(fr)).toBe(fr)
  })

  it('aucune clé du dictionnaire n’est un homographe français ou un anglicisme de SKIP', () => {
    for (const k of DICTIONNAIRE.mots.keys()) {
      expect(DICTIONNAIRE.nePasToucher.has(k), `« ${k} » est dans NE_PAS_TOUCHER`).toBe(false)
      expect(DICTIONNAIRE.skip.has(k), `« ${k} » est dans SKIP`).toBe(false)
    }
  })
})

describe('frenchifyEnglishWords — SKIP : anglicismes déjà francisés', () => {
  it.each([
    'je vais au parking ce week-end',
    'un sandwich, du football, du tennis, du camping, du shopping',
    'le budget du marketing, le planning du manager',
    'un ticket de bus, un taxi, un match de rugby',
  ])('%s', (fr) => {
    expect(f(fr)).toBe(fr)
  })
})

describe('frenchifyEnglishWords — casse', () => {
  it('garde une majuscule initiale, ramène les MAJUSCULES à une seule (sinon épelées)', () => {
    expect(f('live')).toBe('laïve')
    expect(f('Live')).toBe('Laïve')
    expect(f('LIVE')).toBe('Laïve')
    expect(f('Le BUSINESS de YouTube')).toBe('Le Biznèsse de Youtioube')
  })

  it('un nom propre écrit en minuscules garde la forme du dictionnaire', () => {
    expect(f('sur google')).toBe('sur Gougueul')
  })
})

describe('frenchifyEnglishWords — formes dérivées', () => {
  it('pluriels -s, -es, -ies', () => {
    expect(f('les likes et les followers')).toBe('les laïkes et les folôweurs')
    expect(f('deux stories')).toBe('deux storis')
    expect(f('les speeches')).toBe('les spîtches')
  })

  it('formes -ing et -ed d’une entrée', () => {
    expect(f('liking')).toBe('laïkigne')
    expect(f('hacked')).toBe('hakte')
    expect(f('updated')).toBe('eupdéïtide')
    expect(f('following')).toBe('folôwigne')
  })

  it('verbes anglais conjugués à la française (liste fermée)', () => {
    expect(f('il a tweeté, elle a uploadé, ils ont checké')).toBe('il a touîté, elle a eupelôdé, ils ont tchèké')
  })

  it('possessif et contractions', () => {
    expect(f("Google's")).toBe('Gougueulze')
    expect(f("don't stop")).toBe('dônte stop')
  })

  it('mots composés : seulement si CHAQUE partie est anglaise', () => {
    expect(f('fair-play')).toBe('fère pléï')
    expect(f('high-tech')).toBe('haï tèke')
    expect(f('un post-apocalyptique')).toBe('un post-apocalyptique')
    expect(f('baby-foot')).toBe('baby-foot')
  })

  it('élisions françaises : « l’ », « d’ », « qu’ » gardés', () => {
    expect(f("l'update")).toBe("l'eupdéïte")
    expect(f('d’Elon Musk')).toBe('d’Ilone Meuske')
    expect(f("qu'Infinity")).toBe("qu'Infiniti")
  })

  it('ponctuation collée et espaces préservées', () => {
    expect(f('cool, live !')).toBe('coul, laïve !')
    expect(f('(cloud)… «news»')).toBe('(klaoude)… «niouze»')
  })
})

describe('frenchifyEnglishWords — un seul passage', () => {
  it('une phrase reconnue n’est pas reprise par le dictionnaire', () => {
    expect(f('game over')).toBe('guéïme ôveur')
  })

  it('est idempotent sur toute forme qu’il produit (dictionnaire et phrases)', () => {
    for (const v of [...DICTIONNAIRE.mots.values(), ...DICTIONNAIRE.phrases.values()]) {
      expect(f(v), `« ${v} » re-francisé`).toBe(v)
    }
  })

  it('chaque entrée est réellement transformée (aucune collision avec une forme produite)', () => {
    for (const [k, v] of DICTIONNAIRE.mots) {
      if (k === v.toLowerCase()) continue
      expect(f(k), `« ${k} » non transformé`).not.toBe(k)
    }
  })

  it('forme parlée du domaine : identique dans l’app et dans le générateur', () => {
    expect(f('Rejoignez Radio Pirate sur Infinity tiret Freeworld point com.'))
      .toBe('Rejoignez Radio Pirate sur Infiniti tiret Friwourld point com.')
    // la forme déjà francisée du générateur n'est pas francisée une seconde fois
    expect(f('Rejoignez Radio Pirate sur Infiniti tiret Friwourld point com.'))
      .toBe('Rejoignez Radio Pirate sur Infiniti tiret Friwourld point com.')
  })
})

describe('frenchifyEnglishWords — règles de secours', () => {
  it('translittère un mot anglais hors dictionnaire à marqueur fort', () => {
    expect(f('un bon feeling')).toBe('un bon fîligne')
    expect(f('très smooth')).toBe('très smouz')
    expect(f('quelle loneliness')).toBe('quelle lonelinèsse')
  })

  it('ne touche pas une onomatopée ou un remplissage', () => {
    expect(f('eeeeee, wooow, ouuuh')).toBe('eeeeee, wooow, ouuuh')
  })

  it('ne se déclenche jamais sur th, w, k ou -y seuls', () => {
    expect(f('le rythme du thème, un kiwi à Orly')).toBe('le rythme du thème, un kiwi à Orly')
  })

  it('gère une chaîne vide / sans mot', () => {
    expect(f('')).toBe('')
    expect(f('123 + 456 = 579')).toBe('123 + 456 = 579')
  })
})

describe('releverMotsAnglaisInconnus', () => {
  it('liste les mots probablement anglais NON couverts, une fois, dans l’ordre', () => {
    expect(releverMotsAnglaisInconnus('Un feeling sweet, very smooth, feeling ; le background et la wheel.'))
      .toEqual(['feeling', 'sweet', 'smooth', 'background', 'wheel'])
  })

  it('ignore les mots couverts, les phrases, SKIP, les homographes et le français', () => {
    expect(releverMotsAnglaisInconnus(
      'Breaking news : le cloud, les likes, le fair-play, le parking du week-end, son bus, le rythme du thon à Nancy.',
    )).toEqual([])
  })

  it('ignore les formes déjà francisées (domaine du générateur)', () => {
    expect(releverMotsAnglaisInconnus('Rejoignez Radio Pirate sur Infiniti tiret Friwourld point com.')).toEqual([])
  })
})

describe('taille du dictionnaire', () => {
  it('plusieurs centaines d’entrées', () => {
    expect(DICTIONNAIRE.mots.size + DICTIONNAIRE.phrases.size).toBeGreaterThanOrEqual(600)
  })
})
