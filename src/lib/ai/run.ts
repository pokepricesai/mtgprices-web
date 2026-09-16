// src/lib/ai/run.ts
//
// Thin runner around ai.generateText() with structured output. Handles:
//   - selecting model tier
//   - forwarding tools
//   - capturing token counts + latency
//   - safe failure with an error kind

import 'server-only'
import { generateText } from 'ai'
import { AI_MODEL, providerForTier, estimateCostCents, aiConfigured } from './provider'

export type RunTier = 'cheap' | 'reasoning'

export type RunResult = {
  ok: boolean
  text: string
  tokensIn: number
  tokensOut: number
  tokensReasoning: number
  latencyMs: number
  provider: string
  model: string
  estimatedCostCents: number
  errorKind?: 'not_configured' | 'timeout' | 'provider_error' | 'unknown'
}

export async function runAi(input: {
  tier: RunTier
  system: string
  prompt: string
  tools?: Record<string, any>
  maxSteps?: number
  timeoutMs?: number
}): Promise<RunResult> {
  const t0 = Date.now()
  const model = AI_MODEL[input.tier]
  const provider = providerForTier(input.tier)
  const zero: RunResult = {
    ok: false, text: '', tokensIn: 0, tokensOut: 0, tokensReasoning: 0,
    latencyMs: 0, provider, model, estimatedCostCents: 0,
  }

  if (!aiConfigured()) return { ...zero, errorKind: 'not_configured' }
  const timeout = input.timeoutMs ?? 60_000

  try {
    const result = await Promise.race([
      generateText({
        model,
        system: input.system,
        prompt: input.prompt,
        tools: input.tools,
        stopWhen: (step: any) => (step?.stepNumber ?? 0) >= (input.maxSteps ?? 8),
      } as any),
      new Promise<never>((_, rej) => setTimeout(() => rej(new Error('ai_timeout')), timeout)),
    ]) as any

    const tokensIn = result.usage?.inputTokens ?? result.usage?.promptTokens ?? 0
    const tokensOut = result.usage?.outputTokens ?? result.usage?.completionTokens ?? 0
    const tokensReasoning = result.usage?.reasoningTokens ?? 0
    const latencyMs = Date.now() - t0
    return {
      ok: true,
      text: result.text ?? '',
      tokensIn, tokensOut, tokensReasoning,
      latencyMs, provider, model,
      estimatedCostCents: estimateCostCents(model, tokensIn, tokensOut),
    }
  } catch (err: any) {
    const isTimeout = err?.message === 'ai_timeout'
    return {
      ...zero,
      latencyMs: Date.now() - t0,
      errorKind: isTimeout ? 'timeout' : 'provider_error',
      text: err?.message ?? 'unknown provider error',
    }
  }
}

/** Extract the first {...} JSON object from a possibly-noisy string.
 *  Returns `null` if none is found. */
export function extractJson(raw: string): unknown | null {
  const trimmed = raw.trim()
  // If the whole payload IS a JSON object, use it.
  if (trimmed.startsWith('{')) {
    try { return JSON.parse(trimmed) } catch { /* fall through */ }
  }
  const start = trimmed.indexOf('{')
  const end = trimmed.lastIndexOf('}')
  if (start < 0 || end < 0 || end <= start) return null
  try { return JSON.parse(trimmed.slice(start, end + 1)) } catch { return null }
}
