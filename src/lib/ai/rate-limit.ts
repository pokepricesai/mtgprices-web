// src/lib/ai/rate-limit.ts
//
// Pre-launch AI quotas. Conservative defaults (see AI_LIMITS) — a user
// gets a small daily allowance across the four operations. Values are
// env-controlled so they can be tuned without redeploy.

import 'server-only'
import { getSupabaseServiceClient } from '@/lib/supabaseService'

export const AI_LIMITS = {
  /** Max total operations per user per rolling 24h. */
  dailyOps: Number(process.env.AI_DAILY_OPS_LIMIT ?? 20),
  /** Absolute cap on estimated cents spent by any user per rolling 24h. */
  dailyCents: Number(process.env.AI_DAILY_CENTS_LIMIT ?? 200), // $2.00
}

export type QuotaResult = {
  ok: boolean
  reason?: 'ops_exceeded' | 'cost_exceeded'
  usedOps: number
  usedCents: number
}

export async function checkQuota(userId: string): Promise<QuotaResult> {
  const s = getSupabaseServiceClient()
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString()
  const { data } = await s.from('mtg_ai_usage')
    .select('estimated_cost_cents')
    .eq('user_id', userId)
    .gte('created_at', since)
  const rows = (data ?? []) as { estimated_cost_cents: number | null }[]
  const usedOps = rows.length
  const usedCents = rows.reduce((n, r) => n + (r.estimated_cost_cents ?? 0), 0)
  if (usedOps >= AI_LIMITS.dailyOps) {
    return { ok: false, reason: 'ops_exceeded', usedOps, usedCents }
  }
  if (usedCents >= AI_LIMITS.dailyCents) {
    return { ok: false, reason: 'cost_exceeded', usedOps, usedCents }
  }
  return { ok: true, usedOps, usedCents }
}

export type LogInput = {
  userId: string
  operation: 'analyse_deck' | 'improve_deck' | 'replace_card' | 'build_deck'
  provider: string
  model: string
  tokensInput?: number | null
  tokensOutput?: number | null
  tokensReasoning?: number | null
  estimatedCostCents?: number | null
  deckId?: string | null
  outcome?: 'ok' | 'validation_blocked' | 'error' | 'rate_limited'
  errorKind?: string | null
  latencyMs?: number | null
}

export async function logUsage(input: LogInput) {
  const s = getSupabaseServiceClient()
  const { error } = await s.from('mtg_ai_usage').insert({
    user_id: input.userId,
    operation: input.operation,
    provider: input.provider,
    model: input.model,
    tokens_input: input.tokensInput ?? null,
    tokens_output: input.tokensOutput ?? null,
    tokens_reasoning: input.tokensReasoning ?? null,
    estimated_cost_cents: input.estimatedCostCents ?? null,
    deck_id: input.deckId ?? null,
    outcome: input.outcome ?? 'ok',
    error_kind: input.errorKind ?? null,
    latency_ms: input.latencyMs ?? null,
  })
  if (error) console.error('logUsage err:', error)
}
