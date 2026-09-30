// /api/admin/health/pricing-freshness — per-source × per-game freshness.
//
// Complements /api/admin/health (MTG-specific pipeline runs) by
// answering the question we couldn't answer for YGO/TCGPlayer on
// 2026-09-30: is a specific retail source's feed for a specific game
// updating, or has it silently gone flat?
//
// For each (game_id, source) pair on our fixed watchlist, reports:
//   - newest_source_updated_at  : max(updated_at) in tcg_market_prices_current
//   - newest_ingested_at        : max(ingested_at) in tcg_market_prices_current
//   - source_age_hours          : now - newest_source_updated_at
//   - ingest_age_hours          : now - newest_ingested_at
//   - today_daily_rows          : row count in tcg_market_price_daily for today
//   - yesterday_daily_rows      : row count for yesterday
//   - pct_changed_today_vs_yday : percentage of shared (printing,finish,currency)
//                                 whose price differs day-over-day
//   - status                    : healthy | warning | stale | unknown
//   - reasons                   : array of human-readable flags
//
// A source is flagged when:
//   - source_age_hours > SOURCE_STALE_HOURS (48h): the upstream feed
//     itself has not moved in two days. This is the exact signature the
//     YGO/TCGPlayer 2026-09-11 freeze produced.
//   - ingest_age_hours > INGEST_STALE_HOURS (24h): we've written no new
//     rows recently — our pipeline is stuck.
//   - today_daily_rows === 0 AND the source has >0 current rows: today's
//     write path failed.
//   - pct_changed_today_vs_yday === 0 for a feed with > MIN_ROWS_FOR_CHANGE
//     rows: everything moved together = probably a frozen snapshot.
//     (We deliberately do NOT alert on a single quiet day when the feed
//     is small — some feeds legitimately have days with 0 movement.)
//
// Auth: reuses the CRON_SECRET bearer pattern from /api/admin/health.

import { NextResponse } from 'next/server';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const SOURCE_STALE_HOURS = 48;
const SOURCE_WARNING_HOURS = 30;
const INGEST_STALE_HOURS = 24;
const INGEST_WARNING_HOURS = 12;
const MIN_ROWS_FOR_CHANGE_CHECK = 1000;

// Watchlist of (game_id, source) pairs. Keep this list conservative —
// adding a row that doesn't actually exist in tcg_market_prices_current
// will report unknown/zero forever and produce noise. Only add a pair
// once its ingest is live.
const WATCHLIST: readonly { game_id: string; source: string }[] = [
  { game_id: 'mtg',     source: 'tcggraph.tcgplayer' },
  { game_id: 'mtg',     source: 'tcggraph.cardmarket' },
  { game_id: 'ygo',     source: 'tcggraph.tcgplayer' },
  { game_id: 'ygo',     source: 'tcggraph.cardmarket' },
  { game_id: 'op',      source: 'tcggraph.tcgplayer' },
  { game_id: 'op',      source: 'tcggraph.cardmarket' },
  { game_id: 'lorcana', source: 'tcggraph.tcgplayer' },
  { game_id: 'lorcana', source: 'tcggraph.cardmarket' },
  { game_id: 'poke',    source: 'tcggraph.tcgplayer' },
  { game_id: 'poke',    source: 'tcggraph.cardmarket' },
];

function isoAgoHours(iso: string | null | undefined): number | null {
  if (!iso) return null;
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return null;
  return (Date.now() - t) / (1000 * 60 * 60);
}

function todayIsoDate(): string {
  return new Date().toISOString().slice(0, 10);
}

function ymdOffsetIso(offsetDays: number): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + offsetDays);
  return d.toISOString().slice(0, 10);
}

interface SourceReport {
  game_id: string;
  source: string;
  newest_source_updated_at: string | null;
  newest_ingested_at: string | null;
  source_age_hours: number | null;
  ingest_age_hours: number | null;
  today_daily_rows: number | null;
  yesterday_daily_rows: number | null;
  pct_changed_today_vs_yday: number | null;
  status: 'healthy' | 'warning' | 'stale' | 'unknown';
  reasons: string[];
}

// The @supabase/supabase-js `SupabaseClient` generic collapses to `never`
// when created without an injected Database type. Widen with `any` so
// the helper isn't inferred against schema-typed columns we don't have
// generated types for on this side of the shared Supabase project.
type SB = SupabaseClient<any, any, any>;

interface DailySampleRow {
  tcg_printing_id: string;
  finish: string;
  currency: string;
  list_type: string;
  price: number | null;
}

async function inspectSource(
  sb: SB,
  game_id: string,
  source: string,
): Promise<SourceReport> {
  const today = todayIsoDate();
  const yday = ymdOffsetIso(-1);

  const [newestUpdated, newestIngested, todayCount, ydayCount] = await Promise.all([
    sb.from('tcg_market_prices_current')
      .select('updated_at')
      .eq('game_id', game_id)
      .eq('source', source)
      .order('updated_at', { ascending: false, nullsFirst: false })
      .limit(1)
      .maybeSingle(),
    sb.from('tcg_market_prices_current')
      .select('ingested_at')
      .eq('game_id', game_id)
      .eq('source', source)
      .order('ingested_at', { ascending: false, nullsFirst: false })
      .limit(1)
      .maybeSingle(),
    sb.from('tcg_market_price_daily')
      .select('*', { count: 'exact', head: true })
      .eq('game_id', game_id)
      .eq('source', source)
      .eq('observed_on', today),
    sb.from('tcg_market_price_daily')
      .select('*', { count: 'exact', head: true })
      .eq('game_id', game_id)
      .eq('source', source)
      .eq('observed_on', yday),
  ]);

  const newestSourceIso =
    (newestUpdated.data as { updated_at?: string | null } | null)?.updated_at ?? null;
  const newestIngestedIso =
    (newestIngested.data as { ingested_at?: string | null } | null)?.ingested_at ?? null;
  const todayRows = todayCount.count ?? null;
  const ydayRows = ydayCount.count ?? null;

  // Change-rate: cheap approximation. Rather than pull every printing's
  // today+yday prices (potentially 100k rows), we sample the newest
  // 500 daily rows for today and look up their yesterday counterpart.
  let pctChanged: number | null = null;
  if ((todayRows ?? 0) > 0 && (ydayRows ?? 0) > 0) {
    const { data: todayData } = await sb.from('tcg_market_price_daily')
      .select('tcg_printing_id, finish, currency, list_type, price')
      .eq('game_id', game_id)
      .eq('source', source)
      .eq('observed_on', today)
      .limit(500);
    const todaySample = (todayData ?? []) as DailySampleRow[];
    if (todaySample.length > 0) {
      const printingIds = Array.from(new Set(todaySample.map((r) => r.tcg_printing_id)));
      const { data: ydayData } = await sb.from('tcg_market_price_daily')
        .select('tcg_printing_id, finish, currency, list_type, price')
        .eq('game_id', game_id)
        .eq('source', source)
        .eq('observed_on', yday)
        .in('tcg_printing_id', printingIds);
      const ydaySample = (ydayData ?? []) as DailySampleRow[];
      const ydayMap = new Map<string, number | null>();
      for (const r of ydaySample) {
        const key = `${r.tcg_printing_id}|${r.finish}|${r.currency}|${r.list_type}`;
        ydayMap.set(key, r.price);
      }
      let compared = 0;
      let changed = 0;
      for (const r of todaySample) {
        const key = `${r.tcg_printing_id}|${r.finish}|${r.currency}|${r.list_type}`;
        if (!ydayMap.has(key)) continue;
        compared += 1;
        const yPrice = ydayMap.get(key);
        const tPrice = r.price;
        if (yPrice == null || tPrice == null) {
          if (yPrice !== tPrice) changed += 1;
        } else if (Math.abs(Number(yPrice) - Number(tPrice)) > 1e-6) {
          changed += 1;
        }
      }
      pctChanged = compared > 0 ? Math.round((changed / compared) * 1000) / 10 : null;
    }
  }

  const sourceAge = isoAgoHours(newestSourceIso);
  const ingestAge = isoAgoHours(newestIngestedIso);
  const reasons: string[] = [];

  if (newestSourceIso == null) reasons.push('no rows for this (game,source) pair');
  if (sourceAge != null && sourceAge > SOURCE_STALE_HOURS) {
    reasons.push(
      `upstream source not moved in ${Math.round(sourceAge)}h (threshold ${SOURCE_STALE_HOURS}h) — probable upstream freeze`,
    );
  }
  if (ingestAge != null && ingestAge > INGEST_STALE_HOURS) {
    reasons.push(
      `no new writes for ${Math.round(ingestAge)}h (threshold ${INGEST_STALE_HOURS}h) — pipeline may be stuck`,
    );
  }
  if ((todayRows ?? 0) === 0 && newestSourceIso != null) {
    reasons.push("today's daily snapshot has 0 rows despite having current rows for this pair");
  }
  if (
    pctChanged != null
    && pctChanged === 0
    && (todayRows ?? 0) >= MIN_ROWS_FOR_CHANGE_CHECK
  ) {
    reasons.push(
      `0% of sampled prices changed today vs yesterday across ${todayRows} rows — snapshot may be frozen`,
    );
  }

  let status: SourceReport['status'];
  if (newestSourceIso == null) {
    status = 'unknown';
  } else if (
    (sourceAge != null && sourceAge > SOURCE_STALE_HOURS)
    || (ingestAge != null && ingestAge > INGEST_STALE_HOURS)
    || (pctChanged === 0 && (todayRows ?? 0) >= MIN_ROWS_FOR_CHANGE_CHECK)
  ) {
    status = 'stale';
  } else if (
    (sourceAge != null && sourceAge > SOURCE_WARNING_HOURS)
    || (ingestAge != null && ingestAge > INGEST_WARNING_HOURS)
    || (todayRows ?? 0) === 0
  ) {
    status = 'warning';
    if (sourceAge != null && sourceAge > SOURCE_WARNING_HOURS && sourceAge <= SOURCE_STALE_HOURS) {
      reasons.push(`upstream source age ${Math.round(sourceAge)}h (warn @ ${SOURCE_WARNING_HOURS}h)`);
    }
    if (ingestAge != null && ingestAge > INGEST_WARNING_HOURS && ingestAge <= INGEST_STALE_HOURS) {
      reasons.push(`ingest age ${Math.round(ingestAge)}h (warn @ ${INGEST_WARNING_HOURS}h)`);
    }
  } else {
    status = 'healthy';
  }

  return {
    game_id,
    source,
    newest_source_updated_at: newestSourceIso,
    newest_ingested_at: newestIngestedIso,
    source_age_hours: sourceAge != null ? Math.round(sourceAge * 10) / 10 : null,
    ingest_age_hours: ingestAge != null ? Math.round(ingestAge * 10) / 10 : null,
    today_daily_rows: todayRows,
    yesterday_daily_rows: ydayRows,
    pct_changed_today_vs_yday: pctChanged,
    status,
    reasons,
  };
}

export async function GET(req: Request) {
  const auth = req.headers.get('authorization') || '';
  const expected = `Bearer ${process.env.CRON_SECRET ?? ''}`;
  if (!process.env.CRON_SECRET || auth !== expected) {
    return NextResponse.json({ ok: false, error: 'unauthorized' }, { status: 401 });
  }

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    return NextResponse.json({ ok: false, error: 'supabase_env_missing' }, { status: 500 });
  }
  const sb = createClient(url, key, { auth: { persistSession: false } });

  const results: SourceReport[] = [];
  for (const w of WATCHLIST) {
    results.push(await inspectSource(sb, w.game_id, w.source));
  }

  const worst =
    results.some((r) => r.status === 'stale') ? 'stale'
    : results.some((r) => r.status === 'warning') ? 'warning'
    : results.some((r) => r.status === 'unknown') ? 'unknown'
    : 'healthy';

  return NextResponse.json(
    {
      ok: true,
      generated_at: new Date().toISOString(),
      overall_status: worst,
      thresholds: {
        source_stale_hours: SOURCE_STALE_HOURS,
        source_warning_hours: SOURCE_WARNING_HOURS,
        ingest_stale_hours: INGEST_STALE_HOURS,
        ingest_warning_hours: INGEST_WARNING_HOURS,
        min_rows_for_change_check: MIN_ROWS_FOR_CHANGE_CHECK,
      },
      sources: results,
    },
    { status: 200 },
  );
}
