// src/lib/mtg/prices.ts
// Server-only pricing queries.
// mtg_current_prices + mtg_price_observations are RLS-locked to
// service_role. All access here goes through the service-role client
// and must NEVER be called from a client component.

import 'server-only'
import { getSupabaseServiceClient } from '@/lib/supabaseService'
import { robustHeadlinePrice } from './ranking'
import { runStrictQueryWithRetry } from './strictRetry'

export type MtgCurrentPrice = {
  printing_finish_id: string
  provider: string
  market: string
  currency: string
  price_type: string
  condition: string
  price: number
  observed_on: string
  ingestion_source: string
}

export type MtgPricePoint = {
  observed_on: string
  price: number
}

/** All current-price rows for a set of printing_finish ids. Returns
 *  a Map keyed by printing_finish_id for O(1) lookup on card pages.
 *  Chunks the `in(...)` clause because PostgREST + supabase-js gets
 *  slow / occasionally returns null with large IN lists. */
const IN_CHUNK = 100

/** FAIL-CLOSED. Chunked IN query that silently `continue`s past
 *  errored chunks — safe for callers that tolerate missing finishes
 *  (set grid, homepage). **Do NOT use from a Full Route Cache / ISR
 *  caller** — a cached response could silently miss ~10% of its
 *  pricing. Use `getCurrentPricesForFinishesStrict`. */
export async function getCurrentPricesForFinishes(
  finishIds: string[]
): Promise<Map<string, MtgCurrentPrice[]>> {
  const out = new Map<string, MtgCurrentPrice[]>()
  if (!finishIds.length) return out
  const supabase = getSupabaseServiceClient()

  const chunks: string[][] = []
  for (let i = 0; i < finishIds.length; i += IN_CHUNK) chunks.push(finishIds.slice(i, i + IN_CHUNK))
  const results = await Promise.all(
    chunks.map((chunk) =>
      supabase
        .from('mtg_current_prices')
        .select('printing_finish_id, provider, market, currency, price_type, condition, price, observed_on, ingestion_source')
        .in('printing_finish_id', chunk)
    )
  )
  for (const { data, error } of results) {
    if (error) { console.error('getCurrentPricesForFinishes chunk error:', error); continue }
    for (const row of (data ?? []) as MtgCurrentPrice[]) {
      const arr = out.get(row.printing_finish_id) ?? []
      arr.push(row)
      out.set(row.printing_finish_id, arr)
    }
  }
  return out
}

/** Pick a single headline price from a set of current-price rows.
 *  Filters to paper USD retail, then delegates to robustHeadlinePrice
 *  for cross-source outlier suppression. A source's price is dropped
 *  when it exceeds CROSS_SOURCE_MAX_RATIO x the minimum of the other
 *  sources' prices. This is not a ceiling — a Black Lotus at $150k
 *  still ranks correctly when multiple sources agree. See ranking.ts. */
export function pickHeadlinePrice(rows: MtgCurrentPrice[] | undefined): MtgCurrentPrice | null {
  if (!rows || rows.length === 0) return null
  const candidates = rows.filter(
    (r) => r.market === 'paper' && r.currency === 'USD' && r.price_type === 'retail'
  )
  if (candidates.length === 0) return null
  return robustHeadlinePrice(candidates).price
}

// ─── 90-day history ─────────────────────────────────────────────────────

export type MtgHistoryQuery = {
  printingFinishId: string
  provider?: string
  market?: string
  currency?: string
  priceType?: string
  daysBack?: number
}

export type MtgHistorySeries = {
  provider: string
  market: string
  currency: string
  price_type: string
  points: MtgPricePoint[]
}

/** Fetch price history for a single printing_finish over a rolling
 *  window. When provider/market/currency/price_type are omitted the
 *  function returns the paper-USD-retail series across whichever
 *  providers have data. The (printing_finish_id, observed_on) index
 *  on mtg_price_observations makes this a fast partition-pruned scan.
 */
/** FAIL-CLOSED. Returns `[]` on error → cached empty chart.
 *  Use `getPriceHistoryStrict` on cacheable routes. */
export async function getPriceHistory(q: MtgHistoryQuery): Promise<MtgHistorySeries[]> {
  const supabase = getSupabaseServiceClient()
  const daysBack = q.daysBack ?? 90
  const since = new Date()
  since.setUTCDate(since.getUTCDate() - daysBack)
  const sinceIso = since.toISOString().slice(0, 10)

  let query = supabase
    .from('mtg_price_observations')
    .select('provider, market, currency, price_type, observed_on, price')
    .eq('printing_finish_id', q.printingFinishId)
    .gte('observed_on', sinceIso)
    // Historical bootstrap rows may not have is_anomalous set. Treat NULL
    // as "not flagged". Live-ingest rows explicitly set false/true.
    .or('is_anomalous.is.null,is_anomalous.eq.false')

  if (q.provider)   query = query.eq('provider', q.provider)
  if (q.market)     query = query.eq('market', q.market);       else query = query.eq('market', 'paper')
  if (q.currency)   query = query.eq('currency', q.currency);   else query = query.eq('currency', 'USD')
  if (q.priceType)  query = query.eq('price_type', q.priceType); else query = query.eq('price_type', 'retail')

  const { data, error } = await query
    .order('observed_on', { ascending: true })
    .limit(5000)
  if (error) {
    console.error('getPriceHistory error:', error)
    return []
  }

  const seriesMap = new Map<string, MtgHistorySeries>()
  for (const row of (data ?? []) as any[]) {
    const key = `${row.provider}|${row.market}|${row.currency}|${row.price_type}`
    let s = seriesMap.get(key)
    if (!s) {
      s = {
        provider: row.provider,
        market: row.market,
        currency: row.currency,
        price_type: row.price_type,
        points: [],
      }
      seriesMap.set(key, s)
    }
    s.points.push({ observed_on: row.observed_on, price: Number(row.price) })
  }
  return Array.from(seriesMap.values())
}

// ─── Aggregate helper for card grids ────────────────────────────────────

/** Finishes-by-printing map: printing_id → available finish strings.
 *  Chunked in the same way as prices so PostgREST likes the IN clause. */
export async function getFinishesByPrinting(printingIds: string[]): Promise<Map<string, string[]>> {
  const out = new Map<string, string[]>()
  if (!printingIds.length) return out
  const supabase = getSupabaseServiceClient()
  const chunks: string[][] = []
  for (let i = 0; i < printingIds.length; i += IN_CHUNK) chunks.push(printingIds.slice(i, i + IN_CHUNK))
  const results = await Promise.all(
    chunks.map((chunk) => supabase.from('mtg_printing_finishes').select('printing_id, finish').in('printing_id', chunk))
  )
  for (const { data, error } of results) {
    if (error) { console.error('getFinishesByPrinting chunk error:', error); continue }
    for (const row of data ?? []) {
      const arr = out.get((row as any).printing_id) ?? []
      arr.push((row as any).finish)
      out.set((row as any).printing_id, arr)
    }
  }
  return out
}

/** For a list of printing ids, return the freshest paper-USD-retail
 *  price for each printing's nonfoil finish (falling back to any
 *  finish). Used to show a headline price on the set page grid. */
/** FAIL-CLOSED. Internally silently drops any failing chunk of the
 *  finishes-by-printing lookup. Use `getHeadlinePricesByPrintingStrict`
 *  on cacheable routes. */
export async function getHeadlinePricesByPrinting(
  printingIds: string[]
): Promise<Map<string, number>> {
  const out = new Map<string, number>()
  if (!printingIds.length) return out
  const supabase = getSupabaseServiceClient()

  // Chunk + parallelise. Same PostgREST large-IN issue as above.
  const chunks: string[][] = []
  for (let i = 0; i < printingIds.length; i += IN_CHUNK) chunks.push(printingIds.slice(i, i + IN_CHUNK))
  const results = await Promise.all(
    chunks.map((chunk) => supabase.from('mtg_printing_finishes').select('id, printing_id, finish').in('printing_id', chunk))
  )
  const finishes: { id: string; printing_id: string; finish: string }[] = []
  for (const { data, error } of results) {
    if (error) { console.error('getHeadlinePricesByPrinting finish chunk error:', error); continue }
    for (const row of data ?? []) finishes.push(row as any)
  }
  if (finishes.length === 0) return out

  const finishById = new Map<string, { printing_id: string; finish: string }>()
  for (const f of finishes) finishById.set(f.id, { printing_id: f.printing_id, finish: f.finish })

  const finishIds = finishes.map((f) => f.id)
  const priceMap = await getCurrentPricesForFinishes(finishIds)

  for (const [finishId, rows] of Array.from(priceMap.entries())) {
    const meta = finishById.get(finishId)
    if (!meta) continue
    const headline = pickHeadlinePrice(rows)
    if (!headline) continue
    // Prefer nonfoil price; only take a foil/etched price if we do not
    // already have a nonfoil headline for this printing.
    const existing = out.get(meta.printing_id)
    const isNonfoil = meta.finish === 'nonfoil'
    if (existing === undefined || isNonfoil) {
      out.set(meta.printing_id, Number(headline.price))
    }
  }
  return out
}

// ─── Strict variants for cacheable callers ─────────────────────────
// Retry each Supabase stage up to 3 times with 100/200/400ms backoff
// and throw on persistent failure. Legitimate zero-rows pass through
// as empty results. Never silently drops a failing chunk.

/** Strict variant. Chunk failure → throws rather than silently
 *  dropping ~1/n of the pricing. Legitimate empty finishId list
 *  returns an empty Map immediately without touching the DB. */
export async function getCurrentPricesForFinishesStrict(
  finishIds: string[],
): Promise<Map<string, MtgCurrentPrice[]>> {
  const out = new Map<string, MtgCurrentPrice[]>()
  if (!finishIds.length) return out
  const supabase = getSupabaseServiceClient()

  const chunks: string[][] = []
  for (let i = 0; i < finishIds.length; i += IN_CHUNK) chunks.push(finishIds.slice(i, i + IN_CHUNK))

  const results = await Promise.all(chunks.map((chunk, idx) =>
    runStrictQueryWithRetry<MtgCurrentPrice[]>(
      `getCurrentPricesForFinishesStrict chunk=${idx + 1}/${chunks.length}`,
      async () => {
        const { data, error } = await supabase
          .from('mtg_current_prices')
          .select('printing_finish_id, provider, market, currency, price_type, condition, price, observed_on, ingestion_source')
          .in('printing_finish_id', chunk)
        if (error) return { ok: false, error }
        return { ok: true, value: (data ?? []) as MtgCurrentPrice[] }
      },
    ),
  ))

  for (const rows of results) {
    for (const row of rows) {
      const arr = out.get(row.printing_finish_id) ?? []
      arr.push(row)
      out.set(row.printing_finish_id, arr)
    }
  }
  return out
}

/** Strict variant. Query failure throws; legitimate zero history
 *  rows return `[]`. */
export async function getPriceHistoryStrict(q: MtgHistoryQuery): Promise<MtgHistorySeries[]> {
  const supabase = getSupabaseServiceClient()
  const daysBack = q.daysBack ?? 90
  const since = new Date()
  since.setUTCDate(since.getUTCDate() - daysBack)
  const sinceIso = since.toISOString().slice(0, 10)

  const rows = await runStrictQueryWithRetry<any[]>(
    `getPriceHistoryStrict finish=${q.printingFinishId} days=${daysBack}`,
    async () => {
      let query = supabase
        .from('mtg_price_observations')
        .select('provider, market, currency, price_type, observed_on, price')
        .eq('printing_finish_id', q.printingFinishId)
        .gte('observed_on', sinceIso)
        .or('is_anomalous.is.null,is_anomalous.eq.false')
      if (q.provider)  query = query.eq('provider', q.provider)
      if (q.market)    query = query.eq('market', q.market);     else query = query.eq('market', 'paper')
      if (q.currency)  query = query.eq('currency', q.currency); else query = query.eq('currency', 'USD')
      if (q.priceType) query = query.eq('price_type', q.priceType); else query = query.eq('price_type', 'retail')
      const { data, error } = await query.order('observed_on', { ascending: true }).limit(5000)
      if (error) return { ok: false, error }
      return { ok: true, value: (data ?? []) as any[] }
    },
  )

  const seriesMap = new Map<string, MtgHistorySeries>()
  for (const row of rows) {
    const key = `${row.provider}|${row.market}|${row.currency}|${row.price_type}`
    let s = seriesMap.get(key)
    if (!s) {
      s = { provider: row.provider, market: row.market, currency: row.currency, price_type: row.price_type, points: [] }
      seriesMap.set(key, s)
    }
    s.points.push({ observed_on: row.observed_on, price: Number(row.price) })
  }
  return Array.from(seriesMap.values())
}

/** Strict variant. Both the finishes-by-printing lookup AND the
 *  current-price lookup are strict. Chunk failure in either stage
 *  throws. */
export async function getHeadlinePricesByPrintingStrict(
  printingIds: string[],
): Promise<Map<string, number>> {
  const out = new Map<string, number>()
  if (!printingIds.length) return out
  const supabase = getSupabaseServiceClient()

  const chunks: string[][] = []
  for (let i = 0; i < printingIds.length; i += IN_CHUNK) chunks.push(printingIds.slice(i, i + IN_CHUNK))

  const finishChunks = await Promise.all(chunks.map((chunk, idx) =>
    runStrictQueryWithRetry<Array<{ id: string; printing_id: string; finish: string }>>(
      `getHeadlinePricesByPrintingStrict finish-chunk=${idx + 1}/${chunks.length}`,
      async () => {
        const { data, error } = await supabase
          .from('mtg_printing_finishes')
          .select('id, printing_id, finish')
          .in('printing_id', chunk)
        if (error) return { ok: false, error }
        return { ok: true, value: (data ?? []) as any }
      },
    ),
  ))
  const finishes = finishChunks.flat()
  if (finishes.length === 0) return out

  const finishById = new Map<string, { printing_id: string; finish: string }>()
  for (const f of finishes) finishById.set(f.id, { printing_id: f.printing_id, finish: f.finish })

  const finishIds = finishes.map((f) => f.id)
  const priceMap = await getCurrentPricesForFinishesStrict(finishIds)

  for (const [finishId, rows] of Array.from(priceMap.entries())) {
    const meta = finishById.get(finishId)
    if (!meta) continue
    const headline = pickHeadlinePrice(rows)
    if (!headline) continue
    const existing = out.get(meta.printing_id)
    const isNonfoil = meta.finish === 'nonfoil'
    if (existing === undefined || isNonfoil) {
      out.set(meta.printing_id, Number(headline.price))
    }
  }
  return out
}
