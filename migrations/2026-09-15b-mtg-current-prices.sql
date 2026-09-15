-- migrations/2026-09-15b-mtg-current-prices.sql
-- ============================================================================
-- Stage 1D — internal current-price lookup table.
-- Additive, non-destructive, idempotent.
-- ============================================================================
--
-- Why
--   Card-page reads should not scan the 63M-row mtg_price_observations
--   partitioned parent. This small table holds the latest observation
--   per (printing_finish, provider, market, currency, price_type,
--   condition) so a card-page keyed lookup returns in < 5 ms.
--
--   Cardinality is bounded-ish: expected ~800-900k rows steady state
--   (see the Stage 1D design doc). It grows slowly as new printings,
--   providers, finishes or market/price-type identities appear; there
--   is no scheduled pruning in Stage 1D.
--
-- Scope
--   * Table:     public.mtg_current_prices
--   * Index:     mtg_current_prices_finish_idx (finish-scoped lookups)
--   * Function:  public.refresh_mtg_current_prices(look_back_days INT)
--                — server-side reducer so ingestion never pages millions
--                  of raw observations through PostgREST.
--   * RLS:       enabled, NO anon/authenticated policies. Public
--                display of provider-attributed prices is a later
--                decision after provider licensing is resolved.
--
-- Storage
--   * Estimated heap ~135 MB, indexes ~120 MB, total ~260 MB — under
--     1 % of the 48 GB provisioned disk.
--
-- Idempotency
--   * CREATE TABLE IF NOT EXISTS + CREATE INDEX IF NOT EXISTS.
--
-- ============================================================================

BEGIN;

CREATE TABLE IF NOT EXISTS public.mtg_current_prices (
  printing_finish_id  UUID           NOT NULL REFERENCES public.mtg_printing_finishes(id) ON DELETE CASCADE,
  provider            TEXT           NOT NULL,
  market              TEXT           NOT NULL DEFAULT '',
  currency            TEXT           NOT NULL,
  price_type          TEXT           NOT NULL DEFAULT '',
  condition           TEXT           NOT NULL DEFAULT '',
  price               NUMERIC(14, 4) NOT NULL,
  observed_on         DATE           NOT NULL,
  ingestion_source    TEXT           NOT NULL,
  updated_at          TIMESTAMPTZ    NOT NULL DEFAULT NOW(),
  PRIMARY KEY (printing_finish_id, provider, market, currency, price_type, condition)
);

COMMENT ON TABLE  public.mtg_current_prices IS
  'Latest observed price per (finish, provider, market, currency, price_type, condition). Refreshed by the Stage 1D daily pipeline. Internal-only; no public read policy.';
COMMENT ON COLUMN public.mtg_current_prices.observed_on IS
  'observed_on of the source row this current-price entry was derived from. Used to identify stale last-known prices; no pruning is performed in Stage 1D.';

CREATE INDEX IF NOT EXISTS mtg_current_prices_finish_idx
  ON public.mtg_current_prices (printing_finish_id);

-- ─── RLS: enabled, no public policies ──────────────────────────────────────
--
-- Public/anon/authenticated exposure of provider-attributed prices is
-- deferred until legal review has completed. service_role bypasses RLS
-- for ingestion.
ALTER TABLE public.mtg_current_prices ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.mtg_current_prices FROM PUBLIC;
REVOKE ALL ON public.mtg_current_prices FROM anon;
REVOKE ALL ON public.mtg_current_prices FROM authenticated;

-- No SELECT policy is created here. When public display is approved,
-- a follow-up migration will add a targeted policy (likely gated on
-- a provider allow-list rather than an unconditional TRUE).

-- ─── Server-side refresh function ──────────────────────────────────────────
--
-- Reduces mtg_price_observations to the newest observation per unique
-- current-price identity within a caller-specified look-back window,
-- and INSERT … ON CONFLICT DO UPDATE-merges that reduction into
-- mtg_current_prices. Runs entirely inside the database; only the
-- summary row travels over HTTP.
--
-- Design
--   * ``look_back_days`` bounds the raw scan. Called with 3 for daily
--     incremental refreshes; 30 for the one-off initial population.
--   * DISTINCT ON keeps the newest observed_on per composite key.
--   * ON CONFLICT DO UPDATE with a WHERE clause protects against a
--     stale rerun overwriting fresher data.
--
-- Security
--   * SECURITY INVOKER (default). service_role has full table access
--     and bypasses RLS; no elevated privilege needed.
--   * SET search_path pinned so a malicious search_path cannot swap
--     tables under us.
--   * Fully schema-qualified references.
--   * EXECUTE granted only to service_role.

CREATE OR REPLACE FUNCTION public.refresh_mtg_current_prices(look_back_days INTEGER DEFAULT 3)
RETURNS TABLE(
  keys_upserted        BIGINT,
  distinct_finishes    BIGINT,
  latest_observed_on   DATE,
  provider_breakdown   JSONB
)
LANGUAGE plpgsql
SET search_path = pg_catalog, public
SET statement_timeout = '10min'   -- ETL function; must survive multi-million-row DISTINCT ON.
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

COMMENT ON FUNCTION public.refresh_mtg_current_prices(INTEGER) IS
  'Server-side reducer: DISTINCT ON over mtg_price_observations within a look-back window, ON CONFLICT DO UPDATE into mtg_current_prices. Callable only by service_role.';

REVOKE EXECUTE ON FUNCTION public.refresh_mtg_current_prices(INTEGER) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.refresh_mtg_current_prices(INTEGER) FROM anon;
REVOKE EXECUTE ON FUNCTION public.refresh_mtg_current_prices(INTEGER) FROM authenticated;
GRANT  EXECUTE ON FUNCTION public.refresh_mtg_current_prices(INTEGER) TO service_role;

-- ─── Post-condition sanity ──────────────────────────────────────────────────
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_tables WHERE schemaname='public' AND tablename='mtg_current_prices') THEN
    RAISE EXCEPTION 'mtg_current_prices not created';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
     WHERE n.nspname='public' AND c.relname='mtg_current_prices' AND c.relrowsecurity=true
  ) THEN
    RAISE EXCEPTION 'RLS is not enabled on mtg_current_prices';
  END IF;
  IF EXISTS (
    SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='mtg_current_prices'
  ) THEN
    RAISE EXCEPTION 'unexpected RLS policy present on mtg_current_prices — Stage 1D must ship with none';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname='public' AND p.proname='refresh_mtg_current_prices'
  ) THEN
    RAISE EXCEPTION 'refresh_mtg_current_prices function not created';
  END IF;
  RAISE NOTICE 'mtg_current_prices + refresh_mtg_current_prices ready (RLS on, no public policies)';
END $$;

COMMIT;
