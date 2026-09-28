// scripts/audit-unmapped-count-reconcile.mjs
// Definitive count of unmapped MTG tcg_printings with each of three
// definitional filters so we can explain the 137 vs 134 delta.
//
// Run with: node --env-file=.env.local scripts/audit-unmapped-count-reconcile.mjs

import { createClient } from '@supabase/supabase-js'

const sb = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { persistSession: false } },
)

// A. Widest definition: any tcg_printings (mtg) row with no mtg mapping.
const { data: A } = await sb
  .from('tcg_printings')
  .select('id, set_id')
  .eq('game_id', 'mtg')
  .is('mtg_printings_id', null)
  .limit(10000)
console.log(`A. All mtg tcg_printings with mtg_printings_id IS NULL: ${A?.length ?? 0}`)

// B. Filter to only those that have a current market price row.
const idsA = (A ?? []).map((r) => r.id)
const withMarketA = new Set()
const BATCH = 200
for (let i = 0; i < idsA.length; i += BATCH) {
  const slice = idsA.slice(i, i + BATCH)
  const { data: mkt } = await sb
    .from('tcg_market_prices_current')
    .select('tcg_printing_id')
    .eq('game_id', 'mtg')
    .in('tcg_printing_id', slice)
  for (const r of mkt ?? []) withMarketA.add(r.tcg_printing_id)
}
console.log(`B. Unmapped with any tcg_market_prices_current row (any currency): ${withMarketA.size}`)

// C. USD only (the ranking-relevant slice).
const withMarketUsd = new Set()
for (let i = 0; i < idsA.length; i += BATCH) {
  const slice = idsA.slice(i, i + BATCH)
  const { data: mkt } = await sb
    .from('tcg_market_prices_current')
    .select('tcg_printing_id')
    .eq('game_id', 'mtg')
    .eq('currency', 'USD')
    .in('tcg_printing_id', slice)
  for (const r of mkt ?? []) withMarketUsd.add(r.tcg_printing_id)
}
console.log(`C. Unmapped with a USD current market row: ${withMarketUsd.size}`)

// Delta breakdown by set_id
const setById = new Map()
for (const r of A ?? []) setById.set(r.id, r.set_id)
const inBnotC = new Set([...withMarketA].filter((id) => !withMarketUsd.has(id)))
console.log(`\nRows in B but not C (non-USD only): ${inBnotC.size}`)
if (inBnotC.size > 0) {
  const bySet = new Map()
  for (const id of inBnotC) {
    const s = setById.get(id) ?? 'unknown'
    bySet.set(s, (bySet.get(s) ?? 0) + 1)
  }
  for (const [s, n] of [...bySet.entries()].sort((a, b) => b[1] - a[1])) {
    console.log(`  ${s}: ${n}`)
  }
}
