#!/usr/bin/env node
// scripts/audit-ranking-before-after.mjs
//
// Materialises the before/after top-20 highest MTG current prices to
// show the Pass 2A ranking outlier policy in action.
//
// "Before" = raw top-20 by tcg_market_prices_current price, no filter.
// "After"  = the same query, but with the cross-source robust-headline
//            rule and the historical-implausibility rule applied per
//            printing.
//
// Reads ONLY. No mutations. Writes docs/audit/ranking-before-after.md.

// Run with `node --env-file=.env.local scripts/audit-ranking-before-after.mjs`
// so NEXT_PUBLIC_SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY are populated
// without requiring a dotenv dep.

import { createClient } from '@supabase/supabase-js'
import fs from 'node:fs/promises'
import path from 'node:path'

const URL = process.env.NEXT_PUBLIC_SUPABASE_URL
const KEY = process.env.SUPABASE_SERVICE_ROLE_KEY
if (!URL || !KEY) {
  console.error('Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in .env.local')
  process.exit(2)
}
const sb = createClient(URL, KEY, { auth: { persistSession: false } })

// Same constants as src/lib/mtg/ranking.ts — kept inline so this
// script is self-contained and runnable outside the Next build.
const CROSS_SOURCE_MAX_RATIO = 10
const HISTORICAL_MAX_RATIO = 20
const MIN_TEST_PRICE = 1

function median(nums) {
  if (nums.length === 0) return 0
  const s = nums.slice().sort((a, b) => a - b)
  const m = Math.floor(s.length / 2)
  return s.length % 2 === 0 ? (s[m - 1] + s[m]) / 2 : s[m]
}

// ─── 1. Pull the raw top-100 candidates from TCGGraph. ─────────
const { data: topRaw, error: rawErr } = await sb
  .from('tcg_market_prices_current')
  .select('tcg_printing_id, source, list_type, currency, price, finish, updated_at')
  .eq('game_id', 'mtg')
  .eq('currency', 'USD')
  .not('price', 'is', null)
  .order('price', { ascending: false })
  .limit(100)
if (rawErr) throw new Error(`raw pull failed: ${rawErr.message}`)

// Resolve names for readability.
const tcgIds = Array.from(new Set(topRaw.map((r) => r.tcg_printing_id)))
const { data: tp } = await sb.from('tcg_printings').select('id, mtg_printings_id, set_id, collector_number, language, finish').in('id', tcgIds)
const tpById = new Map((tp ?? []).map((r) => [r.id, r]))

const mtgIds = Array.from(new Set((tp ?? []).map((r) => r.mtg_printings_id).filter(Boolean)))
const { data: mp } = await sb.from('mtg_printings').select('id, set_code, collector_number, lang, oracle_card_id, name').in('id', mtgIds)
const mpById = new Map((mp ?? []).map((r) => [r.id, r]))

const oracleIds = Array.from(new Set((mp ?? []).map((r) => r.oracle_card_id).filter(Boolean)))
const { data: oc } = await sb.from('mtg_oracle_cards').select('id, name').in('id', oracleIds)
const nameById = new Map((oc ?? []).map((r) => [r.id, r.name]))

function label(row) {
  const t = tpById.get(row.tcg_printing_id)
  const m = t?.mtg_printings_id ? mpById.get(t.mtg_printings_id) : null
  const name = m?.oracle_card_id ? (nameById.get(m.oracle_card_id) ?? m?.name ?? 'UNKNOWN') : (m?.name ?? 'UNMAPPED')
  const setCode = (m?.set_code ?? t?.set_id?.replace(/^mtg:set:/, '') ?? '???').toString()
  const cn = m?.collector_number ?? t?.collector_number ?? '?'
  return `${name} · ${setCode.toUpperCase()}·${cn} · ${row.finish ?? 'nonfoil'} · ${row.source}`
}

// ─── 2. Cross-pipeline siblings.
// The real cross-source signal comes from comparing TCGGraph (this
// table) against MTGJSON's `mtg_current_prices` (an independent
// pipeline). Same-pipeline comparison misses feed-wide outliers.
// Fetch both:
const uniqueTcg = Array.from(new Set(topRaw.map((r) => r.tcg_printing_id)))
const { data: siblingsAll } = await sb
  .from('tcg_market_prices_current')
  .select('tcg_printing_id, source, price, currency, finish')
  .eq('game_id', 'mtg')
  .eq('currency', 'USD')
  .in('tcg_printing_id', uniqueTcg)

const siblingsByTcgFinish = new Map()
for (const s of siblingsAll ?? []) {
  const key = `${s.tcg_printing_id}::${s.finish ?? ''}`
  const arr = siblingsByTcgFinish.get(key) ?? []
  arr.push({ source: `tcggraph.${s.source}`, price: Number(s.price) })
  siblingsByTcgFinish.set(key, arr)
}

// MTGJSON side: mtg_printings_id → mtg_printing_finishes.id → mtg_current_prices
const mtgIdsForCross = Array.from(new Set((tp ?? []).map((r) => r.mtg_printings_id).filter(Boolean)))
const { data: mtgFinishes } = await sb
  .from('mtg_printing_finishes')
  .select('id, printing_id, finish')
  .in('printing_id', mtgIdsForCross)
const finishById = new Map((mtgFinishes ?? []).map((r) => [r.id, r]))
const mtgFinishIds = (mtgFinishes ?? []).map((f) => f.id)
const { data: mtgCurrents } = await sb
  .from('mtg_current_prices')
  .select('printing_finish_id, provider, market, currency, price_type, price')
  .in('printing_finish_id', mtgFinishIds)
  .eq('market', 'paper').eq('currency', 'USD').eq('price_type', 'retail')
// Index by (mtg_printings_id::finish)
const mtgPipelineByPrintingFinish = new Map()
for (const c of mtgCurrents ?? []) {
  const meta = finishById.get(c.printing_finish_id)
  if (!meta) continue
  const key = `${meta.printing_id}::${meta.finish}`
  const arr = mtgPipelineByPrintingFinish.get(key) ?? []
  arr.push({ source: `mtgjson.${c.provider}`, price: Number(c.price) })
  mtgPipelineByPrintingFinish.set(key, arr)
}

// ─── 3. Cross-pipeline classification (min-anchor rule).
// Combine TCGGraph siblings + MTGJSON pipeline entries into one
// price cloud per (mtg_printing, finish). A row's price is a
// cross-source outlier if it exceeds CROSS_SOURCE_MAX_RATIO x the
// minimum of the OTHER sources' prices. Min-anchor beats median
// because bimodal (mirrored bad feeds) distributions defeat median.
function classify(row) {
  const tcgKey = `${row.tcg_printing_id}::${row.finish ?? ''}`
  const tcgSibs = siblingsByTcgFinish.get(tcgKey) ?? []
  const t = tpById.get(row.tcg_printing_id)
  const mtgPrintingId = t?.mtg_printings_id ?? null
  const mtgFinish = row.finish ?? 'nonfoil'
  const mtgKey = mtgPrintingId ? `${mtgPrintingId}::${mtgFinish}` : null
  const mtgSibs = mtgKey ? (mtgPipelineByPrintingFinish.get(mtgKey) ?? []) : []
  const combined = [...tcgSibs, ...mtgSibs].filter((s) => Number.isFinite(s.price) && s.price > 0)
  if (combined.length < 2) return { verdict: 'single-source', anchor: combined[0]?.price ?? 0, ratio: 1, combinedCount: combined.length, excluded: [] }
  const p = Number(row.price)
  const others = combined.filter((s) => s.price !== p)
  const anchor = others.length > 0 ? Math.min(...others.map((s) => s.price)) : combined[0].price
  const ratio = anchor > 0 ? p / anchor : 1
  const isOutlier = ratio > CROSS_SOURCE_MAX_RATIO && p >= MIN_TEST_PRICE
  const excluded = combined.filter((s) => {
    const rest = combined.filter((x) => x !== s)
    if (rest.length === 0) return false
    const a = Math.min(...rest.map((x) => x.price))
    return a > 0 && s.price / a > CROSS_SOURCE_MAX_RATIO && s.price >= MIN_TEST_PRICE
  }).map((s) => s.source)
  return {
    verdict: isOutlier ? 'cross-source-outlier' : 'agrees',
    anchor, ratio, combinedCount: combined.length, excluded,
  }
}

// ─── 4. Historical implausibility (pull 30d TCGGraph daily for these
//        exact printing+finish tuples; median; compare). ─────
const dailyKeyList = topRaw.map((r) => ({ tcg_printing_id: r.tcg_printing_id, finish: r.finish ?? '', source: r.source }))
const since = new Date(Date.now() - 30 * 86400_000).toISOString().slice(0, 10)
const { data: histAll } = await sb
  .from('tcg_market_price_daily')
  .select('tcg_printing_id, source, finish, price, observed_on')
  .eq('game_id', 'mtg')
  .eq('currency', 'USD')
  .in('tcg_printing_id', uniqueTcg)
  .gte('observed_on', since)

const histByKey = new Map()
for (const h of histAll ?? []) {
  const key = `${h.tcg_printing_id}::${h.source}::${h.finish ?? ''}`
  const arr = histByKey.get(key) ?? []
  arr.push(Number(h.price))
  histByKey.set(key, arr)
}
function historicalMedian(row) {
  const key = `${row.tcg_printing_id}::${row.source}::${row.finish ?? ''}`
  const arr = histByKey.get(key) ?? []
  const good = arr.filter((p) => Number.isFinite(p) && p > 0)
  return good.length > 0 ? median(good) : null
}

// ─── 5. Render markdown. ──────────────────────────────────────
const rows = topRaw.map((r) => {
  const c = classify(r)
  const hm = historicalMedian(r)
  const histBad = hm != null && hm > 0 && (Number(r.price) / hm) > HISTORICAL_MAX_RATIO && Number(r.price) >= MIN_TEST_PRICE
  const verdict = c.verdict === 'cross-source-outlier'
    ? `EXCLUDED · cross-source (min-anchor $${c.anchor.toFixed(2)}, ratio ${c.ratio.toFixed(1)}x, sources=${c.combinedCount})`
    : histBad
      ? `EXCLUDED · historical (30d median $${hm.toFixed(2)}, ratio ${(Number(r.price) / hm).toFixed(1)}x)`
      : 'kept'
  return { ...r, label: label(r), verdict, ratio: c.ratio, med: c.med, hm }
})
const kept = rows.filter((r) => r.verdict === 'kept').slice(0, 20)
const excluded = rows.filter((r) => r.verdict !== 'kept').slice(0, 20)
const before = rows.slice(0, 20)

const lines = []
lines.push('# MTG ranking outlier policy — before / after top-20\n')
lines.push(`_Generated ${new Date().toISOString()} from tcg_market_prices_current (mtg, USD)._\n`)
lines.push(`Policy: cross-source min-anchor ratio > **${CROSS_SOURCE_MAX_RATIO}x** (when ≥2 sources exist across TCGGraph + MTGJSON pipelines) OR historical 30d-median ratio > **${HISTORICAL_MAX_RATIO}x** (when only one source exists). No global ceiling.\n`)
lines.push(`Residual class: genuinely single-source rows where both current and history mirror the same feed (e.g. commons priced $XX,XXX by only one marketplace with no independent second observation) cannot be flagged by either rule and require rarity-based heuristics — out of scope for Pass 2A.\n`)
lines.push('## Before — raw top-20 (no policy)\n')
lines.push('| # | Card · Set · Finish · Source | Price |')
lines.push('|---|---|---|')
before.forEach((r, i) => lines.push(`| ${i + 1} | ${r.label} | $${Number(r.price).toLocaleString()} |`))
lines.push('\n## After — top-20 that survive the policy\n')
lines.push('| # | Card · Set · Finish · Source | Price |')
lines.push('|---|---|---|')
kept.forEach((r, i) => lines.push(`| ${i + 1} | ${r.label} | $${Number(r.price).toLocaleString()} |`))
lines.push(`\n## Excluded (top ${excluded.length}) — reason\n`)
lines.push('| Card · Set · Finish · Source | Price | Verdict |')
lines.push('|---|---|---|')
excluded.forEach((r) => lines.push(`| ${r.label} | $${Number(r.price).toLocaleString()} | ${r.verdict} |`))

const outDir = path.join(process.cwd(), 'docs', 'audit')
await fs.mkdir(outDir, { recursive: true })
const outPath = path.join(outDir, 'ranking-before-after.md')
await fs.writeFile(outPath, lines.join('\n'))

console.log(`\nWrote ${outPath}`)
console.log(`Before top-20: ${before.length}, After (kept) top-20: ${kept.length}, Excluded: ${excluded.length}`)
console.log(`\nExclusions:`)
for (const r of excluded) console.log(`  - ${r.label} · $${Number(r.price).toLocaleString()} · ${r.verdict}`)
