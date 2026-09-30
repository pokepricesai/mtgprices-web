// /api/admin/health/pricing-freshness — per-source × per-game freshness.
//
// Complements /api/admin/health (MTG-specific pipeline runs) by
// answering the question we couldn't answer for YGO/TCGPlayer on
// 2026-09-30: is a specific retail source's feed for a specific game
// updating, or has it silently gone flat?
//
// Categorisation lives in src/lib/health/pricing-freshness.ts and is
// shared with /api/cron/health-check.
//
// Auth: reuses the CRON_SECRET bearer pattern from /api/admin/health.

import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import {
  inspectAllSources,
  overallStatus,
  SOURCE_STALE_HOURS,
  SOURCE_WARNING_HOURS,
  INGEST_STALE_HOURS,
  INGEST_WARNING_HOURS,
  MIN_ROWS_FOR_CHANGE_CHECK,
} from '@/lib/health/pricing-freshness';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

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

  const sources = await inspectAllSources(sb);

  return NextResponse.json(
    {
      ok: true,
      generated_at: new Date().toISOString(),
      overall_status: overallStatus(sources),
      thresholds: {
        source_stale_hours: SOURCE_STALE_HOURS,
        source_warning_hours: SOURCE_WARNING_HOURS,
        ingest_stale_hours: INGEST_STALE_HOURS,
        ingest_warning_hours: INGEST_WARNING_HOURS,
        min_rows_for_change_check: MIN_ROWS_FOR_CHANGE_CHECK,
      },
      sources,
    },
    { status: 200 },
  );
}
