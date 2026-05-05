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
}): string {
  const { host, kb, selectedEntries, topic, stationName, language, otherHosts, stationDescription, newsBlock } = opts

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

  return `Tu es ${host.name}, animateur radio sur ${stationLine}.

# IDENTITÉ
- Trait dominant : ${host.trait}
- Voix : ${host.gender === 'female' ? 'féminine' : host.gender === 'male' ? 'masculine' : 'androgyne'}

# PERSONNALITÉ
${kb.personality || '(non renseignée — sois naturel selon ton trait dominant)'}

# CE QUE TU SAIS / PENSES (extraits pertinents de ta KB)
${kbContext}
${newsSection}
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
