-- ============================================================================
-- STATUS: DEFERRED — DO NOT APPLY
-- ============================================================================
--
-- This file is a design draft written during Stage 1D planning and was
-- explicitly REJECTED from the approved Stage 1D scope. It is retained
-- as a design record only. It must NOT be run against production.
--
-- Location: docs/deferred-migrations/ (deliberately outside migrations/).
--
-- If any of these ideas is revived in a later phase, promote it to a
-- new file under migrations/ with a fresh date + serial, do not simply
-- move this file back.
-- ============================================================================

-- migrations/2026-09-15f-market-import-runs-provider-widen-daily.sql
-- ============================================================================
-- Widen market_import_runs.provider CHECK to include the Stage 1D daily
-- pipeline's summary rows (provider='mtgprices_daily'). Additive.
-- ============================================================================
--
-- Why
--   The Stage 1D orchestrator (pokeprices/mtg_daily_pipeline.py) writes a
--   single summary row per daily run that spans multiple sub-provider
--   ingests (scryfall + mtgjson + canonical derivation + anomaly). This
--   summary row cannot claim provider='mtgjson' because the mtgjson step
--   opens its own row of that provider; a distinct value is needed so
--   both rows coexist per day.
--
--   Provider name chosen: 'mtgprices_daily' — namespace-scoped, will not
--   collide with any real external provider.
--
-- Idempotency
--   Same DO-block-guarded discovery/drop/add pattern as 2026-09-14b.
--
-- ============================================================================

BEGIN;

DO $$
DECLARE
  r RECORD;
BEGIN
  FOR r IN
    SELECT c.conname
      FROM pg_constraint c
      JOIN pg_class     t ON t.oid = c.conrelid
      JOIN pg_namespace n ON n.oid = t.relnamespace
     WHERE n.nspname='public'
       AND t.relname='market_import_runs'
       AND c.contype='c'
       AND pg_get_constraintdef(c.oid) ~* '[(\s]provider[\s=]'
  LOOP
    EXECUTE format('ALTER TABLE public.market_import_runs DROP CONSTRAINT %I', r.conname);
  END LOOP;
END $$;

ALTER TABLE public.market_import_runs
  ADD CONSTRAINT market_import_runs_provider_check
  CHECK (provider IN (
    'pricecharting', 'scryfall', 'mtgjson', 'mtgprices_daily'
  ));

DO $$
DECLARE
  bad_rows bigint;
BEGIN
  SELECT COUNT(*) INTO bad_rows
    FROM public.market_import_runs
   WHERE provider NOT IN ('pricecharting','scryfall','mtgjson','mtgprices_daily');
  IF bad_rows > 0 THEN
    RAISE EXCEPTION 'refusing to commit: % existing rows use a provider outside the widened allow-list', bad_rows;
  END IF;
END $$;

COMMIT;
