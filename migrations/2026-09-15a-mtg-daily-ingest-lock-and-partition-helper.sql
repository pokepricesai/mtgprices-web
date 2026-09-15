-- migrations/2026-09-15a-mtg-daily-ingest-lock-and-partition-helper.sql
-- ============================================================================
-- Stage 1D — DB-backed run lock + partition-ensure helper.
-- Additive, non-destructive, idempotent.
-- ============================================================================
--
-- Why
--   The Stage 1C recovery audit showed two AllPrices bootstrap runs
--   overlapped. GitHub Actions' concurrency group alone is not
--   sufficient — manual runs, local runs and any future worker can
--   invoke the importer outside that scope. This migration installs
--   a database-backed lock that every ingestion path must acquire.
--
--   It also installs a SECURITY DEFINER helper that creates the next
--   monthly partition of ``mtg_price_observations`` on demand so the
--   daily pipeline never inserts into a missing partition.
--
-- Scope
--   * Table:     public.mtg_daily_ingest_locks (RLS + hard REVOKE)
--   * Function:  public.ensure_mtg_price_partition(DATE) — SECURITY
--                DEFINER, EXECUTE granted only to service_role.
--
-- Security
--   * RLS enabled on the lock table with NO policies for anon /
--     authenticated. service_role bypasses RLS.
--   * REVOKE ALL on the lock table from anon + authenticated + PUBLIC.
--   * Partition function:
--       - SET search_path = pg_catalog, public   (fixed inside function)
--       - Fully schema-qualified identifiers
--       - REVOKE EXECUTE from anon, authenticated, PUBLIC
--       - GRANT EXECUTE to service_role only
--       - Belt-and-braces regex assertion on the generated child name
--
-- Idempotency
--   * CREATE TABLE IF NOT EXISTS + CREATE OR REPLACE FUNCTION.
--   * Repeat runs are no-ops.
--
-- ============================================================================

BEGIN;

-- ─── mtg_daily_ingest_locks ─────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.mtg_daily_ingest_locks (
  lock_key             TEXT         PRIMARY KEY,
  acquired_at          TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  acquired_by          TEXT         NOT NULL,
  heartbeat_at         TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  expected_release_by  TIMESTAMPTZ  NOT NULL,
  metadata             JSONB
);

COMMENT ON TABLE public.mtg_daily_ingest_locks IS
  'DB-backed run gate for MTG ingestion jobs. INSERT … ON CONFLICT DO NOTHING is atomic acquire; DELETE releases.';

-- Enable RLS but deploy NO anon / authenticated policies. service_role
-- bypasses RLS and is the only intended writer/reader.
ALTER TABLE public.mtg_daily_ingest_locks ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.mtg_daily_ingest_locks FROM PUBLIC;
REVOKE ALL ON public.mtg_daily_ingest_locks FROM anon;
REVOKE ALL ON public.mtg_daily_ingest_locks FROM authenticated;

-- ─── ensure_mtg_price_partition ─────────────────────────────────────────────
-- Creates mtg_price_observations_YYYY_MM if missing. Idempotent.
--
-- Security posture:
--   * SECURITY DEFINER — runs as the migration author (a superuser role
--     inside Supabase). This is required so the daily pipeline (which
--     runs as service_role) can create partitions without needing
--     table-level CREATE grants on the schema.
--   * SET search_path = pg_catalog, public — prevents an attacker
--     manipulating search_path from swapping in a malicious pg_class or
--     pg_namespace.
--   * All object references inside the function body are schema-qualified.
--   * The generated identifier is asserted to match a tight regex
--     BEFORE it is interpolated into EXECUTE. Postgres' %I quoting is
--     already safe, but the regex assertion prevents surprising
--     behaviour if a caller passes an out-of-range DATE that to_char
--     silently formats into an unexpected shape.
--   * EXECUTE is granted only to service_role; anon / authenticated
--     cannot call it.

CREATE OR REPLACE FUNCTION public.ensure_mtg_price_partition(target_month DATE)
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  m          DATE;
  next_m     DATE;
  suffix     TEXT;
  child_name TEXT;
BEGIN
  m          := date_trunc('month', target_month)::date;
  next_m     := (m + interval '1 month')::date;
  suffix     := to_char(m, 'YYYY_MM');
  child_name := 'mtg_price_observations_' || suffix;

  -- Belt-and-braces identifier assertion. to_char('YYYY_MM') always
  -- produces digits + underscore, but defence-in-depth: refuse anything
  -- that does not match the exact expected shape.
  IF child_name !~ '^mtg_price_observations_[0-9]{4}_[0-9]{2}$' THEN
    RAISE EXCEPTION 'refusing to create partition with unexpected name: %', child_name;
  END IF;

  IF EXISTS (
    SELECT 1
      FROM pg_catalog.pg_class c
      JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
     WHERE n.nspname = 'public'
       AND c.relname = child_name
       AND c.relkind = 'r'
  ) THEN
    RETURN 'exists:' || child_name;
  END IF;

  EXECUTE format(
    'CREATE TABLE public.%I PARTITION OF public.mtg_price_observations FOR VALUES FROM (%L) TO (%L)',
    child_name, m, next_m
  );
  RETURN 'created:' || child_name;
END $$;

COMMENT ON FUNCTION public.ensure_mtg_price_partition(DATE) IS
  'Idempotent creator for the monthly mtg_price_observations partition covering the given date. Callable only by service_role.';

-- Restrict EXECUTE to service_role only.
REVOKE EXECUTE ON FUNCTION public.ensure_mtg_price_partition(DATE) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.ensure_mtg_price_partition(DATE) FROM anon;
REVOKE EXECUTE ON FUNCTION public.ensure_mtg_price_partition(DATE) FROM authenticated;
GRANT  EXECUTE ON FUNCTION public.ensure_mtg_price_partition(DATE) TO service_role;

-- ─── Post-condition sanity ──────────────────────────────────────────────────
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_class WHERE relname='mtg_daily_ingest_locks') THEN
    RAISE EXCEPTION 'mtg_daily_ingest_locks not created';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname='public' AND p.proname='ensure_mtg_price_partition'
  ) THEN
    RAISE EXCEPTION 'ensure_mtg_price_partition not created';
  END IF;
  RAISE NOTICE 'Stage 1D lock table + partition helper installed';
END $$;

COMMIT;
