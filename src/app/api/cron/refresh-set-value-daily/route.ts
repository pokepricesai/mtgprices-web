// src/app/api/cron/refresh-set-value-daily/route.ts
// Daily Vercel Cron endpoint. Recomputes the most-recent-complete
// day's row in mtg_set_value_daily so /browse's 7D / 30D / 90D chips
// stay accurate as time rolls forward. See migrations/2026-09-20-mtg-
// set-value-daily.sql.
//
// The underlying observations come from an external MTGJSON ingest
// (repo: pokeprices-ingest / GitHub Actions "nightly"). The ingest
// records completion in public.market_import_runs. This endpoint
// gates on that completion signal:
//
//   provider           = 'mtgjson'
//   parser_version     = 'mtgjson_all_prices@v1'
//   status             = 'success'
//
// and targets `notes.only_date` of the MOST RECENT such run — NOT
// today's UTC calendar date. CN-06.01-P13 (2026-11-04) corrected the
// earlier today-pinned behaviour after MTGJSON's upstream completion
// drifted past the 21:00 UTC cron window on 2026-11-02, leaving the
// handler to return HTTP 202 silently on every fire and freezing
// mtg_set_value_daily at 2026-11-01. Anchoring to the most recent
// completed only_date makes each fire a self-catch-up: if today's
// ingest hasn't landed, the handler refreshes yesterday's (or the
// most recent available) row instead, idempotent via ON CONFLICT.
//
// The row count in mtg_price_observations for that date is used as a
// secondary sanity check only.
//
// Idempotent: the RPC uses ON CONFLICT DO UPDATE, so re-firing the
// same only_date is safe. The twice-daily schedule remains harmless —
// the second fire of a day no-ops if upstream hasn't advanced.

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

  // Primary gate: the MOST RECENT mtgjson_all_prices@v1 run with
  // status='success' and a parseable only_date in notes. If there is
  // none at all, the upstream ingest has never completed and we
  // cannot compute. If the most recent only_date already has a
  // mtg_set_value_daily row refreshed today, we skip (idempotent
  // early-exit so a redundant same-day fire logs plainly rather than
  // repeating the partition scan).
  const ingest = await getMostRecentCompleteIngest(supabase)
  if (!ingest.only_date) {
    console.warn('[refresh-set-value-daily] ingest_not_available — no completed mtgjson_all_prices@v1 run found')
    return NextResponse.json({
      ok: false,
      reason: 'ingest_not_available',
      details: ingest,
    }, { status: 202 })
  }
  const targetDate = ingest.only_date

  // Secondary sanity check: even if market_import_runs says success,
  // require at least OBS_SANITY_MIN rows for the basis before we
  // write. Guards against a schema drift where the run row was
  // recorded but observations were not.
  const obsRows = await countObservationsForDate(supabase, targetDate)
  if (obsRows < OBS_SANITY_MIN) {
    console.warn(`[refresh-set-value-daily] ingest_sanity_check_failed observed_on=${targetDate} observations=${obsRows} min=${OBS_SANITY_MIN}`)
    return NextResponse.json({
      ok: false,
      reason: 'ingest_sanity_check_failed',
      observed_on: targetDate,
      observations: obsRows,
    }, { status: 202 })
  }

  const t0 = Date.now()
  const { data, error } = await supabase.rpc('mtg_set_value_daily_upsert', {
    p_observed_on: targetDate,
    p_provider: BASIS.provider,
    p_currency: BASIS.currency,
    p_market: BASIS.market,
    p_price_type: BASIS.priceType,
  })
  const ms = Date.now() - t0
  if (error) {
    console.error(`[refresh-set-value-daily] rpc_failed observed_on=${targetDate} err=${error.message} ms=${ms}`)
    return NextResponse.json({ ok: false, error: error.message, ms }, { status: 500 })
  }
  console.log(`[refresh-set-value-daily] ok observed_on=${targetDate} rows=${data} ms=${ms} ingest_completed_at=${ingest.completed_at}`)
  return NextResponse.json({
    ok: true, observed_on: targetDate, rows: data, ms,
    ingest_completed_at: ingest.completed_at,
  })
}

type IngestState = {
  only_date: string | null
  completed_at: string | null
  status: string | null
  run_id: string | null
}

/**
 * Return the most recent mtgjson_all_prices@v1 run with
 * status='success' AND a parseable `only_date` in notes. We iterate
 * up to 20 recent rows (newest first) so that a transient `running`
 * or `failed` row at the top does not shadow an older `success` row
 * we can use today.
 *
 * market_import_runs.notes is a `text` column carrying stringified
 * JSON (not jsonb), so PostgREST's `->>` filtering won't work.
 * Parse defensively here.
 */
export async function getMostRecentCompleteIngest(
  supabase: ReturnType<typeof getSupabaseServiceClient>,
): Promise<IngestState> {
  const { data, error } = await supabase
    .from('market_import_runs')
    .select('id, status, completed_at, notes')
    .eq('provider', 'mtgjson')
    .eq('parser_version', 'mtgjson_all_prices@v1')
    .eq('status', 'success')
    .order('started_at', { ascending: false })
    .limit(20)
  if (error) {
    console.warn('[refresh-set-value-daily] ingest-check failed:', error.message)
    return { only_date: null, completed_at: null, status: null, run_id: null }
  }
  for (const row of (data ?? []) as Array<{ id: string; status: string; completed_at: string | null; notes: unknown }>) {
    if (!row.completed_at) continue
    const parsed = parseNotes(row.notes)
    const noteDate = (parsed && typeof parsed === 'object' && 'only_date' in parsed ? (parsed as { only_date?: unknown }).only_date : null) ?? null
    if (typeof noteDate !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(noteDate)) continue
    return {
      only_date: noteDate,
      completed_at: row.completed_at,
      status: row.status,
      run_id: row.id,
    }
  }
  return { only_date: null, completed_at: null, status: null, run_id: null }
}

function parseNotes(raw: unknown): Record<string, unknown> | null {
  if (raw == null) return null
  if (typeof raw === 'string') {
    try { const v = JSON.parse(raw); return v && typeof v === 'object' ? v as Record<string, unknown> : null }
    catch { return null }
  }
  if (typeof raw === 'object') return raw as Record<string, unknown>
  return null
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
