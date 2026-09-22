#!/usr/bin/env node
// scripts/ygo-post-ingest-verify.mjs
//
// Read-only. Runs AFTER A2 + YGO re-ingest. Confirms:
//   1. No stale current-graded rows survived. Every YGO row in
//      tcg_graded_prices_current lives on a "canonical" printing that
//      the current ingest logic would produce for its card:
//        * for card-scoped rows: anchor prefers 1st-edition, then
//          normal, then unlimited, then any deterministic first key
//        * for printing-scoped rows: the printing_id must be the only
//          printing of that card (single-printing card rule)
//   2. Sample cards match expected attribution:
//        * LOB-001 Blue-Eyes White Dragon        (1st+normal → card)
//        * LOB-070 Red-Eyes Black Dragon         (1st+normal → card)
//        * DB1-EN249 Earthbound Spirit           (foil+normal → card)
//        * one single-printing YGO card          (→ printing)
//
// Exit 0 = green, 1 = regression. Prints structured findings.

import { loadEnv, requireEnv, getSupabase } from '../src/lib/tcggraph/ingest-core.mjs'
loadEnv(); requireEnv('SUPABASE_SERVICE_ROLE_KEY')

const sb = getSupabase()
const failures = []
function ok(label, meta = {}) { console.log(`  ✓ ${label}`, meta) }
function fail(label, meta = {}) { failures.push({ label, ...meta }); console.log(`  ✗ ${label}`, meta) }

// ---------- 1. Pull every YGO printing so we can compute canonical anchors ----------
const printsByCard = new Map()
for (let offset = 0; ; offset += 1000) {
  const { data, error } = await sb.from('tcg_printings')
    .select('id, tcg_card_id, tcggraph_printing_key, finish, edition')
    .eq('game_id', 'ygo').range(offset, offset + 999)
  if (error) throw new Error(error.message)
  if (!data || data.length === 0) break
  for (const p of data) {
    if (!p.tcg_card_id) continue
    const arr = printsByCard.get(p.tcg_card_id) ?? []
    arr.push(p)
    printsByCard.set(p.tcg_card_id, arr)
  }
  if (data.length < 1000) break
}
console.log(`\n[verify] YGO cards materialised: ${printsByCard.size}`)

// canonicalAnchorFor: mirrors resolveGradedAttribution() choice.
function canonicalAnchorFor(prints) {
  // prints is Array of {id, tcggraph_printing_key, ...}
  const byKey = new Map(prints.map((p) => [p.tcggraph_printing_key, p]))
  if (byKey.has('1st-edition')) return byKey.get('1st-edition').id
  if (byKey.has('normal'))       return byKey.get('normal').id
  if (byKey.has('unlimited'))    return byKey.get('unlimited').id
  return prints[0].id
}

// ---------- 2. Stale-row scan on tcg_graded_prices_current ----------
console.log('\n[verify] stale-row scan on tcg_graded_prices_current (game_id=ygo):')

const seenCardIds = new Set()
const staleRows = []      // rows on a non-canonical printing (for card-scoped)
const misAttributedRows = []   // wrong attribution given card family
const orphanRows  = []    // rows whose printing has no card link
const singlePrintingCardIds = new Set()
const multiPrintingCardIds  = new Set()

for (const [cid, arr] of Array.from(printsByCard.entries())) {
  if (arr.length === 1) singlePrintingCardIds.add(cid)
  else                  multiPrintingCardIds.add(cid)
}

const canonicalByCard = new Map()
for (const [cid, arr] of Array.from(printsByCard.entries())) {
  canonicalByCard.set(cid, canonicalAnchorFor(arr))
}

let totalCurrentRows = 0
let cardScopedCount = 0
let printingScopedCount = 0
for (let offset = 0; ; offset += 1000) {
  const { data, error } = await sb.from('tcg_graded_prices_current')
    .select('tcg_printing_id, tcg_card_id, attribution, grader, grade')
    .eq('game_id', 'ygo').range(offset, offset + 999)
  if (error) throw new Error(error.message)
  if (!data || data.length === 0) break
  for (const r of data) {
    totalCurrentRows++
    seenCardIds.add(r.tcg_card_id)
    if (!r.tcg_card_id) { orphanRows.push(r); continue }
    const arr = printsByCard.get(r.tcg_card_id)
    if (!arr) { orphanRows.push(r); continue }
    if (arr.length > 1) {
      cardScopedCount++
      if (r.attribution !== 'card') misAttributedRows.push({ ...r, expected: 'card' })
      const canonical = canonicalByCard.get(r.tcg_card_id)
      if (r.tcg_printing_id !== canonical) staleRows.push({ ...r, expected_anchor: canonical })
    } else {
      printingScopedCount++
      if (r.attribution !== 'printing') misAttributedRows.push({ ...r, expected: 'printing' })
      //  For single-printing cards, the only valid printing_id is that
      //  card's sole printing.
      const only = arr[0].id
      if (r.tcg_printing_id !== only) staleRows.push({ ...r, expected_anchor: only })
    }
  }
  if (data.length < 1000) break
}
console.log(`  total YGO current graded rows: ${totalCurrentRows}`)
console.log(`  card-scoped:                  ${cardScopedCount}`)
console.log(`  printing-scoped:              ${printingScopedCount}`)

if (staleRows.length === 0) ok('no stale rows detected (every row is on its canonical anchor)', {})
else fail(`${staleRows.length} stale current rows detected (wrong anchor for their card)`, { sample: staleRows.slice(0, 5) })
if (misAttributedRows.length === 0) ok('no attribution mismatches vs card-family rule')
else fail(`${misAttributedRows.length} attribution mismatches`, { sample: misAttributedRows.slice(0, 5) })
if (orphanRows.length === 0) ok('no orphan rows (every current row joins to a known printing)')
else fail(`${orphanRows.length} orphan rows`, { sample: orphanRows.slice(0, 5) })

// ---------- 3. Named sample cards ----------
async function inspectCard(label, cardKey) {
  console.log(`\n[verify] ${label}: ${cardKey}`)
  const { data: cards, error: cErr } = await sb.from('tcg_cards')
    .select('id, name, set_id, collector_number').eq('id', cardKey).limit(1)
  if (cErr) { fail(`${label}: lookup failed`, { err: cErr.message }); return }
  if (!cards || cards.length === 0) { fail(`${label}: card not found in tcg_cards`); return }
  const card = cards[0]
  const arr = printsByCard.get(card.id) ?? []
  console.log(`  card: "${card.name}" ${card.set_id} ${card.collector_number}  printings=${arr.length}`)
  for (const p of arr) console.log(`    printing key='${p.tcggraph_printing_key}' finish=${p.finish} edition=${p.edition} id=${p.id}`)
  const { data: g } = await sb.from('tcg_graded_prices_current')
    .select('tcg_printing_id, grader, grade, currency, price, attribution, tcg_card_id')
    .eq('tcg_card_id', card.id).order('grader').order('grade')
  console.log(`  graded rows: ${g?.length ?? 0}`)
  for (const row of g ?? []) console.log(`    ${row.attribution.padEnd(8)} ${row.grader.padEnd(5)} ${row.grade.padEnd(9)} ${row.currency} ${row.price}  on ${row.tcg_printing_id}`)
  if (arr.length > 1) {
    const expected = canonicalByCard.get(card.id)
    const bad = (g ?? []).filter((r) => r.attribution !== 'card' || r.tcg_printing_id !== expected)
    if (bad.length === 0) ok(`${label}: all graded rows are card-scoped on the canonical anchor`)
    else fail(`${label}: ${bad.length} rows not card-scoped or off-anchor`, { expected, sample: bad.slice(0, 3) })
  } else if (arr.length === 1) {
    const bad = (g ?? []).filter((r) => r.attribution !== 'printing' || r.tcg_printing_id !== arr[0].id)
    if (bad.length === 0) ok(`${label}: all graded rows are printing-scoped on the sole printing`)
    else fail(`${label}: ${bad.length} rows not printing-scoped or off-anchor`, { sample: bad.slice(0, 3) })
  }
}

await inspectCard('LOB-001 Blue-Eyes White Dragon (1st+normal)', 'ygo:card:ygo_lob_001')
await inspectCard('LOB-070 Red-Eyes Black Dragon (1st+normal)', 'ygo:card:ygo_lob_070')
await inspectCard('DB1-EN249 Earthbound Spirit (foil+normal)', 'ygo:card:ygo_db1_en249')

// Pick a genuinely single-printing YGO card that has graded rows.
async function findSinglePrintingYgoCardWithGraded() {
  //  Iterate single-printing cards, check for graded presence, return
  //  first hit.
  for (const cid of Array.from(singlePrintingCardIds)) {
    const { count } = await sb.from('tcg_graded_prices_current')
      .select('*', { count: 'exact', head: true })
      .eq('tcg_card_id', cid).limit(1)
    if ((count ?? 0) > 0) return cid
  }
  return null
}
const singleCid = await findSinglePrintingYgoCardWithGraded()
if (singleCid) await inspectCard('single-printing YGO card with graded (expected printing-scoped)', singleCid)
else console.log('\n[verify] no single-printing YGO card carries a graded row (skipped)')

// ---------- Result ----------
console.log('')
if (failures.length === 0) {
  console.log('[verify] GREEN. Post-ingest state is consistent.')
  process.exit(0)
} else {
  console.error('[verify] FAILURES:')
  for (const f of failures) console.error(' -', JSON.stringify(f).slice(0, 400))
  process.exit(1)
}
