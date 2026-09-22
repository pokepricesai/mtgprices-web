#!/usr/bin/env node
// scripts/tcggraph-status.mjs
// Operator-friendly network summary. Slice 4: launch-4 view + FUTURE.
// Read-only. Uses 1 credit (a /games probe) to fetch fresh headers.
// Never prints the API key.

import { loadEnv, getSupabase, tcgFetch } from './lib/tcggraph-ingest.mjs'
loadEnv()

const LAUNCH_NETWORK = [
  { id: 'mtg',      label: 'MAGIC: THE GATHERING' },
  { id: 'ygo',      label: 'YU-GI-OH!' },
  { id: 'onepiece', label: 'ONE PIECE' },
  { id: 'lorcana',  label: 'DISNEY LORCANA' },
]

const FUTURE_NETWORK = [
  { id: 'swu', label: 'STAR WARS: UNLIMITED (future / inactive)' },
]

function pct(n, d) { return d > 0 ? `${(n / d * 100).toFixed(2)}%` : '-' }

async function reportGame(sb, g) {
  console.log('')
  console.log(g.label)
  console.log('-'.repeat(g.label.length))
  const [cards, printings, mapped, ambiguous, unmapped, market, gradedTotal, gradedSlab, gradedRaw, marketHist, gradedHist, run] = await Promise.all([
    sb.from('tcg_cards').select('*', { count: 'exact', head: true }).eq('game_id', g.id),
    sb.from('tcg_printings').select('*', { count: 'exact', head: true }).eq('game_id', g.id),
    sb.from('tcg_printings').select('*', { count: 'exact', head: true }).eq('game_id', g.id).not('mtg_printings_id', 'is', null),
    sb.from('tcg_printings').select('*', { count: 'exact', head: true }).eq('game_id', g.id).eq('mapping_confidence', 'ambiguous'),
    sb.from('tcg_printings').select('*', { count: 'exact', head: true }).eq('game_id', g.id).eq('mapping_confidence', 'unmapped'),
    sb.from('tcg_market_prices_current').select('*', { count: 'exact', head: true }).eq('game_id', g.id),
    sb.from('tcg_graded_prices_current').select('*', { count: 'exact', head: true }).eq('game_id', g.id),
    sb.from('tcg_graded_prices_current').select('*', { count: 'exact', head: true }).eq('game_id', g.id).not('grader', 'in', '("raw")'),
    sb.from('tcg_graded_prices_current').select('*', { count: 'exact', head: true }).eq('game_id', g.id).eq('grader', 'raw'),
    sb.from('tcg_market_price_daily').select('*', { count: 'exact', head: true }).eq('game_id', g.id),
    sb.from('tcg_graded_price_daily').select('*', { count: 'exact', head: true }).eq('game_id', g.id),
    sb.from('tcg_ingest_runs').select('id, resource, status, started_at, finished_at, pages_completed, rows_fetched, credits_used, notes').eq('game_id', g.id).order('started_at', { ascending: false }).limit(1).maybeSingle(),
  ])
  const nCards  = cards.count ?? 0
  const nPrint  = printings.count ?? 0
  const nMapped = mapped.count ?? 0
  const nSlab   = gradedSlab.count ?? 0
  const nRaw    = gradedRaw.count ?? 0
  console.log(`  cards:                 ${nCards}`)
  console.log(`  physical printings:    ${nPrint}`)
  if (g.id === 'mtg') {
    console.log(`    mapped to mtg_id:    ${nMapped}  (${pct(nMapped, nPrint)})`)
  }
  console.log(`  market rows (current): ${market.count ?? 0}`)
  console.log(`  graded rows (current): ${gradedTotal.count ?? 0}`)
  //  A printing may carry multiple slab rows (psa-10 + bgs-10 + cgc-10 + ...).
  //  Row counts are informative; true "% of printings graded" needs
  //  distinct-count, computed on demand from the analytics scripts.
  console.log(`    slab rows:           ${nSlab}   (rows, not distinct printings)`)
  console.log(`    raw rows:            ${nRaw}`)
  console.log(`  history rows (market): ${marketHist.count ?? 0}`)
  console.log(`  history rows (graded): ${gradedHist.count ?? 0}`)
  console.log(`  ambiguous mappings:    ${ambiguous.count ?? 0}`)
  console.log(`  unmapped printings:    ${unmapped.count ?? 0}`)
  if (run.data) {
    const r = run.data
    console.log(`  last ingest:           ${r.resource}  status=${r.status}  pages=${r.pages_completed}  rows=${r.rows_fetched}  credits=${r.credits_used}`)
    console.log(`    started:             ${r.started_at}`)
    console.log(`    finished:            ${r.finished_at ?? '(still running)'}`)
    if (r.notes?.stop_reason) console.log(`    stop reason:         ${r.notes.stop_reason}`)
  } else {
    console.log(`  last ingest:           (none)`)
  }
}

async function main() {
  const sb = getSupabase()
  const probe = await tcgFetch('/games')

  const monthlyUsed = (probe.creditsLimit ?? 0) - (probe.creditsRemaining ?? 0)
  const dailyUsed   = (probe.dailyLimit ?? 0)   - (probe.dailyRemaining ?? 0)
  console.log('')
  console.log('TCGGRAPH PLAN')
  console.log(`  Starter (${probe.creditsLimit ?? '?'}/month, ${probe.dailyLimit ?? '?'}/day)`)
  console.log('')
  console.log('MONTHLY')
  console.log(`  used:      ${monthlyUsed} / ${probe.creditsLimit ?? '?'}`)
  console.log(`  remaining: ${probe.creditsRemaining ?? '?'}`)
  console.log('')
  console.log('DAILY')
  console.log(`  used:      ${dailyUsed} / ${probe.dailyLimit ?? '?'}`)
  console.log(`  remaining: ${probe.dailyRemaining ?? '?'}`)

  console.log('')
  console.log('==========================')
  console.log('LAUNCH NETWORK (5-site launch: PokePrices + these 4)')
  console.log('==========================')
  for (const g of LAUNCH_NETWORK) await reportGame(sb, g)

  console.log('')
  console.log('==========================')
  console.log('FUTURE / INACTIVE')
  console.log('==========================')
  for (const g of FUTURE_NETWORK) await reportGame(sb, g)

  // Ingest health.
  console.log('')
  console.log('INGEST HEALTH')
  console.log('=============')
  const nowIso = new Date().toISOString()
  const fourHoursAgoIso = new Date(Date.now() - 4 * 3600_000).toISOString()
  const { data: staleLocks } = await sb.from('tcg_ingest_locks').select('*').lt('leased_until', nowIso)
  const { data: activeLocks } = await sb.from('tcg_ingest_locks').select('*').gte('leased_until', nowIso)
  const { data: staleRuns }  = await sb.from('tcg_ingest_runs').select('*').eq('status', 'running').lt('started_at', fourHoursAgoIso)
  const { data: failedRuns } = await sb.from('tcg_ingest_runs').select('*').eq('status', 'failure').order('started_at', { ascending: false }).limit(5)
  console.log(`  active locks:          ${activeLocks?.length ?? 0}`)
  console.log(`  stale locks:           ${staleLocks?.length ?? 0}`)
  console.log(`  stale 'running' runs:  ${staleRuns?.length ?? 0}`)
  console.log(`  recent failures:       ${failedRuns?.length ?? 0}`)
  for (const f of failedRuns ?? []) console.log(`    ${f.game_id}.${f.resource}  ${f.started_at}  ${f.notes?.stop_reason ?? '-'}`)
  const warnings = []
  if ((probe.creditsRemaining ?? 0) < 2500) warnings.push(`monthly remaining below 2 500`)
  if ((probe.dailyRemaining ?? 0) < 200)    warnings.push(`daily remaining below 200`)
  if ((staleLocks?.length ?? 0) > 0)        warnings.push(`stale locks present; will auto-reclaim on next attempt`)
  if ((staleRuns?.length ?? 0) > 0)         warnings.push(`stale 'running' runs > 4h old`)
  if (warnings.length === 0) console.log(`  credit warnings:       none`)
  else for (const w of warnings) console.log(`  WARNING: ${w}`)
}

main().catch((e) => { console.error(e.message); process.exit(1) })
