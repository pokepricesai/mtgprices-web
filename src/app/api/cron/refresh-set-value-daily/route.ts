// src/app/api/cron/refresh-set-value-daily/route.ts
// Daily Vercel Cron endpoint. Recomputes today's row in
// mtg_set_value_daily so /browse's 7D / 30D / 90D chips stay
// accurate as time rolls forward. See migrations/2026-09-20-mtg-set-
// value-daily.sql.
//
// The underlying observations come from an external MTGJSON ingest
// (repo: pokeprices-ingest / GitHub Actions "nightly"). The ingest
// records completion in public.market_import_runs. This endpoint
// gates on that completion signal:
//
//   provider           = 'mtgjson'
//   parser_version     = 'mtgjson_all_prices@v1'
//   status             = 'success'
//   notes->>'only_date' = today's date
//
// The row count in mtg_price_observations for today is used as a
// secondary sanity check only.
//
// Idempotent: the RPC uses ON CONFLICT DO UPDATE, so re-firing the
// same date is safe.

import { NextResponse } from 'next/server'
import { getSupabaseServiceClient } from '@/lib/supabaseService'

// Guard against long tail: partition scans can take up to ~30s.
export const maxDuration = 60
export const dynamic = 'force-dynamic'

const BASIS = { provider: 'tcgplayer', currency: 'USD', market: 'paper', priceType: 'retail' } as const
const OBS_SANITY_MIN = 10_000     // typical daily total is ~146 000

export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET
  if (!secret) return NextResponse.json({ ok: false, reason: 'CRON_SECRET_not_set' }, { status: 500 })
  const auth = req.headers.get('authorization')
  if (auth !== `Bearer ${secret}`) return NextResponse.json({ ok: false, reason: 'unauthorized' }, { status: 401 })

  const supabase = getSupabaseServiceClient()
  const today = new Date().toISOString().slice(0, 10)

  // Primary gate: an mtgjson_all_prices@v1 run for TODAY must exist
  // with status='success' in market_import_runs. Without this, the
  // observations table may be partially populated - or empty - even
  // if there are already 10k rows from a stale earlier retry.
  const ingest = await getIngestRunForDate(supabase, today)
  if (!ingest.completed) {
    return NextResponse.json({
      ok: false,
      reason: 'ingest_not_complete',
      observed_on: today,
      details: ingest,
    }, { status: 202 })
  }

  // Secondary sanity check: even if market_import_runs says success,
  // require at least OBS_SANITY_MIN rows for the basis before we
  // write. Guards against a schema drift where the run row was
  // recorded but observations were not.
  const obsRows = await countObservationsForDate(supabase, today)
  if (obsRows < OBS_SANITY_MIN) {
    return NextResponse.json({
      ok: false,
      reason: 'ingest_sanity_check_failed',
      observed_on: today,
      observations: obsRows,
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
  return NextResponse.json({
    ok: true, observed_on: today, rows: data, ms,
    ingest_completed_at: ingest.completed_at,
  })
}

type IngestState = {
  completed: boolean
  completed_at: string | null
  status: string | null
  run_id: string | null
}

async function getIngestRunForDate(
  supabase: ReturnType<typeof getSupabaseServiceClient>,
  observedOn: string,
): Promise<IngestState> {
  // Most recent mtgjson_all_prices@v1 run whose notes.only_date is
  // today. Filtering on JSONB via ->>'only_date' with an EQ text
  // predicate is index-free but the row volume here is tiny (~200/yr).
  const { data, error } = await supabase
    .from('market_import_runs')
    .select('id, status, completed_at, notes')
    .eq('provider', 'mtgjson')
    .eq('parser_version', 'mtgjson_all_prices@v1')
    .order('started_at', { ascending: false })
    .limit(20)
  if (error) {
    console.warn('cron ingest-check failed:', error.message)
    return { completed: false, completed_at: null, status: null, run_id: null }
  }
  for (const row of (data ?? []) as Array<{ id: string; status: string; completed_at: string | null; notes: any }>) {
    const noteDate = (row.notes && row.notes.only_date) ?? null
    if (noteDate !== observedOn) continue
    return {
      completed: row.status === 'success' && !!row.completed_at,
      completed_at: row.completed_at,
      status: row.status,
      run_id: row.id,
    }
  }
  return { completed: false, completed_at: null, status: null, run_id: null }
}

async function countObservationsForDate(
  supabase: ReturnType<typeof getSupabaseServiceClient>,
  observedOn: string,
): Promise<number> {
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
    console.warn('cron obs-count failed:', error.message)
    return 0
  }
  return count ?? 0
}
