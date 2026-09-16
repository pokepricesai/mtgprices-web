// scripts/phase3c-live-retry.ts
//
// Targeted retry of the three surfaces that produced weak output on
// the first live run:
//   - Improve Deck (general) — was a 60s timeout
//   - Improve Deck (budget)  — succeeded but returned 0 suggestions
//   - Build Deck             — succeeded but returned 0 cards
//
// Also adds the two missing scenarios:
//   - Build from collection (owned_only=true)
//   - Budget constraint verification (explicit priceMax on Improve)
//
// Uses a larger 15-card fixture so the model has real material to
// reason about. Longer timeouts on the reasoning tier. Logs raw
// response text so quality can be inspected.

import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createRequire } from 'node:module'

const __dirname = dirname(fileURLToPath(import.meta.url))
try {
  const raw = readFileSync(join(__dirname, '..', '.env.local'), 'utf8')
  for (const line of raw.split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Za-z0-9_]+)\s*=\s*(.*)\s*$/)
    if (!m) continue
    let v = m[2]
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1)
    process.env[m[1]] = v
  }
} catch {}

const require = createRequire(import.meta.url)
const soPath = require.resolve('server-only')
require.cache[soPath] = { id: soPath, filename: soPath, loaded: true, exports: {}, children: [], paths: [], parent: null, path: soPath, isPreloading: false, require } as any
const { createClient } = require('@supabase/supabase-js')
const s = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
})

async function seedBiggerFixture() {
  const email = `mtg-3c-retry-${Date.now()}@example.com`
  const { data: userData } = await s.auth.admin.createUser({ email, password: 'DontUse1234!', email_confirm: true })
  const userId = userData.user!.id

  const { data: legendary } = await s.from('mtg_oracle_cards')
    .select('id, name')
    .ilike('type_line', '%legendary%creature%')
    .overlaps('colors', ['U']).containedBy('color_identity', ['U'])
    .not('capabilities', 'is', null).limit(1)

  // 15 mono-blue non-land cards — explicitly exclude the commander
  // so we don't accidentally seed an illegal duplicate.
  const { data: bluecards } = await s.from('mtg_oracle_cards')
    .select('id, name')
    .overlaps('colors', ['U']).containedBy('color_identity', ['U'])
    .not('type_line', 'ilike', '%land%')
    .neq('id', legendary![0].id)
    .limit(15)

  const { data: deck } = await s.from('mtg_decks').insert({
    user_id: userId, name: 'Live-retry mono-U', format: 'commander',
  }).select().single()

  const inserts = [
    { deck_id: deck.id, oracle_card_id: legendary![0].id, quantity: 1, zone: 'commander' as const },
    ...bluecards!.map((b: any) => ({ deck_id: deck.id, oracle_card_id: b.id, quantity: 1, zone: 'main' as const })),
  ]
  await s.from('mtg_deck_cards').insert(inserts)
  const { data: dc } = await s.from('mtg_deck_cards').select('*').eq('deck_id', deck.id)
  console.log(`Seeded: commander="${legendary![0].name}", main=${bluecards!.length}`)
  return { userId, deck, deckCards: dc ?? [] }
}

async function seedCollection(userId: string, oracleIds: string[]) {
  // Grab a finish per oracle and add 1 nonfoil copy each.
  const { data: printings } = await s.from('mtg_printings')
    .select('id, oracle_card_id').in('oracle_card_id', oracleIds).eq('lang', 'en').eq('digital', false)
  const printingIds = (printings ?? []).map((p: any) => p.id)
  const { data: finishes } = await s.from('mtg_printing_finishes')
    .select('id, printing_id, finish').in('printing_id', printingIds).eq('finish', 'nonfoil')
  const inserts = (finishes ?? []).slice(0, 12).map((f: any) => ({
    user_id: userId,
    printing_finish_id: f.id,
    condition: 'near_mint',
    quantity: 1,
  }))
  if (inserts.length > 0) {
    await s.from('mtg_collection_items').insert(inserts)
  }
  return inserts.length
}

async function buildLightContext(deck: any, deckCards: any[]) {
  const oracleIds = Array.from(new Set(deckCards.map((c) => c.oracle_card_id)))
  const { data: oracles } = await s.from('mtg_oracle_cards')
    .select('id, name, mana_cost, mana_value, type_line, oracle_text, colors, color_identity, keywords, capabilities, layout')
    .in('id', oracleIds)
  const byId = new Map((oracles ?? []).map((o: any) => [o.id, o]))
  const { VALUATION_BASES } = await import('../src/lib/mtg/valuation.data')
  const { validateDeck } = await import('../src/lib/mtg/deck-rules')

  const cardCtx = deckCards.map((c) => {
    const o = byId.get(c.oracle_card_id) as any ?? {}
    return {
      deck_card_id: c.id, oracle_card_id: c.oracle_card_id,
      name: o.name ?? '(unknown)', quantity: c.quantity, zone: c.zone,
      mana_cost: o.mana_cost ?? null, mana_value: o.mana_value ?? null,
      colors: o.colors ?? [], color_identity: o.color_identity ?? [],
      type_line: o.type_line ?? null, types: [] as string[],
      keywords: o.keywords ?? [], capabilities: o.capabilities ?? [],
      oracle_text: o.oracle_text ?? null, layout: o.layout ?? null,
      legality: 'legal',
      preferredPrinting: null,
      owned: { ownedQuantityAcrossPrintings: 0, ownedThisPrinting: 0, printings: [] },
      currentPrice: null,
    }
  })

  const validationInput = cardCtx.map((c) => ({
    oracle_card_id: c.oracle_card_id, name: c.name, quantity: c.quantity, zone: c.zone,
    type_line: c.type_line, color_identity: c.color_identity, keywords: c.keywords,
    oracle_text: c.oracle_text, legality: 'legal' as const,
  }))
  const validation = validateDeck({ format: 'commander' as any, cards: validationInput })

  return {
    deck: { id: deck.id, name: deck.name, format: deck.format, description: deck.description, createdAt: deck.created_at, updatedAt: deck.updated_at },
    commanders: cardCtx.filter((c) => c.zone === 'commander'),
    main: cardCtx.filter((c) => c.zone === 'main'),
    sideboard: [], companion: [], maybeboard: [],
    totals: { main: cardCtx.filter((c) => c.zone === 'main').length, sideboard: 0, commander: cardCtx.filter((c) => c.zone === 'commander').length, companion: 0, maybeboard: 0 },
    curve: [0, 0, 0, 0, 0, 0, 0, 0], colorIdentity: cardCtx.filter((c) => c.zone === 'commander').flatMap((c) => c.color_identity),
    typeBreakdown: {}, capabilityBreakdown: {},
    ownership: { ownedCards: 0, missingCards: cardCtx.length, fullyOwnedEntries: 0, partiallyOwnedEntries: 0, missingEntries: cardCtx.length },
    pricing: { basis: VALUATION_BASES[0], deckValue: 0, deckValueMissingEntries: cardCtx.length, missingCardsValue: 0 },
    validation,
  } as any
}

async function main() {
  console.log('=== Phase 3C retry ===\n')
  const fx = await seedBiggerFixture()
  const context = await buildLightContext(fx.deck, fx.deckCards)

  // Give the fixture user a small collection so build-from-collection has something.
  const ownedCount = await seedCollection(fx.userId, context.main.slice(0, 12).map((c: any) => c.oracle_card_id))
  console.log(`Seeded collection: ${ownedCount} finish rows\n`)

  const { runAi, extractJson } = await import('../src/lib/ai/run')
  const {
    IMPROVE_SYSTEM, improveUserPrompt,
    BUILD_SYSTEM, buildUserPrompt,
  } = await import('../src/lib/ai/prompts')
  const { verifyImproveResponse, verifyBuildResponse } = await import('../src/lib/ai/grounding')
  const { bindDeckTools, bindBuilderTools } = await import('../src/lib/ai/tools')
  const bound = (bindDeckTools as any)(context)

  const results: any[] = []
  function report(label: string, r: any, extras: Record<string, any> = {}) {
    const line = {
      label,
      ok: r.ok, model: r.model,
      tokens_in: r.tokensIn, tokens_out: r.tokensOut, tokens_reasoning: r.tokensReasoning,
      latency_ms: r.latencyMs, est_cost_cents: r.estimatedCostCents,
      error_kind: r.errorKind,
      raw_error: r.errorKind ? String(r.text ?? '').slice(0, 160) : undefined,
      ...extras,
    }
    console.log(JSON.stringify(line, null, 2))
    results.push(line)
  }

  // ── Improve general (with 15-card fixture + 110s timeout) ──
  console.log('--- Improve Deck (general) [retry] ---')
  {
    const r = await runAi({
      tier: 'reasoning',
      system: IMPROVE_SYSTEM,
      prompt: improveUserPrompt('general'),
      tools: bound.tools,
      maxSteps: 12,
      timeoutMs: 110_000,
    })
    const json = r.ok ? extractJson(r.text) : null
    const verified = json ? await (verifyImproveResponse as any)(json, context, bound.authorised) : null
    const summary = verified?.ok ? verified.value.summary : null
    const first = verified?.ok && verified.value.suggestions[0]
    report('improve_general', r, {
      grounding_ok: verified?.ok ?? false,
      accepted: verified?.ok ? verified.value.suggestions.length : 0,
      rejected: verified?.rejected?.length ?? 0,
      summary_preview: summary ? summary.slice(0, 200) : null,
      first_suggestion: first ? {
        remove: first.remove_oracle_card_id?.slice(0, 8) ?? null,
        add: first.add_oracle_card_id.slice(0, 8),
        reason: first.reason.slice(0, 160),
      } : null,
    })
  }

  // ── Improve budget (with priceMax constraint via prompt) ──
  console.log('\n--- Improve Deck (budget) [retry] ---')
  {
    const r = await runAi({
      tier: 'reasoning',
      system: IMPROVE_SYSTEM,
      prompt: improveUserPrompt('budget', 'Missing-cards budget under $30 USD total.'),
      tools: bound.tools,
      maxSteps: 12,
      timeoutMs: 110_000,
    })
    const json = r.ok ? extractJson(r.text) : null
    const verified = json ? await (verifyImproveResponse as any)(json, context, bound.authorised) : null
    report('improve_budget', r, {
      grounding_ok: verified?.ok ?? false,
      accepted: verified?.ok ? verified.value.suggestions.length : 0,
      summary_preview: verified?.ok ? verified.value.summary.slice(0, 200) : null,
    })
  }

  // ── Build Deck (small brief) ─────────────────────────────
  console.log('\n--- Build Deck (small brief) [retry, no ownedOnly] ---')
  {
    const commanderId = context.commanders[0].oracle_card_id
    const commanderName = context.commanders[0].name
    const builder = (bindBuilderTools as any)({
      format: 'commander',
      commanderOracleIds: [commanderId],
      includeCollection: false,
      currency: 'USD' as const,
    })
    const brief = 'Casual mono-blue Commander. Include ~35 Islands, ramp artifacts, blue card draw, cheap counterspells and a few finishers. Keep missing cards under $60.'
    const r = await runAi({
      tier: 'reasoning',
      system: BUILD_SYSTEM,
      prompt: buildUserPrompt({
        format: 'commander', brief, commanderName,
        budgetCurrency: 'USD', budgetMax: 60,
      }),
      tools: builder.tools,
      maxSteps: 22,
      timeoutMs: 160_000,
    })
    const json = r.ok ? extractJson(r.text) : null
    const verified = json ? await (verifyBuildResponse as any)(json, 'commander', builder.authorised) : null
    report('build_small', r, {
      grounding_ok: verified?.ok ?? false,
      grounding_error: verified?.ok ? null : (verified as any)?.error,
      commanders: verified?.ok ? verified.value.commanders.length : null,
      main_returned: verified?.ok ? verified.value.main.length : null,
      distinct_cards: verified?.ok ? new Set(verified.value.main.map((m: any) => m.oracle_card_id)).size : null,
      total_qty: verified?.ok ? verified.value.main.reduce((n: number, m: any) => n + m.quantity, 0) : null,
      summary_preview: verified?.ok ? verified.value.summary.slice(0, 200) : null,
      sample_main: verified?.ok ? verified.value.main.slice(0, 3).map((m: any) => ({ oid: m.oracle_card_id.slice(0, 8), qty: m.quantity, reason: (m.reason ?? '').slice(0, 100) })) : null,
      raw_preview: r.ok ? String(r.text).slice(0, 300) : null,
    })
  }

  // ── Build from collection (owned_only) ────────────────────
  console.log('\n--- Build Deck (owned_only) ---')
  {
    const commanderId = context.commanders[0].oracle_card_id
    const commanderName = context.commanders[0].name
    const builder = (bindBuilderTools as any)({
      format: 'commander',
      commanderOracleIds: [commanderId],
      includeCollection: true,
      currency: 'USD' as const,
    })
    const brief = `Build a mono-U Commander deck using cards this user already owns as much as possible. Owner has around ${ownedCount} unique cards in collection.`
    const r = await runAi({
      tier: 'reasoning',
      system: BUILD_SYSTEM,
      prompt: buildUserPrompt({
        format: 'commander', brief, commanderName, ownedOnly: true,
      }),
      tools: builder.tools,
      maxSteps: 22,
      timeoutMs: 160_000,
    })
    const json = r.ok ? extractJson(r.text) : null
    const verified = json ? await (verifyBuildResponse as any)(json, 'commander', builder.authorised) : null
    report('build_owned', r, {
      grounding_ok: verified?.ok ?? false,
      commanders: verified?.ok ? verified.value.commanders.length : null,
      main_returned: verified?.ok ? verified.value.main.length : null,
      total_qty: verified?.ok ? verified.value.main.reduce((n: number, m: any) => n + m.quantity, 0) : null,
      summary_preview: verified?.ok ? verified.value.summary.slice(0, 200) : null,
    })
  }

  // ── Totals ────────────────────────────────────────────────
  console.log('\n=== Totals ===')
  const totalIn = results.reduce((n, r) => n + (r.tokens_in ?? 0), 0)
  const totalOut = results.reduce((n, r) => n + (r.tokens_out ?? 0), 0)
  const totalR = results.reduce((n, r) => n + (r.tokens_reasoning ?? 0), 0)
  const totalCents = results.reduce((n, r) => n + (r.est_cost_cents ?? 0), 0)
  console.log(`  Total tokens: in=${totalIn}, out=${totalOut}, reasoning=${totalR}`)
  console.log(`  Total est cost: $${(totalCents / 100).toFixed(3)}`)

  // Cleanup.
  await s.from('mtg_collection_items').delete().eq('user_id', fx.userId)
  await s.from('mtg_decks').delete().eq('id', fx.deck.id)
  await s.auth.admin.deleteUser(fx.userId)
  console.log('\n(cleaned up user + deck + collection)')
  process.exit(0)
}

main().catch((err) => { console.error(err); process.exit(1) })
