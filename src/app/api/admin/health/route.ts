// /api/admin/health — auth-protected observability endpoint.
//
// Reports last-successful / currently-running / stale state across the
// four MTG pipelines (TCGGraph catalogue+prices, TCGGraph graded,
// MTGJSON historical, set-value daily) so a human or external monitor
// can determine feed health without database access.
//
// Auth: reuses the existing `CRON_SECRET` bearer pattern. Return 401
// on any mismatch. Never surface secrets, service-role keys, or raw
// error messages that could leak identifiers.

import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const FRESHNESS_HEALTHY_HOURS = 36;
const FRESHNESS_WARNING_HOURS = 72;
const STALE_RUN_MINUTES = 45;

function isoAgoHours(iso: string | null | undefined): number | null {
  if (!iso) return null;
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return null;
  return (Date.now() - t) / (1000 * 60 * 60);
}

function classifyFreshness(ageHours: number | null): 'healthy' | 'warning' | 'stale' | 'unknown' {
  if (ageHours == null) return 'unknown';
  if (ageHours <= FRESHNESS_HEALTHY_HOURS) return 'healthy';
  if (ageHours <= FRESHNESS_WARNING_HOURS) return 'warning';
  return 'stale';
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

  // ── TCGGraph catalogue refresh runs, MTG only ────────────────
  const [lastSuccessRes, runningRes, staleRes, latestPriceRes, latestGradedRes, latestSetValueRes, latestMtgjsonRes] = await Promise.all([
    sb.from('tcg_ingest_runs')
      .select('id, started_at, finished_at, status, pages_completed, credits_used, notes')
      .eq('game_id', 'mtg')
      .eq('resource', 'cards.full')
      .eq('status', 'success')
      .order('finished_at', { ascending: false })
      .limit(1)
      .maybeSingle(),
    sb.from('tcg_ingest_runs')
      .select('id, started_at, finished_at, status, pages_completed, notes')
      .eq('game_id', 'mtg')
      .eq('resource', 'cards.full')
      .eq('status', 'running')
      .is('finished_at', null)
      .order('started_at', { ascending: false })
      .limit(5),
    sb.from('tcg_ingest_runs')
      .select('id, started_at, status, notes')
      .eq('game_id', 'mtg')
      .eq('resource', 'cards.full')
      .eq('status', 'running')
      .is('finished_at', null)
      .lt('started_at', new Date(Date.now() - STALE_RUN_MINUTES * 60 * 1000).toISOString()),
    sb.from('tcg_market_prices_current')
      .select('updated_at')
      .eq('game_id', 'mtg')
      .order('updated_at', { ascending: false })
      .limit(1)
      .maybeSingle(),
    sb.from('tcg_graded_prices_current')
      .select('updated_at')
      .eq('game_id', 'mtg')
      .order('updated_at', { ascending: false })
      .limit(1)
      .maybeSingle(),
    sb.from('mtg_set_value_daily')
      .select('observed_on')
      .order('observed_on', { ascending: false })
      .limit(1)
      .maybeSingle(),
    sb.from('market_import_runs')
      .select('id, started_at, completed_at, status, parser_version, notes')
      .eq('provider', 'mtgjson')
      .eq('status', 'success')
      .order('completed_at', { ascending: false })
      .limit(1)
      .maybeSingle(),
  ]);

  const lastSuccess = lastSuccessRes.data ?? null;
  const running = runningRes.data ?? [];
  const stale = staleRes.data ?? [];
  const latestPriceUpdate = latestPriceRes.data?.updated_at ?? null;
  const latestGradedUpdate = latestGradedRes.data?.updated_at ?? null;
  const latestSetValueDay = latestSetValueRes.data?.observed_on ?? null;
  const latestMtgjson = latestMtgjsonRes.data ?? null;

  const priceAge = isoAgoHours(latestPriceUpdate);
  const gradedAge = isoAgoHours(latestGradedUpdate);
  const mtgjsonAge = isoAgoHours(latestMtgjson?.completed_at ?? null);
  // set_value.observed_on is a DATE — parse midnight UTC.
  const setValueAge = latestSetValueDay ? isoAgoHours(`${latestSetValueDay}T00:00:00Z`) : null;

  const report = {
    ok: true,
    generated_at: new Date().toISOString(),
    tcggraph_catalogue: {
      last_successful_run: lastSuccess
        ? {
            id: lastSuccess.id,
            started_at: lastSuccess.started_at,
            finished_at: lastSuccess.finished_at,
            pages_completed: lastSuccess.pages_completed,
            credits_used: lastSuccess.credits_used,
            stop_reason: (lastSuccess.notes as { stop_reason?: string } | null)?.stop_reason ?? null,
          }
        : null,
      currently_running: running.map((r) => ({
        id: r.id,
        started_at: r.started_at,
        pages_completed: r.pages_completed,
        heartbeat_at: (r.notes as { heartbeat_at?: string } | null)?.heartbeat_at ?? null,
        last_page: (r.notes as { last_page?: number } | null)?.last_page ?? null,
      })),
      stale_running_older_than_minutes: STALE_RUN_MINUTES,
      stale_running: stale.map((r) => ({ id: r.id, started_at: r.started_at })),
    },
    tcggraph_price_feed: {
      latest_updated_at: latestPriceUpdate,
      age_hours: priceAge != null ? Math.round(priceAge * 10) / 10 : null,
      freshness: classifyFreshness(priceAge),
    },
    tcggraph_graded_feed: {
      latest_updated_at: latestGradedUpdate,
      age_hours: gradedAge != null ? Math.round(gradedAge * 10) / 10 : null,
      freshness: classifyFreshness(gradedAge),
    },
    mtgjson_historical: {
      last_successful_run: latestMtgjson
        ? {
            id: latestMtgjson.id,
            completed_at: latestMtgjson.completed_at,
            parser_version: latestMtgjson.parser_version,
            only_date:
              typeof latestMtgjson.notes === 'string'
                ? (() => {
                    try {
                      const parsed = JSON.parse(latestMtgjson.notes) as { only_date?: string };
                      return parsed.only_date ?? null;
                    } catch {
                      return null;
                    }
                  })()
                : (latestMtgjson.notes as { only_date?: string } | null)?.only_date ?? null,
          }
        : null,
      age_hours: mtgjsonAge != null ? Math.round(mtgjsonAge * 10) / 10 : null,
      freshness: classifyFreshness(mtgjsonAge),
    },
    set_value_daily: {
      latest_observed_on: latestSetValueDay,
      age_hours: setValueAge != null ? Math.round(setValueAge * 10) / 10 : null,
      freshness: classifyFreshness(setValueAge),
    },
    thresholds: {
      healthy_hours: FRESHNESS_HEALTHY_HOURS,
      warning_hours: FRESHNESS_WARNING_HOURS,
      stale_run_minutes: STALE_RUN_MINUTES,
    },
  };
  return NextResponse.json(report, { status: 200 });
}
