-- migrations/2026-09-20-mtg-set-value-daily.sql
--
-- Per-set daily basket value aggregate. Small precomputed table
-- (~800 sets × 90 days = ~72k rows per basis) so /browse can answer
-- "what did the set look like 30 days ago" without joining through
-- the 60M-row mtg_price_observations partition set.
--
-- Why a table instead of a materialised view: the daily ingest
-- appends one row per finish per day. Recomputing the whole matview
-- would rescan all 60M rows. A regular table lets us upsert one
-- day at a time.
--
-- Basket composition rule matches mtg_set_aggregates_v4 exactly:
--   for each eligible printing (English, paper, has collector_number)
--   pick the cheapest nonfoil observation of the day, else the
--   cheapest of any finish. Foil and nonfoil are never summed.
--
-- Rows are keyed by (set_code, observed_on, provider, currency,
-- market, price_type) so multiple bases can coexist. Today we only
-- populate tcgplayer/USD/paper/retail.

CREATE TABLE IF NOT EXISTS public.mtg_set_value_daily (
  set_code       text     NOT NULL,
  observed_on    date     NOT NULL,
  provider       text     NOT NULL,
  currency       text     NOT NULL,
  market         text     NOT NULL,
  price_type     text     NOT NULL,
  eligible_count int      NOT NULL,
  priced_count   int      NOT NULL,
  basket_value   numeric  NOT NULL,
  refreshed_at   timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (set_code, observed_on, provider, currency, market, price_type)
);

CREATE INDEX IF NOT EXISTS mtg_set_value_daily_lookup_idx
  ON public.mtg_set_value_daily (observed_on, provider, currency, market, price_type);

-- Function to (re)compute one day. Callable daily from a cron
-- endpoint or backfill loop. UPSERT keyed on the composite PK so a
-- re-run for the same day overwrites cleanly.
CREATE OR REPLACE FUNCTION public.mtg_set_value_daily_upsert(
  p_observed_on date,
  p_provider    text DEFAULT 'tcgplayer',
  p_currency    text DEFAULT 'USD',
  p_market      text DEFAULT 'paper',
  p_price_type  text DEFAULT 'retail'
) RETURNS int
LANGUAGE plpgsql
AS $$
DECLARE
  affected int;
BEGIN
  WITH prints AS (
    -- Eligible population — matches mtg_set_aggregates_v4.
    SELECT id AS printing_id, set_code
    FROM public.mtg_printings
    WHERE digital = false
      AND lang = 'en'
      AND collector_number IS NOT NULL
  ),
  per_printing AS (
    -- For each printing on p_observed_on, the chosen basket price:
    -- MIN(nonfoil observation) preferred, fall back to MIN(any).
    SELECT
      p.set_code,
      p.printing_id,
      MIN(o.price) FILTER (WHERE f.finish = 'nonfoil') AS nonfoil_price,
      MIN(o.price)                                     AS any_price
    FROM prints p
    JOIN public.mtg_printing_finishes  f ON f.printing_id = p.printing_id
    JOIN public.mtg_price_observations o
      ON o.printing_finish_id = f.id
     AND o.observed_on = p_observed_on
     AND o.provider   = p_provider
     AND o.currency   = p_currency
     AND o.market     = p_market
     AND o.price_type = p_price_type
     AND o.price > 0
     AND (o.is_anomalous IS NULL OR o.is_anomalous = false)
    GROUP BY p.set_code, p.printing_id
  ),
  basket AS (
    SELECT set_code, printing_id, COALESCE(nonfoil_price, any_price) AS price
    FROM per_printing
    WHERE COALESCE(nonfoil_price, any_price) IS NOT NULL
  ),
  per_set AS (
    -- Right side of the coverage: how many eligible printings does
    -- each set actually have? Eligible is set-defined, not date-
    -- defined, so this is the same every day.
    SELECT set_code, COUNT(*)::int AS eligible_count
    FROM prints
    GROUP BY set_code
  ),
  agg AS (
    SELECT
      e.set_code,
      e.eligible_count,
      COALESCE(COUNT(b.printing_id), 0)::int AS priced_count,
      COALESCE(ROUND(SUM(b.price)::numeric, 2), 0) AS basket_value
    FROM per_set e
    LEFT JOIN basket b USING (set_code)
    GROUP BY e.set_code, e.eligible_count
  )
  INSERT INTO public.mtg_set_value_daily (
    set_code, observed_on, provider, currency, market, price_type,
    eligible_count, priced_count, basket_value, refreshed_at
  )
  SELECT
    set_code, p_observed_on, p_provider, p_currency, p_market, p_price_type,
    eligible_count, priced_count, basket_value, now()
  FROM agg
  ON CONFLICT (set_code, observed_on, provider, currency, market, price_type)
  DO UPDATE SET
    eligible_count = EXCLUDED.eligible_count,
    priced_count   = EXCLUDED.priced_count,
    basket_value   = EXCLUDED.basket_value,
    refreshed_at   = now();

  GET DIAGNOSTICS affected = ROW_COUNT;
  RETURN affected;
END;
$$;

GRANT EXECUTE ON FUNCTION public.mtg_set_value_daily_upsert(date, text, text, text, text)
  TO service_role;

-- Fast lookup RPC used by /browse and /set/[setCode] to answer
-- "give me the basket value on this specific date for these sets".
-- Two calls (today, today-30) → set-level 30D delta.
CREATE OR REPLACE FUNCTION public.mtg_set_value_daily_read(
  p_set_codes   text[],
  p_observed_on date,
  p_provider    text DEFAULT 'tcgplayer',
  p_currency    text DEFAULT 'USD',
  p_market      text DEFAULT 'paper',
  p_price_type  text DEFAULT 'retail'
) RETURNS TABLE (
  set_code       text,
  observed_on    date,
  eligible_count int,
  priced_count   int,
  basket_value   numeric
) LANGUAGE sql STABLE
AS $$
  SELECT set_code, observed_on, eligible_count, priced_count, basket_value
  FROM public.mtg_set_value_daily
  WHERE set_code = ANY(p_set_codes)
    AND observed_on = p_observed_on
    AND provider   = p_provider
    AND currency   = p_currency
    AND market     = p_market
    AND price_type = p_price_type
$$;

GRANT EXECUTE ON FUNCTION public.mtg_set_value_daily_read(text[], date, text, text, text, text)
  TO anon, authenticated, service_role;
