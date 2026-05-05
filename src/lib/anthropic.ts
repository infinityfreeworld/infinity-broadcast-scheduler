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

export async function callAnthropic(opts: LLMCallOpts): Promise<LLMResponse> {
  const client = new Anthropic({ apiKey: opts.apiKey })
  const resp = await client.messages.create({
    model:       opts.model ?? DEFAULT_MODEL,
    system:      opts.systemPrompt,
    messages:    opts.messages,
    max_tokens:  opts.maxTokens ?? 400,
    temperature: opts.temperature ?? 0.85,
  })

  // Concatène tous les blocs text (en pratique : 1 seul bloc)
  const text = resp.content
    .filter((b): b is { type: 'text'; text: string; citations: unknown } =>
      b.type === 'text')
    .map(b => b.text)
    .join('')
    .trim()

  return {
    text,
    inputTokens:  resp.usage.input_tokens,
    outputTokens: resp.usage.output_tokens,
  }
}
