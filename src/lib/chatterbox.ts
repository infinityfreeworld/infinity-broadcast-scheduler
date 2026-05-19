/**
 * @module InfinityScheduler/Chatterbox
 * @description Sprint DE — Wrapper Node.js pour le serveur Chatterbox TTS
 *   (Resemble AI, image Docker `ghcr.io/devnen/chatterbox-tts-server`).
 *
 *   Adapté du wrapper Neo CPI (~280 LoC). Différences :
 *     - Pure Node (pas de Buffer browser)
 *     - Pas d'admin upload depuis ici (upload géré côté IHL browser)
 *     - Health check `pingUntilReady()` qui attend le réveil du HF Space
 *
 *   Variables d'environnement requises :
 *     - CHATTERBOX_TTS_URL : https://username-chatterbox-xxx.hf.space
 *     - CHATTERBOX_API_KEY : bearer token (hf_xxx)
 *     - CHATTERBOX_VOICE_MAP : JSON optionnel `{ "<hostId>": "<voiceName>" }`
 *     - CHATTERBOX_DEFAULT_VOICE : voix utilisée si hostId pas dans la map
 *     - CHATTERBOX_LANGUAGE : défaut 'fr'
 *     - CHATTERBOX_FALLBACK_PIPER : 'true' (défaut) pour fallback si Chatterbox fail
 *
 *   Usage typique (depuis generate-broadcast.ts) :
 *     const cbVoice = getChatterboxVoiceForHost(host.id)
 *     if (cbVoice) {
 *       try {
 *         const buf = await synthesizeWithChatterbox(text, cbVoice)
 *         writeFileSync(tmpPath, buf)
 *         // suite pipeline normale (readWav, concat, etc.)
 *       } catch (err) {
 *         // fallback Piper
 *       }
 *     }
 */

export interface ChatterboxSpeakOptions {
  voice:               string
  text:                string
  language?:           string
  format?:             'mp3' | 'wav' | 'opus' | 'flac'
  emotionExaggeration?: number
  cfgWeight?:          number
  temperature?:        number
  speed?:              number
}

export class ChatterboxError extends Error {
  constructor(message: string, public readonly status?: number) {
    super(message)
    this.name = 'ChatterboxError'
  }
}

function getEndpoint(): { url: string; apiKey: string } {
  const url = process.env.CHATTERBOX_TTS_URL
  if (!url) throw new ChatterboxError('CHATTERBOX_TTS_URL non défini')
  return {
    url:    url.replace(/\/+$/, ''),
    apiKey: process.env.CHATTERBOX_API_KEY ?? '',
  }
}

function authHeaders(apiKey: string): Record<string, string> {
  return apiKey ? { Authorization: `Bearer ${apiKey}` } : {}
}

/**
 * Health check du HF Space.
 */
export async function pingChatterbox(): Promise<{ ok: boolean; status: number; ms: number }> {
  const { url, apiKey } = getEndpoint()
  const t0 = Date.now()
  try {
    const res = await fetch(`${url}/health`, {
      headers: authHeaders(apiKey),
      signal:  AbortSignal.timeout(90_000),
    })
    return { ok: res.ok, status: res.status, ms: Date.now() - t0 }
  } catch {
    return { ok: false, status: 0, ms: Date.now() - t0 }
  }
}

/**
 * Ping jusqu'à ce que le Space soit éveillé (cold start ~30-60s).
 * Retries avec backoff exponentiel jusqu'à `maxAttempts`.
 */
export async function pingUntilReady(maxAttempts = 6, initialDelayMs = 5_000): Promise<boolean> {
  let delay = initialDelayMs
  for (let i = 0; i < maxAttempts; i++) {
    const r = await pingChatterbox()
    console.log(`  [chatterbox] ping ${i + 1}/${maxAttempts} : ${r.ok ? '✓' : '✗'} ${r.status} (${r.ms}ms)`)
    if (r.ok) return true
    if (i < maxAttempts - 1) {
      await new Promise(resolve => setTimeout(resolve, delay))
      delay = Math.min(delay * 1.5, 30_000)
    }
  }
  return false
}

/**
 * Synthèse texte → audio. Retourne un Buffer (WAV/MP3/etc selon format).
 */
export async function synthesizeWithChatterbox(opts: ChatterboxSpeakOptions): Promise<Buffer> {
  const { url, apiKey } = getEndpoint()
  const body = {
    model:                'chatterbox',
    input:                opts.text,
    voice:                opts.voice.endsWith('.wav') ? opts.voice : `${opts.voice}.wav`,
    response_format:      opts.format ?? 'wav',
    language:             opts.language ?? process.env.CHATTERBOX_LANGUAGE ?? 'fr',
    language_id:          opts.language ?? process.env.CHATTERBOX_LANGUAGE ?? 'fr',
    emotion_exaggeration: opts.emotionExaggeration ?? 0.55,
    cfg_weight:           opts.cfgWeight ?? 0.65,
    temperature:          opts.temperature ?? 0.75,
    speed:                opts.speed ?? 1.0,
  }
  const res = await fetch(`${url}/v1/audio/speech`, {
    method:  'POST',
    headers: {
      'Content-Type': 'application/json',
      ...authHeaders(apiKey),
    },
    body:    JSON.stringify(body),
    signal:  AbortSignal.timeout(120_000),
  })
  if (!res.ok) {
    let detail = ''
    try { detail = await res.text() } catch { /* */ }
    throw new ChatterboxError(`speech HTTP ${res.status}${detail ? ' : ' + detail.slice(0, 200) : ''}`, res.status)
  }
  const arrayBuf = await res.arrayBuffer()
  return Buffer.from(arrayBuf)
}

/**
 * Retourne le nom de la voix Chatterbox associée à un hostId, ou null
 * si le mapping n'est pas configuré OU si le host n'a pas de voix custom.
 *
 *   CHATTERBOX_VOICE_MAP = '{"wtf-cyril":"nestor","wtf-marina":"marina-fr"}'
 *
 *   Si la map est absente mais CHATTERBOX_DEFAULT_VOICE est défini ET
 *   CHATTERBOX_TTS_URL est défini, on retourne la default voice pour
 *   TOUS les hosts (tous bascule sur Chatterbox).
 */
export function getChatterboxVoiceForHost(hostId: string): string | null {
  if (!process.env.CHATTERBOX_TTS_URL) return null
  const json = process.env.CHATTERBOX_VOICE_MAP
  if (json) {
    try {
      const map = JSON.parse(json) as Record<string, string>
      if (map[hostId]) return map[hostId]
    } catch (err) {
      console.warn('[chatterbox] CHATTERBOX_VOICE_MAP malformé:', (err as Error).message)
    }
  }
  const defaultVoice = process.env.CHATTERBOX_DEFAULT_VOICE
  return defaultVoice && defaultVoice.length > 0 ? defaultVoice : null
}

/**
 * True si Chatterbox est configuré ET le fallback Piper est activé
 * (défaut). Permet au pipeline de décider de retry Piper si Chatterbox
 * fail.
 */
export function isFallbackPiperEnabled(): boolean {
  const v = process.env.CHATTERBOX_FALLBACK_PIPER
  if (v === undefined || v === '') return true   // défaut : on retombe sur Piper
  return v === 'true' || v === '1' || v === 'yes'
}
