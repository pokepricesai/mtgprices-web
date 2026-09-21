// src/lib/mtg/set-market-batch.ts
// Server-only. Batched set-level pricing for the /browse directory.
// Returns per-set aggregates that share their methodology with
// /set/[setCode] via src/lib/mtg/set-aggregate.ts.
//
// Two-phase pipeline:
//   1. Call mtg_set_aggregates_v4 in small chunks for the current
//      denominator, priced count, priced subtotal, and most valuable
//      card per set. Chunk size is deliberately small (25) so no
//      single RPC call approaches Supabase's statement_timeout.
//   2. Look up 30D basket movement via the precomputed daily
//      aggregate table mtg_set_value_daily. Two O(N) point lookups
//      (today + 30d ago) instead of joining through 60M+ rows in
//      mtg_price_observations. Prior attempts using the observations
//      partition set directly hit statement_timeout at build time.
//
// A failed RPC chunk is retried once at a smaller size. If it still
// fails, sets in that chunk are returned as empty aggregates. The
// browse tile hides pricing state for empty aggregates.
//
// This module is the only /browse aggregate path. There is no
// batched-TS fallback anymore. The v3-era fallback truncated at 1000
// rows and was the root cause of the launch-day 8/8 bug.

import 'server-only'
import { getSupabaseServiceClient } from '@/lib/supabaseService'
import type { MarketBasis } from './card-market.types'
import { DEFAULT_BASIS } from './card-market'
import {
  type SetAggregate,
  HISTORY_COVERAGE_THRESHOLD,
  MIN_HISTORY_BASKET_SIZE,
  computeCoverage,
  emptyAggregate,
} from './set-aggregate'

export type { SetAggregate } from './set-aggregate'

const MAX_SETS = 1200
const RPC_CHUNK = 25              // ~1.5-2 s per full 800-set page in parallel
const RPC_RETRY_CHUNK = 10        // second try when a chunk errors
const READ_CHUNK = 400            // page size for mtg_set_value_daily_read

export async function getSetAggregates(
  setCodes: string[],
  basis: MarketBasis = DEFAULT_BASIS,
): Promise<Map<string, SetAggregate>> {
  const out = new Map<string, SetAggregate>()
  if (!setCodes.length) return out
  const codes = setCodes.slice(0, MAX_SETS)
  const supabase = getSupabaseServiceClient()

  // Phase 1: chunked v4 RPC.
  const chunks: string[][] = []
  for (let i = 0; i < codes.length; i += RPC_CHUNK) chunks.push(codes.slice(i, i + RPC_CHUNK))
  const results = await Promise.all(chunks.map((chunk) => runRpc(supabase, chunk, basis)))
  const retryTargets: string[] = []
  for (let i = 0; i < results.length; i++) {
    const r = results[i]
    if (r.error) {
      retryTargets.push(...chunks[i])
      continue
    }
    for (const row of r.data ?? []) mergeRow(out, row)
  }

  // Retry any failed chunk at a smaller size before giving up on it.
  if (retryTargets.length) {
    console.warn(`mtg_set_aggregates_v4: ${retryTargets.length} set codes failed at chunk ${RPC_CHUNK}, retrying at ${RPC_RETRY_CHUNK}`)
    const retryChunks: string[][] = []
    for (let i = 0; i < retryTargets.length; i += RPC_RETRY_CHUNK) retryChunks.push(retryTargets.slice(i, i + RPC_RETRY_CHUNK))
    const retryResults = await Promise.all(retryChunks.map((chunk) => runRpc(supabase, chunk, basis)))
    for (const r of retryResults) {
      if (r.error) {
        console.warn('mtg_set_aggregates_v4 retry still failed:', r.error.code, r.error.message)
        continue
      }
      for (const row of r.data ?? []) mergeRow(out, row)
    }
  }

  // Any set not represented in either pass gets an empty aggregate.
  // The tile UI treats empty (eligibleCount=0) as "no data yet"
  // rather than showing garbage.
  for (const code of codes) if (!out.has(code)) out.set(code, emptyAggregate(code))

  // Phase 2: 7D / 30D / 90D basket movement, sourced from the
  // precomputed daily aggregate table. Four cheap point reads
  // (anchor, -7, -30, -90) instead of scanning ~60M observations.
  await annotateHistoricalMovement(supabase, out, codes, basis)

  return out
}

type RpcRow = {
  set_code: string
  eligible_count: number
  priced_count: number
  priced_subtotal: number | string
  most_valuable_name: string | null
  most_valuable_collector_number: string | null
  most_valuable_price: number | string | null
}

async function runRpc(supabase: ReturnType<typeof getSupabaseServiceClient>, chunk: string[], basis: MarketBasis) {
  return await supabase.rpc('mtg_set_aggregates_v4', {
    p_set_codes: chunk,
    p_provider: basis.provider,
    p_currency: basis.currency,
    p_market: basis.market,
    p_price_type: basis.priceType,
  })
}

function mergeRow(out: Map<string, SetAggregate>, row: unknown) {
  const r = row as RpcRow
  const eligibleCount = Number(r.eligible_count) || 0
  const pricedCount = Number(r.priced_count) || 0
  const pricedSubtotal = Number(r.priced_subtotal) || 0
  out.set(r.set_code, {
    setCode: r.set_code,
    eligibleCount,
    pricedCount,
    pricedSubtotal,
    coverage: computeCoverage(pricedCount, eligibleCount),
    mostValuableName: r.most_valuable_name ?? null,
    mostValuableCollectorNumber: r.most_valuable_collector_number ?? null,
    mostValuablePrice: r.most_valuable_price === null || r.most_valuable_price === undefined
      ? null
      : Number(r.most_valuable_price),
    pct7d: null, abs7d: null,
    pct30d: null, abs30d: null,
    pct90d: null, abs90d: null,
  })
}

// ---------------------------------------------------------------------
// 7D / 30D / 90D basket movement, sourced from mtg_set_value_daily.
// One three-endpoint annotation covers all horizons in a single pass.
// ---------------------------------------------------------------------

type DailyRow = {
  set_code: string
  observed_on: string
  eligible_count: number
  priced_count: number
  basket_value: number | string
}

async function annotateHistoricalMovement(
  supabase: ReturnType<typeof getSupabaseServiceClient>,
  out: Map<string, SetAggregate>,
  codes: string[],
  basis: MarketBasis,
): Promise<void> {
  // Anchor to the most recent day the daily aggregate has been
  // refreshed for on this basis. Do not use CURRENT_DATE blindly:
  // if the ingest is running late, today's rows may not exist yet
  // and we would report the whole set as "no history".
  const anchor = await mostRecentAggregateDate(supabase, basis)
  if (!anchor) return
  const anchorMs = Date.parse(anchor + 'T00:00:00Z')
  if (!Number.isFinite(anchorMs)) return

  const isoBack = (days: number) => {
    const d = new Date(anchorMs); d.setUTCDate(d.getUTCDate() - days)
    return d.toISOString().slice(0, 10)
  }
  const iso7  = isoBack(7)
  const iso30 = isoBack(30)
  const iso90 = isoBack(90)

  const [nowRows, r7, r30, r90] = await Promise.all([
    readDailyRows(supabase, codes, anchor, basis),
    readDailyRows(supabase, codes, iso7,   basis),
    readDailyRows(supabase, codes, iso30,  basis),
    readDailyRows(supabase, codes, iso90,  basis),
  ])
  const nowByCode = new Map<string, DailyRow>(nowRows.map((r) => [r.set_code, r]))
  const past7     = new Map<string, DailyRow>(r7.map((r)     => [r.set_code, r]))
  const past30    = new Map<string, DailyRow>(r30.map((r)    => [r.set_code, r]))
  const past90    = new Map<string, DailyRow>(r90.map((r)    => [r.set_code, r]))

  for (const code of codes) {
    const cur = out.get(code)
    if (!cur || cur.eligibleCount === 0) continue
    const n = nowByCode.get(code)
    if (!n) continue

    const p7  = movement(n, past7.get(code))
    const p30 = movement(n, past30.get(code))
    const p90 = movement(n, past90.get(code))

    out.set(code, {
      ...cur,
      pct7d:  p7.pct,  abs7d:  p7.abs,
      pct30d: p30.pct, abs30d: p30.abs,
      pct90d: p90.pct, abs90d: p90.abs,
    })
  }
}

function movement(now: DailyRow, past: DailyRow | undefined): { pct: number | null; abs: number | null } {
  if (!past) return { pct: null, abs: null }
  const nowVal = Number(now.basket_value) || 0
  const pastVal = Number(past.basket_value) || 0
  const nowCov = computeCoverage(now.priced_count, now.eligible_count)
  const pastCov = computeCoverage(past.priced_count, past.eligible_count)
  // Both endpoints must clear the coverage bar AND both must carry
  // at least MIN_HISTORY_BASKET_SIZE priced entries. Otherwise the
  // move is dominated by a handful of movers, not the set.
  const enough =
    nowCov >= HISTORY_COVERAGE_THRESHOLD &&
    pastCov >= HISTORY_COVERAGE_THRESHOLD &&
    now.priced_count >= MIN_HISTORY_BASKET_SIZE &&
    past.priced_count >= MIN_HISTORY_BASKET_SIZE &&
    pastVal > 0
  if (!enough) return { pct: null, abs: null }
  return { pct: (nowVal - pastVal) / pastVal, abs: round2(nowVal - pastVal) }
}

async function mostRecentAggregateDate(
  supabase: ReturnType<typeof getSupabaseServiceClient>,
  basis: MarketBasis,
): Promise<string | null> {
  // Skip zero-coverage days. The daily cron is guarded against
  // pre-ingest inserts, but if a poisoned row ever lands (missed
  // ingest, manual seed, etc.) we do NOT want it to become the /browse
  // anchor: nowVal=0 kills every 30D chip. Require priced_count > 0
  // on at least ONE set on the candidate day. Cheap: single row, PK-
  // covered index scan.
  const { data, error } = await supabase
    .from('mtg_set_value_daily')
    .select('observed_on, priced_count')
    .eq('provider', basis.provider).eq('currency', basis.currency)
    .eq('market', basis.market).eq('price_type', basis.priceType)
    .gt('priced_count', 0)
    .order('observed_on', { ascending: false })
    .limit(1)
  if (error) {
    console.warn('mtg_set_value_daily anchor lookup failed:', error.message)
    return null
  }
  return (data && data[0] && (data[0] as any).observed_on) ?? null
}

async function readDailyRows(
  supabase: ReturnType<typeof getSupabaseServiceClient>,
  codes: string[],
  observedOn: string,
  basis: MarketBasis,
): Promise<DailyRow[]> {
  const chunks: string[][] = []
  for (let i = 0; i < codes.length; i += READ_CHUNK) chunks.push(codes.slice(i, i + READ_CHUNK))
  const results = await Promise.all(chunks.map((chunk) =>
    supabase.rpc('mtg_set_value_daily_read', {
      p_set_codes: chunk,
      p_observed_on: observedOn,
      p_provider: basis.provider,
      p_currency: basis.currency,
      p_market: basis.market,
      p_price_type: basis.priceType,
    }),
  ))
  const rows: DailyRow[] = []
  for (const r of results) {
    if (r.error) {
      console.warn(`mtg_set_value_daily_read(${observedOn}) failed:`, r.error.message)
      continue
    }
    for (const row of (r.data ?? []) as DailyRow[]) rows.push(row)
  }
  return rows
}

function round2(n: number): number { return Math.round(n * 100) / 100 }
