// app/api/decks/[id]/ai/improve/route.ts
// "Improve my deck", 3-5 grounded swap suggestions.

import { NextResponse, type NextRequest } from 'next/server'
import { getCurrentUser } from '@/lib/supabase/server'
import { getDeckById, getDeckCards } from '@/lib/mtg/decks'
import { buildDeckContext } from '@/lib/mtg/deck-context'
import { bindDeckTools } from '@/lib/ai/tools'
import { IMPROVE_SYSTEM, improveUserPrompt, type ImproveGoal, IMPROVE_GOALS, PROMPT_VERSION } from '@/lib/ai/prompts'
import { verifyImproveResponse } from '@/lib/ai/grounding'
import { runAi, extractJson } from '@/lib/ai/run'
import { checkQuota, logUsage } from '@/lib/ai/rate-limit'
import { aiConfigured, sanitiseUserData } from '@/lib/ai/provider'
import { getSupabaseServiceClient } from '@/lib/supabaseService'
import { buildShoppingPreview } from '@/lib/mtg/shopping-preview'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'
// Sonnet 5's reasoning tier averaged 30-60s in live testing with
// tool loops. Bumped from 60s so genuine long-running improves have
// headroom before hitting the timeout.
export const maxDuration = 120

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser()
  if (!user) return NextResponse.json({ error: 'unauthorised' }, { status: 401 })
  if (!aiConfigured()) return NextResponse.json({ error: 'ai_not_configured' }, { status: 503 })

  const { id } = await params
  const deck = await getDeckById(id)
  if (!deck || deck.user_id !== user.id) return NextResponse.json({ error: 'deck not found' }, { status: 404 })

  const quota = await checkQuota(user.id)
  if (!quota.ok) {
    await logUsage({ userId: user.id, operation: 'improve_deck', provider: 'gateway', model: 'n/a', outcome: 'rate_limited', errorKind: quota.reason, deckId: id })
    return NextResponse.json({ error: 'rate_limited', reason: quota.reason, usedOps: quota.usedOps, usedCents: quota.usedCents }, { status: 429 })
  }

  const body = await req.json().catch(() => ({} as any)) ?? {}
  const goal = (Object.keys(IMPROVE_GOALS).includes(body.goal) ? body.goal : 'general') as ImproveGoal
  const custom = typeof body.custom === 'string' ? sanitiseUserData(body.custom) : undefined

  const cards = await getDeckCards(id)
  const context = await buildDeckContext(deck, cards)
  const bound = bindDeckTools(context)

  const result = await runAi({
    tier: 'reasoning',
    system: IMPROVE_SYSTEM,
    prompt: improveUserPrompt(goal, custom),
    tools: bound.tools,
    // 5 steps is enough for: getDeckContext → 3 searchLegalCards calls
    // → emit JSON. Previously 12; the higher cap encouraged the model
    // to keep searching with tiny filter variations and blew up input
    // tokens.
    maxSteps: 5,
    timeoutMs: 90_000,
  })

  if (!result.ok) {
    await logUsage({
      userId: user.id, operation: 'improve_deck',
      provider: result.provider, model: result.model,
      outcome: 'error', errorKind: result.errorKind,
      latencyMs: result.latencyMs, deckId: id,
    })
    return NextResponse.json({ error: result.errorKind ?? 'provider_error' }, { status: 502 })
  }

  const json = extractJson(result.text)
  const verified = json ? await verifyImproveResponse(json, context, bound.authorised) : null

  await logUsage({
    userId: user.id, operation: 'improve_deck',
    provider: result.provider, model: result.model,
    tokensInput: result.tokensIn, tokensOutput: result.tokensOut, tokensReasoning: result.tokensReasoning,
    estimatedCostCents: result.estimatedCostCents, latencyMs: result.latencyMs,
    deckId: id, outcome: verified?.ok ? 'ok' : 'validation_blocked',
    errorKind: verified?.ok ? null : (verified as any)?.error ?? 'grounding_failed',
  })

  // Hydrate resulting suggestions with card details for the UI.
  if (!verified || !verified.ok) {
    return NextResponse.json({ error: 'grounding_failed', reason: (verified as any)?.error ?? 'malformed', rejected: verified?.rejected ?? [] }, { status: 422 })
  }

  const s = getSupabaseServiceClient()
  const allIds = Array.from(new Set(verified.value.suggestions.flatMap((sug) =>
    [sug.add_oracle_card_id, sug.remove_oracle_card_id].filter(Boolean) as string[]
  )))
  const cardById = new Map<string, any>()
  if (allIds.length > 0) {
    const [{ data: oracles }, { data: printings }] = await Promise.all([
      s.from('mtg_oracle_cards').select('id, name, mana_cost, mana_value, type_line, color_identity, capabilities').in('id', allIds),
      s.from('mtg_printings').select('oracle_card_id, image_uri_small, set_code, collector_number, released_at')
        .in('oracle_card_id', allIds)
        .eq('lang', 'en')
        .eq('digital', false)
        .order('released_at', { ascending: false, nullsFirst: false }),
    ])
    const printingByOracle = new Map<string, any>()
    for (const p of (printings ?? []) as any[]) {
      if (!printingByOracle.has(p.oracle_card_id)) printingByOracle.set(p.oracle_card_id, p)
    }
    for (const o of (oracles ?? []) as any[]) {
      cardById.set(o.id, { ...o, printing: printingByOracle.get(o.id) ?? null })
    }
  }

  // Deterministic shopping-preview across all cards to be ADDED ,
  // shows the user the missing-card cost of accepting every suggestion.
  const addEntries = verified.value.suggestions.map((sug) => {
    const card = cardById.get(sug.add_oracle_card_id) ?? null
    return { oracle_card_id: sug.add_oracle_card_id, quantity: sug.quantity, name: card?.name }
  })
  const shopping = addEntries.length > 0 ? await buildShoppingPreview(addEntries).catch(() => null) : null

  return NextResponse.json({
    prompt_version: PROMPT_VERSION,
    summary: verified.value.summary,
    suggestions: verified.value.suggestions.map((sug) => ({
      ...sug,
      add_card: cardById.get(sug.add_oracle_card_id) ?? null,
      remove_card: sug.remove_oracle_card_id ? cardById.get(sug.remove_oracle_card_id) ?? null : null,
    })),
    rejected: verified.rejected,
    shopping,
    usage: {
      tokens_in: result.tokensIn,
      tokens_out: result.tokensOut,
      tokens_reasoning: result.tokensReasoning,
      estimated_cost_cents: result.estimatedCostCents,
      latency_ms: result.latencyMs,
      model: result.model,
    },
  })
}
