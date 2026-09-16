// scripts/phase3c-live-test.ts
// Bypasses the HTTP layer to exercise the AI runner + grounding + tools
// end-to-end against a real deck. Run as:
//
//   npx tsx scripts/phase3c-live-test.ts
//
// Loads .env.local. Uses the FIRST deck belonging to any user (via
// service-role) so we don't need a Supabase Auth session. Reports
// tokens, latency, grounding rejections and validator outcome. This
// is a manual smoke test — CI should NOT depend on live model calls.

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
// Shim the `server-only` package so tsx can import modules that
// guard against client-side use.
const soPath = require.resolve('server-only')
require.cache[soPath] = { id: soPath, filename: soPath, loaded: true, exports: {}, children: [], paths: [], parent: null, path: soPath, isPreloading: false, require } as any

const { createClient } = require('@supabase/supabase-js')

async function main() {
  console.log('=== Phase 3C live model smoke ===\n')
  console.log(`Model cheap:      ${process.env.AI_MODEL_CHEAP}`)
  console.log(`Model reasoning:  ${process.env.AI_MODEL_REASONING}`)
  console.log(`Gateway key set:  ${process.env.AI_GATEWAY_API_KEY ? 'yes' : 'NO — will fail'}\n`)

  const s = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  })

  // Ensure at least one deck exists. If not, create a synthetic
  // Commander deck for a test user + 6 real cards, then clean up after.
  let deck: any = null
  let deckCards: any[] = []
  let syntheticUser: any = null

  const { data: decks } = await s.from('mtg_decks').select('*').limit(1)
  if (decks && decks.length > 0) {
    deck = decks[0]
    const { data: cards } = await s.from('mtg_deck_cards').select('*').eq('deck_id', deck.id)
    deckCards = cards ?? []
    console.log(`Using existing deck: "${deck.name}" (${deck.format}, id=${deck.id})\n`)
  } else {
    console.log('No decks yet — creating a synthetic Commander deck for the live test.')
    const email = `mtg-3c-test-${Date.now()}@example.com`
    const { data: userData, error: uErr } = await s.auth.admin.createUser({ email, password: 'DontUseAlso1234!', email_confirm: true })
    if (uErr || !userData.user) throw new Error('createUser: ' + uErr?.message)
    syntheticUser = userData.user
    const { data: newDeck, error: dErr } = await s.from('mtg_decks').insert({
      user_id: syntheticUser.id, name: 'Phase 3C test deck', format: 'commander',
    }).select().single()
    if (dErr) throw new Error('createDeck: ' + dErr.message)
    deck = newDeck
    // Seed 6 real cards (a legendary creature + 5 non-legendary creatures)
    // — enough for DeckContext + AI to work with.
    const { data: legendary } = await s.from('mtg_oracle_cards')
      .select('id, name, type_line, color_identity')
      .ilike('type_line', '%legendary%creature%')
      .limit(1)
    const { data: creatures } = await s.from('mtg_oracle_cards')
      .select('id, name, type_line')
      .ilike('type_line', '%creature%')
      .not('type_line', 'ilike', '%legendary%')
      .limit(5)
    const rows: any[] = []
    if (legendary?.[0]) rows.push({ deck_id: deck.id, oracle_card_id: legendary[0].id, quantity: 1, zone: 'commander' })
    for (const c of creatures ?? []) rows.push({ deck_id: deck.id, oracle_card_id: c.id, quantity: 1, zone: 'main' })
    if (rows.length > 0) await s.from('mtg_deck_cards').insert(rows)
    const { data: cards } = await s.from('mtg_deck_cards').select('*').eq('deck_id', deck.id)
    deckCards = cards ?? []
    console.log(`Created synthetic deck ${deck.id} with ${deckCards.length} cards.\n`)
  }
  console.log(`Deck has ${(deckCards ?? []).length} card entries.\n`)

  // Build a minimal DeckContext without calling the Next-request-
  // scoped helpers. Hydrate oracle metadata via service role.
  const { runAi, extractJson } = await import('../src/lib/ai/run')
  const { ANALYSE_SYSTEM, analyseUserPrompt, IMPROVE_SYSTEM, improveUserPrompt } = await import('../src/lib/ai/prompts')
  const { verifyImproveResponse, AnalyseSchema } = await import('../src/lib/ai/grounding')
  const { bindDeckTools } = await import('../src/lib/ai/tools')
  const { VALUATION_BASES } = await import('../src/lib/mtg/valuation.data')

  const oracleIds = Array.from(new Set(deckCards.map((c) => c.oracle_card_id)))
  const { data: oracles } = await s.from('mtg_oracle_cards').select('id, name, mana_cost, mana_value, type_line, oracle_text, colors, color_identity, keywords, capabilities, layout').in('id', oracleIds)
  const byId = new Map((oracles ?? []).map((o: any) => [o.id, o]))
  const cardCtx = deckCards.map((c) => {
    const o = byId.get(c.oracle_card_id) as any ?? {}
    return {
      deck_card_id: c.id, oracle_card_id: c.oracle_card_id,
      name: o.name ?? '(unknown)', quantity: c.quantity, zone: c.zone,
      mana_cost: o.mana_cost ?? null, mana_value: o.mana_value ?? null,
      colors: o.colors ?? [], color_identity: o.color_identity ?? [],
      type_line: o.type_line ?? null, types: [],
      keywords: o.keywords ?? [], capabilities: o.capabilities ?? [],
      oracle_text: o.oracle_text ?? null, layout: o.layout ?? null,
      legality: 'legal',
      preferredPrinting: null,
      owned: { ownedQuantityAcrossPrintings: 0, ownedThisPrinting: 0, printings: [] },
      currentPrice: null,
    }
  })
  const context: any = {
    deck: {
      id: deck.id, name: deck.name, format: deck.format,
      description: deck.description, createdAt: deck.created_at, updatedAt: deck.updated_at,
    },
    commanders: cardCtx.filter((c) => c.zone === 'commander'),
    main: cardCtx.filter((c) => c.zone === 'main'),
    sideboard: [], companion: [], maybeboard: [],
    totals: { main: cardCtx.filter((c) => c.zone === 'main').length, sideboard: 0, commander: cardCtx.filter((c) => c.zone === 'commander').length, companion: 0, maybeboard: 0 },
    curve: [0, 0, 0, 0, 0, 0, 0, 0], colorIdentity: [],
    typeBreakdown: {}, capabilityBreakdown: {},
    ownership: { ownedCards: 0, missingCards: 6, fullyOwnedEntries: 0, partiallyOwnedEntries: 0, missingEntries: 6 },
    pricing: { basis: VALUATION_BASES[0], deckValue: 0, deckValueMissingEntries: 6, missingCardsValue: 0 },
    validation: { ok: true, issues: [], warnings: [] },
  }
  const bound = (bindDeckTools as any)(context)

  console.log('--- ANALYSE ---')
  const t0 = performance.now()
  const analyseRes = await runAi({
    tier: 'cheap',
    system: ANALYSE_SYSTEM,
    prompt: analyseUserPrompt(),
    tools: bound.tools,
    maxSteps: 6,
  })
  console.log(`  ok=${analyseRes.ok}  latency=${Math.round(performance.now() - t0)}ms`)
  console.log(`  tokens: in=${analyseRes.tokensIn}, out=${analyseRes.tokensOut}, reasoning=${analyseRes.tokensReasoning}`)
  console.log(`  est cost: ${(analyseRes.estimatedCostCents / 100).toFixed(4)} USD`)
  if (analyseRes.errorKind) console.log(`  errorKind=${analyseRes.errorKind} raw=${analyseRes.text.slice(0, 300)}`)
  if (analyseRes.ok) {
    const json = extractJson(analyseRes.text)
    const parsed = json ? AnalyseSchema.safeParse(json) : { success: false as const }
    console.log(`  schema-parsed=${parsed.success}`)
    if (parsed.success) {
      console.log(`  key_cards=${parsed.data.key_cards.length}  game_plan=${parsed.data.game_plan.slice(0, 100)}…`)
    }
  }

  console.log('\n--- IMPROVE ---')
  const t1 = performance.now()
  const improveRes = await runAi({
    tier: 'reasoning',
    system: IMPROVE_SYSTEM,
    prompt: improveUserPrompt('general'),
    tools: bound.tools,
    maxSteps: 10,
  })
  console.log(`  ok=${improveRes.ok}  latency=${Math.round(performance.now() - t1)}ms`)
  console.log(`  tokens: in=${improveRes.tokensIn}, out=${improveRes.tokensOut}, reasoning=${improveRes.tokensReasoning}`)
  console.log(`  est cost: ${(improveRes.estimatedCostCents / 100).toFixed(4)} USD`)
  if (improveRes.errorKind) console.log(`  errorKind=${improveRes.errorKind} raw=${improveRes.text.slice(0, 300)}`)
  if (improveRes.ok) {
    const json = extractJson(improveRes.text)
    const verified = json ? await (verifyImproveResponse as any)(json, context, bound.authorised) : null
    console.log(`  grounding: ok=${verified?.ok}`)
    if (verified?.ok) {
      console.log(`  suggestions kept=${verified.value.suggestions.length}, rejected=${verified.rejected.length}`)
      for (const s of verified.value.suggestions.slice(0, 3)) {
        console.log(`    - remove=${s.remove_oracle_card_id?.slice(0, 8) ?? 'null'} → add=${s.add_oracle_card_id.slice(0, 8)} × ${s.quantity}`)
        console.log(`      "${s.reason.slice(0, 100)}"`)
      }
    }
  }

  console.log('\n--- GROUNDING NEGATIVE — invented Oracle ID must be rejected ---')
  // Simulate the model emitting a random UUID that was never authorised.
  const bogusPayload = {
    summary: 'Testing',
    suggestions: [{
      remove_oracle_card_id: null,
      add_oracle_card_id: '00000000-0000-4000-8000-000000000000',
      quantity: 1,
      reason: 'invented',
    }],
  }
  const verifyRes = await (verifyImproveResponse as any)(bogusPayload, context, bound.authorised)
  const rejected = verifyRes.ok ? verifyRes.rejected : []
  console.log(`  invented ID rejected: ${verifyRes.ok && rejected.length === 1 && verifyRes.value.suggestions.length === 0 ? 'PASS' : 'FAIL'}`)
  if (rejected.length > 0) console.log(`  reason: ${rejected[0].reason}`)

  // Cleanup if we created a synthetic deck+user.
  if (syntheticUser) {
    await s.from('mtg_decks').delete().eq('id', deck.id)
    await s.auth.admin.deleteUser(syntheticUser.id)
    console.log('\nCleaned up synthetic user + deck.')
  }

  console.log('\n=== done ===')
  process.exit(0)
}

main().catch((err) => { console.error(err); process.exit(1) })
