/**
 * Les hésitations d'une vraie antenne (07/10/2026) : consigne par langue, rattrapage déterministe
 * et borné, et aucun nettoyage de voix ne doit les effacer.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import {
  directiveDisfluences, compterDisfluences, rattraperDisfluences, tauxDisfluences, MAX_PAR_TOUR, TAUX_PAR_DEFAUT,
} from '../disfluences'
import { directiveOral, buildHostSystemPrompt } from '../personas'
import { sanitizeForSpeech } from '../tts-sanitize'
import { frenchifyEnglishWords } from '../frenchify-english'
import { prononcerDomaine } from '../slogan-radio'
import { textePourVoixChinoise } from '../prononciation-zh'
import type { StationLanguage } from '../types'

test('consigne : chaque langue des stations nomme ses VRAIES hésitations, une fréquence et une borne', () => {
  const attendus: Record<string, string[]> = {
    fr: ['« euh… »', '« bah »', '« enfin »', '« tu vois »', 'je veux dire', "c'est, c'est vrai", 'un tour sur deux ou trois', 'DEUX'],
    en: ['"uh…"', '"um…"', '"you know"', '"I mean"', 'one turn in two or three', 'TWO'],
    es: ['« eh… »', '« pues »', '« este… »', '« o sea »', 'one turn in two or three'],
    ru: ['« ну… »', '« э-э… »', '« как бы »', 'one turn in two or three'],
    zh: ['「嗯……」', '「那个……」', '「就是……」', 'one turn in two or three'],
  }
  for (const [langue, mots] of Object.entries(attendus)) {
    const d = directiveOral(langue as StationLanguage)
    for (const m of mots) assert.ok(d.includes(m), `${langue} : « ${m} » absent de la consigne`)
    // Pas d'hésitation dans un titre de musique ni dans le courrier lu.
    assert.match(d, langue === 'fr' ? /titre d'une musique/ : /music title/)
    assert.match(d, langue === 'fr' ? /mot pour mot/ : /word for word/)
  }
  // L'ancienne phrase vague a disparu ; les formes épelées par la voix sont interdites.
  assert.ok(!directiveOral('fr').includes('une hésitation de temps en temps'))
  assert.match(directiveDisfluences('fr'), /JAMAIS « mmh »/)
})

test('consigne : présente dans le prompt système, retirée quand HABILLAGE_DISFLUENCES=0', () => {
  const base = {
    host: { id: 'h', name: 'Cyril', gender: 'male', trait: 'curieux', color: '#fff', avatar: '' },
    kb: { hostId: 'h', stationId: 's', personality: '', entries: [], updatedAt: 0 },
    selectedEntries: [], stationName: 'Radio Pirate', language: 'fr', otherHosts: [],
  } as unknown as Parameters<typeof buildHostSystemPrompt>[0]
  assert.ok(buildHostSystemPrompt(base).includes('HÉSITE COMME UN HUMAIN'))
  assert.ok(!buildHostSystemPrompt({ ...base, disfluences: false }).includes('HÉSITE COMME UN HUMAIN'))
})

test('reconnaissance : les vraies hésitations comptent, les homographes non', () => {
  assert.equal(compterDisfluences('Euh… je pense que oui.', 'fr'), 1)
  assert.equal(compterDisfluences("C'est, c'est vrai, tu vois.", 'fr'), 2)
  assert.equal(compterDisfluences('Le genre humain est enfin arrivé.', 'fr'), 0)
  assert.equal(compterDisfluences('Um, well, I mean it.', 'en'), 3)
  assert.equal(compterDisfluences('I want to be well paid.', 'en'), 0)
  assert.equal(compterDisfluences('Este libro es bueno.', 'es'), 0)
  assert.equal(compterDisfluences('Ну, это правда.', 'ru'), 1)
  assert.equal(compterDisfluences('嗯……这是真的。', 'zh'), 1)
  assert.equal(compterDisfluences('就是这样。', 'zh'), 0)
})

const TOURS_FR = [
  { texte: "Bonjour et bienvenue sur Radio Pirate, on parle aujourd'hui de l'eau et des communs.", permis: false },
  { texte: "Je trouve que la gestion de l'eau, franchement, c'est le grand sujet qu'on oublie.", permis: true },
  { texte: "C'est vrai, mais les communes reprennent la main, regarde ce qui se passe à Grenoble.", permis: true },
  { texte: "Ah ouais, carrément !", permis: false },
  { texte: "On a un message de Lucie, de Brest, qui nous écrit que son puits est à sec depuis juin.", permis: false },
  { texte: "Le problème, c'est que les nappes ne se rechargent plus comme avant, et personne ne le dit.", permis: true },
  { texte: "Alors on s'écoute un morceau, je vous laisse avec Default Track 07.", permis: false },
  { texte: "Il y a quand même des villages qui ont tout changé, des régies publiques, des citernes partout.", permis: true },
  { texte: "Moi je crois surtout que tout passe par les habitants eux-mêmes, pas par les experts.", permis: true },
  { texte: "Bon, il faut aussi parler du prix, parce que l'eau gratuite, ça n'existe pas vraiment.", permis: true },
  { texte: "Merci de nous avoir écoutés, demain on parlera des semences libres sur Radio Pirate.", permis: false },
]

test('rattrapage : atteint la cible, une hésitation par tour ajouté, jamais au-delà de deux', () => {
  const r = rattraperDisfluences(TOURS_FR, 'fr', 'pirate:2026-10-07:disfluences', 0.5)
  const permis = TOURS_FR.filter(t => t.permis).length
  assert.equal(r.avant, 0)
  assert.equal(r.cible, Math.round(0.5 * permis))
  assert.equal(r.ajouts.length, r.cible, `ajouts ${r.ajouts} pour une cible ${r.cible}`)
  const avec = r.textes.filter((t, i) => TOURS_FR[i].permis && compterDisfluences(t, 'fr') > 0).length
  assert.ok(avec >= r.cible)
  for (const k of r.ajouts) {
    assert.ok(TOURS_FR[k].permis, `tour ${k} non permis touché`)
    const n = compterDisfluences(r.textes[k], 'fr')
    assert.ok(n >= 1 && n <= MAX_PAR_TOUR, `tour ${k} : ${n} hésitations`)
  }
})

test('rattrapage : ouverture, conclusion, titre, courrier et réaction courte restent INTACTS', () => {
  for (const graine of ['a', 'b', 'c', 'd', 'e', 'f']) {
    const r = rattraperDisfluences(TOURS_FR, 'fr', graine, 1)
    TOURS_FR.forEach((t, i) => { if (!t.permis) assert.equal(r.textes[i], t.texte, `graine ${graine}, tour ${i}`) })
    // Le reste du texte est conservé (on AJOUTE, on ne réécrit pas) : mêmes mots, dans le même ordre.
    for (const k of r.ajouts) {
      const sansHesitation = r.textes[k].toLowerCase().replace(/[…,]/g, ' ').split(/\s+/).filter(Boolean)
      const origine = TOURS_FR[k].texte.toLowerCase().replace(/[…,]/g, ' ').split(/\s+/).filter(Boolean)
      let j = 0
      for (const m of sansHesitation) if (m === origine[j]) j++
      assert.equal(j, origine.length, `tour ${k} réécrit : « ${r.textes[k]} »`)
    }
  }
})

test('rattrapage : déterministe par graine, et ne fait rien si le modèle en a déjà écrit assez', () => {
  const a = rattraperDisfluences(TOURS_FR, 'fr', 'pirate:2026-10-07:disfluences')
  assert.deepEqual(a, rattraperDisfluences(TOURS_FR, 'fr', 'pirate:2026-10-07:disfluences'))
  const graines = new Set(['1', '2', '3', '4', '5', '6', '7', '8'].map(g => JSON.stringify(rattraperDisfluences(TOURS_FR, 'fr', g).textes)))
  assert.ok(graines.size > 1, 'la graine ne change rien')
  const deja = TOURS_FR.map(t => ({ ...t, texte: t.permis ? `Euh… ${t.texte}` : t.texte }))
  assert.deepEqual(rattraperDisfluences(deja, 'fr', 'x').ajouts, [])
  assert.deepEqual(rattraperDisfluences(TOURS_FR, 'fr', 'x', 0).ajouts, [])
  // jamais deux tours voisins quand il y a de la place
  const r = rattraperDisfluences(TOURS_FR, 'fr', 'pirate:2026-10-07:disfluences', 0.4)
  for (let k = 1; k < r.ajouts.length; k++) assert.ok(r.ajouts[k] - r.ajouts[k - 1] > 1, `${r.ajouts}`)
})

test('rattrapage : chaque langue reçoit SES hésitations, pas celles du français', () => {
  const cas: Array<[StationLanguage, string[], RegExp]> = [
    ['en', ['The water problem, honestly, is the big topic nobody talks about.', 'Towns are taking control back, look at what happens in Bristol.', 'I think it all goes through people themselves, not through experts.'], /(uh|um|well|hmm|you know|I mean|like)/i],
    ['es', ['El problema del agua, sinceramente, es el gran tema olvidado.', 'Los pueblos recuperan el control, mira lo que pasa en Valencia.', 'Yo creo que todo pasa por la gente misma, no por los expertos.'], /(eh|pues|bueno|este|o sea)/i],
    ['ru', ['Проблема воды, честно говоря, это главная забытая тема.', 'Города возвращают контроль, посмотри, что происходит в Казани.', 'Я думаю, что всё зависит от самих людей, а не от экспертов.'], /(ну|э-э|хм|как бы|в общем)/i],
    ['zh', ['水的问题，说实话，是大家都忘记的大话题。', '很多城市正在重新掌握主动权，你看看成都发生了什么。', '我觉得一切都取决于老百姓自己，而不是专家。'], /(嗯|那个|呃|就是|怎么说呢)/],
  ]
  for (const [langue, textes, motif] of cas) {
    const r = rattraperDisfluences(textes.map(texte => ({ texte, permis: true })), langue, `s:${langue}`, 1)
    assert.ok(r.ajouts.length >= 2, `${langue} : ${r.ajouts.length} ajout(s)`)
    for (const k of r.ajouts) {
      assert.match(r.textes[k], motif, `${langue} : « ${r.textes[k]} »`)
      assert.doesNotMatch(r.textes[k], /\beuh\b/i, `${langue} : hésitation française`)
    }
  }
})

test('HABILLAGE_DISFLUENCES : taux, pourcentage, 0 = désactivé', () => {
  assert.equal(tauxDisfluences({}), TAUX_PAR_DEFAUT)
  assert.equal(tauxDisfluences({ HABILLAGE_DISFLUENCES: '0.5' }), 0.5)
  assert.equal(tauxDisfluences({ HABILLAGE_DISFLUENCES: '0,3' }), 0.3)
  assert.equal(tauxDisfluences({ HABILLAGE_DISFLUENCES: '40' }), 0.4)
  assert.equal(tauxDisfluences({ HABILLAGE_DISFLUENCES: '0' }), 0)
  assert.equal(tauxDisfluences({ HABILLAGE_DISFLUENCES: 'off' }), 0)
  assert.equal(tauxDisfluences({ HABILLAGE_DISFLUENCES: 'nimporte' }), TAUX_PAR_DEFAUT)
})

test('voix : aucun nettoyage (sanitize, domaine, anglais→français, chinois) n\'efface une hésitation', () => {
  const textes: Array<[StationLanguage, string]> = [
    ['fr', "Euh… je pense, hmm, que c'est, c'est vrai. Bah, enfin, tu vois, genre, je veux dire… hein ?"],
    ['en', "Um… well, I mean, you know, uh, it's, it's true."],
    ['es', 'Eh… pues, o sea, este… es, es verdad.'],
    ['ru', 'Ну… э-э, как бы, это, это правда.'],
    ['zh', '嗯……那个，就是……这个，这是真的。呃，'],
  ]
  for (const [langue, t] of textes) {
    const avant = compterDisfluences(t, langue)
    const propre = sanitizeForSpeech(prononcerDomaine(t, langue))
    assert.equal(compterDisfluences(propre, langue), avant, `${langue} sanitize : « ${propre} »`)
    assert.ok(propre.includes('…'), `${langue} : les points de suspension (la pause) ont disparu`)
    if (langue === 'fr') assert.equal(compterDisfluences(frenchifyEnglishWords(propre), 'fr'), avant)
    if (langue === 'zh') assert.equal(textePourVoixChinoise(propre), propre)
  }
})

test('orchestration : le rattrapage est branché sur le transcript ET la voix, réglable', () => {
  const src = readFileSync(new URL('../../scripts/generate-broadcast.ts', import.meta.url), 'utf8')
  assert.match(src, /rattraperDisfluences\(/)
  assert.match(src, /turns\[k\]\.text = r\.textes\[k\]/)
  assert.match(src, /plansVoix\[k\]\.texte = prononcerDomaine\(r\.textes\[k\], language\)/)
  assert.match(src, /disfluences:\s+tauxHesitations > 0/)
  const readme = readFileSync(new URL('../../../README.md', import.meta.url), 'utf8')
  assert.match(readme, /HABILLAGE_DISFLUENCES/)
})

test('Piper : « euh… » devient « euh, » (seule la virgule fait une pause chez Piper), le transcript n\'est pas touché', async () => {
  const { textePourVoixPiper } = await import('../piper')
  const { pausePiper } = await import('../disfluences')
  assert.equal(pausePiper("Euh… je pense, hmm… que oui. Bah... voilà."), 'Euh, je pense, hmm, que oui. Bah, voilà.')
  assert.equal(pausePiper('Um… I think so.'), 'Um, I think so.')
  assert.equal(pausePiper('Ну… это правда.'), 'Ну, это правда.')
  // Un « … » qui n'est pas une hésitation ne change pas ; « euh » reste dit.
  assert.equal(pausePiper('Et puis… rien.'), 'Et puis… rien.')
  const dit = textePourVoixPiper("Euh… c'est, c'est vrai.", 'fr_FR-siwis-medium')
  assert.equal(dit, "Euh, c'est, c'est vrai.")
  assert.equal(compterDisfluences(dit, 'fr'), 2)
})
