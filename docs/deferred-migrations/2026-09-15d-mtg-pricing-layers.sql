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

-- migrations/2026-09-15d-mtg-pricing-layers.sql
-- ============================================================================
-- Stage 1D — three-tier pricing architecture.
--
--   A. mtg_current_prices          — fast latest-price lookup.
--   B. mtg_price_observations      — full raw provider observations (~90d rolling).
--   C. mtg_price_daily_canonical   — one representative MTGPrices daily value per
--                                    (printing_finish, market, currency), retained
--                                    INDEFINITELY.
--
--      Long-term provider aggregates (weekly + monthly) live in:
--        mtg_price_provider_weekly, mtg_price_provider_monthly
--
-- Additive; non-destructive; does not touch mtg_price_observations.
-- ============================================================================
--
-- Why
--   Retention policy: keep raw for ~90d, roll up older data, but never
--   lose MTGPrices' own permanent daily history. The canonical daily
--   series is what powers the standard long-term price chart in year 5.
--
-- Canonical methodology (see docs/mtg-canonical-pricing.md for full detail)
--   1. Only providers with mtg_provider_policies.derived_use_internal=true
--      contribute to the internal canonical series (INTERNAL rows have
--      series_scope='internal').
--   2. Only providers with derived_use_public=true contribute to the
--      public canonical series (series_scope='public').
--   3. Per (printing_finish, observed_on, market, currency):
--      - Filter to price_type='retail'.
--      - Filter observations to permitted providers per series_scope.
--      - Compute canonical = MEDIAN(price) of the surviving observations.
--      - sample_count records how many observations contributed.
--      - contributing_providers records which ones (audit trail).
--   4. On days where NO permitted provider has data, NO canonical row is
--      written for that series_scope. We do not carry-forward values.
--   5. methodology_version stamps every row so a future re-derivation
--      can be stored alongside the existing series without conflicting.
--
-- Partitioning
--   mtg_price_daily_canonical is partitioned by RANGE(observed_on),
--   YEARLY. Yearly granularity balances partition count (~10 partitions
--   over a decade) against per-partition size (~15 M rows/year at
--   current density if we retain public + internal + paper + mtgo).
--
--   The provider weekly/monthly aggregates are NOT partitioned; their
--   cardinality is much lower (per-week / per-month aggregation) and
--   they stay well under the size where partitioning helps.
--
-- ============================================================================

BEGIN;

-- ═══════════════════════════════════════════════════════════════════════════
-- A. mtg_current_prices
-- ═══════════════════════════════════════════════════════════════════════════
-- One row per (printing_finish, provider, market, currency, price_type).
-- Refreshed by the daily job to reflect the latest observation.
--
-- Rationale for a materialised table (rather than a view):
--   * Card pages need <10 ms latest-price reads.
--   * The alternative "SELECT DISTINCT ON" over 63 M rows requires an
--     efficient (finish, provider, market, currency, price_type, observed_on DESC)
--     index and still costs more than a keyed lookup on a small table.
--   * ~2-3 M rows steady state (117k printings × ~3 finishes × ~5 providers × 2 price_types
--     with density ~1 provider actually having each combo).

CREATE TABLE IF NOT EXISTS public.mtg_current_prices (
  printing_finish_id  UUID    NOT NULL REFERENCES public.mtg_printing_finishes(id) ON DELETE CASCADE,
  provider            TEXT    NOT NULL,
  market              TEXT    NOT NULL DEFAULT '',
  currency            TEXT    NOT NULL,
  price_type          TEXT    NOT NULL DEFAULT '',
  condition           TEXT    NOT NULL DEFAULT '',

  price               NUMERIC(14, 4) NOT NULL,
  observed_on         DATE    NOT NULL,
  ingestion_source    TEXT    NOT NULL,
  is_anomalous        BOOLEAN NOT NULL DEFAULT false,
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  PRIMARY KEY (printing_finish_id, provider, market, currency, price_type, condition)
);

COMMENT ON TABLE public.mtg_current_prices IS 'Latest price per (printing_finish, provider, market, currency, price_type, condition). Refreshed by the daily pipeline. Card-page read path.';

CREATE INDEX IF NOT EXISTS mtg_current_prices_finish_idx    ON public.mtg_current_prices (printing_finish_id);
CREATE INDEX IF NOT EXISTS mtg_current_prices_observed_idx  ON public.mtg_current_prices (observed_on);
CREATE INDEX IF NOT EXISTS mtg_current_prices_provider_idx  ON public.mtg_current_prices (provider);

ALTER TABLE public.mtg_current_prices ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS mtg_current_prices_read ON public.mtg_current_prices;
CREATE POLICY mtg_current_prices_read
  ON public.mtg_current_prices
  FOR SELECT
  TO anon, authenticated
  USING (true);

-- ═══════════════════════════════════════════════════════════════════════════
-- C. mtg_price_daily_canonical — permanent long-term series
-- ═══════════════════════════════════════════════════════════════════════════
-- Partitioned RANGE(observed_on), YEARLY. Retention: indefinite.

CREATE TABLE IF NOT EXISTS public.mtg_price_daily_canonical (
  id                     BIGINT GENERATED ALWAYS AS IDENTITY,
  printing_finish_id     UUID NOT NULL REFERENCES public.mtg_printing_finishes(id) ON DELETE RESTRICT,
  observed_on            DATE NOT NULL,
  market                 TEXT NOT NULL,          -- 'paper' | 'mtgo' | 'arena'
  currency               TEXT NOT NULL,          -- 'USD' | 'EUR' | 'TIX'
  series_scope           TEXT NOT NULL           -- 'internal' | 'public'
                         CHECK (series_scope IN ('internal','public')),

  price                  NUMERIC(14, 4) NOT NULL,
  sample_count           INTEGER      NOT NULL CHECK (sample_count > 0),
  contributing_providers TEXT[]       NOT NULL,
  methodology_version    TEXT         NOT NULL,
  price_type             TEXT         NOT NULL DEFAULT 'retail',

  created_at             TIMESTAMPTZ  NOT NULL DEFAULT NOW(),

  PRIMARY KEY (observed_on, id)
) PARTITION BY RANGE (observed_on);

COMMENT ON TABLE public.mtg_price_daily_canonical IS 'MTGPrices'' own permanent daily-price series. One representative retail value per (printing_finish, day, market, currency, series_scope). Never overwritten; historical values remain stable.';

CREATE UNIQUE INDEX IF NOT EXISTS mtg_price_daily_canonical_unique
  ON public.mtg_price_daily_canonical
    (printing_finish_id, observed_on, market, currency, series_scope, methodology_version, price_type);

CREATE INDEX IF NOT EXISTS mtg_price_daily_canonical_finish_date_idx
  ON public.mtg_price_daily_canonical (printing_finish_id, observed_on);

CREATE INDEX IF NOT EXISTS mtg_price_daily_canonical_date_brin
  ON public.mtg_price_daily_canonical USING BRIN (observed_on) WITH (pages_per_range = 32);

-- ─── Yearly partitions covering 2026-2030 (buffer). Extend annually. ────────
CREATE TABLE IF NOT EXISTS public.mtg_price_daily_canonical_2026
  PARTITION OF public.mtg_price_daily_canonical
  FOR VALUES FROM ('2026-01-01') TO ('2027-01-01');

CREATE TABLE IF NOT EXISTS public.mtg_price_daily_canonical_2027
  PARTITION OF public.mtg_price_daily_canonical
  FOR VALUES FROM ('2027-01-01') TO ('2028-01-01');

CREATE TABLE IF NOT EXISTS public.mtg_price_daily_canonical_2028
  PARTITION OF public.mtg_price_daily_canonical
  FOR VALUES FROM ('2028-01-01') TO ('2029-01-01');

CREATE TABLE IF NOT EXISTS public.mtg_price_daily_canonical_2029
  PARTITION OF public.mtg_price_daily_canonical
  FOR VALUES FROM ('2029-01-01') TO ('2030-01-01');

CREATE TABLE IF NOT EXISTS public.mtg_price_daily_canonical_2030
  PARTITION OF public.mtg_price_daily_canonical
  FOR VALUES FROM ('2030-01-01') TO ('2031-01-01');

ALTER TABLE public.mtg_price_daily_canonical ENABLE ROW LEVEL SECURITY;

-- Public read allowed on the whole table; series_scope filter applied at
-- query time by the reader (or via a future view mtg_price_daily_public).
DROP POLICY IF EXISTS mtg_price_daily_canonical_read ON public.mtg_price_daily_canonical;
CREATE POLICY mtg_price_daily_canonical_read
  ON public.mtg_price_daily_canonical
  FOR SELECT
  TO anon, authenticated
  USING (series_scope = 'public');
-- Internal series is NOT publicly readable; service role can still see it.

-- ─── Convenience view for the public series ────────────────────────────────
CREATE OR REPLACE VIEW public.v_mtg_price_daily AS
  SELECT
    printing_finish_id,
    observed_on,
    market,
    currency,
    price,
    price_type,
    sample_count,
    contributing_providers,
    methodology_version
  FROM public.mtg_price_daily_canonical
  WHERE series_scope = 'public';

COMMENT ON VIEW public.v_mtg_price_daily IS 'Public canonical daily price series — the standard long-term chart source. Filters to series_scope=''public''.';

-- ═══════════════════════════════════════════════════════════════════════════
-- D. mtg_price_provider_weekly + mtg_price_provider_monthly aggregates
-- ═══════════════════════════════════════════════════════════════════════════
-- Long-term retention of PER-PROVIDER shape after raw partitions are dropped.
-- Fed by a rollup step in the daily pipeline once a raw partition ages past
-- the 90-day retention.

CREATE TABLE IF NOT EXISTS public.mtg_price_provider_weekly (
  printing_finish_id  UUID    NOT NULL REFERENCES public.mtg_printing_finishes(id) ON DELETE RESTRICT,
  week_start          DATE    NOT NULL,          -- ISO week Monday
  provider            TEXT    NOT NULL,
  market              TEXT    NOT NULL DEFAULT '',
  currency            TEXT    NOT NULL,
  price_type          TEXT    NOT NULL DEFAULT '',
  condition           TEXT    NOT NULL DEFAULT '',

  price_min           NUMERIC(14, 4) NOT NULL,
  price_max           NUMERIC(14, 4) NOT NULL,
  price_median        NUMERIC(14, 4) NOT NULL,
  price_mean          NUMERIC(14, 4) NOT NULL,
  price_last          NUMERIC(14, 4) NOT NULL,
  sample_count        INTEGER        NOT NULL CHECK (sample_count > 0),

  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  PRIMARY KEY (
    printing_finish_id, week_start, provider,
    market, currency, price_type, condition
  )
);

COMMENT ON TABLE public.mtg_price_provider_weekly IS 'Weekly per-provider aggregate. Populated when raw observations age past retention.';

CREATE INDEX IF NOT EXISTS mtg_price_provider_weekly_week_idx
  ON public.mtg_price_provider_weekly (week_start);
CREATE INDEX IF NOT EXISTS mtg_price_provider_weekly_finish_idx
  ON public.mtg_price_provider_weekly (printing_finish_id, week_start);

CREATE TABLE IF NOT EXISTS public.mtg_price_provider_monthly (
  printing_finish_id  UUID    NOT NULL REFERENCES public.mtg_printing_finishes(id) ON DELETE RESTRICT,
  month_start         DATE    NOT NULL,          -- first day of month
  provider            TEXT    NOT NULL,
  market              TEXT    NOT NULL DEFAULT '',
  currency            TEXT    NOT NULL,
  price_type          TEXT    NOT NULL DEFAULT '',
  condition           TEXT    NOT NULL DEFAULT '',

  price_min           NUMERIC(14, 4) NOT NULL,
  price_max           NUMERIC(14, 4) NOT NULL,
  price_median        NUMERIC(14, 4) NOT NULL,
  price_mean          NUMERIC(14, 4) NOT NULL,
  price_last          NUMERIC(14, 4) NOT NULL,
  sample_count        INTEGER        NOT NULL CHECK (sample_count > 0),

  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  PRIMARY KEY (
    printing_finish_id, month_start, provider,
    market, currency, price_type, condition
  )
);

COMMENT ON TABLE public.mtg_price_provider_monthly IS 'Monthly per-provider aggregate for deep history.';

CREATE INDEX IF NOT EXISTS mtg_price_provider_monthly_month_idx
  ON public.mtg_price_provider_monthly (month_start);
CREATE INDEX IF NOT EXISTS mtg_price_provider_monthly_finish_idx
  ON public.mtg_price_provider_monthly (printing_finish_id, month_start);

ALTER TABLE public.mtg_price_provider_weekly  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.mtg_price_provider_monthly ENABLE ROW LEVEL SECURITY;

-- Weekly/monthly aggregates inherit each provider's public policy: we
-- gate at query time via a JOIN to mtg_provider_policies where
-- public_display=true. RLS here is permissive on read; the JOIN in
-- application code is the gate.
DROP POLICY IF EXISTS mtg_price_provider_weekly_read  ON public.mtg_price_provider_weekly;
CREATE POLICY mtg_price_provider_weekly_read  ON public.mtg_price_provider_weekly  FOR SELECT TO anon, authenticated USING (true);

DROP POLICY IF EXISTS mtg_price_provider_monthly_read ON public.mtg_price_provider_monthly;
CREATE POLICY mtg_price_provider_monthly_read ON public.mtg_price_provider_monthly FOR SELECT TO anon, authenticated USING (true);

-- ═══════════════════════════════════════════════════════════════════════════
-- Retention tracker — canonical audit of what partitions have been dropped.
-- ═══════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS public.mtg_price_retention_log (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  action       TEXT NOT NULL CHECK (action IN (
                  'rollup_weekly','rollup_monthly','drop_raw_partition','extend_canonical_partition'
                )),
  target_name  TEXT NOT NULL,
  window_start DATE,
  window_end   DATE,
  rows_moved   BIGINT,
  notes        JSONB,
  performed_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE public.mtg_price_retention_log IS 'Audit trail: which raw partitions have been rolled up + dropped, when, and how many rows moved.';

CREATE INDEX IF NOT EXISTS mtg_price_retention_log_performed_at_idx
  ON public.mtg_price_retention_log (performed_at DESC);

-- ═══════════════════════════════════════════════════════════════════════════
-- Post-condition sanity
-- ═══════════════════════════════════════════════════════════════════════════
DO $$
DECLARE
  n_partitions int;
BEGIN
  SELECT COUNT(*) INTO n_partitions
    FROM pg_inherits WHERE inhparent = 'public.mtg_price_daily_canonical'::regclass;
  IF n_partitions < 5 THEN
    RAISE EXCEPTION 'expected >= 5 yearly canonical partitions, got %', n_partitions;
  END IF;
  RAISE NOTICE 'mtg_price_daily_canonical partitions: %', n_partitions;
END $$;

COMMIT;
