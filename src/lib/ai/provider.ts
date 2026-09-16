// src/lib/ai/provider.ts
//
// Thin abstraction over the AI SDK v7 + Vercel AI Gateway.
//
// The Gateway lets us pass `"provider/model"` strings directly. Both
// tiers (cheap + reasoning) are configured via env vars so we can swap
// providers/models without redeploying code — only re-deploying.
//
// Cheap tier: constrained output, minimal reasoning allowance.
// Reasoning tier: deck building + strategic reasoning, higher
// reasoning allowance.
//
// Sonnet 5 is used for both today; the split still matters because
// each tier uses different reasoning caps.

import 'server-only'

type Tier = 'cheap' | 'reasoning'

export const AI_MODEL: Record<Tier, string> = {
  cheap: process.env.AI_MODEL_CHEAP ?? 'anthropic/claude-sonnet-5',
  reasoning: process.env.AI_MODEL_REASONING ?? 'anthropic/claude-sonnet-5',
}

/** Provider identifier for logging. Extracted from the model string
 *  as everything before the first "/". */
export function providerOf(modelString: string): string {
  const idx = modelString.indexOf('/')
  return idx >= 0 ? modelString.slice(0, idx) : modelString
}

/** Effective model IDs per tier — used by the usage log so we can
 *  reconstruct exactly what ran in production. */
export function modelForTier(tier: Tier): string {
  return AI_MODEL[tier]
}

export function providerForTier(tier: Tier): string {
  return providerOf(AI_MODEL[tier])
}

/** Rough per-1M-token costs in USD, used ONLY for an app-side estimate
 *  in mtg_ai_usage. The Vercel AI Gateway dashboard remains the
 *  authoritative billing source. Update as pricing evolves. */
const APPROX_COST_PER_MTOK: Record<string, { input: number; output: number }> = {
  // Anthropic Sonnet-class ~ $3 in / $15 out per 1M tokens.
  'anthropic/claude-sonnet-5':      { input: 3, output: 15 },
  'anthropic/claude-sonnet-4-6':    { input: 3, output: 15 },
  'anthropic/claude-haiku-4-5':     { input: 0.8, output: 4 },
  'anthropic/claude-opus-4-7':      { input: 15, output: 75 },
}

export function estimateCostCents(model: string, tokensIn: number, tokensOut: number): number {
  const p = APPROX_COST_PER_MTOK[model]
  if (!p) return 0
  const usd = (tokensIn / 1_000_000) * p.input + (tokensOut / 1_000_000) * p.output
  return Math.round(usd * 100)
}

/** Prompt injection defence: strip anything that looks like an
 *  attempt to override the system role from user-provided card notes
 *  / imported deck descriptions. */
export function sanitiseUserData(input: string, maxLength = 4000): string {
  const trimmed = input.slice(0, maxLength)
  return trimmed
    .replace(/\n?\s*###?\s*(system|instructions?|tool)\s*[:\n]/gi, ' ')
    .replace(/\n?\s*ignore\s+previous\s+instructions/gi, ' [redacted] ')
    .replace(/\n?\s*(you are|act as|pretend to be)\s+/gi, ' ')
}

/** True when the model provider is reachable — used to fail fast if
 *  AI_GATEWAY_API_KEY is unset. Never prints the key. */
export function aiConfigured(): boolean {
  return Boolean(process.env.AI_GATEWAY_API_KEY)
}
