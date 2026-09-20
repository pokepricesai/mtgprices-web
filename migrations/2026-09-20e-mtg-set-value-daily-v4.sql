-- migrations/2026-09-20e-mtg-set-value-daily-v4.sql
--
-- Two set-scoped variants that fit inside PostgREST's ~8-15 s
-- statement timeout by processing only a slice of sets per call.
-- The v3 whole-corpus upsert times out through PostgREST even
-- though the same SQL runs in 30 s over psql. The backfill script
-- fans out into ~30 chunked calls per date instead.
--
--   mtg_set_value_daily_upsert_slice(observed_on, set_codes[], ...)
--     - upserts rows for just the sets in set_codes[]
--     - the WHERE cf.set_code = ANY() filter lets the planner
--       drastically shrink both sides of the hash join
--
-- The whole-corpus mtg_set_value_daily_upsert() function is kept
-- for backwards compatibility with the daily cron endpoint.

CREATE OR REPLACE FUNCTION public.mtg_set_value_daily_upsert_slice(
  p_observed_on date,
  p_set_codes   text[],
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
  WITH cf AS (
    SELECT * FROM public.mtg_canonical_finish WHERE set_code = ANY(p_set_codes)
  ),
  day_obs AS (
    -- Filter observations to (a) the requested date and basis, and
    -- (b) exactly the finish IDs that belong to the sets we are
    -- upserting. The second filter dodges a full-partition scan for
    -- a small set chunk.
    SELECT o.printing_finish_id, MIN(o.price) AS price
    FROM public.mtg_price_observations o
    WHERE o.observed_on = p_observed_on
      AND o.provider   = p_provider
      AND o.currency   = p_currency
      AND o.market     = p_market
      AND o.price_type = p_price_type
      AND o.price > 0
      AND (o.is_anomalous IS NULL OR o.is_anomalous = false)
      AND o.printing_finish_id IN (SELECT finish_id FROM cf)
    GROUP BY o.printing_finish_id
  ),
  basket AS (
    SELECT cf.set_code, cf.printing_id, d.price
    FROM cf
    JOIN day_obs d ON d.printing_finish_id = cf.finish_id
  ),
  per_set AS (
    SELECT set_code, COUNT(*)::int AS eligible_count FROM cf GROUP BY set_code
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

GRANT EXECUTE ON FUNCTION public.mtg_set_value_daily_upsert_slice(date, text[], text, text, text, text)
  TO service_role;
