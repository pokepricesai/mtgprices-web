// app/api/decks/[id]/ai/replace/route.ts
// AI-ranked replacement candidates for a specific deck card.

import { NextResponse, type NextRequest } from 'next/server'
import { getCurrentUser } from '@/lib/supabase/server'
import { getDeckById, getDeckCards } from '@/lib/mtg/decks'
import { buildDeckContext } from '@/lib/mtg/deck-context'
import { bindDeckTools } from '@/lib/ai/tools'
import { REPLACE_SYSTEM, replaceUserPrompt, PROMPT_VERSION } from '@/lib/ai/prompts'
import { ReplaceSchema } from '@/lib/ai/grounding'
import { runAi, extractJson } from '@/lib/ai/run'
import { checkQuota, logUsage } from '@/lib/ai/rate-limit'
import { aiConfigured, sanitiseUserData } from '@/lib/ai/provider'
import { getSupabaseServiceClient } from '@/lib/supabaseService'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'
export const maxDuration = 60

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser()
  if (!user) return NextResponse.json({ error: 'unauthorised' }, { status: 401 })
  if (!aiConfigured()) return NextResponse.json({ error: 'ai_not_configured' }, { status: 503 })

  const { id } = await params
  const deck = await getDeckById(id)
  if (!deck || deck.user_id !== user.id) return NextResponse.json({ error: 'deck not found' }, { status: 404 })

  const quota = await checkQuota(user.id)
  if (!quota.ok) {
    await logUsage({ userId: user.id, operation: 'replace_card', provider: 'gateway', model: 'n/a', outcome: 'rate_limited', errorKind: quota.reason, deckId: id })
    return NextResponse.json({ error: 'rate_limited', reason: quota.reason }, { status: 429 })
  }

  const body = await req.json().catch(() => ({} as any)) ?? {}
  const oracleId: string = body.oracle_card_id
  const mode: 'similar' | 'cheaper' | 'owned' = ['similar', 'cheaper', 'owned'].includes(body.mode) ? body.mode : 'similar'
  const custom = typeof body.custom === 'string' ? sanitiseUserData(body.custom, 400) : undefined
  if (!oracleId) return NextResponse.json({ error: 'oracle_card_id required' }, { status: 400 })

  const cards = await getDeckCards(id)
  const context = await buildDeckContext(deck, cards)
  const bound = bindDeckTools(context)

  const result = await runAi({
    tier: 'cheap',
    system: REPLACE_SYSTEM,
    prompt: replaceUserPrompt(oracleId, mode, custom),
    tools: bound.tools,
    maxSteps: 6,
  })

  if (!result.ok) {
    await logUsage({ userId: user.id, operation: 'replace_card', provider: result.provider, model: result.model, outcome: 'error', errorKind: result.errorKind, latencyMs: result.latencyMs, deckId: id })
    return NextResponse.json({ error: result.errorKind ?? 'provider_error' }, { status: 502 })
  }

  const json = extractJson(result.text)
  const parsed = json ? ReplaceSchema.safeParse(json) : { success: false as const }
  if (!parsed.success) {
    await logUsage({ userId: user.id, operation: 'replace_card', provider: result.provider, model: result.model, tokensInput: result.tokensIn, tokensOutput: result.tokensOut, estimatedCostCents: result.estimatedCostCents, latencyMs: result.latencyMs, deckId: id, outcome: 'validation_blocked', errorKind: 'malformed' })
    return NextResponse.json({ error: 'malformed_response' }, { status: 422 })
  }
  // Grounding: every candidate must be authorised.
  const kept = parsed.data.candidates.filter((c) => bound.authorised.has(c.oracle_card_id))
  const rejected = parsed.data.candidates.filter((c) => !bound.authorised.has(c.oracle_card_id))

  // Hydrate.
  const s = getSupabaseServiceClient()
  const ids = kept.map((k) => k.oracle_card_id)
  const cardById = new Map<string, any>()
  if (ids.length > 0) {
    const [{ data: oracles }, { data: printings }] = await Promise.all([
      s.from('mtg_oracle_cards').select('id, name, mana_cost, type_line, capabilities').in('id', ids),
      s.from('mtg_printings').select('oracle_card_id, image_uri_small, set_code, collector_number, released_at').in('oracle_card_id', ids).eq('lang', 'en').eq('digital', false).order('released_at', { ascending: false, nullsFirst: false }),
    ])
    const printingBy = new Map<string, any>()
    for (const p of (printings ?? []) as any[]) if (!printingBy.has(p.oracle_card_id)) printingBy.set(p.oracle_card_id, p)
    for (const o of (oracles ?? []) as any[]) cardById.set(o.id, { ...o, printing: printingBy.get(o.id) ?? null })
  }

  await logUsage({ userId: user.id, operation: 'replace_card', provider: result.provider, model: result.model, tokensInput: result.tokensIn, tokensOutput: result.tokensOut, tokensReasoning: result.tokensReasoning, estimatedCostCents: result.estimatedCostCents, latencyMs: result.latencyMs, deckId: id, outcome: 'ok' })

  return NextResponse.json({
    prompt_version: PROMPT_VERSION,
    target_oracle_card_id: parsed.data.target_oracle_card_id,
    candidates: kept.map((c) => ({ ...c, card: cardById.get(c.oracle_card_id) ?? null })),
    rejected,
    usage: {
      tokens_in: result.tokensIn, tokens_out: result.tokensOut, tokens_reasoning: result.tokensReasoning,
      estimated_cost_cents: result.estimatedCostCents, latency_ms: result.latencyMs, model: result.model,
    },
  })
}
