#!/usr/bin/env node
// scripts/ygo-rule-delta.mjs
//
// Read-only: quantify how many additional cards/rows are re-labelled
// under the broader "any card with >1 printing is card-scoped" rule
// versus the previous "multi-printing AND at least one edition variant"
// rule.

import { loadEnv, requireEnv, getSupabase } from '../src/lib/tcggraph/ingest-core.mjs'
loadEnv(); requireEnv('SUPABASE_SERVICE_ROLE_KEY')
const sb = getSupabase()

// Pull all YGO printings.
const printsByCard = new Map()
for (let offset = 0; ; offset += 1000) {
  const { data } = await sb.from('tcg_printings')
    .select('tcg_card_id, tcggraph_printing_key, edition, finish')
    .eq('game_id', 'ygo').range(offset, offset + 999)
  if (!data || data.length === 0) break
  for (const p of data) {
    if (!p.tcg_card_id) continue
    const arr = printsByCard.get(p.tcg_card_id) ?? []
    arr.push(p)
    printsByCard.set(p.tcg_card_id, arr)
  }
  if (data.length < 1000) break
}
const totalCards = printsByCard.size
const singlePrinting = []
const multiEditionRule = new Set()   // >1 AND at least one edition variant
const multiAnyRule    = new Set()   // >1 printing
for (const [cid, arr] of Array.from(printsByCard.entries())) {
  if (arr.length === 1) singlePrinting.push(cid)
  else {
    multiAnyRule.add(cid)
    if (arr.some((r) => r.edition != null)) multiEditionRule.add(cid)
  }
}
const deltaCards = Array.from(multiAnyRule).filter((c) => !multiEditionRule.has(c))
console.log(`YGO cards total: ${totalCards}`)
console.log(`  single-printing:        ${singlePrinting.length}`)
console.log(`  multi (edition rule):   ${multiEditionRule.size}`)
console.log(`  multi (any rule):       ${multiAnyRule.size}`)
console.log(`  DELTA cards (any-rule but NOT edition-rule): ${deltaCards.length}`)

// Sample the printing-key patterns in the delta so we can eyeball
// what these cards look like.
const patternHist = new Map()
for (const cid of deltaCards) {
  const keys = printsByCard.get(cid).map((r) => r.tcggraph_printing_key).sort().join('+')
  patternHist.set(keys, (patternHist.get(keys) || 0) + 1)
}
console.log('\nDelta-card printing-key patterns (top 10):')
Array.from(patternHist.entries()).sort((a, b) => b[1] - a[1]).slice(0, 10)
  .forEach(([pattern, n]) => console.log(`  ${n.toString().padStart(6)}  ${pattern}`))

// Sample-hydrate a few names.
console.log('\nDelta-card samples (first 8):')
const sampleIds = deltaCards.slice(0, 8)
if (sampleIds.length > 0) {
  const { data } = await sb.from('tcg_cards').select('id, name, set_id, collector_number').in('id', sampleIds)
  for (const c of data ?? []) {
    const arr = printsByCard.get(c.id)
    const keys = arr.map((r) => r.tcggraph_printing_key).sort().join(', ')
    console.log(`  ${c.set_id} ${c.collector_number} "${c.name}"  printings=[${keys}]`)
  }
}

// Row-level delta: pre-migration, tcg_card_id column may not yet
// exist and graded rows are attached to a single anchor printing per
// card. Reconstruct card membership via tcg_printings:
//   delta printings := every printing whose card is in deltaSet
//   delta rows      := graded rows for those printings
const deltaSet = new Set(deltaCards)
const deltaPrintingIds = new Set()
for (const cid of deltaCards) {
  const arr = printsByCard.get(cid) ?? []
  for (const p of arr) {
    // Reconstruct the tcg_printings.id. We already know the printing
    // key, but we selected minimal columns above. Refetch card->prints
    // via a scoped id lookup would be an extra round-trip; instead we
    // pull ids inline below.
  }
}
// Faster: query tcg_printings.id for every delta card in chunks.
const deltaCardIdChunks = []
{
  const arr = Array.from(deltaCards)
  for (let i = 0; i < arr.length; i += 200) deltaCardIdChunks.push(arr.slice(i, i + 200))
}
for (const slice of deltaCardIdChunks) {
  const { data } = await sb.from('tcg_printings').select('id').eq('game_id', 'ygo').in('tcg_card_id', slice)
  for (const r of data ?? []) deltaPrintingIds.add(r.id)
}
console.log(`\nRow-level delta:`)
console.log(`  delta printings identified: ${deltaPrintingIds.size}`)

const deltaPidArr = Array.from(deltaPrintingIds)
let currentDeltaRows = 0
for (let i = 0; i < deltaPidArr.length; i += 200) {
  const slice = deltaPidArr.slice(i, i + 200)
  const { count } = await sb.from('tcg_graded_prices_current')
    .select('*', { count: 'exact', head: true })
    .eq('game_id', 'ygo').in('tcg_printing_id', slice)
  currentDeltaRows += count ?? 0
}
console.log(`  additional current rows moving to attribution=card: ${currentDeltaRows}`)

let dailyDeltaRows = 0
for (let i = 0; i < deltaPidArr.length; i += 200) {
  const slice = deltaPidArr.slice(i, i + 200)
  const { count } = await sb.from('tcg_graded_price_daily')
    .select('*', { count: 'exact', head: true })
    .eq('game_id', 'ygo').in('tcg_printing_id', slice)
  dailyDeltaRows += count ?? 0
}
console.log(`  additional daily rows moving to attribution=card:   ${dailyDeltaRows}`)
