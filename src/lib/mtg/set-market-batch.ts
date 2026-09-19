// src/lib/mtg/set-market-batch.ts
// Server-only. Batched set-level pricing for the /browse directory.
// Returns per-set aggregates that share their methodology with
// /set/[setCode] via src/lib/mtg/set-aggregate.ts.
//
// Two-phase pipeline:
//   1. Call mtg_set_aggregates_v4 in small chunks. This gives us the
//      correct denominator, priced count, priced subtotal, and most
//      valuable card per set. Chunk size is deliberately small (25) so
//      no single RPC call approaches Supabase's statement_timeout.
//   2. For sets that clear the coverage threshold, look up 30D basket
//      movement in mtg_price_observations. Paginated properly (unlike
//      the previous fallback pipeline, which silently truncated
//      Postgrest .in() at 1000 rows and shipped wildly wrong numbers).
//
// A failed RPC chunk is retried once at a smaller size. If it still
// fails, sets in that chunk are returned as empty aggregates. The
// browse tile hides pricing state for empty aggregates, which is much
// better than the previous "silently show 8/8 priced".
//
// This module is intentionally the only path. There is no batched-TS
// fallback anymore: the v3-era fallback truncated at 1000 rows and
// was the root cause of the launch-day bug.

import 'server-only'
import { getSupabaseServiceClient } from '@/lib/supabaseService'
import type { MarketBasis } from './card-market.types'
import { DEFAULT_BASIS } from './card-market'
import {
  type SetAggregate,
  SET_VALUE_COVERAGE_THRESHOLD,
  HISTORY_COVERAGE_THRESHOLD,
  MIN_HISTORY_BASKET_SIZE,
  computeCoverage,
  emptyAggregate,
} from './set-aggregate'

export type { SetAggregate } from './set-aggregate'

const MAX_SETS      = 1200
const RPC_CHUNK     = 25          // ~1.5-2 s per full 800-set page in parallel
const RPC_RETRY_CHUNK = 10        // second try when a chunk errors
const OBS_CHUNK     = 200         // Postgrest .in() page size for observations
const OBS_PAGE_SIZE = 1000        // Postgrest default max rows per response

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
  // rather than "8/8 priced $6.45".
  for (const code of codes) if (!out.has(code)) out.set(code, emptyAggregate(code))

  // Phase 2: 30D basket movement for sets that clear the coverage
  // gate. Currently OFF for the batch surface. Two reasons:
  //   1. Site launched 2026-09-19, so mtg_price_observations does not
  //      yet hold 30 days of history. Every /browse render would only
  //      produce nulls.
  //   2. Fetching observations for ~120k basket finishes hits the
  //      Postgres statement_timeout at build time (verified during
  //      the pricing-accuracy fix).
  // Re-enable once we cross the 30-day mark AND the observations
  // table is either indexed for this workload or aggregated into a
  // dedicated materialised view.
  const SET_AGGREGATES_ENABLE_30D = process.env.SET_AGGREGATES_ENABLE_30D === '1'
  if (SET_AGGREGATES_ENABLE_30D) {
    const eligibleSets = Array.from(out.values()).filter((a) =>
      a.pricedCount >= MIN_HISTORY_BASKET_SIZE &&
      a.coverage >= SET_VALUE_COVERAGE_THRESHOLD,
    )
    if (eligibleSets.length > 0) {
      await annotate30dMovement(supabase, out, eligibleSets.map((a) => a.setCode), basis)
    }
  }

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
    pct30d: null,
    abs30d: null,
  })
}

// ---------------------------------------------------------------------
// 30D basket movement.
// ---------------------------------------------------------------------

async function annotate30dMovement(
  supabase: ReturnType<typeof getSupabaseServiceClient>,
  out: Map<string, SetAggregate>,
  setCodes: string[],
  basis: MarketBasis,
): Promise<void> {
  // 1. Rebuild the basket composition (printing → chosen finish) for
  //    exactly the sets that qualify. Same nonfoil-preferred rule as
  //    the RPC, so the current vs 30-day-ago comparison is like-for-
  //    like.
  type PrintRow = { id: string; set_code: string }
  const printChunks: string[][] = []
  for (let i = 0; i < setCodes.length; i += OBS_CHUNK) printChunks.push(setCodes.slice(i, i + OBS_CHUNK))
  const prints: PrintRow[] = (await Promise.all(printChunks.map((chunk) =>
    collectPaged<PrintRow>(supabase, 'mtg_printings', 'id, set_code',
      'set_code', chunk, 'id',
      (q) => q.eq('digital', false).eq('lang', 'en').not('collector_number', 'is', null),
    )))).flat()
  if (prints.length === 0) return
  const printsById = new Map<string, PrintRow>(prints.map((p) => [p.id, p]))
  const printingIds = prints.map((p) => p.id)

  // 2. Finishes for those printings, paginated in parallel.
  type FinishRow = { id: string; printing_id: string; finish: string }
  const finishIdChunks: string[][] = []
  for (let i = 0; i < printingIds.length; i += OBS_CHUNK) finishIdChunks.push(printingIds.slice(i, i + OBS_CHUNK))
  const finishes: FinishRow[] = (await Promise.all(finishIdChunks.map((chunk) =>
    collectPaged<FinishRow>(supabase, 'mtg_printing_finishes', 'id, printing_id, finish',
      'printing_id', chunk, 'id',
      (q) => q,
    )))).flat()
  if (finishes.length === 0) return
  const finishById = new Map<string, FinishRow>(finishes.map((f) => [f.id, f]))

  // 3. Current prices on the basis for those finishes, paginated in
  //    parallel.
  type CurrentRow = { printing_finish_id: string; price: number }
  const finishIds = finishes.map((f) => f.id)
  const cpChunks: string[][] = []
  for (let i = 0; i < finishIds.length; i += OBS_CHUNK) cpChunks.push(finishIds.slice(i, i + OBS_CHUNK))
  const currents: CurrentRow[] = (await Promise.all(cpChunks.map((chunk) =>
    collectPaged<CurrentRow>(supabase, 'mtg_current_prices', 'printing_finish_id, price',
      'printing_finish_id', chunk, 'printing_finish_id',
      (q) => q.eq('provider', basis.provider).eq('currency', basis.currency)
              .eq('market', basis.market).eq('price_type', basis.priceType),
    )))).flat()
  const cheapestNonfoil = new Map<string, string>()   // printing_id → finish_id
  const cheapestAny     = new Map<string, string>()   // printing_id → finish_id
  const priceByFinish   = new Map<string, number>()
  for (const cp of currents) {
    const p = Number(cp.price); if (!Number.isFinite(p) || p <= 0) continue
    const f = finishById.get(cp.printing_finish_id); if (!f) continue
    priceByFinish.set(f.id, p)
    const curAny = cheapestAny.get(f.printing_id)
    if (!curAny || p < (priceByFinish.get(curAny) ?? Infinity)) cheapestAny.set(f.printing_id, f.id)
    if (f.finish === 'nonfoil') {
      const curNf = cheapestNonfoil.get(f.printing_id)
      if (!curNf || p < (priceByFinish.get(curNf) ?? Infinity)) cheapestNonfoil.set(f.printing_id, f.id)
    }
  }
  // Basket: printing_id → chosen finish_id (nonfoil-preferred).
  const basketByPrinting = new Map<string, string>()
  for (const p of prints) {
    const nf = cheapestNonfoil.get(p.id) ?? cheapestAny.get(p.id)
    if (nf) basketByPrinting.set(p.id, nf)
  }
  const basketFinishIds = Array.from(new Set(Array.from(basketByPrinting.values())))
  if (basketFinishIds.length === 0) return

  // 4. 30D observations for exactly the basket finishes. This is the
  //    biggest table and needs proper pagination (previous impl
  //    silently truncated at 1000 rows).
  const since = new Date()
  since.setUTCDate(since.getUTCDate() - 30)
  const sinceIso = since.toISOString().slice(0, 10)

  type ObsRow = { printing_finish_id: string; observed_on: string; price: number }
  type Agg = { earliest: { d: string; p: number }; latest: { d: string; p: number } }
  const byFinish = new Map<string, Agg>()
  const obsChunks: string[][] = []
  for (let i = 0; i < basketFinishIds.length; i += OBS_CHUNK) obsChunks.push(basketFinishIds.slice(i, i + OBS_CHUNK))
  const obsRows: ObsRow[] = (await Promise.all(obsChunks.map((chunk) =>
    collectPaged<ObsRow>(supabase, 'mtg_price_observations', 'printing_finish_id, observed_on, price',
      'printing_finish_id', chunk, 'observed_on',
      (q) => q.eq('provider', basis.provider).eq('currency', basis.currency)
              .eq('market', basis.market).eq('price_type', basis.priceType)
              .or('is_anomalous.is.null,is_anomalous.eq.false')
              .gte('observed_on', sinceIso),
    )))).flat()
  for (const row of obsRows) {
    const p = Number(row.price); if (!Number.isFinite(p) || p <= 0) continue
    const cur = byFinish.get(row.printing_finish_id)
    if (!cur) { byFinish.set(row.printing_finish_id, { earliest: { d: row.observed_on, p }, latest: { d: row.observed_on, p } }); continue }
    if (row.observed_on < cur.earliest.d) cur.earliest = { d: row.observed_on, p }
    if (row.observed_on > cur.latest.d)   cur.latest   = { d: row.observed_on, p }
  }

  // 5. Fold per set. Only surface pct30d/abs30d when the basket clears
  //    both a size floor and the history-coverage threshold.
  type Bucket = { basketSize: number; withHistory: number; valueNow: number; valueThen: number }
  const buckets = new Map<string, Bucket>()
  for (const code of setCodes) buckets.set(code, { basketSize: 0, withHistory: 0, valueNow: 0, valueThen: 0 })
  for (const [pid, finishId] of Array.from(basketByPrinting.entries())) {
    const p = printsById.get(pid); if (!p) continue
    const bucket = buckets.get(p.set_code); if (!bucket) continue
    bucket.basketSize += 1
    const hist = byFinish.get(finishId)
    if (hist && hist.earliest.d !== hist.latest.d) {
      bucket.withHistory += 1
      bucket.valueNow  += hist.latest.p
      bucket.valueThen += hist.earliest.p
    }
  }
  for (const [code, b] of Array.from(buckets.entries())) {
    const cur = out.get(code); if (!cur) continue
    const coverage = b.basketSize > 0 ? b.withHistory / b.basketSize : 0
    const enough =
      b.withHistory >= MIN_HISTORY_BASKET_SIZE &&
      coverage >= HISTORY_COVERAGE_THRESHOLD &&
      b.valueThen > 0
    if (!enough) continue
    const pct = (b.valueNow - b.valueThen) / b.valueThen
    const abs = round2(b.valueNow - b.valueThen)
    out.set(code, { ...cur, pct30d: pct, abs30d: abs })
  }
}

// Collect all rows for a single .in() chunk, paginating past the
// Postgrest default 1000-row cap. The old fallback pipeline this
// replaces silently stopped at 1000 rows per call, which is exactly
// the bug that produced "8/8 priced" for a 426-card set.
//
// Pagination requires a stable ordering. Callers pass an order column
// (usually the primary key or a natural composite) so range slices do
// not overlap or drop rows.
async function collectPaged<T>(
  supabase: ReturnType<typeof getSupabaseServiceClient>,
  table: string,
  columns: string,
  key: string,
  keyValues: string[],
  orderBy: string,
  where: (q: any) => any,
): Promise<T[]> {
  const out: T[] = []
  let from = 0
  const HARD_CAP = 200_000
  // eslint-disable-next-line no-constant-condition
  while (true) {
    const end = from + OBS_PAGE_SIZE - 1
    const q = where(
      supabase.from(table).select(columns).in(key, keyValues).order(orderBy, { ascending: true }),
    ).range(from, end)
    const { data, error } = await q
    if (error) {
      console.warn(`collectPaged(${table}) error at rows ${from}-${end}:`, error.message)
      return out
    }
    const batch = (data ?? []) as T[]
    out.push(...batch)
    if (batch.length < OBS_PAGE_SIZE) return out
    from += OBS_PAGE_SIZE
    if (from >= HARD_CAP) {
      console.warn(`collectPaged(${table}) hit hard cap ${HARD_CAP}, stopping`)
      return out
    }
  }
}

function round2(n: number): number { return Math.round(n * 100) / 100 }
