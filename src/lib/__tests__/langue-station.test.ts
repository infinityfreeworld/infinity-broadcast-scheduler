/**
 * Règle d'or (Bâtisseur, 04/10/2026) : tout ce qui se dit sur une station se dit dans la langue
 * de la station. Les phrases ci-dessous sont des tours RÉELS des émissions publiées (kind 30093)
 * de Free Press FM (station anglaise) du 29/09 au 04/10/2026.
 *
 * ⚠️ Copie identique dans l'app : src/modules/radio/ai/__tests__/langue-station.test.ts
 */
import { describe, it, expect } from './vitest-cale'
import {
  horsLangue, detecterLangue, consigneLangueTour, enteteLangueSysteme, demandeReecriture,
  retirerEtiquetteLocuteur, garantirLangue, type LangueStation,
} from '../langue-station'

const ANGLAIS_REELS = [
  "Good afternoon, Free Press FM listeners—Independent International News where we dig deeper when others look away.",
  "Ah, Malik, you’re asking the right questions—because when Trump starts talking about \"asking Europe to release diesel reserves,\" it's theatre.",
  "\"Sarah plays chess, Trump plays Monopoly.\"",
  "That’s the most polite way I’ve ever heard of ethnic cleansing.",
  "Sarah, you’re selling Kiev short—those memes *are* weapons.",
  "Malik, your metaphors are as expired as last month's bread.",
]

const FRANCAIS_REELS = [
  "De retour sur Free Press FM, et ne vous y trompez pas—ces pots qui ont dansé sous les fenêtres des banques espagnoles, c'était la colère.",
  "[Malik] Ah, Sarah, tu veux parler de Brésil ? Écoute, Lula ou Bolsonaro Jr, c’est comme choisir entre la fièvre et la pneumonie.",
  "Ah, là tu parles !",
  "Ah, là tu m’as cloué le bec, Sarah !",
  "\"Ah ouais? Et le gagnant du corps à corps est... qui, Malik?\"",
  "Un auditeur nous écrit depuis Marseille : « Malik, arrêtez de parler comme si la démocratie était morte. »",
  "Et Poutine, il signe des autographes dans les décombres ?",
]

describe('horsLangue — station anglaise (Free Press FM)', () => {
  it.each(ANGLAIS_REELS)('garde un tour anglais : %s', (t) => {
    expect(horsLangue(t, 'en')).toBe(null)
  })
  it.each(FRANCAIS_REELS)('attrape un tour français : %s', (t) => {
    expect(horsLangue(t, 'en')).toBe('fr')
  })
  it("attrape un tour anglais qui bascule en français à la fin", () => {
    expect(horsLangue("Spain’s housing crisis isn’t a crisis, it’s a profit model. Bon, alors on s’écoute un morceau, et on revient tout de suite avec vous.", 'en')).toBe('fr')
  })
  it("n'attrape pas une expression française isolée dans une phrase anglaise", () => {
    expect(horsLangue("Well, c'est la vie, as they say in Paris — but for the families evicted in Madrid it is a disaster.", 'en')).toBe(null)
  })
})

describe('horsLangue — les autres stations restent dans leur langue', () => {
  it('station française : un tour français passe, un tour anglais est attrapé', () => {
    expect(horsLangue("Bon, alors aujourd'hui on parle de la Ğ1, et franchement, c'est pas ce que vous croyez.", 'fr')).toBe(null)
    expect(horsLangue("Ah, Marina, tu me fais rire avec ton Bitcoin, mais le week-end, les gens veulent du concret.", 'fr')).toBe(null)
    expect(horsLangue("Well, today we are going to talk about the housing market, and honestly it is not what you think.", 'fr')).toBe('en')
  })
  it('station espagnole', () => {
    expect(horsLangue("Bueno, hoy hablamos de la vivienda en Madrid, y la verdad es que la situación está muy mal.", 'es')).toBe(null)
    expect(horsLangue("Alors voilà, aujourd'hui on parle du logement à Madrid, et franchement c'est très grave.", 'es')).toBe('fr')
  })
  it('stations à écriture propre (russe, chinois)', () => {
    expect(horsLangue('Добрый вечер, это Свобода FM, и сегодня мы говорим о свободе слова.', 'ru')).toBe(null)
    expect(horsLangue("Bonsoir, c'est Svoboda FM, et ce soir on parle de la liberté de la presse avec vous.", 'ru')).toBe('fr')
    expect(horsLangue('大家好，这里是自由之声，今天我们来聊聊新闻自由。', 'zh')).toBe(null)
    expect(horsLangue('Good evening, this is the voice of freedom, and today we talk about the news.', 'zh')).toBe('en')
  })
  it('un texte trop court ou sans mots-outils est indécidable : gardé', () => {
    expect(horsLangue('Monopoly !', 'en')).toBe(null)
    expect(horsLangue('', 'en')).toBe(null)
  })
})

describe('detecterLangue', () => {
  it('reconnaît les langues des stations', () => {
    expect(detecterLangue("Et devine quoi Sarah, cette liste qu’on devine longue… elle tient sur un seul chèque.")).toBe('fr')
    expect(detecterLangue("Let me tell you who wins, Sarah: the landlords in Madrid who are laughing all the way to the bank.")).toBe('en')
    expect(detecterLangue('Добрый вечер, это Свобода FM.')).toBe('ru')
    expect(detecterLangue('今天我们来聊聊新闻自由。')).toBe('zh')
  })
})

const LANGUES: LangueStation[] = ['fr', 'en', 'es', 'it', 'pt', 'hi', 'ja', 'zh', 'ru']

describe('consignes de langue', () => {
  it.each(LANGUES)('une consigne de tour existe pour %s', (l) => {
    expect(consigneLangueTour(l).length).toBeGreaterThanOrEqual(30)
  })
  it("la consigne d'une station anglaise est en anglais et interdit le français", () => {
    const c = consigneLangueTour('en')
    expect(c).toContain('English')
    expect(c).toContain('Never speak French')
    expect(horsLangue(c, 'en')).toBe(null)
  })
  it("la consigne d'une station française est en français", () => {
    expect(consigneLangueTour('fr')).toContain('français')
    expect(horsLangue(consigneLangueTour('fr'), 'fr')).toBe(null)
  })
  it("l'en-tête du prompt système n'existe que hors français", () => {
    expect(enteteLangueSysteme('fr')).toBe('')
    expect(enteteLangueSysteme('en')).toContain('ENGLISH')
  })
  it('la demande de réécriture nomme la langue de la station', () => {
    expect(demandeReecriture('en', 'fr')).toContain('ENTIRELY in English')
    expect(demandeReecriture('en', 'fr')).toContain('French')
    expect(demandeReecriture('fr', 'en')).toContain('ENTIÈREMENT en français')
  })
})

describe('retirerEtiquetteLocuteur', () => {
  it("retire « [Sarah] » recopié de l'historique", () => {
    expect(retirerEtiquetteLocuteur('[Sarah] Exactly, Malik.')).toBe('Exactly, Malik.')
    expect(retirerEtiquetteLocuteur('Exactly, [Malik] knows.')).toBe('Exactly, [Malik] knows.')
  })
})

describe('garantirLangue — le chemin complet d\'un tour', () => {
  it('un tour anglais passe sans appel au modèle', async () => {
    let appels = 0
    const r = await garantirLangue('[Sarah] Exactly, Malik, and that is the whole point of this show.', 'en', async () => { appels++; return '' })
    expect(r.horsLangue).toBe(null)
    expect(r.texte).toBe('Exactly, Malik, and that is the whole point of this show.')
    expect(appels).toBe(0)
  })
  it('un tour français est réécrit en anglais', async () => {
    const demandes: string[] = []
    const r = await garantirLangue('De retour sur Free Press FM, et ne vous y trompez pas, ces pots ont dansé sous les fenêtres.', 'en',
      async (_fautif, demande) => { demandes.push(demande); return 'Back on Free Press FM, and make no mistake, those pots were banging under the bank windows.' })
    expect(r.horsLangue).toBe(null)
    expect(r.reecritures).toBe(1)
    expect(r.texte).toContain('Back on Free Press FM')
    expect(demandes[0]).toContain('ENTIRELY in English')
  })
  it('un modèle qui s\'obstine en français : tour signalé hors langue après 2 réécritures', async () => {
    let appels = 0
    const r = await garantirLangue('Ah, là tu parles, Malik !', 'en', async () => { appels++; return 'Ah ouais, Sarah, tu as encore raison sur ce point.' })
    expect(r.horsLangue).toBe('fr')
    expect(appels).toBe(2)
  })
  it('une station française garde ses tours français', async () => {
    const r = await garantirLangue('Ah, là tu parles, Marina ! Et franchement, ça fait du bien.', 'fr', async () => { throw new Error('aucun appel attendu') })
    expect(r.horsLangue).toBe(null)
  })
})
