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

function cleanText(s: string): string {
  return s
    .replace(/<[^>]+>/g, ' ')             // strip HTML tags
    .replace(/&[a-z]+;/gi, ' ')            // strip basic HTML entities
    .replace(/\s+/g, ' ')
    .trim()
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

export function formatNewsForPrompt(items: NewsItem[]): string {
  if (items.length === 0) return ''
  return items.map(item => {
    const date = item.publishedAt
      ? new Date(item.publishedAt).toLocaleDateString('fr-FR', { day: '2-digit', month: 'short' })
      : ''
    const summary = item.summary ? ` — ${item.summary.slice(0, 180)}` : ''
    return `• ${date ? `[${date}] ` : ''}${item.title}${summary} (${item.sourceTitle})`
  }).join('\n')
}
