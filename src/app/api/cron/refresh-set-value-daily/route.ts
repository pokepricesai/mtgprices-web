// src/app/api/cron/refresh-set-value-daily/route.ts
// Daily Vercel Cron endpoint. Recomputes today's row in
// mtg_set_value_daily so the /browse 30D chip stays accurate as time
// rolls forward. See migrations/2026-09-20-mtg-set-value-daily.sql.
//
// The RPC pulls from mtg_price_observations. The MTGJSON daily
// ingest lands there around 02:30 UTC, so we schedule this endpoint
// slightly later at 03:15 UTC to consume the fresh data.

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
