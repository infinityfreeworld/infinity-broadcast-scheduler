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
  /** Vignette extraite du rendu (asset à part entière, épinglé lui aussi). */
  poster?: { id: string; url: string; ipfs?: string }
}

export interface WafAsset {
  id: string
  type: string
  url: string
  ipfs?: string
  mime?: string
}

/** Relit un asset — sert à récupérer le CID, épinglé APRÈS la réponse. */
export async function getAsset(id: string): Promise<WafAsset> {
  const res = await fetch(`${wafBase()}/api/v1/assets/${encodeURIComponent(id)}`, {
    headers: authHeaders(),
  })
  const text = await res.text()
  let data: unknown
  try { data = JSON.parse(text) } catch { data = { raw: text } }
  if (!res.ok) throw new Error(`WAF /assets → ${(data as { error?: string })?.error ?? `HTTP ${res.status}`}`)
  return data as WafAsset
}

/**
 * Attend que le CID d'un asset apparaisse, sans jamais bloquer la production.
 *
 * L'épinglage IPFS de la forge est lancé APRÈS sa réponse : au moment du
 * rendu, le CID n'existe pas encore. Sans cette attente, le programme partait
 * sur NOSTR avec la seule URL de la forge — et devenait injouable le jour où
 * cette adresse change. On sonde donc un temps borné, puis on publie ce qu'on
 * a : une vidéo servie par la forge vaut mieux qu'aucune vidéo.
 */
export async function attendreCid(id: string, opts: { timeoutMs?: number; pasMs?: number } = {}): Promise<string | undefined> {
  const timeoutMs = opts.timeoutMs ?? 90_000
  const pasMs = opts.pasMs ?? 5_000
  const t0 = Date.now()
  while (Date.now() - t0 < timeoutMs) {
    try {
      const a = await getAsset(id)
      if (a.ipfs) return a.ipfs
    } catch {
      // Un échec de sondage n'est pas un échec de production.
    }
    await new Promise(r => setTimeout(r, pasMs))
  }
  return undefined
}

export interface WafUpload {
  id: string
  url: string
  ipfs?: string
  type: 'audio' | 'image'
  bytes: number
}

/**
 * Dépose un média fabriqué ici (la voix-off du JT) dans la forge, et renvoie
 * son `assetId` — utilisable tel quel comme `audio.assetId` du montage.
 *
 * Pourquoi ce détour : le montage n'accepte qu'un asset local ou une URL
 * publiquement joignable. La piste est produite dans un exécuteur GitHub qui
 * n'expose rien sur le réseau ; sans dépôt, il faudrait la faire transiter par
 * un hébergeur tiers pour obtenir une adresse — la dépendance que la forge
 * souveraine cherche justement à retirer.
 */
export async function uploadMedia(
  data: Buffer | Uint8Array,
  opts: { filename: string; mime: string; label?: string },
): Promise<WafUpload> {
  const form = new FormData()
  // On laisse `fetch` poser lui-même le Content-Type : écrit à la main, la
  // frontière multipart manquerait et le serveur ne verrait aucun fichier.
  form.append('file', new Blob([new Uint8Array(data)], { type: opts.mime }), opts.filename)
  if (opts.label) form.append('prompt', opts.label)

  const key = process.env.WAF_API_KEY
  const res = await fetch(`${wafBase()}/api/v1/upload`, {
    method: 'POST',
    headers: key ? { Authorization: `Bearer ${key}` } : {},
    body: form,
  })
  const text = await res.text()
  let parsed: unknown
  try { parsed = JSON.parse(text) } catch { parsed = { raw: text } }
  if (!res.ok) {
    const msg = (parsed as { error?: string })?.error ?? `HTTP ${res.status}`
    throw new Error(`WAF /api/v1/upload → ${msg}`)
  }
  const up = parsed as WafUpload
  if (!up?.id) throw new Error('WAF /upload : aucun identifiant renvoyé')
  return up
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
