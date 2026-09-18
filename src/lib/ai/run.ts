// src/lib/ai/run.ts
//
// Thin runner around ai.generateText() with structured output. Handles:
//   - selecting model tier
//   - forwarding tools
//   - capturing token counts + latency
//   - safe failure with an error kind

import 'server-only'
import { generateText, generateObject } from 'ai'
import type { z } from 'zod'
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

// Test-only seam. Unit tests replace runAi's underlying call with a
// canned response. Production paths never touch this, no route or
// UI calls the setter. Setting a mock via __setAiRunMock also intercepts
// runAiObject (the mock text is JSON-parsed to produce the `value`).
let __mockRunner: ((input: any) => Promise<RunResult>) | null = null
export function __setAiRunMock(fn: ((input: any) => Promise<RunResult>) | null) {
  __mockRunner = fn
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

  if (__mockRunner) return __mockRunner(input)
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

/** Schema-enforced runner. The model is forced to emit an object
 *  matching `schema`; no JSON parsing gymnastics. Prefer this over
 *  runAi() + extractJson() for surfaces where output shape matters
 *  (Build). */
export async function runAiObject<T>(input: {
  tier: RunTier
  system: string
  prompt: string
  schema: z.ZodType<T>
  tools?: Record<string, any>
  maxSteps?: number
  timeoutMs?: number
}): Promise<RunResult & { value: T | null }> {
  const t0 = Date.now()
  const model = AI_MODEL[input.tier]
  const provider = providerForTier(input.tier)
  const zero = {
    ok: false, text: '', tokensIn: 0, tokensOut: 0, tokensReasoning: 0,
    latencyMs: 0, provider, model, estimatedCostCents: 0, value: null as T | null,
  }
  // Test seam, same mock hook as runAi. Parse the canned text
  // through the schema so the caller still gets `value`.
  if (__mockRunner) {
    const canned = await __mockRunner(input)
    if (!canned.ok) return { ...canned, value: null } as any
    try {
      const raw = JSON.parse(canned.text)
      const parsed = input.schema.safeParse(raw)
      return { ...canned, value: parsed.success ? parsed.data : null } as any
    } catch {
      return { ...canned, value: null } as any
    }
  }
  if (!aiConfigured()) return { ...zero, errorKind: 'not_configured' } as any
  const timeout = input.timeoutMs ?? 60_000
  try {
    const result = await Promise.race([
      generateObject({
        model,
        system: input.system,
        prompt: input.prompt,
        schema: input.schema,
        tools: input.tools,
        stopWhen: (step: any) => (step?.stepNumber ?? 0) >= (input.maxSteps ?? 8),
      } as any),
      new Promise<never>((_, rej) => setTimeout(() => rej(new Error('ai_timeout')), timeout)),
    ]) as any
    const tokensIn = result.usage?.inputTokens ?? result.usage?.promptTokens ?? 0
    const tokensOut = result.usage?.outputTokens ?? result.usage?.completionTokens ?? 0
    const tokensReasoning = result.usage?.reasoningTokens ?? 0
    return {
      ok: true,
      text: JSON.stringify(result.object ?? {}),
      value: result.object as T,
      tokensIn, tokensOut, tokensReasoning,
      latencyMs: Date.now() - t0, provider, model,
      estimatedCostCents: estimateCostCents(model, tokensIn, tokensOut),
    }
  } catch (err: any) {
    const isTimeout = err?.message === 'ai_timeout'
    return {
      ...zero,
      latencyMs: Date.now() - t0,
      errorKind: isTimeout ? 'timeout' : 'provider_error',
      text: err?.message ?? 'unknown provider error',
    } as any
  }
}

/** Extract a JSON object from a possibly-noisy string. Tries in order:
 *   1. The whole trimmed payload.
 *   2. A ```json ... ``` fenced block.
 *   3. Every '{ ... }' span starting at the first '{', trying larger
 *      closes first (some models emit incidental braces in reasoning
 *      text before the real JSON, the naive first-to-last approach
 *      falls into that trap). */
export function extractJson(raw: string): unknown | null {
  const trimmed = raw.trim()
  if (!trimmed) return null

  if (trimmed.startsWith('{')) {
    try { return JSON.parse(trimmed) } catch { /* fall through */ }
  }

  const fenced = trimmed.match(/```(?:json)?\s*(\{[\s\S]*?\})\s*```/i)
  if (fenced) {
    try { return JSON.parse(fenced[1]) } catch { /* fall through */ }
  }

  const firstBrace = trimmed.indexOf('{')
  if (firstBrace < 0) return null
  // Collect every '}' position after the first '{', largest first.
  const closes: number[] = []
  for (let i = trimmed.length - 1; i > firstBrace; i--) {
    if (trimmed[i] === '}') closes.push(i)
  }
  for (const c of closes) {
    try { return JSON.parse(trimmed.slice(firstBrace, c + 1)) } catch { /* try next */ }
  }
  return null
}
