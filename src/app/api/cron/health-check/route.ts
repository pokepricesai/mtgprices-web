// /api/cron/health-check — hourly operational monitor.
//
// Runs inspectAllSources() from the shared lib, compares each per-
// (game_id, source) status to the last-observed value in
// health_source_state, and writes append-only rows to health_alert_log
// on transitions. Edge-triggered by design: no re-log while a source
// stays stale between hourly runs.
//
// Also sweeps orphaned tcg_ingest_runs (status='running',
// finished_at IS NULL, older than STALE_RUN_HOURS) across ALL games.
// The existing refresh.mjs only sweeps for the specific game about to
// start — so YGO runs orphaned by a Vercel hard-kill lingered because
// no new YGO run followed within the sweep window. This global sweep
// closes that gap without touching genuinely-active runs.
//
// Auth: reuses CRON_SECRET bearer.
//
// Kill switch: HEALTH_CRON_ENABLED='false' pauses the alert writes but
// still returns the read-only status snapshot.
//
// NOTE ON YGO CACHE INVALIDATION:
//   Not this route's job. Ingest completion in refresh.mjs is what
//   fires cache invalidation — this route only observes.

import { NextResponse } from 'next/server';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import {
  inspectAllSources,
  overallStatus,
  SOURCE_STALE_HOURS,
  SOURCE_WARNING_HOURS,
  INGEST_STALE_HOURS,
  INGEST_WARNING_HOURS,
  MIN_ROWS_FOR_CHANGE_CHECK,
  type SourceReport,
} from '@/lib/health/pricing-freshness';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const STALE_RUN_HOURS = 1;
const UNKNOWN_ALERT_AFTER_HOURS = 48;

type SB = SupabaseClient<any, any, any>;

interface StateRow {
  game_id: string;
  source: string;
  status: string;
  category: string;
  since: string;
  updated_at: string;
  last_transition_at: string | null;
  prior_status: string | null;
  reasons: unknown;
  metrics: unknown;
}

interface TransitionEvent {
  game_id: string;
  source: string;
  from_status: string | null;
  to_status: string;
  from_category: string | null;
  to_category: string;
  reason: string;
}

function metricsFor(r: SourceReport) {
  return {
    newest_source_updated_at: r.newest_source_updated_at,
    newest_ingested_at: r.newest_ingested_at,
    source_age_hours: r.source_age_hours,
    ingest_age_hours: r.ingest_age_hours,
    today_daily_rows: r.today_daily_rows,
    yesterday_daily_rows: r.yesterday_daily_rows,
    pct_changed_today_vs_yday: r.pct_changed_today_vs_yday,
  };
}

async function computeAndPersistTransitions(
  sb: SB,
  reports: readonly SourceReport[],
): Promise<TransitionEvent[]> {
  const nowIso = new Date().toISOString();
  const { data: existingRows } = await sb.from('health_source_state').select('*');
  const existing = new Map<string, StateRow>();
  for (const r of (existingRows ?? []) as StateRow[]) {
    existing.set(`${r.game_id}|${r.source}`, r);
  }

  const transitions: TransitionEvent[] = [];
  const upserts: unknown[] = [];

  for (const r of reports) {
    const key = `${r.game_id}|${r.source}`;
    const prior = existing.get(key);
    const isNew = !prior;
    const statusChanged = prior && prior.status !== r.status;
    const categoryChanged = prior && prior.category !== r.category;

    // Unknown → alert only if it has persisted long enough. Fresh
    // unknowns (a genuinely new watchlist entry) don't page anyone.
    let shouldAlert = false;
    let reason = '';
    if (isNew) {
      shouldAlert = r.status !== 'healthy';
      reason = shouldAlert ? `first observation: ${r.category}` : '';
    } else if (statusChanged) {
      shouldAlert = true;
      reason = `status ${prior!.status} → ${r.status}`;
    } else if (categoryChanged) {
      // Category shift within the same status (e.g. source_stale →
      // ingest_stale) is still worth surfacing.
      shouldAlert = true;
      reason = `category ${prior!.category} → ${r.category} (status still ${r.status})`;
    } else if (r.status === 'unknown') {
      const sinceMs = Date.parse(prior!.since);
      const ageHours = (Date.now() - sinceMs) / (1000 * 60 * 60);
      if (
        ageHours >= UNKNOWN_ALERT_AFTER_HOURS
        && !prior!.last_transition_at
      ) {
        shouldAlert = true;
        reason = `unknown for ${Math.round(ageHours)}h — never ingested?`;
      }
    }

    if (shouldAlert) {
      const ev: TransitionEvent = {
        game_id: r.game_id,
        source: r.source,
        from_status: prior?.status ?? null,
        to_status: r.status,
        from_category: prior?.category ?? null,
        to_category: r.category,
        reason,
      };
      transitions.push(ev);
    }

    upserts.push({
      game_id: r.game_id,
      source: r.source,
      status: r.status,
      category: r.category,
      // Preserve `since` if status is unchanged; otherwise stamp now.
      since:
        !prior || prior.status !== r.status ? nowIso : prior.since,
      updated_at: nowIso,
      last_transition_at:
        !prior ? nowIso
        : prior.status !== r.status ? nowIso
        : prior.last_transition_at,
      prior_status:
        !prior ? null
        : prior.status !== r.status ? prior.status
        : prior.prior_status,
      reasons: r.reasons,
      metrics: metricsFor(r),
    });
  }

  if (upserts.length > 0) {
    const { error } = await sb.from('health_source_state').upsert(upserts as never, {
      onConflict: 'game_id,source',
    });
    if (error) throw new Error(`health_source_state upsert failed: ${error.message}`);
  }

  if (transitions.length > 0) {
    const alertRows = transitions.map((t) => {
      const rpt = reports.find(
        (r) => r.game_id === t.game_id && r.source === t.source,
      )!;
      return {
        game_id: t.game_id,
        source: t.source,
        from_status: t.from_status,
        to_status: t.to_status,
        from_category: t.from_category,
        to_category: t.to_category,
        reasons: { transition_reason: t.reason, detail: rpt.reasons },
        metrics: metricsFor(rpt),
      };
    });
    const { error } = await sb.from('health_alert_log').insert(alertRows as never);
    if (error) throw new Error(`health_alert_log insert failed: ${error.message}`);

    // Log prominently so Vercel runtime logs surface transitions even
    // before an email/Slack transport is wired.
    for (const t of transitions) {
      const rpt = reports.find(
        (r) => r.game_id === t.game_id && r.source === t.source,
      );
      console.warn(
        `[health-alert] ${t.game_id}/${t.source}: ${t.from_status ?? '(new)'} → ${t.to_status}`,
        { reason: t.reason, detail: rpt?.reasons, metrics: rpt ? metricsFor(rpt) : null },
      );
    }
  }

  return transitions;
}

interface SweptRun {
  id: string;
  game_id: string;
  resource: string;
  age_hours: number;
}

async function sweepOrphanedRuns(sb: SB): Promise<SweptRun[]> {
  const cutoff = new Date(Date.now() - STALE_RUN_HOURS * 60 * 60 * 1000).toISOString();
  const { data: stale } = await sb
    .from('tcg_ingest_runs')
    .select('id, game_id, resource, started_at, notes')
    .eq('status', 'running')
    .is('finished_at', null)
    .lt('started_at', cutoff)
    .order('started_at', { ascending: true });

  const swept: SweptRun[] = [];
  const nowIso = new Date().toISOString();
  for (const r of (stale ?? []) as Array<{
    id: string;
    game_id: string;
    resource: string;
    started_at: string;
    notes: Record<string, unknown> | null;
  }>) {
    const ageHours = Math.round(
      (Date.now() - Date.parse(r.started_at)) / (1000 * 60 * 60),
    );
    const { error } = await sb.from('tcg_ingest_runs').update({
      status: 'timed_out',
      finished_at: nowIso,
      notes: {
        ...(r.notes ?? {}),
        stop_reason: 'timed_out_swept_by_health_cron',
        swept_by: 'cron:health-check',
        swept_at: nowIso,
        original_started_at: r.started_at,
      },
    }).eq('id', r.id);
    if (!error) swept.push({ id: r.id, game_id: r.game_id, resource: r.resource, age_hours: ageHours });
  }

  if (swept.length > 0) {
    console.warn(
      `[health-check] swept ${swept.length} orphaned tcg_ingest_runs`,
      swept.map((s) => `${s.game_id}/${s.resource} (${s.age_hours}h old, id=${s.id})`),
    );
  }
  return swept;
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

  const startMs = Date.now();
  const disabled = (process.env.HEALTH_CRON_ENABLED ?? '').trim().toLowerCase() === 'false';

  const sources = await inspectAllSources(sb);

  let transitions: TransitionEvent[] = [];
  let swept: SweptRun[] = [];
  if (!disabled) {
    try {
      transitions = await computeAndPersistTransitions(sb, sources);
    } catch (err) {
      console.error('[health-check] transition persistence failed', err);
    }
    try {
      swept = await sweepOrphanedRuns(sb);
    } catch (err) {
      console.error('[health-check] orphan sweep failed', err);
    }
  }

  const overall = overallStatus(sources);
  if (overall !== 'healthy') {
    console.warn(`[health-check] overall=${overall}`, {
      counts: sources.reduce<Record<string, number>>((acc, s) => {
        acc[s.category] = (acc[s.category] ?? 0) + 1;
        return acc;
      }, {}),
    });
  }

  return NextResponse.json({
    ok: true,
    generated_at: new Date().toISOString(),
    duration_ms: Date.now() - startMs,
    overall_status: overall,
    disabled_persistence: disabled,
    thresholds: {
      source_stale_hours: SOURCE_STALE_HOURS,
      source_warning_hours: SOURCE_WARNING_HOURS,
      ingest_stale_hours: INGEST_STALE_HOURS,
      ingest_warning_hours: INGEST_WARNING_HOURS,
      min_rows_for_change_check: MIN_ROWS_FOR_CHANGE_CHECK,
      stale_run_hours: STALE_RUN_HOURS,
      unknown_alert_after_hours: UNKNOWN_ALERT_AFTER_HOURS,
    },
    sources,
    transitions,
    orphans_swept: swept,
  });
}
