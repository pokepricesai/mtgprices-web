// scripts/phase3c-improve-slim.ts
// Live test: Improve Deck after token-trim changes. Same fixture shape
// as prior retry runs so cost/tokens are directly comparable.

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

async function seedFixture() {
  const email = `mtg-improve-slim-${Date.now()}@example.com`
  const { data: userData } = await s.auth.admin.createUser({ email, password: 'DontUse1234!', email_confirm: true })
  const userId = userData.user!.id
  const { data: legendary } = await s.from('mtg_oracle_cards')
    .select('id, name')
    .ilike('type_line', '%legendary%creature%')
    .overlaps('colors', ['U']).containedBy('color_identity', ['U'])
    .not('capabilities', 'is', null).limit(1)
  const { data: bluecards } = await s.from('mtg_oracle_cards')
    .select('id, name')
    .overlaps('colors', ['U']).containedBy('color_identity', ['U'])
    .not('type_line', 'ilike', '%land%').neq('id', legendary![0].id).limit(15)
  const { data: deck } = await s.from('mtg_decks').insert({
    user_id: userId, name: 'Improve-slim', format: 'commander',
  }).select().single()
  const inserts = [
    { deck_id: deck.id, oracle_card_id: legendary![0].id, quantity: 1, zone: 'commander' as const },
    ...bluecards!.map((b: any) => ({ deck_id: deck.id, oracle_card_id: b.id, quantity: 1, zone: 'main' as const })),
  ]
  await s.from('mtg_deck_cards').insert(inserts)
  const { data: dc } = await s.from('mtg_deck_cards').select('*').eq('deck_id', deck.id)
  return { userId, deck, deckCards: dc ?? [] }
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
      legality: 'legal', preferredPrinting: null,
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
    curve: [0, 0, 0, 0, 0, 0, 0, 0],
    colorIdentity: cardCtx.filter((c) => c.zone === 'commander').flatMap((c) => c.color_identity),
    typeBreakdown: {}, capabilityBreakdown: {},
    ownership: { ownedCards: 0, missingCards: cardCtx.length, fullyOwnedEntries: 0, partiallyOwnedEntries: 0, missingEntries: cardCtx.length },
    pricing: { basis: VALUATION_BASES[0], deckValue: 0, deckValueMissingEntries: cardCtx.length, missingCardsValue: 0 },
    validation,
  } as any
}

async function runImprove(context: any, goal: 'general' | 'budget') {
  const { runAi, extractJson } = await import('../src/lib/ai/run')
  const { IMPROVE_SYSTEM, improveUserPrompt } = await import('../src/lib/ai/prompts')
  const { verifyImproveResponse } = await import('../src/lib/ai/grounding')
  const { bindDeckTools } = await import('../src/lib/ai/tools')
  const bound = (bindDeckTools as any)(context)
  const r = await runAi({
    tier: 'reasoning',
    system: IMPROVE_SYSTEM,
    prompt: improveUserPrompt(goal),
    tools: bound.tools,
    maxSteps: 5,
    timeoutMs: 90_000,
  })
  const json = r.ok ? extractJson(r.text) : null
  const verified = json ? await (verifyImproveResponse as any)(json, context, bound.authorised) : null
  console.log(`  ${goal.padEnd(8)}  ok=${r.ok}  in=${r.tokensIn.toString().padStart(6)} out=${r.tokensOut.toString().padStart(5)}  ${r.latencyMs}ms  $${(r.estimatedCostCents/100).toFixed(3)}  suggestions=${verified?.ok ? verified.value.suggestions.length : ((verified as any)?.error ?? 'n/a')}`)
  if (verified?.ok) {
    const ids: string[] = []
    for (const sug of verified.value.suggestions) {
      if (sug.add_oracle_card_id) ids.push(sug.add_oracle_card_id)
      if (sug.remove_oracle_card_id) ids.push(sug.remove_oracle_card_id)
    }
    const { data: names } = await s.from('mtg_oracle_cards').select('id, name').in('id', ids)
    const byId = new Map((names ?? []).map((n: any) => [n.id, n.name]))
    for (const sug of verified.value.suggestions.slice(0, 3)) {
      const add = byId.get(sug.add_oracle_card_id) ?? sug.add_oracle_card_id.slice(0, 8)
      const rem = sug.remove_oracle_card_id ? (byId.get(sug.remove_oracle_card_id) ?? sug.remove_oracle_card_id.slice(0, 8)) : '(ADD)'
      console.log(`      + ${add} — ${sug.remove_oracle_card_id ? `swap out ${rem}` : 'add'}  ${sug.reason?.slice(0, 90)}`)
    }
  }
}

async function main() {
  console.log('=== Phase 3C: Improve after token-trim ===\n')
  const fx = await seedFixture()
  console.log(`Seeded 15 blues + commander\n`)
  const context = await buildLightContext(fx.deck, fx.deckCards)
  await runImprove(context, 'general')
  await runImprove(context, 'budget')
  console.log(`\nBaseline (before trim, same fixture shape):`)
  console.log('  general   in=86,507 out=4,584  81.8s $0.330')
  console.log('  budget    in=23,006 out=2,259  39.4s $0.100')
  process.exit(0)
}
main().catch((err) => { console.error(err); process.exit(1) })
