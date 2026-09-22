#!/usr/bin/env node
// scripts/tcggraph-bootstrap.mjs
//
// Slice 2 production bootstrap CLI. Resumable, credit-aware,
// per-game. Never activates a Vercel cron. Never exposes the API key.
//
// Usage:
//   node scripts/tcggraph-bootstrap.mjs --game magic-the-gathering [--from-page N] [--max-pages M] [--dry-run] [--resume]
//   node scripts/tcggraph-bootstrap.mjs --game yugioh
//   node scripts/tcggraph-bootstrap.mjs --game one-piece
//   node scripts/tcggraph-bootstrap.mjs --game star-wars-unlimited
//
// The script:
//   1. Writes a tcg_ingest_runs 'running' row for this game+resource.
//   2. Acquires a tcg_ingest_locks row for (game, 'cards.full').
//   3. Streams /cards?game=X&page=N&limit=100 pages sequentially.
//   4. Batch-maps MTG cards to mtg_printings via the deterministic key.
//   5. Upserts into tcg_sets, tcg_cards, tcg_printings,
//      tcg_external_ids, tcg_market_prices_current,
//      tcg_graded_prices_current, tcg_market_price_daily,
//      tcg_graded_price_daily (all keyed for idempotent replay).
//   6. Stops CLEANLY when the daily credit reserve is about to be
//      breached and writes a resume checkpoint. Never loops on 429/5xx.

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { randomUUID } from 'node:crypto'
import {
  loadEnv, requireEnv, getSupabase, tcgFetch,
  batchMapMtgCards,
  buildSetRow, buildCardRow, buildPrintingRows,
  buildMarketRows, buildGradedRows, buildExternalIdRows,
  upsertChunked,
} from './lib/tcggraph-ingest.mjs'

loadEnv()
requireEnv('TCGGRAPH_API_KEY')
requireEnv('NEXT_PUBLIC_SUPABASE_URL')
requireEnv('SUPABASE_SERVICE_ROLE_KEY')

const __dirname = dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = join(__dirname, '..')
const CHECKPOINT_DIR = join(REPO_ROOT, '.tmp', 'tcggraph-bootstrap')
mkdirSync(CHECKPOINT_DIR, { recursive: true })

// TCGGraph slug -> internal short id. Do NOT rename existing internal
// ids (swu, onepiece); downstream tables FK to them. New games are
// appended.
const GAMES = {
  'magic-the-gathering': 'mtg',
  'yugioh': 'ygo',
  'one-piece': 'onepiece',
  'disney-lorcana': 'lorcana',
  'star-wars-unlimited': 'swu',
}

function arg(name)  { const i = process.argv.indexOf(`--${name}`); if (i < 0) return null; const v = process.argv[i + 1]; return v && !v.startsWith('--') ? v : null }
function flag(name) { return process.argv.includes(`--${name}`) }

const slug = arg('game')
if (!slug || !GAMES[slug]) {
  console.error(`--game must be one of: ${Object.keys(GAMES).join(', ')}`)
  process.exit(2)
}
const GAME_ID = GAMES[slug]
const RESOURCE = 'cards.full'
const FROM_PAGE = Number(arg('from-page') ?? 1)
const MAX_PAGES = Number(arg('max-pages') ?? Infinity)
const DRY_RUN = flag('dry-run')
const RESUME = flag('resume')
const LIMIT = 100

// Credit safety. Stop when daily-remaining drops below this reserve
// so we never zero out and never trigger a rate-limit refusal.
const DAILY_RESERVE = 100

const CHECKPOINT_FILE = join(CHECKPOINT_DIR, `${GAME_ID}.${RESOURCE}.json`)

function readCheckpoint() {
  if (!existsSync(CHECKPOINT_FILE)) return null
  try { return JSON.parse(readFileSync(CHECKPOINT_FILE, 'utf8')) } catch { return null }
}
function writeCheckpoint(cp) { writeFileSync(CHECKPOINT_FILE, JSON.stringify(cp, null, 2)) }

// ---------------------------------------------------------------------
async function acquireLock(sb, workerId, minutes = 30) {
  // Reclaim expired lock; otherwise refuse.
  const leasedUntil = new Date(Date.now() + minutes * 60_000).toISOString()
  const { error } = await sb.rpc  // just for typing; not used
  // Manual upsert with WHERE leased_until < now() semantics via delete-then-insert.
  const { data: existing } = await sb.from('tcg_ingest_locks')
    .select('game_id, resource, leased_by, leased_until')
    .eq('game_id', GAME_ID).eq('resource', RESOURCE).maybeSingle()
  if (existing) {
    if (new Date(existing.leased_until).getTime() > Date.now()) {
      throw new Error(`another worker holds the lock (${existing.leased_by} until ${existing.leased_until}); retry after that time or force-release`)
    }
    await sb.from('tcg_ingest_locks').delete().eq('game_id', GAME_ID).eq('resource', RESOURCE)
  }
  const { error: e2 } = await sb.from('tcg_ingest_locks').insert({
    game_id: GAME_ID, resource: RESOURCE, leased_by: workerId, leased_until: leasedUntil,
  })
  if (e2) throw new Error(`lock insert failed: ${e2.message}`)
}
async function releaseLock(sb) {
  await sb.from('tcg_ingest_locks').delete().eq('game_id', GAME_ID).eq('resource', RESOURCE)
}

// ---------------------------------------------------------------------
async function main() {
  const sb = getSupabase()
  const workerId = `bootstrap-${randomUUID()}`
  console.log(`[bootstrap] game=${GAME_ID} (${slug}) resource=${RESOURCE} dry-run=${DRY_RUN} resume=${RESUME}`)

  // Resume from checkpoint if requested.
  const cp = RESUME ? readCheckpoint() : null
  const startPage = cp?.next_page ?? FROM_PAGE
  console.log(`[bootstrap] start page = ${startPage}   max pages this run = ${MAX_PAGES === Infinity ? 'unlimited' : MAX_PAGES}   daily reserve = ${DAILY_RESERVE}`)

  if (!DRY_RUN) await acquireLock(sb, workerId)

  const runId = randomUUID()
  const runInsert = {
    id: runId, game_id: GAME_ID, resource: RESOURCE,
    provider: 'tcggraph', provider_version: '2026-08-01',
    started_at: new Date().toISOString(),
    status: 'running',
    pages_requested: 0, pages_completed: 0,
    rows_fetched: 0, rows_inserted: 0, rows_updated: 0, rows_rejected: 0,
    credits_used: 0, credits_remaining: null, daily_credits_remaining: null,
    etag_hits: 0, http_304_count: 0, errors: 0,
    notes: { resume: RESUME, dry_run: DRY_RUN, from_page: startPage, max_pages: MAX_PAGES },
  }
  if (!DRY_RUN) await sb.from('tcg_ingest_runs').insert(runInsert)

  const stats = {
    pagesCompleted: 0,
    rowsFetched: 0,
    creditsUsed: 0,
    marketRows: 0,
    gradedRows: 0,
    mappingCounts: { exact: 0, high_confidence: 0, ambiguous: 0, unmapped: 0 },
    lastPage: startPage - 1,
    stopReason: null,
    firstDaily: null,
    lastDaily: null,
  }

  try {
    for (let page = startPage; ; page++) {
      if (page - startPage >= MAX_PAGES) { stats.stopReason = 'max_pages_reached'; break }
      const r = await tcgFetch('/cards', { game: slug, page, limit: LIMIT })
      stats.creditsUsed += r.cost
      if (stats.firstDaily === null) stats.firstDaily = r.dailyRemaining
      stats.lastDaily = r.dailyRemaining
      if (r.status === 429) { stats.stopReason = `429 rate limited at page ${page}`; break }
      if (r.status >= 500) { stats.stopReason = `${r.status} at page ${page}`; break }
      if (r.status !== 200) { stats.stopReason = `unexpected status ${r.status} at page ${page}`; break }
      const data = r.body?.data ?? []
      if (data.length === 0) { stats.stopReason = 'no_more_data'; break }
      stats.rowsFetched += data.length

      // Only English cards; other-language rows are ignored for this
      // bootstrap and can be added by re-running with a language filter.
      const en = data.filter((c) => (c.language || 'en') === 'en')

      // MTG mapping. For non-MTG games the map is empty.
      const mtgMap = GAME_ID === 'mtg' ? await batchMapMtgCards(sb, en) : new Map()
      for (const [, m] of mtgMap) stats.mappingCounts[m.confidence] = (stats.mappingCounts[m.confidence] || 0) + 1

      // Build all rows for the page.
      const setRows       = uniqueBy(en.map((c) => buildSetRow(GAME_ID, c.set)).filter(Boolean), 'id')
      const cardRows      = en.map((c) => buildCardRow(GAME_ID, c))
      const printingRows  = en.flatMap((c) => buildPrintingRows(GAME_ID, c, mtgMap))
      const marketRows    = en.flatMap((c) => buildMarketRows(GAME_ID, c, runId))
      const gradedRows    = en.flatMap((c) => buildGradedRows(GAME_ID, c, runId))
      const extIdRows     = en.flatMap((c) => buildExternalIdRows(GAME_ID, c, mtgMap))
      const dailyMarket = marketRows.map((m) => ({
        tcg_printing_id: m.tcg_printing_id, observed_on: todayIso(m.updated_at),
        source: m.source, list_type: m.list_type, currency: m.currency, finish: m.finish ?? '',
        game_id: m.game_id, price: m.price, price_low: m.price_low, price_trend: m.price_trend,
        avg_1d: m.avg_1d, avg_7d: m.avg_7d, avg_30d: m.avg_30d, source_run_id: runId,
      }))
      const dailyGraded = gradedRows.map((g) => ({
        tcg_printing_id: g.tcg_printing_id, observed_on: todayIso(g.updated_at),
        grader: g.grader, grade: g.grade, currency: g.currency, game_id: g.game_id,
        price: g.price, card_sales_volume: g.card_sales_volume, source_run_id: runId,
      }))

      if (!DRY_RUN) {
        await upsertChunked(sb, 'tcg_sets',                     setRows,      'id')
        await upsertChunked(sb, 'tcg_cards',                    cardRows,     'id')
        await upsertChunked(sb, 'tcg_printings',                printingRows, 'id')
        // external_ids has a unique index on (scope,source,external_id); use that as conflict target.
        await upsertChunked(sb, 'tcg_external_ids',             extIdRows,    'scope,source,external_id')
        await upsertChunked(sb, 'tcg_market_prices_current',    marketRows,   'tcg_printing_id,source,list_type,currency,finish')
        await upsertChunked(sb, 'tcg_graded_prices_current',    gradedRows,   'tcg_printing_id,grader,grade,currency')
        await upsertChunked(sb, 'tcg_market_price_daily',       dailyMarket,  'tcg_printing_id,observed_on,source,list_type,currency,finish')
        await upsertChunked(sb, 'tcg_graded_price_daily',       dailyGraded,  'tcg_printing_id,observed_on,grader,grade,currency')
      }

      stats.marketRows += marketRows.length
      stats.gradedRows += gradedRows.length
      stats.pagesCompleted += 1
      stats.lastPage = page
      const totalPages = r.body?.meta?.totalPages ?? null
      if (page % 25 === 0 || page <= 3) {
        console.log(`[bootstrap] page ${page}${totalPages ? '/' + totalPages : ''}  cost=${r.cost}  daily_rem=${r.dailyRemaining}  cards=${data.length}  mkt=${marketRows.length}  graded=${gradedRows.length}  mapping=${JSON.stringify(stats.mappingCounts)}`)
      }
      if (r.body?.meta?.hasMore === false) { stats.stopReason = 'catalogue_exhausted'; break }

      // Credit-safety check.
      if (r.dailyRemaining != null && r.dailyRemaining <= DAILY_RESERVE) {
        stats.stopReason = `daily_reserve_reached (remaining=${r.dailyRemaining}, reserve=${DAILY_RESERVE})`
        break
      }
    }
  } catch (err) {
    stats.stopReason = `exception: ${err.message}`
  } finally {
    if (!DRY_RUN) await releaseLock(sb)
  }

  // Persist run record.
  const status =
    stats.stopReason === 'catalogue_exhausted' || stats.stopReason === 'no_more_data' ? 'success'
    : stats.stopReason?.startsWith('daily_reserve_reached') ? 'aborted_credit'
    : stats.stopReason === 'max_pages_reached' ? 'partial'
    : 'failure'
  const finishedAt = new Date().toISOString()
  if (!DRY_RUN) {
    await sb.from('tcg_ingest_runs').update({
      finished_at: finishedAt,
      status,
      pages_completed: stats.pagesCompleted,
      pages_requested: stats.pagesCompleted,
      rows_fetched:    stats.rowsFetched,
      credits_used:    stats.creditsUsed,
      credits_remaining: null,           // final residual only known via a follow-up call
      daily_credits_remaining: stats.lastDaily,
      notes: {
        ...runInsert.notes,
        stop_reason: stats.stopReason,
        market_rows_upserted: stats.marketRows,
        graded_rows_upserted: stats.gradedRows,
        mapping_counts: stats.mappingCounts,
        last_page: stats.lastPage,
      },
    }).eq('id', runId)
  }

  // Write checkpoint for --resume.
  writeCheckpoint({
    game_id: GAME_ID, resource: RESOURCE, run_id: runId,
    next_page: stats.stopReason === 'catalogue_exhausted' || stats.stopReason === 'no_more_data' ? null : stats.lastPage + 1,
    finished_at: finishedAt,
    status,
    stats,
  })

  console.log(`\n[bootstrap] === DONE ===`)
  console.log(`  status:               ${status}`)
  console.log(`  stop reason:          ${stats.stopReason}`)
  console.log(`  last page completed:  ${stats.lastPage}`)
  console.log(`  next page on resume:  ${stats.stopReason === 'catalogue_exhausted' ? '(none, done)' : stats.lastPage + 1}`)
  console.log(`  rows fetched:         ${stats.rowsFetched}`)
  console.log(`  credits used:         ${stats.creditsUsed}`)
  console.log(`  daily remaining:      ${stats.lastDaily}`)
  console.log(`  market rows upserted: ${stats.marketRows}`)
  console.log(`  graded rows upserted: ${stats.gradedRows}`)
  console.log(`  mapping counts:       ${JSON.stringify(stats.mappingCounts)}`)
  console.log(`  checkpoint:           ${CHECKPOINT_FILE}`)
}

function uniqueBy(rows, key) {
  const seen = new Set()
  const out = []
  for (const r of rows) { if (!r) continue; const k = r[key]; if (seen.has(k)) continue; seen.add(k); out.push(r) }
  return out
}
function todayIso(updatedAt) {
  const d = updatedAt ? new Date(updatedAt) : new Date()
  return isNaN(d) ? new Date().toISOString().slice(0, 10) : d.toISOString().slice(0, 10)
}

main().catch((err) => { console.error('[bootstrap] FATAL:', err.message); process.exit(1) })
