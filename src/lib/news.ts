/**
 * @module InfinityScheduler/News
 * @description Fetch RSS/Atom Node — équivalent serveur de
 *   infinity/src/modules/radio/ai/news-fetcher.ts (qui utilisait le DOMParser
 *   browser via un proxy CORS dev). Ici on parse XML avec fast-xml-parser
 *   et on fetch directement (pas de CORS côté serveur).
 *
 *   Cap MAX_ITEMS_PER_SOURCE pour ne pas saturer le system prompt LLM.
 */

import { XMLParser } from 'fast-xml-parser'
import type { RadioStation, NewsItem, NewsSource } from './types'

const FETCH_TIMEOUT_MS = 8000
const MAX_ITEMS_PER_SOURCE = 5

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
  textNodeName: '#text',
  // 🔴 Reporterre était MUET : « Entity expansion limit exceeded: 1009 > 1000 » (14/09/2026). La
  // limite par défaut compte chaque `&amp;` ou `&#8217;` d'un flux ordinaire ; un long flux la
  // dépasse sans rien avoir d'hostile. On relève le TOTAL, et l'on garde serrées les bornes qui
  // arrêtent vraiment une bombe d'entités (profondeur d'imbrication, taille d'une entité, longueur
  // dépliée) — la seule chose dangereuse est l'entité qui en contient d'autres.
  processEntities: {
    enabled: true,
    maxEntitySize: 10_000,
    maxExpansionDepth: 10,
    maxTotalExpansions: 50_000,
    maxExpandedLength: 2_000_000,
  },
})

async function fetchSource(source: NewsSource): Promise<NewsItem[]> {
  if (source.type !== 'rss') return []   // web/nostr : pas géré ici

  try {
    const ac = new AbortController()
    const tid = setTimeout(() => ac.abort(), FETCH_TIMEOUT_MS)
    const res = await fetch(source.url, {
      signal: ac.signal,
      headers: { 'User-Agent': 'InfinityBroadcastScheduler/0.1 (+https://github.com/infinityfreeworld/infinity)' },
    })
    clearTimeout(tid)
    if (!res.ok) return []
    const xml = await res.text()
    return parseFeed(xml, source.title)
  } catch (err) {
    console.warn(`[news] Erreur fetch ${source.title} (${source.url}):`, err instanceof Error ? err.message : err)
    return []
  }
}

function parseFeed(xml: string, sourceTitle: string): NewsItem[] {
  let parsed: Record<string, unknown>
  try {
    parsed = parser.parse(xml) as Record<string, unknown>
  } catch (err) {
    console.warn(`[news] Parse XML échoué pour ${sourceTitle}:`, err instanceof Error ? err.message : err)
    return []
  }

  // RSS 2.0 : <rss><channel><item>...
  const rss = parsed.rss as { channel?: { item?: unknown[] | unknown } } | undefined
  if (rss?.channel?.item) {
    const items = Array.isArray(rss.channel.item) ? rss.channel.item : [rss.channel.item]
    return items.slice(0, MAX_ITEMS_PER_SOURCE).map(it => parseRssItem(it, sourceTitle))
      .filter((i): i is NewsItem => i !== null)
  }

  // Atom : <feed><entry>...
  const feed = parsed.feed as { entry?: unknown[] | unknown } | undefined
  if (feed?.entry) {
    const entries = Array.isArray(feed.entry) ? feed.entry : [feed.entry]
    return entries.slice(0, MAX_ITEMS_PER_SOURCE).map(it => parseAtomEntry(it, sourceTitle))
      .filter((i): i is NewsItem => i !== null)
  }

  return []
}

function parseRssItem(item: unknown, sourceTitle: string): NewsItem | null {
  if (typeof item !== 'object' || item === null) return null
  const it = item as Record<string, unknown>
  const title = textOf(it.title)
  if (!title) return null
  const summary = textOf(it.description) || textOf((it as { summary?: unknown }).summary)
  const link = textOf(it.link)
  const pubDate = textOf((it as { pubDate?: unknown }).pubDate) ||
                  textOf((it as { 'dc:date'?: unknown })['dc:date'])
  const publishedAt = pubDate ? Date.parse(pubDate) : undefined
  return {
    title:       cleanText(title),
    summary:     summary ? cleanText(summary) : undefined,
    link:        link || undefined,
    publishedAt: Number.isFinite(publishedAt) ? publishedAt : undefined,
    sourceTitle,
  }
}

function parseAtomEntry(entry: unknown, sourceTitle: string): NewsItem | null {
  if (typeof entry !== 'object' || entry === null) return null
  const e = entry as Record<string, unknown>
  const title = textOf(e.title)
  if (!title) return null
  const summary = textOf(e.summary) || textOf(e.content)
  // Atom link peut être {@_href: ...} ou string
  let link: string | undefined
  const linkEl = e.link
  if (typeof linkEl === 'string') link = linkEl
  else if (Array.isArray(linkEl) && linkEl[0] && typeof linkEl[0] === 'object') {
    link = (linkEl[0] as Record<string, string>)['@_href']
  } else if (linkEl && typeof linkEl === 'object') {
    link = (linkEl as Record<string, string>)['@_href']
  }
  const updated = textOf(e.updated) || textOf(e.published)
  const publishedAt = updated ? Date.parse(updated) : undefined
  return {
    title:       cleanText(title),
    summary:     summary ? cleanText(summary) : undefined,
    link:        link || undefined,
    publishedAt: Number.isFinite(publishedAt) ? publishedAt : undefined,
    sourceTitle,
  }
}

function textOf(node: unknown): string {
  if (node == null) return ''
  if (typeof node === 'string') return node
  if (typeof node === 'object') {
    const obj = node as Record<string, unknown>
    if ('#text' in obj) return String(obj['#text'])
    if ('_' in obj) return String(obj._)
  }
  return String(node)
}

/**
 * Entités HTML nommées rencontrées dans les flux RSS francophones.
 * Volontairement courte : ce qui n'y figure pas passe par le décodage
 * NUMÉRIQUE ci-dessous, qui couvre tout Unicode.
 */
const ENTITES_NOMMEES: Record<string, string> = {
  amp: '&', lt: '<', gt: '>', quot: '"', apos: "'",
  nbsp: ' ', laquo: '«', raquo: '»', hellip: '…', mdash: '—', ndash: '–',
  rsquo: '\u2019', lsquo: '\u2018', ldquo: '\u201C', rdquo: '\u201D',
  eacute: 'é', egrave: 'è', ecirc: 'ê', euml: 'ë',
  agrave: 'à', acirc: 'â', ccedil: 'ç', ugrave: 'ù', ucirc: 'û',
  icirc: 'î', iuml: 'ï', ocirc: 'ô', oelig: 'œ', deg: '°', euro: '€',
  Eacute: 'É', Egrave: 'È', Agrave: 'À', Ccedil: 'Ç',
}

/**
 * Décode UNE passe d'entités HTML — nommées et numériques.
 *
 * ⚠️ Décoder, pas supprimer. Le code d'avant faisait
 * `.replace(/&[a-z]+;/gi, ' ')` : `arm&eacute;e` devenait « arm e », un
 * mot coupé en deux, et les entités NUMÉRIQUES (`&#233;`) traversaient
 * intactes jusqu'au prompt. Mesuré le 01/09/2026 : **36 % des
 * actualités** récupérées étaient abîmées, sur 6 sources.
 */
function decoderEntites(s: string): string {
  return s.replace(
    /&(#\d{1,7}|#[xX][0-9a-fA-F]{1,6}|[a-zA-Z][a-zA-Z0-9]{1,31});/g,
    (entier, corps: string) => {
      if (corps[0] === '#') {
        const code = corps[1] === 'x' || corps[1] === 'X'
          ? Number.parseInt(corps.slice(2), 16)
          : Number.parseInt(corps.slice(1), 10)
        // Hors plage Unicode ou point de code interdit : on laisse tel quel
        // plutôt que de produire un caractère de remplacement.
        if (!Number.isFinite(code) || code <= 0 || code > 0x10FFFF) return entier
        try { return String.fromCodePoint(code) } catch { return entier }
      }
      return ENTITES_NOMMEES[corps] ?? entier
    },
  )
}

/**
 * Nettoie un titre ou un résumé de flux RSS.
 *
 * Balises et entités s'imbriquent : certains flux publient du HTML
 * DOUBLEMENT encodé (`&amp;#233;`), où une première passe ne révèle
 * qu'une seconde entité. On alterne donc décodage et retrait de balises,
 * avec un nombre de passes BORNÉ — une boucle « jusqu'à stabilité » sur
 * une entrée hostile ne se terminerait pas forcément.
 */
export function cleanText(s: string): string {
  let texte = s
  for (let passe = 0; passe < 3; passe++) {
    const avant = texte
    texte = decoderEntites(texte).replace(/<[^>]+>/g, ' ')
    if (texte === avant) break
  }
  return texte.replace(/\s+/g, ' ').trim()
}

export async function fetchNewsForStation(
  station: RadioStation,
  limit = 8,
): Promise<NewsItem[]> {
  if (!station.sources || station.sources.length === 0) return []
  const results = await Promise.all(station.sources.map(fetchSource))
  const all = results.flat()
  all.sort((a, b) => (b.publishedAt ?? 0) - (a.publishedAt ?? 0))
  return all.slice(0, limit)
}

const HEURE = 3_600_000
const JOUR = 24 * HEURE

/**
 * Tri de FRAÎCHEUR pour le JT — ligne éditoriale du fondateur (14/09/2026) : « majoritairement des
 * actualités positives des dernières 24 h, mais peut également évoquer des sujets plus anciens ».
 *
 * Le tri garde MAJORITAIREMENT le frais (≤ 24 h) et quelques sujets plus anciens (≤ 7 jours). Le
 * choix des nouvelles POSITIVES, lui, revient au rédacteur (le LLM) : il faut donc lui en donner
 * assez pour qu'il puisse choisir, et venues de plusieurs sources — tirées à tour de rôle, sinon le
 * flux le plus bavard remplirait tout.
 * Une nouvelle SANS date compte comme ancienne : rien ne permet de la dire « du jour ».
 */
export function choisirActualites(
  items: NewsItem[],
  { frais = 6, anciens = 2, maintenant = Date.now() }: { frais?: number; anciens?: number; maintenant?: number } = {},
): NewsItem[] {
  const vus = new Set<string>()
  const uniques = items.filter(it => {
    const cle = it.title.trim().toLowerCase()
    if (!cle || vus.has(cle)) return false
    vus.add(cle)
    return true
  })
  const estFrais = (it: NewsItem) => !!it.publishedAt && it.publishedAt <= maintenant + HEURE && maintenant - it.publishedAt <= JOUR
  const recent = (a: NewsItem, b: NewsItem) => (b.publishedAt ?? 0) - (a.publishedAt ?? 0)
  const tourDeRole = (liste: NewsItem[], n: number): NewsItem[] => {
    const parSource = new Map<string, NewsItem[]>()
    for (const it of [...liste].sort(recent)) parSource.set(it.sourceTitle, [...(parSource.get(it.sourceTitle) ?? []), it])
    const files = [...parSource.values()]
    const pris: NewsItem[] = []
    while (pris.length < n && files.some(f => f.length)) {
      for (const f of files) { const it = f.shift(); if (it && pris.length < n) pris.push(it) }
    }
    return pris
  }
  const fraiches = uniques.filter(estFrais)
  const plusAnciennes = uniques.filter(it => !estFrais(it) && (!it.publishedAt || maintenant - it.publishedAt <= 7 * JOUR))
  return [...tourDeRole(fraiches, frais), ...tourDeRole(plusAnciennes, anciens)]
}

/**
 * `maintenant` (facultatif, le JT) ajoute la FRAÎCHEUR à chaque date : « il y a 5 h » ou « plus
 * ancien ». Sans lui, le format reste celui de la radio, à l'identique.
 */
export function formatNewsForPrompt(items: NewsItem[], opts: { maintenant?: number } = {}): string {
  if (items.length === 0) return ''
  return items.map(item => {
    const date = item.publishedAt
      ? new Date(item.publishedAt).toLocaleDateString('fr-FR', { day: '2-digit', month: 'short' })
      : ''
    let etiquette = date
    if (opts.maintenant !== undefined && item.publishedAt && item.publishedAt <= opts.maintenant + HEURE) {
      const heures = Math.max(0, Math.round((opts.maintenant - item.publishedAt) / HEURE))
      etiquette = heures <= 24 ? `il y a ${heures} h` : `${date} · plus ancien`
    }
    const summary = item.summary ? ` — ${item.summary.slice(0, 180)}` : ''
    return `• ${etiquette ? `[${etiquette}] ` : ''}${item.title}${summary} (${item.sourceTitle})`
  }).join('\n')
}
