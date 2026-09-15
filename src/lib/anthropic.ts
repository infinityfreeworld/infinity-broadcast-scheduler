/**
 * @module InfinityScheduler/Anthropic
 * @description Wrapper Node natif autour du SDK Anthropic officiel.
 *   Utilisé pour générer chaque tour de dialogue d'un broadcast.
 */

import Anthropic from '@anthropic-ai/sdk'

export interface LLMMessage {
  role:    'user' | 'assistant'
  content: string
}

export interface LLMCallOpts {
  apiKey:        string
  model?:        string                  // défaut : claude-haiku-4-5-20251001
  systemPrompt:  string
  messages:      LLMMessage[]
  maxTokens?:    number                  // défaut 400 (3 phrases courtes)
  temperature?:  number                  // défaut 0.85 (vivant) — jamais envoyée aux modèles qui la refusent
  flux?:         boolean                 // en flux : seule voie pour une LONGUE rédaction (cf. callAnthropic)
}

export interface LLMResponse {
  text:         string
  inputTokens:  number
  outputTokens: number
  stopReason?:  string | null            // « max_tokens » = réponse COUPÉE au plafond : le texte est incomplet
}

const DEFAULT_MODEL = 'claude-haiku-4-5-20251001'

const MAX_ATTEMPTS = 3
const BASE_BACKOFF_MS = 1500

/**
 * Les modèles récents REFUSENT les paramètres d'échantillonnage : `temperature` y rend une erreur 400
 * (Claude Sonnet 5, Opus 5, Opus 4.7 et 4.8, Fable, Mythos). Le Journal de Freeworld TV écrit avec
 * Sonnet 5 (15/09/2026) : sans ce tri, chaque appel échouait avant d'avoir écrit un mot. Les modèles
 * plus anciens — Haiku 4.5, celui de la radio et du JT en images — gardent leur température.
 */
export function accepteTemperature(model: string): boolean {
  return !/^claude-(?:sonnet-5|opus-5|opus-4-[78]|fable|mythos)(?:$|-)/.test(model)
}

function sleep(ms: number): Promise<void> {
  return new Promise(r => setTimeout(r, ms))
}

function isRetryable(err: unknown): boolean {
  // Erreurs réseau transitoires : ETIMEDOUT, ECONNRESET, ECONNREFUSED, EAI_AGAIN.
  // Le SDK officiel Anthropic ré-emet l'erreur native fetch sous .cause.
  const e = err as { code?: string; cause?: { code?: string }; status?: number }
  const code = e?.code ?? e?.cause?.code
  if (code && ['ETIMEDOUT', 'ECONNRESET', 'ECONNREFUSED', 'EAI_AGAIN', 'UND_ERR_SOCKET'].includes(code)) {
    return true
  }
  // 429 + 5xx : retry recommandé.
  if (e?.status === 429 || (typeof e?.status === 'number' && e.status >= 500 && e.status < 600)) {
    return true
  }
  return false
}

export async function callAnthropic(opts: LLMCallOpts): Promise<LLMResponse> {
  const client = new Anthropic({ apiKey: opts.apiKey })
  const model = opts.model ?? DEFAULT_MODEL

  let lastErr: unknown
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      const params = {
        model,
        system:      opts.systemPrompt,
        messages:    opts.messages,
        max_tokens:  opts.maxTokens ?? 400,
        ...(accepteTemperature(model) ? { temperature: opts.temperature ?? 0.85 } : {}),
      }
      // Sans flux, le SDK refuse les requêtes trop longues (au-delà de ~21 000 jetons de sortie) ; or la réflexion
      // du modèle compte dans ce plafond. Le 15/09/2026, le 1er conducteur du Journal a été coupé net à 16 000.
      const resp = opts.flux ? await client.messages.stream(params).finalMessage() : await client.messages.create(params)

      const text = resp.content
        .map(b => (b.type === 'text' ? b.text : ''))
        .join('')
        .trim()

      return {
        text,
        inputTokens:  resp.usage.input_tokens,
        outputTokens: resp.usage.output_tokens,
        stopReason:   resp.stop_reason,
      }
    } catch (err) {
      lastErr = err
      if (attempt < MAX_ATTEMPTS && isRetryable(err)) {
        const wait = BASE_BACKOFF_MS * Math.pow(2, attempt - 1)
        const code = (err as { code?: string; cause?: { code?: string } })?.code
          ?? (err as { cause?: { code?: string } })?.cause?.code
          ?? 'unknown'
        console.warn(`   ⚠️  Anthropic ${code} (tentative ${attempt}/${MAX_ATTEMPTS}), retry dans ${wait}ms…`)
        await sleep(wait)
        continue
      }
      throw err
    }
  }
  throw lastErr
}
