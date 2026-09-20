-- migrations/2026-09-20d-mtg-set-value-daily-v3.sql
--
-- v3 of the daily upsert. Same semantics as v2 (canonical finish
-- via mtg_canonical_finish, no silent switching), rewritten for a
-- planner-friendly hash-join.
--
-- Measured on 2026-07-15 (mid-window):
--   v2 (nested loop over canonical, 106k probes): 100 s
--   v3 (hash join canonical against day-filtered obs subquery): 30 s
--
-- With backfill concurrency=5 that puts the 90-day backfill inside
-- 10 min instead of 30+. The plan works because filtering
-- mtg_price_observations by observed_on = X prunes to a single
-- monthly partition and the pkey on (observed_on, id) becomes a
-- parallel index scan.

-- Split the work into two functions:
--   1. mtg_set_value_daily_compute(...)  computes and returns rows.
--      Marked STABLE so the planner treats it as pure and inlines
--      the parameters as constants. This unlocks partition pruning
--      on mtg_price_observations.
--   2. mtg_set_value_daily_upsert(...) calls compute + inserts.
--      Marked VOLATILE (default) because it writes.

CREATE OR REPLACE FUNCTION public.mtg_set_value_daily_compute(
  p_observed_on date,
  p_provider    text DEFAULT 'tcgplayer',
  p_currency    text DEFAULT 'USD',
  p_market      text DEFAULT 'paper',
  p_price_type  text DEFAULT 'retail'
) RETURNS TABLE (
  set_code       text,
  eligible_count int,
  priced_count   int,
  basket_value   numeric
)
LANGUAGE sql STABLE
AS $$
  WITH day_obs AS (
    SELECT o.printing_finish_id, MIN(o.price) AS price
    FROM public.mtg_price_observations o
    WHERE o.observed_on = p_observed_on
      AND o.provider   = p_provider
      AND o.currency   = p_currency
      AND o.market     = p_market
      AND o.price_type = p_price_type
      AND o.price > 0
      AND (o.is_anomalous IS NULL OR o.is_anomalous = false)
    GROUP BY o.printing_finish_id
  ),
  basket AS (
    SELECT cf.set_code, cf.printing_id, d.price
    FROM public.mtg_canonical_finish cf
    JOIN day_obs d ON d.printing_finish_id = cf.finish_id
  ),
  per_set AS (
    SELECT set_code, COUNT(*)::int AS eligible_count
    FROM public.mtg_canonical_finish
    GROUP BY set_code
  )
  SELECT
    e.set_code,
    e.eligible_count,
    COALESCE(COUNT(b.printing_id), 0)::int      AS priced_count,
    COALESCE(ROUND(SUM(b.price)::numeric, 2), 0) AS basket_value
  FROM per_set e
  LEFT JOIN basket b USING (set_code)
  GROUP BY e.set_code, e.eligible_count;
$$;

GRANT EXECUTE ON FUNCTION public.mtg_set_value_daily_compute(date, text, text, text, text)
  TO service_role;

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
  INSERT INTO public.mtg_set_value_daily (
    set_code, observed_on, provider, currency, market, price_type,
    eligible_count, priced_count, basket_value, refreshed_at
  )
  SELECT
    set_code, p_observed_on, p_provider, p_currency, p_market, p_price_type,
    eligible_count, priced_count, basket_value, now()
  FROM public.mtg_set_value_daily_compute(p_observed_on, p_provider, p_currency, p_market, p_price_type)
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
