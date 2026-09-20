-- migrations/2026-09-20c-mtg-canonical-finish.sql
--
-- Small precomputed mapping: one row per eligible printing to its
-- CANONICAL finish. Making this a real table (not a view) lets the
-- daily upsert avoid a DISTINCT ON over the whole
-- mtg_printing_finishes table for every date backfilled. Reduced the
-- upsert path from ~100 s to ~5-15 s per date in probe runs.
--
-- The canonical finish is a structural property of the printing (does
-- the printing exist as nonfoil?), NOT of price data. It is stable
-- across all dates, which is what "same basket both endpoints"
-- requires. See migrations/2026-09-20b-mtg-set-value-daily-v2.sql.

CREATE TABLE IF NOT EXISTS public.mtg_canonical_finish (
  printing_id   uuid PRIMARY KEY,
  set_code      text     NOT NULL,
  finish_id     uuid     NOT NULL,
  finish_name   text     NOT NULL,
  refreshed_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS mtg_canonical_finish_set_idx
  ON public.mtg_canonical_finish (set_code, printing_id);

-- Refresh function: fully rebuilds the mapping. Cheap (~seconds) on
-- the current ~100k-printing catalogue. Called manually or from an
-- ingest hook when new printings land.
CREATE OR REPLACE FUNCTION public.mtg_canonical_finish_refresh()
RETURNS int
LANGUAGE plpgsql
AS $$
DECLARE
  affected int;
BEGIN
  WITH prints AS (
    SELECT id AS printing_id, set_code
    FROM public.mtg_printings
    WHERE digital = false AND lang = 'en' AND collector_number IS NOT NULL
  ),
  picked AS (
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
      f.finish
  ),
  -- Upsert path so a re-run does not blow away or duplicate rows.
  ins AS (
    INSERT INTO public.mtg_canonical_finish
      (printing_id, set_code, finish_id, finish_name, refreshed_at)
    SELECT printing_id, set_code, finish_id, finish_name, now() FROM picked
    ON CONFLICT (printing_id) DO UPDATE SET
      set_code    = EXCLUDED.set_code,
      finish_id   = EXCLUDED.finish_id,
      finish_name = EXCLUDED.finish_name,
      refreshed_at = now()
    RETURNING 1
  ),
  del AS (
    -- Sweep printings that no longer qualify (e.g., a printing became
    -- digital-only or got its collector_number nulled during a Scryfall
    -- reingest). Keeps the mapping in lock-step with the source.
    DELETE FROM public.mtg_canonical_finish c
    WHERE NOT EXISTS (SELECT 1 FROM picked p WHERE p.printing_id = c.printing_id)
    RETURNING 1
  )
  SELECT (SELECT COUNT(*) FROM ins) + (SELECT COUNT(*) FROM del) INTO affected;
  RETURN affected;
END;
$$;

GRANT EXECUTE ON FUNCTION public.mtg_canonical_finish_refresh() TO service_role;

-- Initial populate at migration apply time so the daily upsert can
-- start using it immediately.
SELECT public.mtg_canonical_finish_refresh();

-- v3 of the daily upsert. Same signature/return, uses the mapping.
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
  WITH basket AS (
    -- For each eligible printing (via mtg_canonical_finish), sum the
    -- canonical finish's observations on p_observed_on. GROUP BY
    -- collapses duplicate rows (in case multiple provider/currency
    -- combinations exist for the same finish/date - although the
    -- WHERE below already prunes those).
    SELECT
      cf.set_code,
      cf.printing_id,
      MIN(o.price) AS price
    FROM public.mtg_canonical_finish cf
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
    SELECT set_code, COUNT(*)::int AS eligible_count
    FROM public.mtg_canonical_finish
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
