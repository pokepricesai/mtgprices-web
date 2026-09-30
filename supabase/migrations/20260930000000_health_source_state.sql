-- migrations/2026-09-30-health-source-state.sql
--
-- State store for the hourly per-source pricing-freshness monitor
-- (/api/cron/health-check). The point of persisting state is to make
-- alerts *edge-triggered* rather than level-triggered — we want a loud
-- notification when a source flips healthy→stale, and silence while it
-- stays stale.
--
-- Two tables:
--
--   health_source_state
--     One row per (game_id, source). Records the CURRENT observed
--     status and when we first saw that status. Overwritten on each
--     run. The `since` column is preserved across identical status
--     observations so a caller can tell "how long has this been stale".
--
--   health_alert_log
--     Append-only log, one row per detected transition. This is what
--     an email / Slack integration would iterate over. Never truncated
--     by the app — pruning is manual.
--
-- Idempotent, safe to re-run.

create table if not exists public.health_source_state (
  game_id       text not null,
  source        text not null,
  status        text not null check (status in ('healthy','warning','stale','unknown')),
  category      text not null check (category in ('healthy','warning','source_stale','ingest_stale','frozen_snapshot','unknown')),
  since         timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  last_transition_at timestamptz,
  prior_status  text,
  reasons       jsonb,
  metrics       jsonb,
  primary key (game_id, source)
);

comment on table public.health_source_state is
  'Current freshness status per (game_id, source). One row per pair. Updated hourly by /api/cron/health-check.';

create table if not exists public.health_alert_log (
  id                bigserial primary key,
  game_id           text not null,
  source            text not null,
  from_status       text,
  to_status         text not null,
  from_category     text,
  to_category       text not null,
  transitioned_at   timestamptz not null default now(),
  reasons           jsonb,
  metrics           jsonb
);

create index if not exists ix_health_alert_log_recent
  on public.health_alert_log (transitioned_at desc);

create index if not exists ix_health_alert_log_pair_recent
  on public.health_alert_log (game_id, source, transitioned_at desc);

comment on table public.health_alert_log is
  'Append-only transitions for the freshness monitor. Attach email/Slack here later.';

-- Note: no RLS. Both tables are service-role only.
