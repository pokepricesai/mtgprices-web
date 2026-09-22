// src/lib/tcggraph/refresh.mjs
//
// Single implementation of the "run one full catalogue refresh for
// game X" pipeline. Consumed by both the CLI (scripts/tcggraph-
// bootstrap.mjs) and the production Vercel Cron route
// (src/app/api/cron/tcggraph-refresh/route.ts).
//
// Slice 5 additions:
//   * PRODUCTION_DAILY_RESERVE / PRODUCTION_MONTHLY_RESERVE guards
//     honoured up front - refuse to START a run that could dip below
//     these, not just stop mid-way.
//   * Lock hygiene guarantees releaseLock() runs even on throws.
//   * Structured telemetry object returned to the caller.
//   * `source` is recorded on tcg_ingest_runs.notes so operators can
//     filter cron vs bootstrap runs later.

import { randomUUID } from 'node:crypto'
import {
  SUPPORTED_GAMES,
  BOOTSTRAP_DAILY_RESERVE,
  PRODUCTION_DAILY_RESERVE,
  PRODUCTION_MONTHLY_RESERVE,
  tcgFetch,
  batchMapMtgCards,
  buildSetRow, buildCardRow, buildPrintingRows,
  buildMarketRows, buildGradedRows, buildExternalIdRows,
  upsertChunked,
} from './ingest-core.mjs'

const RESOURCE = 'cards.full'
const LIMIT = 100

/**
 * Options:
 *   gameSlug        - required, must be a key in SUPPORTED_GAMES
 *   sb              - Supabase service-role client
 *   source          - 'cron' | 'bootstrap' | 'manual-admin'
 *   fromPage        - default 1
 *   maxPages        - default Infinity
 *   dryRun          - default false. When true, no locks / no
 *                     ingest_runs row / no upserts.
 *   dailyReserve    - default PRODUCTION_DAILY_RESERVE
 *   monthlyReserve  - default PRODUCTION_MONTHLY_RESERVE
 *   logger          - { info, warn, error }; default console-shaped
 *   preflightCredits- default true. When true, hits /games once to
 *                     read x-daily-remaining / x-credits-remaining
 *                     and refuses to start if reserves would be
 *                     breached. Set false for very cheap runs.
 */
export async function refreshCatalogue(opts) {
  const {
    gameSlug,
    sb,
    source = 'unknown',
    fromPage = 1,
    maxPages = Infinity,
    dryRun = false,
    dailyReserve = PRODUCTION_DAILY_RESERVE,
    monthlyReserve = PRODUCTION_MONTHLY_RESERVE,
    logger = defaultLogger(),
    preflightCredits = true,
  } = opts

  const gameId = SUPPORTED_GAMES[gameSlug]
  if (!gameId) {
    return { status: 'failure', reason: 'unknown_game_slug', gameSlug, stopReason: 'unknown_game_slug' }
  }
  if (!sb) throw new Error('refreshCatalogue: sb (Supabase service client) is required')

  const workerId = `${source}-${randomUUID()}`
  const runId = randomUUID()
  logger.info('tcg.refresh.start', { game: gameId, source, dryRun, dailyReserve, monthlyReserve })

  // ------- 1. Preflight credit check -------
  if (preflightCredits) {
    const pre = await tcgFetch('/games')
    if (pre.status !== 200) {
      return {
        status: 'failure', reason: 'preflight_failed',
        gameSlug, gameId, stopReason: `preflight_status_${pre.status}`,
        credits: { monthlyRemaining: pre.creditsRemaining, dailyRemaining: pre.dailyRemaining },
      }
    }
    if (pre.dailyRemaining != null && pre.dailyRemaining < dailyReserve) {
      logger.warn('tcg.refresh.preflight_daily_low', { game: gameId, dailyRemaining: pre.dailyRemaining, reserve: dailyReserve })
      await recordSkippedRun(sb, { runId, gameId, source, reason: 'insufficient_daily_credits', preflightCredits: pre })
      return {
        status: 'skipped_credit', reason: 'insufficient_daily_credits',
        gameSlug, gameId,
        stopReason: 'insufficient_daily_credits',
        credits: { monthlyRemaining: pre.creditsRemaining, dailyRemaining: pre.dailyRemaining, dailyReserve },
      }
    }
    if (pre.creditsRemaining != null && pre.creditsRemaining < monthlyReserve) {
      logger.warn('tcg.refresh.preflight_monthly_low', { game: gameId, monthlyRemaining: pre.creditsRemaining, reserve: monthlyReserve })
      await recordSkippedRun(sb, { runId, gameId, source, reason: 'insufficient_monthly_credits', preflightCredits: pre })
      return {
        status: 'skipped_credit', reason: 'insufficient_monthly_credits',
        gameSlug, gameId,
        stopReason: 'insufficient_monthly_credits',
        credits: { monthlyRemaining: pre.creditsRemaining, dailyRemaining: pre.dailyRemaining, monthlyReserve },
      }
    }
  }

  // ------- 2. Acquire lock (unless dry run) -------
  if (!dryRun) {
    const acquired = await acquireLock(sb, workerId, gameId, RESOURCE, 30)
    if (!acquired.ok) {
      return { status: 'skipped_lock', reason: acquired.reason, gameSlug, gameId, stopReason: acquired.reason, existingLease: acquired.existing }
    }
  }

  // ------- 3. Insert 'running' run row -------
  const runInsert = {
    id: runId, game_id: gameId, resource: RESOURCE,
    provider: 'tcggraph', provider_version: '2026-08-01',
    started_at: new Date().toISOString(),
    status: 'running',
    pages_requested: 0, pages_completed: 0,
    rows_fetched: 0, rows_inserted: 0, rows_updated: 0, rows_rejected: 0,
    credits_used: 0, credits_remaining: null, daily_credits_remaining: null,
    etag_hits: 0, http_304_count: 0, errors: 0,
    notes: { source, dry_run: dryRun, from_page: fromPage, max_pages: maxPages === Infinity ? 'unlimited' : maxPages, daily_reserve: dailyReserve, monthly_reserve: monthlyReserve },
  }
  if (!dryRun) {
    const { error } = await sb.from('tcg_ingest_runs').insert(runInsert)
    if (error) {
      await releaseLock(sb, gameId, RESOURCE).catch(() => {})
      return { status: 'failure', reason: 'ingest_runs_insert_failed', gameSlug, gameId, stopReason: 'ingest_runs_insert_failed', error: error.message }
    }
  }

  // ------- 4. Page loop -------
  const stats = {
    pagesCompleted: 0,
    rowsFetched: 0,
    creditsUsed: 0,
    marketRows: 0,
    gradedRows: 0,
    mappingCounts: { exact: 0, high_confidence: 0, ambiguous: 0, unmapped: 0 },
    lastPage: fromPage - 1,
    stopReason: null,
    firstDaily: null,
    lastDaily: null,
    lastMonthly: null,
    errors: 0,
  }
  //  observedOn is captured ONCE per run so a refresh that straddles
  //  midnight writes all rows under a single date. Semantically this is
  //  "the day WE observed the snapshot", not the day the provider claims
  //  its price last changed - the latter is preserved on the price row's
  //  own updated_at column, but daily history is a per-run observation.
  const observedOn = new Date().toISOString().slice(0, 10)

  try {
    for (let page = fromPage; ; page++) {
      if (page - fromPage >= maxPages) { stats.stopReason = 'max_pages_reached'; break }
      const r = await tcgFetch('/cards', { game: gameSlug, page, limit: LIMIT })
      stats.creditsUsed += r.cost
      if (stats.firstDaily === null) stats.firstDaily = r.dailyRemaining
      stats.lastDaily = r.dailyRemaining
      stats.lastMonthly = r.creditsRemaining
      if (r.status === 429)                    { stats.stopReason = `429_rate_limited_page_${page}`; stats.errors++; break }
      if (r.status >= 500 && r.status < 600)   { stats.stopReason = `http_${r.status}_page_${page}`;  stats.errors++; break }
      if (r.status !== 200)                    { stats.stopReason = `http_${r.status}_page_${page}`;  stats.errors++; break }
      const data = r.body?.data ?? []
      if (data.length === 0)                   { stats.stopReason = 'no_more_data'; break }
      stats.rowsFetched += data.length

      const en = data.filter((c) => (c.language || 'en') === 'en')
      const mtgMap = gameId === 'mtg' ? await batchMapMtgCards(sb, en) : new Map()
      for (const [, m] of mtgMap) stats.mappingCounts[m.confidence] = (stats.mappingCounts[m.confidence] || 0) + 1

      const setRows      = uniqueBy(en.map((c) => buildSetRow(gameId, c.set)).filter(Boolean), 'id')
      const cardRows     = en.map((c) => buildCardRow(gameId, c))
      const printingRows = en.flatMap((c) => buildPrintingRows(gameId, c, mtgMap))
      const marketRows   = en.flatMap((c) => buildMarketRows(gameId, c, runId))
      const gradedRows   = en.flatMap((c) => buildGradedRows(gameId, c, runId))
      const extIdRows    = en.flatMap((c) => buildExternalIdRows(gameId, c, mtgMap))
      const dailyMarket = marketRows.map((m) => ({
        tcg_printing_id: m.tcg_printing_id, observed_on: observedOn,
        source: m.source, list_type: m.list_type, currency: m.currency, finish: m.finish ?? '',
        game_id: m.game_id, price: m.price, price_low: m.price_low, price_trend: m.price_trend,
        avg_1d: m.avg_1d, avg_7d: m.avg_7d, avg_30d: m.avg_30d, source_run_id: runId,
      }))
      const dailyGraded = gradedRows.map((g) => ({
        tcg_printing_id: g.tcg_printing_id, observed_on: observedOn,
        grader: g.grader, grade: g.grade, currency: g.currency, game_id: g.game_id,
        price: g.price, card_sales_volume: g.card_sales_volume, source_run_id: runId,
        //  Carry the current-row semantics into daily history so a
        //  future audit can distinguish edition-ambiguous observations
        //  from genuine printing-specific ones without a schema join.
        attribution: g.attribution, tcg_card_id: g.tcg_card_id,
      }))

      if (!dryRun) {
        await upsertChunked(sb, 'tcg_sets',                  setRows,      'id')
        await upsertChunked(sb, 'tcg_cards',                 cardRows,     'id')
        await upsertChunked(sb, 'tcg_printings',             printingRows, 'id')
        await upsertChunked(sb, 'tcg_external_ids',          extIdRows,    'scope,source,external_id')
        await upsertChunked(sb, 'tcg_market_prices_current', marketRows,   'tcg_printing_id,source,list_type,currency,finish')
        await upsertChunked(sb, 'tcg_graded_prices_current', gradedRows,   'tcg_printing_id,grader,grade,currency')
        await upsertChunked(sb, 'tcg_market_price_daily',    dailyMarket,  'tcg_printing_id,observed_on,source,list_type,currency,finish')
        await upsertChunked(sb, 'tcg_graded_price_daily',    dailyGraded,  'tcg_printing_id,observed_on,grader,grade,currency')
      }

      stats.marketRows += marketRows.length
      stats.gradedRows += gradedRows.length
      stats.pagesCompleted += 1
      stats.lastPage = page
      const totalPages = r.body?.meta?.totalPages ?? null
      if (page === 1 || page % 25 === 0 || totalPages && page === totalPages) {
        logger.info('tcg.refresh.page', { game: gameId, page, totalPages, cost: r.cost, dailyRemaining: r.dailyRemaining, mkt: marketRows.length, graded: gradedRows.length })
      }
      if (r.body?.meta?.hasMore === false) { stats.stopReason = 'catalogue_exhausted'; break }

      if (r.dailyRemaining != null && r.dailyRemaining <= dailyReserve) {
        stats.stopReason = `daily_reserve_reached_${r.dailyRemaining}_${dailyReserve}`
        break
      }
      if (r.creditsRemaining != null && r.creditsRemaining <= monthlyReserve) {
        stats.stopReason = `monthly_reserve_reached_${r.creditsRemaining}_${monthlyReserve}`
        break
      }
    }
  } catch (err) {
    stats.errors++
    stats.stopReason = `exception: ${err instanceof Error ? err.message : String(err)}`
    logger.error('tcg.refresh.exception', { game: gameId, err: err instanceof Error ? err.message : String(err) })
  } finally {
    if (!dryRun) await releaseLock(sb, gameId, RESOURCE).catch(() => {})
  }

  // ------- 5. Finalise ingest_runs row -------
  const status =
    stats.stopReason === 'catalogue_exhausted' || stats.stopReason === 'no_more_data' ? 'success'
    : String(stats.stopReason).startsWith('daily_reserve_reached') ? 'aborted_credit'
    : String(stats.stopReason).startsWith('monthly_reserve_reached') ? 'aborted_credit'
    : stats.stopReason === 'max_pages_reached' ? 'partial'
    : 'failure'
  const finishedAt = new Date().toISOString()

  if (!dryRun) {
    try {
      await sb.from('tcg_ingest_runs').update({
        finished_at: finishedAt,
        status,
        pages_completed: stats.pagesCompleted,
        pages_requested: stats.pagesCompleted,
        rows_fetched:    stats.rowsFetched,
        credits_used:    stats.creditsUsed,
        credits_remaining: stats.lastMonthly,
        daily_credits_remaining: stats.lastDaily,
        errors: stats.errors,
        notes: {
          ...runInsert.notes,
          stop_reason: stats.stopReason,
          market_rows_upserted: stats.marketRows,
          graded_rows_upserted: stats.gradedRows,
          mapping_counts: stats.mappingCounts,
          last_page: stats.lastPage,
        },
      }).eq('id', runId)
    } catch (err) {
      logger.warn('tcg.refresh.finalise_failed', { err: err instanceof Error ? err.message : String(err) })
    }
  }

  logger.info('tcg.refresh.done', { game: gameId, status, stopReason: stats.stopReason, pages: stats.pagesCompleted, credits: stats.creditsUsed })

  return {
    status,
    reason: null,
    gameSlug,
    gameId,
    stopReason: stats.stopReason,
    runId,
    startedAt: runInsert.started_at,
    finishedAt,
    pagesCompleted: stats.pagesCompleted,
    rowsFetched:    stats.rowsFetched,
    creditsUsed:    stats.creditsUsed,
    marketRowsUpserted: stats.marketRows,
    gradedRowsUpserted: stats.gradedRows,
    mappingCounts: stats.mappingCounts,
    lastPage: stats.lastPage,
    credits: { monthlyRemaining: stats.lastMonthly, dailyRemaining: stats.lastDaily },
    errors: stats.errors,
  }
}

// ---------------------------------------------------------------------
// Lock helpers.
// ---------------------------------------------------------------------

async function acquireLock(sb, workerId, gameId, resource, minutes) {
  const leasedUntil = new Date(Date.now() + minutes * 60_000).toISOString()
  const { data: existing } = await sb.from('tcg_ingest_locks')
    .select('game_id, resource, leased_by, leased_until')
    .eq('game_id', gameId).eq('resource', resource).maybeSingle()
  if (existing) {
    if (new Date(existing.leased_until).getTime() > Date.now()) {
      return { ok: false, reason: 'lock_held', existing }
    }
    // Stale lock. Reclaim.
    await sb.from('tcg_ingest_locks').delete().eq('game_id', gameId).eq('resource', resource)
  }
  const { error } = await sb.from('tcg_ingest_locks').insert({
    game_id: gameId, resource, leased_by: workerId, leased_until: leasedUntil,
  })
  if (error) return { ok: false, reason: `lock_insert_failed: ${error.message}` }
  return { ok: true, workerId, leasedUntil }
}

async function releaseLock(sb, gameId, resource) {
  await sb.from('tcg_ingest_locks').delete().eq('game_id', gameId).eq('resource', resource)
}

async function recordSkippedRun(sb, { runId, gameId, source, reason, preflightCredits }) {
  try {
    await sb.from('tcg_ingest_runs').insert({
      id: runId, game_id: gameId, resource: RESOURCE,
      provider: 'tcggraph', provider_version: '2026-08-01',
      started_at: new Date().toISOString(),
      finished_at: new Date().toISOString(),
      status: 'aborted_credit',
      pages_requested: 0, pages_completed: 0, rows_fetched: 0,
      credits_used: 0,
      credits_remaining: preflightCredits?.creditsRemaining ?? null,
      daily_credits_remaining: preflightCredits?.dailyRemaining ?? null,
      etag_hits: 0, http_304_count: 0, errors: 0,
      notes: { source, stop_reason: reason },
    })
  } catch { /* best-effort telemetry */ }
}

// ---------------------------------------------------------------------
// Utilities.
// ---------------------------------------------------------------------

function uniqueBy(rows, key) {
  const seen = new Set()
  const out = []
  for (const r of rows) { if (!r) continue; const k = r[key]; if (seen.has(k)) continue; seen.add(k); out.push(r) }
  return out
}

function defaultLogger() {
  return {
    info:  (msg, meta) => { if (process.env.TCGGRAPH_DEBUG) console.log('[tcg.refresh]', msg, meta ?? {}) },
    warn:  (msg, meta) => { console.warn('[tcg.refresh]', msg, meta ?? {}) },
    error: (msg, meta) => { console.error('[tcg.refresh]', msg, meta ?? {}) },
  }
}

export { BOOTSTRAP_DAILY_RESERVE, PRODUCTION_DAILY_RESERVE, PRODUCTION_MONTHLY_RESERVE } from './ingest-core.mjs'
