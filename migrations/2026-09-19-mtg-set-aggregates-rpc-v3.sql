-- migrations/2026-09-19-mtg-set-aggregates-rpc-v3.sql
--
-- v3 of the /browse aggregates RPC. Replaces the DISTINCT ON sort
-- strategy from v1/v2 with GROUP BY + FILTER aggregation, which the
-- planner handles as a single hash aggregate rather than sort-per-key.
-- v2 was still timing out at 989-set scale because the DISTINCT ON on
-- the joined CTE forced expensive per-printing sorts.
--
-- Same semantics as before, minus the 30D delta (still handled in TS).

DROP FUNCTION IF EXISTS public.mtg_set_aggregates(text[], text, text, text, text);

CREATE FUNCTION public.mtg_set_aggregates(
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
  top_card_name      text,
  top_card_price     numeric
)
LANGUAGE sql STABLE
AS $$
  WITH prints AS (
    SELECT id AS printing_id, name AS printing_name, set_code
    FROM mtg_printings
    WHERE set_code = ANY(p_set_codes)
      AND digital = false
      AND lang = 'en'
  ),
  per_printing AS (
    -- One row per printing with a priced basket entry.
    -- Cheapest nonfoil (preferred) and cheapest any-finish (fallback).
    SELECT
      p.set_code,
      p.printing_id,
      p.printing_name,
      MIN(cp.price) FILTER (WHERE f.finish = 'nonfoil') AS nonfoil_price,
      MIN(cp.price)                                     AS any_price
    FROM prints p
    JOIN mtg_printing_finishes f ON f.printing_id = p.printing_id
    JOIN mtg_current_prices cp
      ON cp.printing_finish_id = f.id
     AND cp.provider  = p_provider
     AND cp.currency  = p_currency
     AND cp.market    = p_market
     AND cp.price_type = p_price_type
     AND cp.price > 0
    GROUP BY p.set_code, p.printing_id, p.printing_name
  ),
  basket AS (
    SELECT
      set_code, printing_id, printing_name,
      COALESCE(nonfoil_price, any_price) AS price
    FROM per_printing
    WHERE COALESCE(nonfoil_price, any_price) IS NOT NULL
  ),
  per_set_totals AS (
    SELECT set_code, COUNT(*)::int AS total_printed
    FROM prints
    GROUP BY set_code
  ),
  per_set_priced AS (
    SELECT
      set_code,
      COUNT(*)::int                        AS total_priced,
      ROUND(SUM(price)::numeric, 2)        AS estimated_value,
      MAX(price)                           AS top_card_price
    FROM basket
    GROUP BY set_code
  ),
  top_cards AS (
    -- Card name that hits MAX(price) per set.
    SELECT b.set_code, b.printing_name, b.price
    FROM basket b
    JOIN per_set_priced ps
      ON ps.set_code = b.set_code AND ps.top_card_price = b.price
  )
  SELECT
    t.set_code,
    t.total_printed,
    COALESCE(p.total_priced, 0)  AS total_priced,
    COALESCE(p.estimated_value, 0) AS estimated_value,
    -- pick any tied top card deterministically (name asc) so results
    -- are stable across calls.
    (SELECT printing_name FROM top_cards tc WHERE tc.set_code = t.set_code ORDER BY printing_name LIMIT 1) AS top_card_name,
    CASE WHEN p.top_card_price IS NULL THEN NULL ELSE ROUND(p.top_card_price, 2) END AS top_card_price
  FROM per_set_totals t
  LEFT JOIN per_set_priced p ON p.set_code = t.set_code;
$$;

GRANT EXECUTE ON FUNCTION public.mtg_set_aggregates(text[], text, text, text, text)
  TO anon, authenticated, service_role;
