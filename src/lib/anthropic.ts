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
  temperature?:  number                  // défaut 0.85 (vivant)
}

export interface LLMResponse {
  text:         string
  inputTokens:  number
  outputTokens: number
}

const DEFAULT_MODEL = 'claude-haiku-4-5-20251001'

const MAX_ATTEMPTS = 3
const BASE_BACKOFF_MS = 1500

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

  let lastErr: unknown
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      const resp = await client.messages.create({
        model:       opts.model ?? DEFAULT_MODEL,
        system:      opts.systemPrompt,
        messages:    opts.messages,
        max_tokens:  opts.maxTokens ?? 400,
        temperature: opts.temperature ?? 0.85,
      })

      const text = resp.content
        .map(b => (b.type === 'text' ? b.text : ''))
        .join('')
        .trim()

      return {
        text,
        inputTokens:  resp.usage.input_tokens,
        outputTokens: resp.usage.output_tokens,
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
