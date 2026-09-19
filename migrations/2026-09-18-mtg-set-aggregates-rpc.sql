-- migrations/2026-09-18-mtg-set-aggregates-rpc.sql
--
-- Single-round-trip aggregate for the /browse set directory. Replaces
-- four sequential batched queries in src/lib/mtg/set-market-batch.ts
-- with one server-side computation. Same methodology, same numbers.
--
-- Basket rule:
--   For each English paper printing, pick the cheapest nonfoil price
--   on the caller's basis. If no nonfoil is priced, fall back to the
--   cheapest priced finish (foil or etched).
--
-- Coverage guard for 30D delta:
--   Require ≥ 5 basket finishes with usable earliest+latest 30D
--   observations AND ≥ 40% of the basket having history. Otherwise
--   return NULL for pct_30d / abs_30d so the UI never shows a
--   misleading number.
--
-- is_anomalous:
--   Treat NULL as "not flagged", matching the app-side filter.
--
-- Read-only, marked STABLE. Callable via PostgREST rpc.

CREATE OR REPLACE FUNCTION public.mtg_set_aggregates(
  p_set_codes  text[],
  p_provider   text DEFAULT 'tcgplayer',
  p_currency   text DEFAULT 'USD',
  p_market     text DEFAULT 'paper',
  p_price_type text DEFAULT 'retail'
)
RETURNS TABLE (
  set_code           text,
  total_printed      int,
  total_priced       int,
  estimated_value    numeric,
  pct_30d            numeric,
  abs_30d            numeric,
  top_card_name      text,
  top_card_price     numeric
)
LANGUAGE sql STABLE
AS $$
  WITH prints AS (
    SELECT p.id AS printing_id, p.name, p.set_code
    FROM mtg_printings p
    WHERE p.set_code = ANY(p_set_codes)
      AND p.digital = false
      AND p.lang = 'en'
  ),
  finishes AS (
    SELECT f.id AS finish_id, f.printing_id, f.finish
    FROM mtg_printing_finishes f
    WHERE f.printing_id IN (SELECT printing_id FROM prints)
  ),
  currents AS (
    SELECT cp.printing_finish_id, cp.price
    FROM mtg_current_prices cp
    WHERE cp.printing_finish_id IN (SELECT finish_id FROM finishes)
      AND cp.provider  = p_provider
      AND cp.currency  = p_currency
      AND cp.market    = p_market
      AND cp.price_type = p_price_type
      AND cp.price > 0
  ),
  joined AS (
    SELECT p.set_code, p.printing_id, p.name AS printing_name,
           f.finish_id, f.finish, c.price
    FROM currents c
    JOIN finishes f ON f.finish_id = c.printing_finish_id
    JOIN prints p ON p.printing_id = f.printing_id
  ),
  cheapest_nonfoil AS (
    SELECT DISTINCT ON (printing_id) printing_id, finish_id, finish, price, set_code, printing_name
    FROM joined
    WHERE finish = 'nonfoil'
    ORDER BY printing_id, price ASC
  ),
  cheapest_any AS (
    SELECT DISTINCT ON (printing_id) printing_id, finish_id, finish, price, set_code, printing_name
    FROM joined
    ORDER BY printing_id, price ASC
  ),
  basket AS (
    SELECT p.printing_id, p.printing_name, p.set_code,
           COALESCE(nf.finish_id, ca.finish_id) AS finish_id,
           COALESCE(nf.price, ca.price)         AS price
    FROM (
      SELECT p.printing_id, p.name AS printing_name, p.set_code
      FROM prints p
    ) p
    LEFT JOIN cheapest_nonfoil nf ON nf.printing_id = p.printing_id
    LEFT JOIN cheapest_any     ca ON ca.printing_id = p.printing_id
    WHERE COALESCE(nf.finish_id, ca.finish_id) IS NOT NULL
  ),
  obs_window AS (
    SELECT po.printing_finish_id,
           po.observed_on,
           po.price
    FROM mtg_price_observations po
    WHERE po.printing_finish_id IN (SELECT finish_id FROM basket)
      AND po.observed_on >= (current_date - interval '30 days')
      AND po.provider  = p_provider
      AND po.currency  = p_currency
      AND po.market    = p_market
      AND po.price_type = p_price_type
      AND (po.is_anomalous IS NULL OR po.is_anomalous = false)
      AND po.price > 0
  ),
  obs_earliest AS (
    SELECT DISTINCT ON (printing_finish_id) printing_finish_id, observed_on AS earliest_d, price AS earliest_p
    FROM obs_window
    ORDER BY printing_finish_id, observed_on ASC
  ),
  obs_latest AS (
    SELECT DISTINCT ON (printing_finish_id) printing_finish_id, observed_on AS latest_d, price AS latest_p
    FROM obs_window
    ORDER BY printing_finish_id, observed_on DESC
  ),
  basket_hist AS (
    SELECT b.set_code, b.printing_name, b.finish_id, b.price AS current_price,
           oe.earliest_p, oe.earliest_d,
           ol.latest_p, ol.latest_d
    FROM basket b
    LEFT JOIN obs_earliest oe ON oe.printing_finish_id = b.finish_id
    LEFT JOIN obs_latest   ol ON ol.printing_finish_id = b.finish_id
  ),
  per_set AS (
    SELECT
      s.set_code,
      (SELECT COUNT(*) FROM prints WHERE prints.set_code = s.set_code)::int AS total_printed,
      COUNT(bh.finish_id)::int                                                AS total_priced,
      COALESCE(SUM(bh.current_price), 0)::numeric                             AS estimated_value,
      SUM(CASE WHEN bh.earliest_p IS NOT NULL AND bh.latest_p IS NOT NULL AND bh.earliest_d <> bh.latest_d THEN 1 ELSE 0 END)::int   AS basket_with_history,
      SUM(CASE WHEN bh.earliest_p IS NOT NULL AND bh.latest_p IS NOT NULL AND bh.earliest_d <> bh.latest_d THEN bh.latest_p ELSE 0 END)::numeric  AS value_now,
      SUM(CASE WHEN bh.earliest_p IS NOT NULL AND bh.latest_p IS NOT NULL AND bh.earliest_d <> bh.latest_d THEN bh.earliest_p ELSE 0 END)::numeric AS value_then
    FROM (SELECT DISTINCT set_code FROM prints) s
    LEFT JOIN basket_hist bh ON bh.set_code = s.set_code
    GROUP BY s.set_code
  ),
  top_cards AS (
    SELECT DISTINCT ON (set_code) set_code, printing_name, current_price
    FROM basket_hist
    WHERE current_price IS NOT NULL
    ORDER BY set_code, current_price DESC
  )
  SELECT
    ps.set_code,
    ps.total_printed,
    ps.total_priced,
    ROUND(ps.estimated_value, 2) AS estimated_value,
    CASE
      WHEN ps.basket_with_history >= 5
       AND ps.total_priced > 0
       AND ps.basket_with_history::float / ps.total_priced::float >= 0.40
       AND ps.value_then > 0
      THEN ROUND((ps.value_now - ps.value_then) / ps.value_then, 4)
      ELSE NULL
    END AS pct_30d,
    CASE
      WHEN ps.basket_with_history >= 5
       AND ps.total_priced > 0
       AND ps.basket_with_history::float / ps.total_priced::float >= 0.40
      THEN ROUND(ps.value_now - ps.value_then, 2)
      ELSE NULL
    END AS abs_30d,
    tc.printing_name,
    CASE WHEN tc.current_price IS NULL THEN NULL ELSE ROUND(tc.current_price, 2) END AS top_card_price
  FROM per_set ps
  LEFT JOIN top_cards tc ON tc.set_code = ps.set_code;
$$;

-- Grant execute to the anon/authenticated roles so PostgREST can call
-- it. Adjust to service_role if you prefer to hide it behind server
-- code only.
GRANT EXECUTE ON FUNCTION public.mtg_set_aggregates(text[], text, text, text, text) TO anon, authenticated, service_role;
