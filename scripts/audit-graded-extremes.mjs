#!/usr/bin/env node
// scripts/audit-graded-extremes.mjs
//
// READ-ONLY audit of TCGGraph graded price extremes for MTG (USD).
// Investigates whether the top-20 highest graded quotes in
// `tcg_graded_prices_current` are plausible transacted values or
// stale/unmoving listings.
//
// Never writes to the DB. Uses service-role only to read across RLS.
// Emits a markdown report to stdout AND to docs/audit/graded-extremes-report.md.

import { loadEnv, getSupabase } from './lib/tcggraph-ingest.mjs'
import { writeFileSync, mkdirSync, existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

loadEnv()
const sb = getSupabase()

const __dirname = dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = join(__dirname, '..')
const REPORT_PATH = join(REPO_ROOT, 'docs', 'audit', 'graded-extremes-report.md')

const HISTORY_DAYS = 30
const TOP_N = 20

function fmtUSD(n) {
  if (n == null) return '-'
  try {
    return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 2 }).format(n)
  } catch { return `$${Number(n).toFixed(2)}` }
}
function pad(s, n) { s = String(s ?? ''); return s.length >= n ? s : s + ' '.repeat(n - s.length) }
function stddev(xs) {
  if (!xs.length) return 0
  const m = xs.reduce((a, b) => a + b, 0) / xs.length
  const v = xs.reduce((a, b) => a + (b - m) ** 2, 0) / xs.length
  return Math.sqrt(v)
}

// ---------------------------------------------------------------------
// Step 1: introspect what columns actually exist on the graded tables,
// so we know whether there is any "listings vs sales" signal at all.
// ---------------------------------------------------------------------
async function introspectColumns() {
  const tables = ['tcg_graded_prices_current', 'tcg_graded_price_daily']
  const result = {}
  for (const t of tables) {
    const { data, error } = await sb
      .from('information_schema.columns')
      .select('column_name, data_type')
      .eq('table_schema', 'public')
      .eq('table_name', t)
    if (error) {
      // information_schema is often not exposed via PostgREST. Fall
      // back to selecting a single row and reading the keys.
      const { data: row } = await sb.from(t).select('*').limit(1)
      result[t] = row?.[0] ? Object.keys(row[0]).map((k) => ({ column_name: k, data_type: typeof row[0][k] })) : []
    } else {
      result[t] = data ?? []
    }
  }
  return result
}

// ---------------------------------------------------------------------
// Step 2: top-20 highest MTG USD graded rows in the current table.
// ---------------------------------------------------------------------
async function fetchTopExtremes() {
  //  Not joining via PostgREST FK sugar because we want to be certain
  //  about which columns come from which table. Fetch the extreme rows
  //  first, then fan out.
  const { data: top, error } = await sb
    .from('tcg_graded_prices_current')
    .select('*')
    .eq('game_id', 'mtg')
    .eq('currency', 'USD')
    .order('price', { ascending: false })
    .limit(TOP_N)
  if (error) throw error

  const printingIds = [...new Set(top.map((r) => r.tcg_printing_id))]
  const { data: printings } = await sb
    .from('tcg_printings')
    .select('id, mtg_printings_id, tcggraph_printing_key, finish, language')
    .in('id', printingIds)
  const printingsById = new Map((printings ?? []).map((p) => [p.id, p]))

  const mtgIds = [...new Set((printings ?? []).map((p) => p.mtg_printings_id).filter(Boolean))]
  //  Note: mtg_printings has `name` directly and does NOT have a `finish`
  //  column - finish lives on tcg_printings. Keep the select tight to the
  //  columns we actually rely on.
  const { data: mtgPrintings, error: mpErr } = await sb
    .from('mtg_printings')
    .select('id, set_code, collector_number, oracle_card_id, name, lang, released_at, rarity, scryfall_uri')
    .in('id', mtgIds)
  if (mpErr) throw mpErr
  const mtgById = new Map((mtgPrintings ?? []).map((p) => [p.id, p]))

  //  Oracle join is now belt-and-suspenders (name is on mtg_printings).
  //  Kept so we still resolve a display name if a printing row somehow
  //  lacks one.
  const oracleIds = [...new Set((mtgPrintings ?? []).map((p) => p.oracle_card_id).filter(Boolean))]
  const { data: oracle } = await sb
    .from('mtg_oracle_cards')
    .select('id, name')
    .in('id', oracleIds)
  const oracleById = new Map((oracle ?? []).map((o) => [o.id, o]))

  return top.map((r) => {
    const p = printingsById.get(r.tcg_printing_id) ?? null
    const mp = p?.mtg_printings_id ? mtgById.get(p.mtg_printings_id) : null
    const oc = mp?.oracle_card_id ? oracleById.get(mp.oracle_card_id) : null
    return {
      row: r,
      printing: p,
      mtgPrinting: mp,
      oracle: oc,
      displayName: mp?.name ?? oc?.name ?? '(unmapped)',
    }
  })
}

// ---------------------------------------------------------------------
// Step 3: for each extreme row, fetch the last 30 daily observations.
// ---------------------------------------------------------------------
async function fetchHistoryFor(rowCtx) {
  const r = rowCtx.row
  const { data, error } = await sb
    .from('tcg_graded_price_daily')
    .select('*')
    .eq('tcg_printing_id', r.tcg_printing_id)
    .eq('grader', r.grader)
    .eq('grade', r.grade)
    .eq('currency', r.currency)
    .order('observed_on', { ascending: false })
    .limit(HISTORY_DAYS)
  if (error) throw error
  return data ?? []
}

// ---------------------------------------------------------------------
// Step 4: classify.
// ---------------------------------------------------------------------
function classify(rowCtx, history) {
  const prices = history.map((h) => Number(h.price)).filter((x) => Number.isFinite(x))
  const distinct = new Set(prices).size
  const sd = stddev(prices)
  const n = prices.length
  const moved = distinct > 1
  const volume = rowCtx.row.card_sales_volume
  const currentPrice = Number(rowCtx.row.price)

  //  Heuristic classification. TCGGraph does not expose a listing/sale
  //  flag - we only get {price, salesVolume, updatedAt}. So the
  //  strongest signal we have is (a) whether the price ever moves
  //  and (b) whether card_sales_volume is populated / plausible.
  let smell = ''
  let confidence = ''
  if (n === 0) {
    smell = 'no history — cannot classify'
    confidence = 'low'
  } else if (!moved && (volume == null || volume === 0)) {
    smell = 'SMELLS LIKE A LISTING (unchanging price, no sales volume signal)'
    confidence = sd === 0 && n >= 14 ? 'high' : 'medium'
  } else if (!moved && volume > 0) {
    smell = 'flat price but sales_volume > 0 — possibly a thin-market anchor'
    confidence = 'low-medium'
  } else if (moved && distinct >= 3) {
    smell = 'shows sales movement (multiple distinct prices)'
    confidence = distinct >= 5 ? 'high' : 'medium'
  } else {
    smell = 'minor drift (2 distinct prices) — likely re-listed / re-priced, not confirmed sales'
    confidence = 'medium'
  }
  return { distinct, stddev: sd, n, moved, smell, confidence, currentPrice, volume }
}

// ---------------------------------------------------------------------
// Main.
// ---------------------------------------------------------------------
async function main() {
  const startedAt = new Date().toISOString()
  const columns = await introspectColumns()
  const top = await fetchTopExtremes()

  const rowReports = []
  for (const ctx of top) {
    const hist = await fetchHistoryFor(ctx)
    const cls = classify(ctx, hist)
    rowReports.push({ ctx, hist, cls })
  }

  //  Build the markdown.
  const lines = []
  lines.push('# MTG graded-price extremes audit')
  lines.push('')
  lines.push(`- Generated: ${startedAt}`)
  lines.push(`- Scope: top ${TOP_N} \`tcg_graded_prices_current\` rows for \`game_id='mtg'\` and \`currency='USD'\``)
  lines.push(`- History window: last ${HISTORY_DAYS} rows in \`tcg_graded_price_daily\` per (printing, grader, grade, currency)`)
  lines.push('- Read-only. No mutations issued.')
  lines.push('')

  lines.push('## 1. Columns available for listings-vs-sales distinction')
  lines.push('')
  for (const t of Object.keys(columns)) {
    lines.push(`### \`${t}\``)
    lines.push('')
    lines.push('| column | type |')
    lines.push('|---|---|')
    for (const c of columns[t]) {
      lines.push(`| \`${c.column_name}\` | ${c.data_type} |`)
    }
    lines.push('')
  }
  const currentCols = columns['tcg_graded_prices_current'].map((c) => c.column_name)
  const historyCols = columns['tcg_graded_price_daily'].map((c) => c.column_name)
  const hasSalesVolume = currentCols.includes('card_sales_volume')
  const hasIsListing = currentCols.some((c) => /listing|is_sold|price_type|source_kind/i.test(c))
  lines.push('**Interpretation:**')
  lines.push('')
  lines.push(`- \`card_sales_volume\` present on current: ${hasSalesVolume ? 'YES' : 'NO'}`)
  lines.push(`- Explicit "listing vs sale" flag column present: ${hasIsListing ? 'YES' : 'NO — no boolean/enum discriminator exists'}`)
  lines.push('- TCGGraph\'s upstream payload only carries `{grader, grade, currency, price, salesVolume, updatedAt}`. There is no per-quote \'sold\' vs \'listed\' flag from the provider. Our schema therefore cannot make the distinction either — we can only *infer* it from `card_sales_volume` (aggregate) and from history movement.')
  lines.push('')

  lines.push('## 2. Top-20 rows')
  lines.push('')
  lines.push('| # | Card | Set | Coll# | Finish | Grader | Grade | Price (USD) | sales_vol | distinct 30d | stddev 30d | classification | confidence |')
  lines.push('|---|---|---|---|---|---|---|---:|---:|---:|---:|---|---|')
  rowReports.forEach(({ ctx, cls }, i) => {
    const name = ctx.displayName ?? '(unmapped)'
    const set = ctx.mtgPrinting?.set_code?.toUpperCase() ?? '?'
    const cn = ctx.mtgPrinting?.collector_number ?? '?'
    const finish = ctx.mtgPrinting?.finish ?? ctx.printing?.finish ?? '?'
    lines.push(
      `| ${i + 1} | ${name} | ${set} | ${cn} | ${finish} | ${ctx.row.grader} | ${ctx.row.grade} | ${fmtUSD(cls.currentPrice)} | ${cls.volume ?? '-'} | ${cls.distinct}/${cls.n} | ${cls.stddev.toFixed(2)} | ${cls.smell} | ${cls.confidence} |`
    )
  })
  lines.push('')

  lines.push('## 3. Per-row detail')
  lines.push('')
  rowReports.forEach(({ ctx, hist, cls }, i) => {
    const name = ctx.displayName ?? '(unmapped)'
    const set = ctx.mtgPrinting?.set_code?.toUpperCase() ?? '?'
    const cn = ctx.mtgPrinting?.collector_number ?? '?'
    lines.push(`### ${i + 1}. ${name} [${set} #${cn}] — ${ctx.row.grader} ${ctx.row.grade}`)
    lines.push('')
    lines.push(`- Current price: **${fmtUSD(cls.currentPrice)}**`)
    lines.push(`- \`card_sales_volume\`: ${cls.volume ?? 'null'}`)
    lines.push(`- History rows: ${cls.n}, distinct prices: ${cls.distinct}, stddev: ${cls.stddev.toFixed(2)}`)
    lines.push(`- Classification: ${cls.smell}  _(confidence: ${cls.confidence})_`)
    if (hist.length > 0) {
      const min = Math.min(...hist.map((h) => Number(h.price)))
      const max = Math.max(...hist.map((h) => Number(h.price)))
      lines.push(`- 30d price range: ${fmtUSD(min)} — ${fmtUSD(max)}`)
      const first = hist[hist.length - 1]
      const last = hist[0]
      lines.push(`- Oldest observation in window: ${first.observed_on} @ ${fmtUSD(first.price)}`)
      lines.push(`- Newest observation in window: ${last.observed_on} @ ${fmtUSD(last.price)}`)
    }
    lines.push(`- Attribution: \`${ctx.row.attribution ?? '-'}\`  &middot;  tcg_printing_id: \`${ctx.row.tcg_printing_id}\``)
    lines.push('')
  })

  lines.push('## 4. Aggregate signal')
  lines.push('')
  const listingLike = rowReports.filter((r) => r.cls.smell.startsWith('SMELLS')).length
  const salesLike = rowReports.filter((r) => r.cls.smell.startsWith('shows sales')).length
  const flatWithVolume = rowReports.filter((r) => r.cls.smell.startsWith('flat price but sales_volume')).length
  const drift = rowReports.filter((r) => r.cls.smell.startsWith('minor drift')).length
  lines.push(`- Smells like a listing (flat, no volume): ${listingLike}/${TOP_N}`)
  lines.push(`- Shows sales-like movement: ${salesLike}/${TOP_N}`)
  lines.push(`- Flat price WITH some sales volume: ${flatWithVolume}/${TOP_N}`)
  lines.push(`- Minor drift (2 distinct prices): ${drift}/${TOP_N}`)
  lines.push('')

  lines.push('## 5. Frontend terminology check')
  lines.push('')
  lines.push('- `src/components/mtg/GradedPricesPanel.tsx` labels the surface "Graded card prices" and describes them as **"market estimates for professionally graded copies of this exact printing where sufficient market data is available."** The UI does NOT claim these are confirmed sales. It also does NOT say "listings", and it does not surface `card_sales_volume`. A viewer sees only a price + a "last update N days ago" pill.')
  lines.push('- `src/app/set/[setCode]/card/[cardSlug]/page.tsx` is the only route that renders the panel and it passes the TCGGraph bundle straight through — no extra copy claiming "sold for" or "sales history".')
  lines.push('- Verdict: the UI does not lie, but it does not warn either. A $200k+ number with no sales-volume caveat can easily be read by a user as "this is the going rate" when it may be one seller\'s ask that has never transacted.')
  lines.push('')

  lines.push('## 6. Recommendations (no code changes yet)')
  lines.push('')
  lines.push('1. Surface `card_sales_volume` alongside every graded cell — even a small "N sales / period" pill is enough to let users spot thin-market anchors.')
  lines.push('2. When `card_sales_volume` is 0/null AND the daily history shows a flat price for ≥14 days, either suppress the row or annotate it with "listing-based estimate — no recent sales observed".')
  lines.push('3. Consider a server-side sanity threshold: if the current price is more than 10× the raw price AND `card_sales_volume` is null/0, flag the row rather than display it in the hero grid.')
  lines.push('4. Add an admin-only \'graded outliers\' view that runs this same query on a schedule so we notice new $200k+ ghost anchors when TCGGraph ingests them.')
  lines.push('5. Long-term: ask TCGGraph if their gradedPrices payload can expose a `priceKind` (`listing` vs `sale`) or a `salesCount` per grade tier. Without that, we are always inferring.')
  lines.push('')

  const md = lines.join('\n')

  //  Ensure docs/audit/ exists.
  const outDir = dirname(REPORT_PATH)
  if (!existsSync(outDir)) mkdirSync(outDir, { recursive: true })
  writeFileSync(REPORT_PATH, md, 'utf8')

  process.stdout.write(md + '\n')
  process.stderr.write(`\n[audit] wrote ${REPORT_PATH}\n`)
}

main().catch((e) => {
  console.error('[audit] fatal:', e)
  process.exit(1)
})
