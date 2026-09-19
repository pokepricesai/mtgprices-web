// app/api/ai/ask/route.ts
//
// Public "Ask MTGPrices AI" endpoint. Signed-in only. Runs the model
// with the public-tools set (searchCards, getCardFacts, getCurrentPrice,
// findSimilarCards, getFormatRule, getMarketMovers), records usage
// into mtg_ai_usage and returns the model's answer plus the compact
// list of cards it authorised via tool calls (so the UI can render
// grounded card widgets).

import { NextResponse } from 'next/server'
import { z } from 'zod'
import { getCurrentUser } from '@/lib/supabase/server'
import { getSupabaseServiceClient } from '@/lib/supabaseService'
import { checkQuota, logUsage, AI_LIMITS } from '@/lib/ai/rate-limit'
import { runAi } from '@/lib/ai/run'
import { sanitiseUserData, aiConfigured } from '@/lib/ai/provider'
import { bindPublicAiTools, PUBLIC_AI_SYSTEM_PROMPT } from '@/lib/ai/public-tools'

export const runtime = 'nodejs'

const BodySchema = z.object({
  prompt: z.string().min(1).max(1200),
  // Optional: user picked one of their decks as context. When present
  // we don't rebuild the deck AI (analyse/improve live on the deck
  // page). We just cite the deck name + format in the system prompt.
  deck_id: z.string().uuid().optional(),
})

export async function POST(req: Request) {
  if (!aiConfigured()) {
    return NextResponse.json({ error: 'ai_not_configured' }, { status: 503 })
  }
  const user = await getCurrentUser()
  if (!user) return NextResponse.json({ error: 'unauthenticated' }, { status: 401 })

  const raw = await req.json().catch(() => null)
  const parsed = BodySchema.safeParse(raw)
  if (!parsed.success) {
    return NextResponse.json({ error: 'invalid_body' }, { status: 400 })
  }

  const quota = await checkQuota(user.id)
  if (!quota.ok) {
    return NextResponse.json({
      error: 'rate_limited',
      reason: quota.reason,
      usedOps: quota.usedOps,
      dailyOps: AI_LIMITS.dailyOps,
    }, { status: 429 })
  }

  const cleaned = sanitiseUserData(parsed.data.prompt, 1200)

  // Optional deck context: read the name + format + commander line but
  // do NOT hand deck cards to the model. Ask AI is public catalogue
  // scoped; deck AI lives on /decks/[id].
  let deckHint = ''
  if (parsed.data.deck_id) {
    const s = getSupabaseServiceClient()
    const { data: deck } = await s
      .from('mtg_decks')
      .select('id, name, format, user_id')
      .eq('id', parsed.data.deck_id)
      .maybeSingle()
    if (deck && deck.user_id === user.id) {
      deckHint = `\n\nThe user is asking in the context of their deck "${deck.name}" (format: ${deck.format}). ` +
        `Do not attempt to fetch the deck contents; only use the format to scope your searches. ` +
        `If they want deck-scoped analysis, tell them to use Analyse or Improve on the deck page.`
    }
  }

  const { tools, authorised } = bindPublicAiTools()
  const t0 = Date.now()
  // Ceiling picked to fit inside Vercel's 300s function budget with
  // headroom while giving the model enough room for the harder
  // prompts (e.g. "compare three cards + similarity" needs ~8 tool
  // calls: searchCards, 3× getCurrentPrice, getCardFacts, findSimilar
  // and often another searchCards for the similar-to target).
  const result = await runAi({
    tier: 'cheap',
    system: PUBLIC_AI_SYSTEM_PROMPT + deckHint,
    prompt: cleaned,
    tools,
    maxSteps: 12,
    timeoutMs: 120_000,
  })
  const latencyMs = Date.now() - t0

  if (!result.ok) {
    await logUsage({
      userId: user.id,
      operation: 'ask',
      provider: result.provider,
      model: result.model,
      outcome: result.errorKind === 'timeout' ? 'error' : 'error',
      errorKind: result.errorKind ?? 'unknown',
      latencyMs,
    })
    return NextResponse.json({ error: 'ai_failed', kind: result.errorKind ?? 'unknown' }, { status: 502 })
  }

  await logUsage({
    userId: user.id,
    operation: 'ask',
    provider: result.provider,
    model: result.model,
    tokensInput: result.tokensIn,
    tokensOutput: result.tokensOut,
    tokensReasoning: result.tokensReasoning,
    estimatedCostCents: result.estimatedCostCents,
    outcome: 'ok',
    latencyMs,
  })

  // Fetch compact display info (image, set, headline price) for every
  // authorised oracle_card_id so the UI can render grounded card
  // widgets alongside the prose answer.
  const groundedCards = await hydrateCards(Array.from(authorised).slice(0, 12))

  return NextResponse.json({
    ok: true,
    text: result.text,
    grounded_cards: groundedCards,
    usage: {
      opsUsed: quota.usedOps + 1,
      opsLimit: AI_LIMITS.dailyOps,
      costCents: result.estimatedCostCents,
      latencyMs,
    },
  })
}

async function hydrateCards(oracleIds: string[]): Promise<Array<{
  oracle_card_id: string
  name: string
  set_code: string
  collector_number: string | null
  image_uri_small: string | null
  card_href: string
}>> {
  if (oracleIds.length === 0) return []
  const s = getSupabaseServiceClient()
  // Freshest English paper printing per oracle for display.
  const { data: prints } = await s
    .from('mtg_printings')
    .select('id, oracle_card_id, name, set_code, collector_number, image_uri_small, released_at')
    .in('oracle_card_id', oracleIds)
    .eq('digital', false)
    .eq('lang', 'en')
    .order('released_at', { ascending: false, nullsFirst: false })
  const bestPerOracle = new Map<string, any>()
  for (const p of (prints ?? []) as any[]) {
    if (!bestPerOracle.has(p.oracle_card_id)) bestPerOracle.set(p.oracle_card_id, p)
  }
  const rows: Array<{ oracle_card_id: string; name: string; set_code: string; collector_number: string | null; image_uri_small: string | null; card_href: string }> = []
  for (const oracleId of oracleIds) {
    const p = bestPerOracle.get(oracleId)
    if (!p) continue
    const nameSlug = String(p.name).toLowerCase().replace(/[’']/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')
    const seg = p.collector_number ? `${p.collector_number}-${nameSlug}` : nameSlug
    rows.push({
      oracle_card_id: p.oracle_card_id,
      name: p.name,
      set_code: p.set_code,
      collector_number: p.collector_number,
      image_uri_small: p.image_uri_small,
      card_href: `/set/${p.set_code}/card/${seg}`,
    })
  }
  return rows
}
