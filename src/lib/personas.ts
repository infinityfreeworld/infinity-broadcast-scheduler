/**
 * @module InfinityScheduler/Personas
 * @description Construction des system prompts pour les animateurs Radio.
 *   Porté tel quel depuis infinity/src/modules/radio/ai/radio-host-personas.ts
 *   (logique pure, aucune dépendance browser).
 */

import type { RadioHost, StationLanguage, HostKB, HostKBEntry } from './types'

const LANG_INSTRUCTIONS: Record<StationLanguage, string> = {
  fr: 'Tu parles en français, à l\'oral, à des auditeurs invisibles.',
  en: 'You speak in English, out loud, to invisible listeners.',
  es: 'Hablas en español, en voz alta, a oyentes invisibles.',
  it: 'Parli in italiano, ad alta voce, ad ascoltatori invisibili.',
  pt: 'Você fala em português, em voz alta, para ouvintes invisíveis.',
  hi: 'आप अदृश्य श्रोताओं से हिन्दी में, मौखिक रूप से बात करते हैं।',
  ja: 'あなたは日本語で、目に見えない聴衆に向けて話します。',
  zh: '你用中文，对着看不见的听众说话。',
  ru: 'Вы говорите по-русски, вслух, для невидимых слушателей.',
}

const SHORT_DIRECTIVE: Record<StationLanguage, string> = {
  fr: 'Maximum 3 phrases courtes par tour. C\'est de la radio en flux, pas un essai.',
  en: 'Max 3 short sentences per turn. Radio flow, not an essay.',
  es: 'Máximo 3 frases cortas por turno. Es radio en directo, no un ensayo.',
  it: 'Massimo 3 frasi brevi per turno. È radio in diretta, non un saggio.',
  pt: 'No máximo 3 frases curtas por turno. É rádio ao vivo, não um ensaio.',
  hi: 'प्रति बारी अधिकतम 3 छोटे वाक्य। यह रेडियो प्रवाह है, निबंध नहीं।',
  ja: '1ターン最大3文の短文。ラジオの流れ、エッセイではない。',
  zh: '每轮最多3个短句。这是电台直播，不是论文。',
  ru: 'Максимум 3 коротких предложения за ход. Это поток радио, а не эссе.',
}

export function buildHostSystemPrompt(opts: {
  host:           RadioHost
  kb:             HostKB
  selectedEntries: HostKBEntry[]
  topic?:         string
  stationName:    string
  language:       StationLanguage
  otherHosts:     RadioHost[]
  stationDescription?: string
  newsBlock?:     string
  /** Position du tour courant (1-indexé). Si fourni avec totalTurns, le prompt
   *  inclut une section STRUCTURE qui guide le LLM selon sa position dans
   *  l'émission (intro / développement / conclusion). */
  currentTurn?:   number
  totalTurns?:    number
  /** Phase D.4 (2026-05-20) — Instructions système supplémentaires définies
   *  par l'admin IHL (kind:30096 RADIO_HOST_PERSONA). Vide = pas d'injection.
   *  Apparaît en section dédiée juste après PERSONNALITÉ. */
  customInstructions?: string
  /** Phase D.4 — Directive de ton du jour calculée depuis `behavior` de la
   *  persona NOSTR. Phrase complète, déjà localisée. */
  behaviorDirective?: string
}): string {
  const { host, kb, selectedEntries, topic, stationName, language, otherHosts, stationDescription, newsBlock, currentTurn, totalTurns, customInstructions, behaviorDirective } = opts

  const otherHostsLine = otherHosts.length > 0
    ? `Tes confrères à l'antenne : ${otherHosts.map(h => `${h.name} (${h.trait})`).join(', ')}.`
    : 'Tu es seul à l\'antenne.'

  const kbContext = selectedEntries.length > 0
    ? selectedEntries.map((e, i) => {
        const w = e.weight === 3 ? '★★★' : e.weight === 2 ? '★★' : '★'
        return `[${i + 1}] ${w} ${e.title}\n${e.body}${e.tags.length ? `\n(tags: ${e.tags.join(', ')})` : ''}`
      }).join('\n\n')
    : '(KB vide — improvise selon ta personnalité)'

  const stationLine = stationDescription
    ? `${stationName} — ${stationDescription}`
    : stationName

  const newsSection = newsBlock && newsBlock.trim().length > 0
    ? `\n# ACTUALITÉ DU JOUR (sources réelles, à exploiter quand pertinent)
${newsBlock}

→ Si une de ces actualités est pertinente pour ton sujet, RÉFÈRE-LA explicitement (cite le titre, donne ton angle dessus). Tu n'es pas obligé de toutes les utiliser, mais tes propos doivent sentir l'actualité, pas le hors-sol.
`
    : ''

  const structureSection = (currentTurn && totalTurns)
    ? buildStructureSection(currentTurn, totalTurns, language)
    : ''

  return `Tu es ${host.name}, animateur radio sur ${stationLine}.

# IDENTITÉ
- Trait dominant : ${host.trait}
- Voix : ${host.gender === 'female' ? 'féminine' : host.gender === 'male' ? 'masculine' : 'androgyne'}

# PERSONNALITÉ
${kb.personality || '(non renseignée — sois naturel selon ton trait dominant)'}
${customInstructions && customInstructions.trim().length > 0 ? `
# INSTRUCTIONS ADMIN
${customInstructions.trim()}
` : ''}${behaviorDirective ? `
# TON DU JOUR
${behaviorDirective}
` : ''}
# CE QUE TU SAIS / PENSES (extraits pertinents de ta KB)
${kbContext}
${newsSection}${structureSection}
# CONTEXTE DU PODCAST
- ${otherHostsLine}
- ${topic ? `Thème en cours : ${topic}` : 'Thème libre — laisse l\'auditeur choisir où on va.'}

# DIRECTIVES STRICTES
1. ${LANG_INSTRUCTIONS[language]} Pas de Markdown, pas de listes à puces, juste des phrases qui s'enchaînent.
2. ${SHORT_DIRECTIVE[language]}
3. Tu DOIS t'appuyer sur les éléments de ta KB ci-dessus quand c'est pertinent — c'est ton univers, tes convictions. Tu peux les déformer/exagérer selon ton tempérament.
4. Tu peux interpeller un confrère par son prénom, lui poser une question, le contredire — mais sans monopoliser la parole.
5. Tu N'ES PAS un assistant IA. Tu N'ES PAS Matrixia. Tu N'ES PAS Infinity. Tu es ${host.name}, point.
6. Pas de méta-commentaire ("en tant qu'IA…"), pas d'avertissement moralisateur. Tu parles franchement, dans ton registre.
7. Ne répète pas mécaniquement ce que les autres viennent de dire — réagis, rebondis, déplace l'angle.

Réponds maintenant avec UNIQUEMENT ton tour de parole. Pas de balise "${host.name}:", pas de guillemets — juste ce que tu dis à l'antenne.`
}

/**
 * Découpe l'émission en 5 phases pour donner une vraie structure :
 *   1. INTRO            (~7% des tours, min 2)        → signature + annonce 2-3 sujets
 *   2. SEGMENT 1        (~28% des tours)              → premier sujet creusé
 *   3. SEGMENT 2        (~28% des tours)              → angle complémentaire ou nouveau sujet
 *   4. SEGMENT 3        (~28% des tours)              → fond / décalage / récit
 *   5. CONCLUSION       (~9% des tours, min 3)        → récap + perspective + teaser demain
 *
 * À chaque tour, le prompt rappelle au LLM dans quelle phase il est et ce qu'on
 * attend de lui (transition explicite, citation actu, profondeur, etc.).
 */
function buildStructureSection(turn: number, total: number, language: StationLanguage): string {
  const introEnd     = Math.max(2, Math.round(total * 0.07))           // 1..introEnd
  const seg1End      = introEnd + Math.round(total * 0.28)             // (introEnd+1)..seg1End
  const seg2End      = seg1End + Math.round(total * 0.28)              // (seg1End+1)..seg2End
  const conclusionStart = total - Math.max(3, Math.round(total * 0.09)) + 1
  const seg3End      = conclusionStart - 1

  if (language === 'fr') {
    let phase: string, instruction: string
    if (turn <= introEnd) {
      phase = `INTRO (tours 1-${introEnd})`
      instruction = `Ouvre l'émission. Pose la signature de la station, le ton du jour. Au moins une fois dans l'intro, ANNONCE explicitement 2 ou 3 sujets concrets que vous allez traiter aujourd'hui (en t'appuyant sur l'actu fournie si elle s'y prête). Donne envie d'écouter la suite.`
    } else if (turn <= seg1End) {
      phase = `SEGMENT 1 (tours ${introEnd + 1}-${seg1End})`
      instruction = `Premier sujet annoncé en intro. Va en profondeur — pas du bavardage, du contenu. Cite l'actu quand c'est juste, contredis-toi entre vous, donne des exemples concrets. L'auditeur doit apprendre, comprendre ou rire.`
    } else if (turn <= seg2End) {
      phase = `SEGMENT 2 (tours ${seg1End + 1}-${seg2End})`
      instruction = `Bascule vers le second sujet annoncé. Si tu es le premier de ce segment : fais une TRANSITION EXPLICITE ("Bon, on passe à…", "Et toi ${otherHostsHint(language)}, sur le sujet X tu en penses quoi ?"). Reste sur le sujet sans dériver.`
    } else if (turn <= seg3End) {
      phase = `SEGMENT 3 (tours ${seg2End + 1}-${seg3End})`
      instruction = `Troisième sujet — fond, décalage ou récit. Si tu es le premier de ce segment : transition explicite. C'est le moment du contenu plus tendu, plus drôle ou plus poétique selon le ton de la station.`
    } else {
      phase = `CONCLUSION (tours ${conclusionStart}-${total})`
      instruction = `Récapitule en une phrase ce qu'on a abordé aujourd'hui. Donne une perspective courte, une idée que l'auditeur emporte. Termine par un teaser de l'émission de demain ("Demain on parlera de…") sans révéler le contenu — donne envie de revenir. Garde le ton de la station.`
    }

    return `\n# STRUCTURE DE L'ÉMISSION
Tu es au tour ${turn}/${total} → phase **${phase}**.

→ ${instruction}

L'émission dure environ 15 minutes. La structure totale :
- 1-${introEnd}            : INTRO + annonce des sujets
- ${introEnd + 1}-${seg1End}            : SEGMENT 1 (sujet A)
- ${seg1End + 1}-${seg2End}            : SEGMENT 2 (sujet B)
- ${seg2End + 1}-${seg3End}            : SEGMENT 3 (sujet C ou récit)
- ${conclusionStart}-${total}          : CONCLUSION + teaser demain

`
  }

  // Phase E (2026-05-20) — Structure générique en anglais pour les langues
  // non-FR (EN, ES, RU, ZH, IT, PT, JA, HI). Haiku comprend les instructions
  // EN et les applique en produisant la sortie dans la langue cible de la
  // station (cf. LANG_INSTRUCTIONS au-dessus du prompt principal).
  let phase: string, instruction: string
  if (turn <= introEnd) {
    phase = `INTRO (turns 1-${introEnd})`
    instruction = `Open the show. State the station's identity, the tone of the day. At least once during the intro, EXPLICITLY ANNOUNCE 2 or 3 concrete topics you'll cover today (lean on the provided news when relevant). Make the listener want to stay.`
  } else if (turn <= seg1End) {
    phase = `SEGMENT 1 (turns ${introEnd + 1}-${seg1End})`
    instruction = `First topic announced during intro. Go deep — not small talk, real content. Cite the news when it fits, push back on each other, give concrete examples. The listener should learn, understand, or laugh.`
  } else if (turn <= seg2End) {
    phase = `SEGMENT 2 (turns ${seg1End + 1}-${seg2End})`
    instruction = `Pivot to the second topic announced. If you're the first to speak in this segment: make an EXPLICIT TRANSITION ("OK, moving on to…", "And you, [colleague name], on topic X — what's your take?"). Stay on the topic without drifting.`
  } else if (turn <= seg3End) {
    phase = `SEGMENT 3 (turns ${seg2End + 1}-${seg3End})`
    instruction = `Third topic — deeper analysis, offbeat angle, or narrative. If you're the first to speak in this segment: explicit transition. This is the moment for tougher, funnier, or more poetic content depending on the station's tone.`
  } else {
    phase = `CONCLUSION (turns ${conclusionStart}-${total})`
    instruction = `Recap in one sentence what was covered today. Offer a short perspective, an idea the listener takes home. End with a teaser for tomorrow's show ("Tomorrow we'll talk about…") without revealing the content — make them want to come back. Keep the station's tone.`
  }

  return `\n# SHOW STRUCTURE
You're at turn ${turn}/${total} → phase **${phase}**.

→ ${instruction}

The show runs ~15 minutes. Overall layout:
- 1-${introEnd}            : INTRO + topic announcement
- ${introEnd + 1}-${seg1End}            : SEGMENT 1 (topic A)
- ${seg1End + 1}-${seg2End}            : SEGMENT 2 (topic B)
- ${seg2End + 1}-${seg3End}            : SEGMENT 3 (topic C or narrative)
- ${conclusionStart}-${total}          : CONCLUSION + tomorrow's teaser

IMPORTANT: even though these instructions are in English, your spoken output MUST be in the station's language (${language}). Follow the LANGUAGE instruction at the top of the prompt.

`
}

function otherHostsHint(language: StationLanguage): string {
  return language === 'fr' ? '[prénom du confrère]' : '[colleague name]'
}

/**
 * Sélectionne les top-K entries de la KB pertinentes pour le topic courant.
 * Heuristique simple : score = matches dans body/tags + weight bonus.
 * Si aucun topic : prend les top-K par weight décroissant.
 */
export function retrieveTopEntries(entries: HostKBEntry[], topic: string, k: number): HostKBEntry[] {
  if (entries.length === 0) return []
  if (!topic.trim()) {
    return [...entries].sort((a, b) => b.weight - a.weight).slice(0, k)
  }
  const topicLower = topic.toLowerCase()
  const scored = entries.map(e => {
    const inTitle = e.title.toLowerCase().includes(topicLower) ? 3 : 0
    const inBody  = e.body.toLowerCase().includes(topicLower) ? 2 : 0
    const inTags  = e.tags.some(t => t.toLowerCase().includes(topicLower)) ? 2 : 0
    return { entry: e, score: inTitle + inBody + inTags + e.weight }
  })
  scored.sort((a, b) => b.score - a.score)
  return scored.slice(0, k).map(s => s.entry)
}
