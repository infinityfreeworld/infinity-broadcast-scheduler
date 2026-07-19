/**
 * @module InfinityScheduler/TV/WAF
 * @description Client de l'API WeAreForger (WAF) — la forge média souveraine.
 *   Le générateur TV délègue à WAF : génération d'IMAGES (/api/v1/generate) et
 *   MONTAGE vidéo (/api/v1/render, timeline → .mp4 → pin data-space → CID).
 *   WAF fait le rendu ET le pin IPFS ; on récupère le CID (ou, à défaut, l'URL
 *   publique WAF utilisable directement par le player en attendant le pin).
 *
 *   Config : WAF_API_URL (base, ex https://weareforger.data-space.world) +
 *   WAF_API_KEY (Bearer wafk_…). Auth = header Authorization: Bearer.
 */

function wafBase(): string {
  const u = process.env.WAF_API_URL
  if (!u) throw new Error('WAF_API_URL manquant (base de l’API WeAreForger)')
  return u.replace(/\/+$/, '')
}

function authHeaders(): Record<string, string> {
  const key = process.env.WAF_API_KEY
  const h: Record<string, string> = { 'Content-Type': 'application/json' }
  if (key) h['Authorization'] = `Bearer ${key}`
  return h
}

async function post<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(`${wafBase()}${path}`, {
    method: 'POST',
    headers: authHeaders(),
    body: JSON.stringify(body),
  })
  const text = await res.text()
  let data: unknown
  try { data = JSON.parse(text) } catch { data = { raw: text } }
  if (!res.ok) {
    const msg = (data as { error?: string })?.error ?? `HTTP ${res.status}`
    throw new Error(`WAF ${path} → ${msg}`)
  }
  return data as T
}

export interface WafImage { id: string; url: string; seed?: number }

/** Génère une image et renvoie son assetId WAF (référencé ensuite au montage). */
export async function generateImage(
  prompt: string,
  opts: { style?: string; ratio?: string; seed?: number } = {},
): Promise<WafImage> {
  const data = await post<{ images: WafImage[] }>('/api/v1/generate', {
    prompt,
    style: opts.style ?? 'aucun',
    ratio: opts.ratio ?? '16:9',
    count: 1,
    seed: opts.seed,
  })
  const img = data.images?.[0]
  if (!img?.id) throw new Error('WAF /generate : aucune image renvoyée')
  return img
}

export interface RenderShot {
  assetId?: string
  url?: string
  durationSec?: number
  motion?: 'in' | 'out' | 'none'
  title?: string
  subtitle?: string
}

export interface RenderResult {
  id: string
  url: string
  /** CID IPFS si déjà pinné par WAF (sinon undefined → utiliser `url`). */
  ipfs?: string
  durationSec: number
}

/** Monte une timeline en .mp4 (Ken Burns + lower-thirds + audio) → CID/URL. */
export async function renderTimeline(payload: {
  shots: RenderShot[]
  audio?: { assetId?: string; url?: string }
  width?: number
  height?: number
  fps?: number
  prompt?: string
}): Promise<RenderResult> {
  return post<RenderResult>('/api/v1/render', payload)
}
