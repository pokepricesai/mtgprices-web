// app/api/decks/new-ai/route.ts
// "Build me a deck" — AI drafts a deck via iterative searchLegalCards
// calls, then the app validates + returns a preview. Nothing is saved
// until the user confirms via /api/decks/new-ai/save.

import { NextResponse, type NextRequest } from 'next/server'
import { getCurrentUser } from '@/lib/supabase/server'
import { bindBuilderTools } from '@/lib/ai/tools'
import { BUILD_SYSTEM, buildUserPrompt, PROMPT_VERSION } from '@/lib/ai/prompts'
import { verifyBuildResponse } from '@/lib/ai/grounding'
import { runAi, extractJson } from '@/lib/ai/run'
import { checkQuota, logUsage } from '@/lib/ai/rate-limit'
import { aiConfigured, sanitiseUserData } from '@/lib/ai/provider'
import { getSupabaseServiceClient } from '@/lib/supabaseService'
import { getFormatRule } from '@/lib/mtg/format-rules'
import { validateDeck, type DeckCardForValidation } from '@/lib/mtg/deck-rules'
import type { FormatKey } from '@/lib/mtg/formats.data'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'
export const maxDuration = 60

export async function POST(req: NextRequest) {
  const user = await getCurrentUser()
  if (!user) return NextResponse.json({ error: 'unauthorised' }, { status: 401 })
  if (!aiConfigured()) return NextResponse.json({ error: 'ai_not_configured' }, { status: 503 })

  const quota = await checkQuota(user.id)
  if (!quota.ok) {
    await logUsage({ userId: user.id, operation: 'build_deck', provider: 'gateway', model: 'n/a', outcome: 'rate_limited', errorKind: quota.reason })
    return NextResponse.json({ error: 'rate_limited', reason: quota.reason }, { status: 429 })
  }

  const body = await req.json().catch(() => ({} as any)) ?? {}
  const format: FormatKey = body.format
  const rule = getFormatRule(format)
  if (!rule) return NextResponse.json({ error: 'unsupported_format' }, { status: 400 })
  const brief = typeof body.brief === 'string' ? sanitiseUserData(body.brief, 1200) : ''
  const commanderIds: string[] = Array.isArray(body.commander_oracle_ids) ? body.commander_oracle_ids.slice(0, 2) : []
  const ownedOnly = Boolean(body.owned_only)
  const budgetMax = typeof body.budget_max === 'number' ? body.budget_max : undefined
  const budgetCurrency = body.budget_currency === 'EUR' ? 'EUR' : body.budget_currency === 'USD' ? 'USD' : undefined

  // Look up commander name(s) for the prompt.
  const s = getSupabaseServiceClient()
  let commanderName: string | undefined
  if (commanderIds.length > 0) {
    const { data } = await s.from('mtg_oracle_cards').select('name').in('id', commanderIds)
    commanderName = ((data ?? []) as any[]).map((r) => r.name).join(' & ')
  }

  const bound = bindBuilderTools({
    format,
    commanderOracleIds: commanderIds,
    includeCollection: ownedOnly,
    budgetMax,
    currency: budgetCurrency,
  })

  const result = await runAi({
    tier: 'reasoning',
    system: BUILD_SYSTEM,
    prompt: buildUserPrompt({
      format, brief,
      commanderName,
      budgetCurrency, budgetMax,
      ownedOnly,
    }),
    tools: bound.tools,
    maxSteps: 20,
    timeoutMs: 90_000,
  })

  if (!result.ok) {
    await logUsage({ userId: user.id, operation: 'build_deck', provider: result.provider, model: result.model, outcome: 'error', errorKind: result.errorKind, latencyMs: result.latencyMs })
    return NextResponse.json({ error: result.errorKind ?? 'provider_error' }, { status: 502 })
  }

  const json = extractJson(result.text)
  const verified = json ? await verifyBuildResponse(json, format, bound.authorised) : null
  if (!verified || !verified.ok) {
    await logUsage({ userId: user.id, operation: 'build_deck', provider: result.provider, model: result.model, tokensInput: result.tokensIn, tokensOutput: result.tokensOut, tokensReasoning: result.tokensReasoning, estimatedCostCents: result.estimatedCostCents, latencyMs: result.latencyMs, outcome: 'validation_blocked', errorKind: (verified as any)?.error ?? 'malformed' })
    return NextResponse.json({ error: (verified as any)?.error ?? 'grounding_failed' }, { status: 422 })
  }

  // Hydrate cards + run deterministic validator on the projected deck.
  const allIds = Array.from(new Set([...verified.value.commanders, ...verified.value.main.map((m) => m.oracle_card_id)]))
  const [{ data: oracles }, { data: printings }] = await Promise.all([
    s.from('mtg_oracle_cards').select('id, name, mana_cost, mana_value, type_line, color_identity, keywords, oracle_text, capabilities').in('id', allIds),
    s.from('mtg_printings').select('oracle_card_id, image_uri_small, set_code, collector_number, released_at').in('oracle_card_id', allIds).eq('lang', 'en').eq('digital', false).order('released_at', { ascending: false, nullsFirst: false }),
  ])
  const oracleById = new Map<string, any>()
  for (const o of (oracles ?? []) as any[]) oracleById.set(o.id, o)
  const printingBy = new Map<string, any>()
  for (const p of (printings ?? []) as any[]) if (!printingBy.has(p.oracle_card_id)) printingBy.set(p.oracle_card_id, p)

  const validationInput: DeckCardForValidation[] = [
    ...verified.value.commanders.map((id) => {
      const o = oracleById.get(id) ?? {}
      return {
        oracle_card_id: id,
        name: o.name ?? '(unknown)',
        quantity: 1,
        zone: 'commander' as const,
        type_line: o.type_line ?? null,
        color_identity: o.color_identity ?? null,
        keywords: o.keywords ?? null,
        oracle_text: o.oracle_text ?? null,
        legality: 'legal',
      }
    }),
    ...verified.value.main.map((m) => {
      const o = oracleById.get(m.oracle_card_id) ?? {}
      return {
        oracle_card_id: m.oracle_card_id,
        name: o.name ?? '(unknown)',
        quantity: m.quantity,
        zone: 'main' as const,
        type_line: o.type_line ?? null,
        color_identity: o.color_identity ?? null,
        keywords: o.keywords ?? null,
        oracle_text: o.oracle_text ?? null,
        legality: 'legal',
      }
    }),
  ]
  const validation = validateDeck({ format, cards: validationInput })

  await logUsage({ userId: user.id, operation: 'build_deck', provider: result.provider, model: result.model, tokensInput: result.tokensIn, tokensOutput: result.tokensOut, tokensReasoning: result.tokensReasoning, estimatedCostCents: result.estimatedCostCents, latencyMs: result.latencyMs, outcome: validation.ok ? 'ok' : 'validation_blocked', errorKind: validation.ok ? null : 'invalid_deck' })

  return NextResponse.json({
    prompt_version: PROMPT_VERSION,
    proposed: {
      format,
      summary: verified.value.summary,
      commanders: verified.value.commanders.map((id) => ({ oracle_card_id: id, card: hydrate(id, oracleById, printingBy) })),
      main: verified.value.main.map((m) => ({ ...m, card: hydrate(m.oracle_card_id, oracleById, printingBy) })),
      warnings: verified.value.warnings,
    },
    validation,
    usage: {
      tokens_in: result.tokensIn, tokens_out: result.tokensOut, tokens_reasoning: result.tokensReasoning,
      estimated_cost_cents: result.estimatedCostCents, latency_ms: result.latencyMs, model: result.model,
    },
  })
}

function hydrate(oracleId: string, oracleById: Map<string, any>, printingBy: Map<string, any>) {
  const o = oracleById.get(oracleId)
  if (!o) return null
  return { ...o, printing: printingBy.get(oracleId) ?? null }
}
