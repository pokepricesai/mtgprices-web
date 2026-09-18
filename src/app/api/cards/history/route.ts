// GET /api/cards/history?finish=<id>&days=<n|all>
// Returns the paper USD retail price history for one printing_finish
// across every provider that has observations, in the shape the client
// CardPriceChart expects. Used to lazy load the "All" window without
// shipping every point in the initial page payload.
//
// Basis is locked to paper / USD / retail so a single chart never mixes
// currencies. Provider is intentionally NOT locked: multi provider
// visibility is what the chart wants.
//
// Row cap keeps this cheap even for cards with years of history. If we
// hit the cap we still return sensibly, but the client should treat it
// as approximate.

import { NextResponse } from 'next/server'
import { getSupabaseServiceClient } from '@/lib/supabaseService'

export const runtime = 'nodejs'
export const revalidate = 600

const MAX_ROWS = 6000
// Hard upper bound on the "All" window. Five years is more history than
// any current MTGJSON basket has, and prevents pathological scans on a
// missing index.
const MAX_DAYS = 5 * 365

export async function GET(req: Request) {
  const url = new URL(req.url)
  const finish = url.searchParams.get('finish')
  const daysRaw = url.searchParams.get('days') ?? '90'

  if (!finish || !/^[0-9a-f-]{8,}$/i.test(finish)) {
    return NextResponse.json({ error: 'invalid_finish' }, { status: 400 })
  }

  let daysBack: number
  if (daysRaw === 'all') daysBack = MAX_DAYS
  else {
    const n = parseInt(daysRaw, 10)
    if (!Number.isFinite(n) || n <= 0 || n > MAX_DAYS) {
      return NextResponse.json({ error: 'invalid_days' }, { status: 400 })
    }
    daysBack = n
  }

  const since = new Date()
  since.setUTCDate(since.getUTCDate() - daysBack)
  const sinceIso = since.toISOString().slice(0, 10)

  const supabase = getSupabaseServiceClient()
  const { data, error } = await supabase
    .from('mtg_price_observations')
    .select('provider, market, currency, price_type, observed_on, price')
    .eq('printing_finish_id', finish)
    .eq('market', 'paper')
    .eq('currency', 'USD')
    .eq('price_type', 'retail')
    .or('is_anomalous.is.null,is_anomalous.eq.false')
    .gte('observed_on', sinceIso)
    .order('observed_on', { ascending: true })
    .limit(MAX_ROWS)

  if (error) {
    console.error('history route error:', error)
    return NextResponse.json({ error: 'query_failed' }, { status: 500 })
  }

  type Row = { provider: string; market: string; currency: string; price_type: string; observed_on: string; price: number }
  const bySeries = new Map<string, { provider: string; points: { date: string; value: number }[] }>()
  for (const row of (data ?? []) as Row[]) {
    const price = Number(row.price)
    if (!Number.isFinite(price) || price <= 0) continue
    const key = row.provider
    let s = bySeries.get(key)
    if (!s) { s = { provider: row.provider, points: [] }; bySeries.set(key, s) }
    s.points.push({ date: row.observed_on, value: price })
  }

  const series = Array.from(bySeries.values())
  const truncated = (data?.length ?? 0) >= MAX_ROWS

  return NextResponse.json({
    finish,
    daysBack: daysRaw === 'all' ? 'all' : daysBack,
    truncated,
    series,
  })
}
