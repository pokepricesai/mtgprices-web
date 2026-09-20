-- migrations/2026-09-20b-mtg-set-value-daily-v2.sql
--
-- v2 of mtg_set_value_daily_upsert. The v1 rule was
--
--   COALESCE(nonfoil_price, any_price)
--
-- which picks a nonfoil observation when one exists on the date and
-- silently falls back to any-finish MIN otherwise. That means the
-- CHOSEN FINISH can change between two dates for the same printing:
-- a printing that has both nonfoil and foil finishes but no nonfoil
-- observation on a given day would be scored on foil for that day and
-- on nonfoil for another day. The basket is no longer stable across
-- dates and 7D/30D/90D comparisons are not like-for-like.
--
-- Direct evidence: on 2026-08-21, SOC had 420/426 printings with a
-- nonfoil observation and 6 with only a foil observation. Under v1
-- those 6 would use foil on the past endpoint and nonfoil on the
-- current endpoint - i.e., they would be a different logical card in
-- the two baskets.
--
-- v2 rule (structural, price-independent):
--
--   For each eligible printing, choose one canonical finish based
--   solely on which finishes exist in mtg_printing_finishes for
--   that printing. Preference nonfoil > foil > etched, then any
--   other finish deterministically ordered.
--
--   The canonical finish never changes based on price data. If the
--   canonical finish has no observation on a date, that printing is
--   simply UNPRICED for that endpoint. Coverage falls; the price is
--   not silently substituted.
--
-- Rewrite is a REPLACE of the same function name so app code and the
-- daily cron pick it up transparently. Same signature, same return
-- type.

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
    -- Eligible population - matches mtg_set_aggregates_v4.
    SELECT id AS printing_id, set_code
    FROM public.mtg_printings
    WHERE digital = false
      AND lang = 'en'
      AND collector_number IS NOT NULL
  ),
  canonical_finish AS (
    -- One finish per printing, stable across all dates. Preference:
    -- nonfoil (0), foil (1), etched (2), everything else (3+).
    SELECT DISTINCT ON (p.printing_id)
      p.printing_id,
      p.set_code,
      f.id     AS finish_id,
      f.finish AS finish_name
    FROM prints p
    JOIN public.mtg_printing_finishes f ON f.printing_id = p.printing_id
    ORDER BY
      p.printing_id,
      CASE f.finish
        WHEN 'nonfoil' THEN 0
        WHEN 'foil'    THEN 1
        WHEN 'etched'  THEN 2
        ELSE 3
      END,
      f.finish  -- deterministic tie-break for any exotic finish
  ),
  basket AS (
    -- One row per priced printing. Only the canonical finish's
    -- observation on p_observed_on counts. Missing observation = the
    -- printing does NOT appear in the basket for this date.
    SELECT
      cf.set_code,
      cf.printing_id,
      MIN(o.price) AS price
    FROM canonical_finish cf
    JOIN public.mtg_price_observations o
      ON o.printing_finish_id = cf.finish_id
     AND o.observed_on = p_observed_on
     AND o.provider   = p_provider
     AND o.currency   = p_currency
     AND o.market     = p_market
     AND o.price_type = p_price_type
     AND o.price > 0
     AND (o.is_anomalous IS NULL OR o.is_anomalous = false)
    GROUP BY cf.set_code, cf.printing_id
  ),
  per_set AS (
    -- Eligible count is set-defined, not date-defined. Same every day.
    SELECT set_code, COUNT(*)::int AS eligible_count
    FROM prints
    GROUP BY set_code
  ),
  agg AS (
    SELECT
      e.set_code,
      e.eligible_count,
      COALESCE(COUNT(b.printing_id), 0)::int      AS priced_count,
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
