-- migrations/2026-09-14b-market-import-runs-provider-widen.sql
-- ============================================================================
-- Widen market_import_runs.provider CHECK to accept 'scryfall' + 'mtgjson'.
-- ============================================================================
--
-- Discovery
--   During Stage 1B (fresh Scryfall catalogue ingestion in the sister
--   Python scraper repo) the first attempt to open a market_import_runs
--   row with provider='scryfall' failed with:
--
--     23514  new row for relation "market_import_runs" violates check
--            constraint "market_import_runs_provider_check"
--
--   The existing CHECK only permits 'pricecharting'. Every current
--   market_import_runs row uses that value.
--
-- Scope
--   Additive, non-destructive. Widens the allow-list to include the
--   two providers Stage 1B (scryfall) and Stage 1C (mtgjson) will
--   need. Does NOT change any existing row, does NOT alter any other
--   table, does NOT touch legacy MTG or Pokemon data.
--
-- Idempotency
--   Uses DO-block guarded DROP CONSTRAINT / ADD CONSTRAINT. Re-apply
--   is a no-op: if the new constraint definition already exists it is
--   preserved; otherwise the old one is dropped and the new one added.
--
-- Post-apply state
--   market_import_runs.provider now accepts:
--     'pricecharting'   (existing — Pokemon side, unchanged)
--     'scryfall'        (MTGPrices Stage 1B — catalogue + game data)
--     'mtgjson'         (MTGPrices Stage 1C — pricing + reconciliation)
--
-- ============================================================================

BEGIN;

-- Discover and drop any CHECK constraint on the ``provider`` column of
-- public.market_import_runs. Supabase auto-names CHECK constraints so
-- the literal name is unstable — we discover by inspecting
-- pg_get_constraintdef. Filter matches specifically the provider
-- column (not source, not status, not anything else) by requiring the
-- constraint definition to reference the word 'provider' preceded by
-- either an open-parens or whitespace and followed by whitespace or
-- equals — that pattern matches Postgres's canonical serialisation of
-- ``CHECK ((provider = ANY (...))`` and equivalents, but does NOT
-- match ``source = ANY (...)`` or ``status = ANY (...)`` or any
-- constraint text that merely contains the substring "provider" as
-- part of another identifier.
DO $$
DECLARE
  r RECORD;
BEGIN
  FOR r IN
    SELECT c.conname
      FROM pg_constraint c
      JOIN pg_class     t ON t.oid = c.conrelid
      JOIN pg_namespace n ON n.oid = t.relnamespace
     WHERE n.nspname = 'public'
       AND t.relname = 'market_import_runs'
       AND c.contype = 'c'
       AND pg_get_constraintdef(c.oid) ~* '[(\s]provider[\s=]'
  LOOP
    EXECUTE format(
      'ALTER TABLE public.market_import_runs DROP CONSTRAINT %I',
      r.conname
    );
  END LOOP;
END $$;

ALTER TABLE public.market_import_runs
  ADD CONSTRAINT market_import_runs_provider_check
  CHECK (provider IN ('pricecharting', 'scryfall', 'mtgjson'));

-- Sanity checks — these are read-only; they raise NOTICE messages the
-- SQL editor surfaces but do not abort the transaction on their own.
-- They confirm the new state at COMMIT time.
DO $$
DECLARE
  total_rows        bigint;
  pricecharting_rows bigint;
  bad_rows          bigint;
BEGIN
  SELECT COUNT(*) INTO total_rows FROM public.market_import_runs;
  SELECT COUNT(*) INTO pricecharting_rows FROM public.market_import_runs WHERE provider = 'pricecharting';
  SELECT COUNT(*) INTO bad_rows
    FROM public.market_import_runs
   WHERE provider NOT IN ('pricecharting', 'scryfall', 'mtgjson');
  RAISE NOTICE 'market_import_runs total=%, pricecharting=%, non-allowlist=%',
    total_rows, pricecharting_rows, bad_rows;
  IF bad_rows > 0 THEN
    RAISE EXCEPTION 'refusing to commit: % existing rows use a provider not in the new allow-list',
      bad_rows;
  END IF;
END $$;

COMMIT;
