// Shared freshness inspector used by:
//   - GET /api/admin/health/pricing-freshness  (on-demand, humans)
//   - GET /api/cron/health-check               (hourly, transitions)
//
// Both call inspectAllSources() so a single implementation defines
// what "healthy" means. The cron layers state-transition logic on top.
//
// The status categorisation distinguishes:
//   HEALTHY         source + ingest within expected cadence
//   SOURCE_STALE    upstream provider data is old; our ingest is fine
//   INGEST_STALE    our pipeline has not written recently
//   FROZEN_SNAPSHOT large feed showing repeated 0% day-over-day movement
//   WARNING         nearing thresholds but not yet stale
//   UNKNOWN         no rows exist for the pair (never ingested)

import type { SupabaseClient } from '@supabase/supabase-js';

export const SOURCE_STALE_HOURS = 48;
export const SOURCE_WARNING_HOURS = 30;
export const INGEST_STALE_HOURS = 24;
export const INGEST_WARNING_HOURS = 12;
export const MIN_ROWS_FOR_CHANGE_CHECK = 1000;

// Watchlist of (game_id, source) pairs. Adding an entry that has never
// ingested will report UNKNOWN forever and produce noise; only add
// pairs whose ingest is live.
export const WATCHLIST: readonly { game_id: string; source: string }[] = [
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

export type FreshnessCategory =
  | 'healthy'
  | 'source_stale'
  | 'ingest_stale'
  | 'frozen_snapshot'
  | 'warning'
  | 'unknown';

export interface SourceReport {
  game_id: string;
  source: string;
  newest_source_updated_at: string | null;
  newest_ingested_at: string | null;
  source_age_hours: number | null;
  ingest_age_hours: number | null;
  today_daily_rows: number | null;
  yesterday_daily_rows: number | null;
  pct_changed_today_vs_yday: number | null;
  category: FreshnessCategory;
  // A single-word rollup convenient for wiring to a red/amber/green
  // health probe. `stale` collapses source_stale + ingest_stale +
  // frozen_snapshot.
  status: 'healthy' | 'warning' | 'stale' | 'unknown';
  reasons: string[];
}

// Widen the SupabaseClient generics — we don't ship generated Database
// types on this side of the shared Supabase project.
type SB = SupabaseClient<any, any, any>;

interface DailySampleRow {
  tcg_printing_id: string;
  finish: string;
  currency: string;
  list_type: string;
  price: number | null;
}

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

export async function inspectSource(
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

  // Change-rate: sampled 500 rows from today, join back to yesterday.
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

  const sourceIsStale = sourceAge != null && sourceAge > SOURCE_STALE_HOURS;
  const ingestIsStale = ingestAge != null && ingestAge > INGEST_STALE_HOURS;
  const frozenSnapshot =
    pctChanged != null
    && pctChanged === 0
    && (todayRows ?? 0) >= MIN_ROWS_FOR_CHANGE_CHECK;

  let category: FreshnessCategory;
  if (newestSourceIso == null) {
    category = 'unknown';
    reasons.push('no rows for this (game,source) pair');
  } else if (ingestIsStale) {
    // Ingest-stale is the most operationally actionable — we can fix it.
    // Surface it first even if source is also stale.
    category = 'ingest_stale';
    reasons.push(
      `no new writes for ${Math.round(ingestAge!)}h (threshold ${INGEST_STALE_HOURS}h) — our pipeline has stopped writing`,
    );
    if (sourceIsStale) {
      reasons.push(`(upstream also stale: source not moved in ${Math.round(sourceAge!)}h)`);
    }
  } else if (sourceIsStale) {
    category = 'source_stale';
    reasons.push(
      `upstream source not moved in ${Math.round(sourceAge!)}h (threshold ${SOURCE_STALE_HOURS}h) — provider freeze; ingest is running`,
    );
  } else if (frozenSnapshot) {
    category = 'frozen_snapshot';
    reasons.push(
      `0% of sampled prices changed today vs yesterday across ${todayRows} rows — snapshot may be frozen upstream`,
    );
  } else if (
    (sourceAge != null && sourceAge > SOURCE_WARNING_HOURS)
    || (ingestAge != null && ingestAge > INGEST_WARNING_HOURS)
    || (todayRows ?? 0) === 0
  ) {
    category = 'warning';
    if (sourceAge != null && sourceAge > SOURCE_WARNING_HOURS) {
      reasons.push(`upstream source age ${Math.round(sourceAge)}h (warn @ ${SOURCE_WARNING_HOURS}h)`);
    }
    if (ingestAge != null && ingestAge > INGEST_WARNING_HOURS) {
      reasons.push(`ingest age ${Math.round(ingestAge)}h (warn @ ${INGEST_WARNING_HOURS}h)`);
    }
    if ((todayRows ?? 0) === 0) {
      reasons.push("today's daily snapshot has 0 rows despite having current rows for this pair");
    }
  } else {
    category = 'healthy';
  }

  const status: SourceReport['status'] =
    category === 'healthy' ? 'healthy'
    : category === 'warning' ? 'warning'
    : category === 'unknown' ? 'unknown'
    : 'stale';

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
    category,
    status,
    reasons,
  };
}

export async function inspectAllSources(sb: SB): Promise<SourceReport[]> {
  const out: SourceReport[] = [];
  for (const w of WATCHLIST) {
    out.push(await inspectSource(sb, w.game_id, w.source));
  }
  return out;
}

export function overallStatus(reports: readonly SourceReport[]): SourceReport['status'] {
  if (reports.some((r) => r.status === 'stale')) return 'stale';
  if (reports.some((r) => r.status === 'warning')) return 'warning';
  if (reports.some((r) => r.status === 'unknown')) return 'unknown';
  return 'healthy';
}
