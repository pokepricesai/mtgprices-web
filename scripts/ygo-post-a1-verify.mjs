#!/usr/bin/env node
// scripts/ygo-post-a1-verify.mjs
//
// Runs after A1 has been applied. Exit code 0 = green, 1 = regression
// detected. Prints a small structured report. Read-only against prod
// state; the only writes attempted are intentional CHECK-constraint
// probes that MUST fail, and any accidental leak is cleaned up by the
// exact composite key immediately.

import { loadEnv, requireEnv, getSupabase } from '../src/lib/tcggraph/ingest-core.mjs'
loadEnv(); requireEnv('SUPABASE_SERVICE_ROLE_KEY')

const sb = getSupabase()
const failures = []
function ok(label, meta = {}) { console.log(`  ✓ ${label}`, meta) }
function fail(label, meta = {}) { failures.push({ label, ...meta }); console.log(`  ✗ ${label}`, meta) }

// -- 0. Baseline: prove we can reach each table at all -----------------
// If this fails, our creds/URL are wrong and every downstream check
// would produce a misleading verdict.
console.log('\n[verify] baseline connectivity:')
for (const table of ['tcg_graded_prices_current', 'tcg_graded_price_daily', 'tcg_printings']) {
  const probe = await sb.from(table).select('*', { head: true, count: 'exact' }).limit(1)
  if (probe.error) fail(`${table}: table reachable`, { err: probe.error.message })
  else ok(`${table}: table reachable`, { rowCount: probe.count ?? null })
}

// -- 1. New columns exist ---------------------------------------------
// Two independent probes: (a) SELECT the columns; (b) filter on them.
// (b) is the definitive test since PostgREST caches column names on
// startup - only server-side Postgres refuses to filter on a truly
// missing column. Any error here means A1 was NOT applied (or was
// rolled back), because the raw Postgres error "column ... does not
// exist" comes from the server, not from the schema cache.
console.log('\n[verify] new columns are queryable and known to server:')
for (const table of ['tcg_graded_prices_current', 'tcg_graded_price_daily']) {
  const selProbe = await sb.from(table).select('attribution, tcg_card_id', { head: true, count: 'exact' }).limit(1)
  if (selProbe.error) fail(`${table}: SELECT attribution, tcg_card_id`, { err: selProbe.error.message, code: selProbe.error.code })
  else ok(`${table}: SELECT attribution, tcg_card_id`, { rowCount: selProbe.count ?? null })
  const filtProbe = await sb.from(table).select('*', { head: true, count: 'exact' }).eq('attribution', 'printing').limit(1)
  if (filtProbe.error) fail(`${table}: WHERE attribution='printing' works`, { err: filtProbe.error.message, code: filtProbe.error.code })
  else ok(`${table}: WHERE attribution='printing' works`, { rowCount: filtProbe.count ?? null })
}

// -- 2. CHECK constraint is enforced -----------------------------------
// Strategy: pick a real existing tcg_printings row so the FK is
// satisfied, then attempt an insert with attribution='card' and
// tcg_card_id=null. If the CHECK is live, the insert is rejected
// with a check_violation. To avoid touching real (grader, grade)
// data we use sentinel values ('__check_probe__' / '__check_probe__').
// Any accidental leak is deleted by that exact composite key.
console.log('\n[verify] CHECK constraints reject attribution=card with NULL tcg_card_id:')
const { data: anchorPrints } = await sb
  .from('tcg_printings').select('id, game_id').eq('game_id', 'ygo').limit(1)
const anchor = anchorPrints?.[0] ?? null
if (!anchor) {
  fail('no ygo tcg_printings row available to anchor the CHECK probe')
} else {
  for (const table of ['tcg_graded_prices_current', 'tcg_graded_price_daily']) {
    const row = {
      tcg_printing_id: anchor.id,
      game_id: anchor.game_id,
      grader: '__check_probe__',
      grade:  '__check_probe__',
      currency: 'USD',
      price: 0.01,
      attribution: 'card',
      tcg_card_id: null,
      ...(table === 'tcg_graded_price_daily' ? { observed_on: '1970-01-01' } : {}),
    }
    const ins = await sb.from(table).insert(row)
    if (ins.error && /check/i.test(ins.error.message)) {
      ok(`${table}: CHECK rejects the invalid row`, { code: ins.error.code })
    } else if (ins.error) {
      //  Some other error (FK, NOT NULL on observed_on, etc.). Report it
      //  but do not treat as pass, because we did not prove the CHECK.
      fail(`${table}: probe insert failed for a non-CHECK reason`, { err: ins.error.message, code: ins.error.code })
    } else {
      fail(`${table}: CHECK missing - invalid row was accepted`)
      //  Belt-and-braces cleanup of any leaked probe row.
      const delQ = sb.from(table).delete()
        .eq('tcg_printing_id', row.tcg_printing_id)
        .eq('grader', row.grader).eq('grade', row.grade).eq('currency', row.currency)
      if (table === 'tcg_graded_price_daily') delQ.eq('observed_on', row.observed_on)
      const del = await delQ
      if (del.error) console.warn(`  ! cleanup failed on ${table}:`, del.error.message)
    }
  }
}

// -- 3. LOB-001 daily history is now attribution='card' ---------------
console.log('\n[verify] LOB-001 (Blue-Eyes White Dragon) historical daily rows:')
const cardId = 'ygo:card:ygo_lob_001'
const { data: dailyRows, error: dErr } = await sb
  .from('tcg_graded_price_daily')
  .select('tcg_printing_id, observed_on, grader, grade, price, attribution, tcg_card_id')
  .eq('game_id', 'ygo')
  .eq('tcg_card_id', cardId)
  .order('observed_on', { ascending: true })
if (dErr) fail('read LOB-001 daily rows', { err: dErr.message })
else {
  const n = dailyRows?.length ?? 0
  if (n === 0) fail('no LOB-001 daily rows found (expected some from prior daily runs)')
  else ok('LOB-001 daily rows fetched', { count: n })
  const printingScoped = (dailyRows ?? []).filter((r) => r.attribution !== 'card')
  if (printingScoped.length === 0) ok('every LOB-001 daily row is attribution=card')
  else fail('some LOB-001 daily rows still attribution!=card', { sample: printingScoped.slice(0, 3) })
  const nullCard = (dailyRows ?? []).filter((r) => !r.tcg_card_id)
  if (nullCard.length === 0) ok('every LOB-001 daily row has tcg_card_id populated')
  else fail('some LOB-001 daily rows have NULL tcg_card_id', { sample: nullCard.slice(0, 3) })
}

// -- 4. Ambiguity rule: no ambiguous-card row is printing-scoped -------
// Broader rule: any YGO card with >1 physical printing is ambiguous.
console.log('\n[verify] no daily row for an ambiguous YGO card is still printing-scoped:')

const printsByCard = new Map()
for (let offset = 0; ; offset += 1000) {
  const { data } = await sb.from('tcg_printings')
    .select('tcg_card_id')
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
const ambiguousCards = new Set()
for (const [cid, arr] of Array.from(printsByCard.entries())) {
  if (arr.length > 1) ambiguousCards.add(cid)
}
console.log(`  ambiguous YGO cards: ${ambiguousCards.size}`)

let dailyBad = 0, dailyChecked = 0, dailyErr = null
for (let offset = 0; ; offset += 1000) {
  const { data, error } = await sb.from('tcg_graded_price_daily')
    .select('tcg_card_id, attribution').eq('game_id', 'ygo').range(offset, offset + 999)
  if (error) { dailyErr = error; break }
  if (!data || data.length === 0) break
  dailyChecked += data.length
  for (const r of data) if (r.tcg_card_id && ambiguousCards.has(r.tcg_card_id) && r.attribution !== 'card') dailyBad++
  if (data.length < 1000) break
  if (offset >= 400_000) break
}
if (dailyErr) fail('scan tcg_graded_price_daily for stale printing-scoped rows', { err: dailyErr.message })
else if (dailyBad === 0 && dailyChecked > 0) ok('no ambiguous-card daily row is printing-scoped', { dailyChecked })
else if (dailyChecked === 0) fail('daily scan returned 0 rows - check reachability', { dailyChecked })
else fail(`${dailyBad} ambiguous-card daily rows still labelled printing-specific`, { dailyChecked })

let currentBad = 0, currentChecked = 0, currentErr = null
for (let offset = 0; ; offset += 1000) {
  const { data, error } = await sb.from('tcg_graded_prices_current')
    .select('tcg_card_id, attribution').eq('game_id', 'ygo').range(offset, offset + 999)
  if (error) { currentErr = error; break }
  if (!data || data.length === 0) break
  currentChecked += data.length
  for (const r of data) if (r.tcg_card_id && ambiguousCards.has(r.tcg_card_id) && r.attribution !== 'card') currentBad++
  if (data.length < 1000) break
  if (offset >= 400_000) break
}
if (currentErr) fail('scan tcg_graded_prices_current for stale printing-scoped rows', { err: currentErr.message })
else if (currentBad === 0 && currentChecked > 0) ok('no ambiguous-card current row is printing-scoped', { currentChecked })
else if (currentChecked === 0) fail('current scan returned 0 rows - check reachability', { currentChecked })
else fail(`${currentBad} ambiguous-card current rows still labelled printing-specific`, { currentChecked })

// -- 5. Other games untouched ------------------------------------------
console.log('\n[verify] other games have no card-scoped rows (expected: none):')
for (const g of ['mtg', 'onepiece', 'lorcana']) {
  const c = await sb.from('tcg_graded_prices_current').select('*', { count: 'exact', head: true })
    .eq('game_id', g).eq('attribution', 'card')
  if (c.error) fail(`${g}: current card-scoped count`, { err: c.error.message })
  else if ((c.count ?? 0) === 0) ok(`${g}: current has 0 card-scoped rows`)
  else fail(`${g}: unexpected ${c.count} card-scoped rows in current`)
  const d = await sb.from('tcg_graded_price_daily').select('*', { count: 'exact', head: true })
    .eq('game_id', g).eq('attribution', 'card')
  if (d.error) fail(`${g}: daily card-scoped count`, { err: d.error.message })
  else if ((d.count ?? 0) === 0) ok(`${g}: daily has 0 card-scoped rows`)
  else fail(`${g}: unexpected ${d.count} card-scoped rows in daily`)
}

// -- Result ------------------------------------------------------------
console.log('')
if (failures.length === 0) {
  console.log('[verify] GREEN. A1 metadata correction is consistent.')
  process.exit(0)
} else {
  console.error('[verify] FAILURES:')
  for (const f of failures) console.error(' -', JSON.stringify(f))
  process.exit(1)
}
