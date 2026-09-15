-- migrations/2026-09-15c-refresh-mtg-current-prices-timeout.sql
-- ============================================================================
-- Stage 1D hotfix — widen statement_timeout on refresh_mtg_current_prices.
-- Additive; CREATE OR REPLACE FUNCTION. No schema change.
-- ============================================================================
--
-- Discovery
--   Gate 4 (LIVE initial current-price population) hit
--   SQLSTATE 57014: canceling statement due to statement timeout.
--   Even look_back_days=3 (~2M raw rows to reduce) exceeded the
--   default PostgREST statement_timeout that service_role inherits
--   (~8-60 s depending on Supabase tier).
--
--   The reducer is a legitimate ETL operation and MUST be allowed to
--   run to completion. Raising the timeout at the FUNCTION level via
--   `SET statement_timeout` scopes the exception to just this function
--   — every other PostgREST call keeps the tight default.
--
-- Change
--   CREATE OR REPLACE FUNCTION with an added
--       SET statement_timeout = '10min'
--   clause. Body unchanged. Security posture unchanged
--   (SECURITY INVOKER, GRANT EXECUTE only to service_role).
--
-- Idempotency
--   Re-running is a no-op (CREATE OR REPLACE).
--
-- ============================================================================

BEGIN;

CREATE OR REPLACE FUNCTION public.refresh_mtg_current_prices(look_back_days INTEGER DEFAULT 3)
RETURNS TABLE(
  keys_upserted        BIGINT,
  distinct_finishes    BIGINT,
  latest_observed_on   DATE,
  provider_breakdown   JSONB
)
LANGUAGE plpgsql
SET search_path = pg_catalog, public
SET statement_timeout = '10min'
AS $$
DECLARE
  since       DATE := (CURRENT_DATE - GREATEST(look_back_days, 0));
  n_upserted  BIGINT;
BEGIN
  IF look_back_days IS NULL OR look_back_days < 0 THEN
    RAISE EXCEPTION 'look_back_days must be >= 0, got %', look_back_days;
  END IF;

  WITH src AS (
    SELECT DISTINCT ON (
             printing_finish_id, provider, market, currency, price_type, condition
           )
           printing_finish_id, provider, market, currency, price_type, condition,
           price, observed_on, ingestion_source
      FROM public.mtg_price_observations
     WHERE observed_on >= since
     ORDER BY printing_finish_id, provider, market, currency, price_type, condition,
              observed_on DESC
  ),
  ins AS (
    INSERT INTO public.mtg_current_prices AS cp (
      printing_finish_id, provider, market, currency, price_type, condition,
      price, observed_on, ingestion_source, updated_at
    )
    SELECT src.printing_finish_id, src.provider, src.market, src.currency,
           src.price_type, src.condition,
           src.price, src.observed_on, src.ingestion_source, NOW()
      FROM src
    ON CONFLICT (printing_finish_id, provider, market, currency, price_type, condition)
    DO UPDATE SET
      price            = EXCLUDED.price,
      observed_on      = EXCLUDED.observed_on,
      ingestion_source = EXCLUDED.ingestion_source,
      updated_at       = NOW()
    WHERE cp.observed_on <= EXCLUDED.observed_on
    RETURNING 1
  )
  SELECT COUNT(*) INTO n_upserted FROM ins;

  RETURN QUERY
  SELECT n_upserted                                       AS keys_upserted,
         (SELECT COUNT(DISTINCT printing_finish_id)
            FROM public.mtg_current_prices)::bigint       AS distinct_finishes,
         (SELECT MAX(observed_on)
            FROM public.mtg_current_prices)               AS latest_observed_on,
         (SELECT jsonb_object_agg(provider, cnt)
            FROM (
              SELECT provider, COUNT(*)::bigint AS cnt
                FROM public.mtg_current_prices
               GROUP BY provider
            ) t)                                          AS provider_breakdown;
END $$;

-- Grants + security posture unchanged. Re-issue them defensively so a
-- fresh application via a different environment ends up in the same
-- state as the 15b apply.
REVOKE EXECUTE ON FUNCTION public.refresh_mtg_current_prices(INTEGER) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.refresh_mtg_current_prices(INTEGER) FROM anon;
REVOKE EXECUTE ON FUNCTION public.refresh_mtg_current_prices(INTEGER) FROM authenticated;
GRANT  EXECUTE ON FUNCTION public.refresh_mtg_current_prices(INTEGER) TO service_role;

-- Post-condition
DO $$
DECLARE
  cfg text[];
BEGIN
  SELECT proconfig INTO cfg
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname='public' AND p.proname='refresh_mtg_current_prices';
  IF NOT ('statement_timeout=10min' = ANY(cfg)) THEN
    RAISE EXCEPTION 'expected statement_timeout=10min in proconfig, got %', cfg;
  END IF;
  IF NOT ('search_path=pg_catalog, public' = ANY(cfg)) THEN
    RAISE EXCEPTION 'expected search_path=pg_catalog, public in proconfig, got %', cfg;
  END IF;
  RAISE NOTICE 'refresh_mtg_current_prices now runs with statement_timeout=10min';
END $$;

COMMIT;
