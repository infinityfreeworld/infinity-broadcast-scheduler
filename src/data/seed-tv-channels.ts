/**
 * @module InfinityScheduler/TV/Seed
 * @description Chaînes TV de départ pour le générateur. `id` DOIT correspondre à
 *   l'id d'une TvChannel côté app (les programmes sont taggés `channel=<id>` et
 *   le player joue le programme courant de la chaîne du même id).
 */
import type { TvChannelConfig } from '../lib/tv-types'

export const TV_CHANNELS: TvChannelConfig[] = [
  {
    id: 'tv-jt-fr',
    name: 'JT INFINITY',
    language: 'fr',
    theme: "journal quotidien des SOLUTIONS : écologie, entraide, initiatives citoyennes, technologies libres. Ton posé, factuel, constructif.",
    segments: 4,
    sources: [
      { type: 'rss', url: 'https://www.reporterre.net/spip.php?page=backend', title: 'Reporterre' },
      { type: 'rss', url: 'https://mrmondialisation.org/feed/', title: 'Mr Mondialisation' },
    ],
  },
  {
    id: 'tv-nature',
    name: 'NATURE & VIVANT',
    language: 'fr',
    theme: "magazine contemplatif sur la nature, la biodiversité et le vivant. Plans larges, ambiance apaisée, émerveillement.",
    segments: 3,
  },
]

export function findChannel(id?: string): TvChannelConfig {
  if (!id) return TV_CHANNELS[0]
  const c = TV_CHANNELS.find(c => c.id === id)
  if (!c) throw new Error(`Chaîne TV inconnue : ${id} (dispo : ${TV_CHANNELS.map(c => c.id).join(', ')})`)
  return c
}
