// src/lib/mtg/prices.ts
// Server-only pricing queries.
// mtg_current_prices + mtg_price_observations are RLS-locked to
// service_role. All access here goes through the service-role client
// and must NEVER be called from a client component.

import 'server-only'
import { getSupabaseServiceClient } from '@/lib/supabaseService'

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

/** Preferred USD-paper-retail order — used to pick a single "headline"
 *  price when we want one number. This is a display convention only
 *  and does NOT imply any commercial redistribution decision. */
const PREFERRED_PROVIDER_ORDER = [
  'tcgplayer',
  'cardkingdom',
  'cardmarket',
  'manapool',
  'cardhoarder',
]

/** All current-price rows for a set of printing_finish ids. Returns
 *  a Map keyed by printing_finish_id for O(1) lookup on card pages.
 *  Chunks the `in(...)` clause because PostgREST + supabase-js gets
 *  slow / occasionally returns null with large IN lists. */
const IN_CHUNK = 100

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
 *  Priority: paper USD retail from the preferred provider list.
 *  Returns null if no matching row. */
export function pickHeadlinePrice(rows: MtgCurrentPrice[] | undefined): MtgCurrentPrice | null {
  if (!rows || rows.length === 0) return null
  const candidates = rows.filter(
    (r) => r.market === 'paper' && r.currency === 'USD' && r.price_type === 'retail'
  )
  if (candidates.length === 0) return null
  // Preferred provider order, then any survivor.
  for (const provider of PREFERRED_PROVIDER_ORDER) {
    const found = candidates.find((r) => r.provider === provider)
    if (found) return found
  }
  return candidates[0]
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
    .eq('is_anomalous', false)

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

/** For a list of printing ids, return the freshest paper-USD-retail
 *  price for each printing's nonfoil finish (falling back to any
 *  finish). Used to show a headline price on the set page grid. */
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
