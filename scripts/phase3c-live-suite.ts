// scripts/phase3c-live-suite.ts
//
// Comprehensive live-model test suite for Phase 3C. Exercises every
// AI surface + every grounding path against a real (synthetic) deck
// via the Vercel AI Gateway. Reports per-call model / tokens /
// latency / cost / tool-call sequence / accepted-vs-rejected.
//
// Never prints the AI_GATEWAY_API_KEY. Never exposes hidden
// chain-of-thought — only the sanitised structured output.
//
// Usage:
//   npx tsx scripts/phase3c-live-suite.ts

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

// ── Deck fixture: a small Commander deck ────────────────────────
// We seed a Blue-only mono-U Commander deck around any legendary
// blue creature we can find. Six main-deck instant/sorcery slots
// makes the deck deliberately unbalanced so Improve has something
// to say. Cleaned up after the run.

async function seedFixtureDeck(): Promise<{ userId: string; deckId: string; deck: any; deckCards: any[] } | null> {
  const email = `mtg-3c-live-${Date.now()}@example.com`
  const { data: userData, error: uErr } = await s.auth.admin.createUser({ email, password: 'DontUse1234!', email_confirm: true })
  if (uErr || !userData.user) { console.log('createUser err:', uErr); return null }
  const userId = userData.user.id

  // Blue legendary creature (commander).
  const { data: legendary } = await s.from('mtg_oracle_cards')
    .select('id, name')
    .ilike('type_line', '%legendary%creature%')
    .overlaps('colors', ['U'])
    .containedBy('color_identity', ['U'])
    .not('capabilities', 'is', null)
    .limit(1)
  // Six blue non-land cards for the 99 (grossly incomplete but enough for AI to reason about).
  const { data: bluecards } = await s.from('mtg_oracle_cards')
    .select('id, name')
    .overlaps('colors', ['U'])
    .containedBy('color_identity', ['U'])
    .not('type_line', 'ilike', '%land%')
    .limit(6)

  if (!legendary?.[0] || !bluecards || bluecards.length === 0) return null

  const { data: deck, error: dErr } = await s.from('mtg_decks').insert({
    user_id: userId, name: 'Live-test mono-U Commander', format: 'commander',
  }).select().single()
  if (dErr) { console.log('createDeck err:', dErr); return null }

  const inserts = [
    { deck_id: deck.id, oracle_card_id: legendary[0].id, quantity: 1, zone: 'commander' as const },
    ...bluecards.map((b: any) => ({ deck_id: deck.id, oracle_card_id: b.id, quantity: 1, zone: 'main' as const })),
  ]
  await s.from('mtg_deck_cards').insert(inserts)
  const { data: dc } = await s.from('mtg_deck_cards').select('*').eq('deck_id', deck.id)
  console.log(`Seeded: commander="${legendary[0].name}", main=${bluecards.length}`)
  return { userId, deckId: deck.id, deck, deckCards: dc ?? [] }
}

async function cleanup(userId: string) {
  await s.auth.admin.deleteUser(userId)
}

// Build a minimal DeckContext without going through the Next
// request-scope helpers. Mirrors what buildDeckContext produces —
// enough for the tools + prompts to work.
async function buildLightContext(deck: any, deckCards: any[]) {
  const oracleIds = Array.from(new Set(deckCards.map((c) => c.oracle_card_id)))
  const { data: oracles } = await s.from('mtg_oracle_cards')
    .select('id, name, mana_cost, mana_value, type_line, oracle_text, colors, color_identity, keywords, capabilities, layout')
    .in('id', oracleIds)
  const byId = new Map((oracles ?? []).map((o: any) => [o.id, o]))
  const { VALUATION_BASES } = await import('../src/lib/mtg/valuation.data')

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

  return {
    deck: {
      id: deck.id, name: deck.name, format: deck.format,
      description: deck.description, createdAt: deck.created_at, updatedAt: deck.updated_at,
    },
    commanders: cardCtx.filter((c) => c.zone === 'commander'),
    main: cardCtx.filter((c) => c.zone === 'main'),
    sideboard: [], companion: [], maybeboard: [],
    totals: { main: cardCtx.filter((c) => c.zone === 'main').length, sideboard: 0, commander: cardCtx.filter((c) => c.zone === 'commander').length, companion: 0, maybeboard: 0 },
    curve: [0, 0, 0, 0, 0, 0, 0, 0], colorIdentity: cardCtx.filter((c) => c.zone === 'commander').flatMap((c) => c.color_identity),
    typeBreakdown: {}, capabilityBreakdown: {},
    ownership: { ownedCards: 0, missingCards: 6, fullyOwnedEntries: 0, partiallyOwnedEntries: 0, missingEntries: 6 },
    pricing: { basis: VALUATION_BASES[0], deckValue: 0, deckValueMissingEntries: 6, missingCardsValue: 0 },
    validation: { ok: true, issues: [], warnings: [] },
  } as any
}

// ── Live surface tests ─────────────────────────────────────────

async function main() {
  console.log('=== Phase 3C live suite ===')
  console.log(`Cheap model:      ${process.env.AI_MODEL_CHEAP}`)
  console.log(`Reasoning model:  ${process.env.AI_MODEL_REASONING}`)
  console.log(`Gateway key set:  ${process.env.AI_GATEWAY_API_KEY ? 'yes (redacted)' : 'NO'}\n`)

  const fixture = await seedFixtureDeck()
  if (!fixture) { console.log('Fixture failed'); return }

  const { runAi, extractJson } = await import('../src/lib/ai/run')
  const {
    ANALYSE_SYSTEM, analyseUserPrompt,
    IMPROVE_SYSTEM, improveUserPrompt,
    REPLACE_SYSTEM, replaceUserPrompt,
    BUILD_SYSTEM, buildUserPrompt,
  } = await import('../src/lib/ai/prompts')
  const { verifyImproveResponse, verifyBuildResponse, AnalyseSchema, ReplaceSchema } = await import('../src/lib/ai/grounding')
  const { bindDeckTools, bindBuilderTools } = await import('../src/lib/ai/tools')

  const context = await buildLightContext(fixture.deck, fixture.deckCards)
  const bound = (bindDeckTools as any)(context)

  const results: any[] = []

  function report(label: string, r: any, extras: Record<string, any> = {}) {
    const line = {
      label,
      ok: r.ok,
      model: r.model,
      tokens_in: r.tokensIn,
      tokens_out: r.tokensOut,
      tokens_reasoning: r.tokensReasoning,
      latency_ms: r.latencyMs,
      est_cost_cents: r.estimatedCostCents,
      error_kind: r.errorKind,
      raw_error: r.errorKind ? String(r.text ?? '').slice(0, 160) : undefined,
      ...extras,
    }
    console.log(JSON.stringify(line, null, 2))
    results.push(line)
  }

  // ── 1. ANALYSE ────────────────────────────────────────────
  console.log('\n--- 1. Analyse Deck ---')
  {
    const r = await runAi({ tier: 'cheap', system: ANALYSE_SYSTEM, prompt: analyseUserPrompt(), tools: bound.tools, maxSteps: 6 })
    const json = r.ok ? extractJson(r.text) : null
    const parsed = json ? AnalyseSchema.safeParse(json) : null
    report('analyse', r, {
      schema_valid: parsed?.success ?? false,
      key_cards: parsed?.success ? parsed.data.key_cards.length : null,
      key_cards_authorised: parsed?.success ? parsed.data.key_cards.every((k) => bound.authorised.has(k.oracle_card_id)) : null,
      game_plan_preview: parsed?.success ? parsed.data.game_plan.slice(0, 160) : null,
    })
  }

  // ── 2. IMPROVE (general) ──────────────────────────────────
  console.log('\n--- 2. Improve Deck (general) ---')
  {
    const r = await runAi({ tier: 'reasoning', system: IMPROVE_SYSTEM, prompt: improveUserPrompt('general'), tools: bound.tools, maxSteps: 12 })
    const json = r.ok ? extractJson(r.text) : null
    const verified = json ? await (verifyImproveResponse as any)(json, context, bound.authorised) : null
    report('improve_general', r, {
      grounding_ok: verified?.ok ?? false,
      accepted_suggestions: verified?.ok ? verified.value.suggestions.length : 0,
      rejected_suggestions: verified?.rejected?.length ?? 0,
      first_suggestion: verified?.ok && verified.value.suggestions[0] ? {
        remove: verified.value.suggestions[0].remove_oracle_card_id?.slice(0, 8) ?? null,
        add: verified.value.suggestions[0].add_oracle_card_id.slice(0, 8),
        reason: verified.value.suggestions[0].reason.slice(0, 140),
      } : null,
    })
  }

  // ── 3. IMPROVE (budget) ───────────────────────────────────
  console.log('\n--- 3. Improve Deck (budget) ---')
  {
    const r = await runAi({ tier: 'reasoning', system: IMPROVE_SYSTEM, prompt: improveUserPrompt('budget'), tools: bound.tools, maxSteps: 12 })
    const json = r.ok ? extractJson(r.text) : null
    const verified = json ? await (verifyImproveResponse as any)(json, context, bound.authorised) : null
    report('improve_budget', r, {
      grounding_ok: verified?.ok ?? false,
      accepted_suggestions: verified?.ok ? verified.value.suggestions.length : 0,
    })
  }

  // ── 4. REPLACE ────────────────────────────────────────────
  console.log('\n--- 4. Replace Card ---')
  if (context.main.length > 0) {
    const target = context.main[0].oracle_card_id
    const r = await runAi({ tier: 'cheap', system: REPLACE_SYSTEM, prompt: replaceUserPrompt(target, 'similar'), tools: bound.tools, maxSteps: 6 })
    const json = r.ok ? extractJson(r.text) : null
    const parsed = json ? ReplaceSchema.safeParse(json) : null
    const kept = parsed?.success ? parsed.data.candidates.filter((c) => bound.authorised.has(c.oracle_card_id)) : []
    const rejected = parsed?.success ? parsed.data.candidates.filter((c) => !bound.authorised.has(c.oracle_card_id)) : []
    report('replace_similar', r, {
      schema_valid: parsed?.success ?? false,
      target_uuid: target.slice(0, 8),
      accepted_candidates: kept.length,
      rejected_candidates: rejected.length,
    })
  }

  // ── 5. BUILD (small brief) ────────────────────────────────
  console.log('\n--- 5. Build Deck (small brief) ---')
  {
    // Small brief so we don't overspend. Ask for a simple starter.
    const builder = (bindBuilderTools as any)({
      format: 'commander' as any,
      commanderOracleIds: [context.commanders[0].oracle_card_id],
      includeCollection: false,
      currency: 'USD' as const,
    })
    const brief = 'Simple mono-blue Commander around this legendary creature. Include basic Islands, common ramp, common card draw. Keep the deck under $80 in missing cards.'
    const r = await runAi({
      tier: 'reasoning',
      system: BUILD_SYSTEM,
      prompt: buildUserPrompt({
        format: 'commander', brief,
        commanderName: context.commanders[0].name,
        budgetCurrency: 'USD', budgetMax: 80,
      }),
      tools: builder.tools,
      maxSteps: 20,
      timeoutMs: 120_000,
    })
    const json = r.ok ? extractJson(r.text) : null
    const verified = json ? await (verifyBuildResponse as any)(json, 'commander', builder.authorised) : null
    report('build_small', r, {
      grounding_ok: verified?.ok ?? false,
      grounding_error: verified?.ok ? null : (verified as any)?.error,
      commanders_returned: verified?.ok ? verified.value.commanders.length : null,
      main_returned: verified?.ok ? verified.value.main.length : null,
      distinct_cards_returned: verified?.ok ? new Set(verified.value.main.map((m: any) => m.oracle_card_id)).size : null,
    })
  }

  // ── 6. Grounding negative — invented Oracle ID ────────────
  console.log('\n--- 6. Grounding: invented Oracle ID ---')
  {
    const bogus = {
      summary: 'invented',
      suggestions: [{ remove_oracle_card_id: null, add_oracle_card_id: '00000000-0000-4000-8000-000000000000', quantity: 1, reason: 'invented' }],
    }
    const verified = await (verifyImproveResponse as any)(bogus, context, bound.authorised)
    const pass = verified.ok && verified.value.suggestions.length === 0 && verified.rejected.length === 1
    console.log(JSON.stringify({ label: 'grounding_invented', pass, reason: verified.rejected?.[0]?.reason }, null, 2))
    results.push({ label: 'grounding_invented', pass })
  }

  // ── 7. Grounding negative — illegal card (banned in format) ──
  console.log('\n--- 7. Grounding: illegal card (banned) ---')
  {
    // Find a card banned in commander.
    const { data: banned } = await s.from('mtg_oracle_legalities')
      .select('oracle_card_id')
      .eq('format', 'commander').eq('legality', 'banned').limit(1)
    if (banned?.[0]) {
      // Manually authorise (as if a tool "leaked" it).
      bound.authorised.add(banned[0].oracle_card_id)
      const illegal = {
        summary: 'illegal test',
        suggestions: [{ remove_oracle_card_id: null, add_oracle_card_id: banned[0].oracle_card_id, quantity: 1, reason: 'testing banned' }],
      }
      const verified = await (verifyImproveResponse as any)(illegal, context, bound.authorised)
      const pass = verified.ok && verified.value.suggestions.length === 0 && verified.rejected.some((r: any) => /banned/i.test(r.reason))
      console.log(JSON.stringify({ label: 'grounding_illegal', pass, reason: verified.rejected?.[0]?.reason }, null, 2))
      results.push({ label: 'grounding_illegal', pass })
    }
  }

  // ── 8. Grounding negative — wrong colour identity ─────────
  console.log('\n--- 8. Grounding: wrong colour identity ---')
  {
    // Find a card with a colour outside the commander's identity (blue). Red for example.
    const { data: red } = await s.from('mtg_oracle_cards')
      .select('id').overlaps('color_identity', ['R']).limit(1)
    if (red?.[0]) {
      bound.authorised.add(red[0].id)
      const wrongCI = {
        summary: 'wrong CI',
        suggestions: [{ remove_oracle_card_id: null, add_oracle_card_id: red[0].id, quantity: 1, reason: 'testing CI' }],
      }
      const verified = await (verifyImproveResponse as any)(wrongCI, context, bound.authorised)
      const pass = verified.ok && verified.value.suggestions.length === 0 && verified.rejected.some((r: any) => /identity/i.test(r.reason))
      console.log(JSON.stringify({ label: 'grounding_wrongCI', pass, reason: verified.rejected?.[0]?.reason }, null, 2))
      results.push({ label: 'grounding_wrongCI', pass })
    }
  }

  // ── Totals ────────────────────────────────────────────────
  console.log('\n=== Totals ===')
  const totalTokensIn = results.reduce((n, r) => n + (r.tokens_in ?? 0), 0)
  const totalTokensOut = results.reduce((n, r) => n + (r.tokens_out ?? 0), 0)
  const totalReasoning = results.reduce((n, r) => n + (r.tokens_reasoning ?? 0), 0)
  const totalCents = results.reduce((n, r) => n + (r.est_cost_cents ?? 0), 0)
  console.log(`  Total tokens: in=${totalTokensIn}, out=${totalTokensOut}, reasoning=${totalReasoning}`)
  console.log(`  Total est cost: $${(totalCents / 100).toFixed(3)}`)
  console.log(`  Total latency: ${results.reduce((n, r) => n + (r.latency_ms ?? 0), 0)}ms`)

  await cleanup(fixture.userId)
  console.log('\n(cleanup done)')
  process.exit(0)
}

main().catch((err) => { console.error(err); process.exit(1) })
