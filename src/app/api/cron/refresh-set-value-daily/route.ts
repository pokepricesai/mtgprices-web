// src/app/api/cron/refresh-set-value-daily/route.ts
// Daily Vercel Cron endpoint. Recomputes today's row in
// mtg_set_value_daily so the /browse 30D chip stays accurate as time
// rolls forward. See migrations/2026-09-20-mtg-set-value-daily.sql.
//
// The RPC pulls from mtg_price_observations, which is populated by an
// external MTGJSON ingest that lands on its own schedule. This
// endpoint refuses to write a row if the ingest for the requested
// date has not landed yet: an all-zero row would poison /browse's
// "most recent" anchor and hide every 30D chip.
//
// Observed behaviour: the 2026-09-21 ingest had not landed by 03:15
// UTC when the previous cron fired. It inserted 957 zero-value rows
// which had to be manually deleted. The pre-check below prevents
// that failure mode.

import { NextResponse } from 'next/server'
import { getSupabaseServiceClient } from '@/lib/supabaseService'

// Guard against long tail: partition scans can take up to ~30s.
export const maxDuration = 60
export const dynamic = 'force-dynamic'

const BASIS = { provider: 'tcgplayer', currency: 'USD', market: 'paper', priceType: 'retail' } as const

export async function GET(req: Request) {
  // Vercel Cron authenticates itself via a shared secret. Reject
  // anything else so this endpoint is not scrapeable.
  const secret = process.env.CRON_SECRET
  if (!secret) return NextResponse.json({ ok: false, reason: 'CRON_SECRET_not_set' }, { status: 500 })
  const auth = req.headers.get('authorization')
  if (auth !== `Bearer ${secret}`) return NextResponse.json({ ok: false, reason: 'unauthorized' }, { status: 401 })

  const supabase = getSupabaseServiceClient()
  const today = new Date().toISOString().slice(0, 10)

  // Guard: refuse to upsert if the ingest for today has not landed
  // yet. The check is a light row-count against the same basis. Any
  // non-zero count means at least some observations for today are
  // present; the RPC will then produce a coverage figure per set.
  const ingestOk = await hasIngestForDate(supabase, today)
  if (!ingestOk) {
    return NextResponse.json({
      ok: false,
      reason: 'ingest_not_landed',
      observed_on: today,
      note: 'mtg_price_observations has no rows for today on this basis; refusing to write a zero row',
    }, { status: 202 })
  }

  const t0 = Date.now()
  const { data, error } = await supabase.rpc('mtg_set_value_daily_upsert', {
    p_observed_on: today,
    p_provider: BASIS.provider,
    p_currency: BASIS.currency,
    p_market: BASIS.market,
    p_price_type: BASIS.priceType,
  })
  const ms = Date.now() - t0
  if (error) return NextResponse.json({ ok: false, error: error.message, ms }, { status: 500 })
  return NextResponse.json({ ok: true, observed_on: today, rows: data, ms })
}

async function hasIngestForDate(supabase: ReturnType<typeof getSupabaseServiceClient>, observedOn: string): Promise<boolean> {
  // head:true + count returns just the row count, no rows shipped.
  // Range-limit to one row so the count returns fast on a partition
  // that already has 100k+ rows for the day.
  const { count, error } = await supabase
    .from('mtg_price_observations')
    .select('*', { count: 'exact', head: true })
    .eq('observed_on', observedOn)
    .eq('provider', BASIS.provider)
    .eq('currency', BASIS.currency)
    .eq('market', BASIS.market)
    .eq('price_type', BASIS.priceType)
    .limit(1)
  if (error) {
    console.warn('refresh-set-value-daily: ingest-check failed, assuming ok:', error.message)
    return true
  }
  // Require a reasonable minimum so a partial ingest of a few hundred
  // rows still gets skipped. The typical daily total is ~146k rows.
  return (count ?? 0) >= 10_000
}
