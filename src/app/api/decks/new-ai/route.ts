// app/api/decks/new-ai/route.ts
// "Build me a deck" via the staged AI Build pipeline (Plan → Candidates
// → Select → Repair). Nothing is saved until the user confirms via
// /api/decks/new-ai/save.

import { NextResponse, type NextRequest } from 'next/server'
import { getCurrentUser } from '@/lib/supabase/server'
import { PROMPT_VERSION } from '@/lib/ai/prompts'
import { runBuildPipeline } from '@/lib/ai/build/pipeline'
import { checkQuota, logUsage } from '@/lib/ai/rate-limit'
import { aiConfigured, sanitiseUserData } from '@/lib/ai/provider'
import { getFormatRule } from '@/lib/mtg/format-rules'
import type { FormatKey } from '@/lib/mtg/formats.data'
import { buildShoppingPreview } from '@/lib/mtg/shopping-preview'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'
// Two AI stages (Plan cheap + Select reasoning) plus an optional
// repair pass. Budget the wall-clock generously.
export const maxDuration = 180

export async function POST(req: NextRequest) {
  const user = await getCurrentUser()
  if (!user) return NextResponse.json({ error: 'unauthorised' }, { status: 401 })
  if (!aiConfigured()) return NextResponse.json({ error: 'ai_not_configured' }, { status: 503 })
  // Build UI is hidden until the staged pipeline passes live tests.
  // The API is gated too so a hand-crafted fetch can't reach it in
  // production. Local scripts and the Vercel test env can flip
  // AI_BUILD_ENABLED to 'true' to run the pipeline end-to-end.
  if (process.env.AI_BUILD_ENABLED !== 'true') {
    return NextResponse.json({ error: 'build_disabled' }, { status: 503 })
  }

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

  const pipeline = await runBuildPipeline({
    format, brief,
    commanderOracleIds: commanderIds,
    useCollection: ownedOnly,
    budgetMax,
    budgetCurrency,
  })

  // Provider/model are attached to each stage's usage; grab the first
  // populated one for the rate-limit log.
  const providerAny = 'gateway'
  const modelAny = process.env.AI_MODEL_REASONING ?? 'anthropic/claude-sonnet-5'
  const outcome = pipeline.ok ? 'ok' : (pipeline.failureStage === 'validate' ? 'validation_blocked' : 'error')
  await logUsage({
    userId: user.id, operation: 'build_deck',
    provider: providerAny, model: modelAny,
    tokensInput: pipeline.usage.total.tokensIn,
    tokensOutput: pipeline.usage.total.tokensOut,
    tokensReasoning: pipeline.usage.total.tokensReasoning,
    estimatedCostCents: pipeline.usage.total.estimatedCostCents,
    latencyMs: pipeline.usage.total.latencyMs,
    outcome,
    errorKind: pipeline.ok ? null : (pipeline.error ?? pipeline.failureStage ?? 'unknown'),
  })

  if (!pipeline.ok || !pipeline.proposed) {
    return NextResponse.json({
      error: pipeline.error ?? 'build_failed',
      failure_stage: pipeline.failureStage,
      usage: pipeline.usage,
      pool: pipeline.pool,
    }, { status: 422 })
  }

  // Deterministic shopping-preview, AI never sources price data.
  const entries: Array<{ oracle_card_id: string; quantity: number; name?: string }> = []
  for (const c of pipeline.proposed.commanders) entries.push({ oracle_card_id: c.oracle_card_id, quantity: 1, name: c.card?.name })
  for (const m of pipeline.proposed.main) entries.push({ oracle_card_id: m.oracle_card_id, quantity: m.quantity, name: m.card?.name })
  const shopping = await buildShoppingPreview(entries).catch(() => null)

  return NextResponse.json({
    prompt_version: PROMPT_VERSION,
    proposed: pipeline.proposed,
    validation: pipeline.validation,
    usage: pipeline.usage,
    pool: pipeline.pool,
    repair_applied: pipeline.repairApplied,
    shopping,
  })
}
