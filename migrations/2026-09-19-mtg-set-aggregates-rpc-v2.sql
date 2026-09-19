-- migrations/2026-09-19-mtg-set-aggregates-rpc-v2.sql
--
-- v2 of the /browse aggregates RPC. The v1 form embedded a 30-day
-- observation join that made the whole call statement-timeout at
-- realistic scales (989 sets). This version:
--   * returns only totals + coverage + estimated value + top card
--   * drops the 30D observation join entirely
--
-- The TypeScript caller keeps a separate, chunked observation query for
-- the 30D chip on /browse tiles. Skipping the observations here lets
-- the RPC handle the full set list in well under a second.

-- Drop the v1 function first because the return signature is changing
-- (v1 also returned pct_30d and abs_30d). CREATE OR REPLACE cannot
-- change the RETURNS clause.
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
    SELECT DISTINCT ON (printing_id) printing_id, price, set_code, printing_name
    FROM joined
    WHERE finish = 'nonfoil'
    ORDER BY printing_id, price ASC
  ),
  cheapest_any AS (
    SELECT DISTINCT ON (printing_id) printing_id, price, set_code, printing_name
    FROM joined
    ORDER BY printing_id, price ASC
  ),
  basket AS (
    SELECT p.printing_id, p.name AS printing_name, p.set_code,
           COALESCE(nf.price, ca.price) AS price
    FROM prints p
    LEFT JOIN cheapest_nonfoil nf ON nf.printing_id = p.printing_id
    LEFT JOIN cheapest_any     ca ON ca.printing_id = p.printing_id
    WHERE COALESCE(nf.price, ca.price) IS NOT NULL
  ),
  per_set AS (
    SELECT
      s.set_code,
      (SELECT COUNT(*) FROM prints WHERE prints.set_code = s.set_code)::int AS total_printed,
      COUNT(b.printing_id)::int                                              AS total_priced,
      COALESCE(SUM(b.price), 0)::numeric                                     AS estimated_value
    FROM (SELECT DISTINCT set_code FROM prints) s
    LEFT JOIN basket b ON b.set_code = s.set_code
    GROUP BY s.set_code
  ),
  top_cards AS (
    SELECT DISTINCT ON (set_code) set_code, printing_name, price
    FROM basket
    ORDER BY set_code, price DESC
  )
  SELECT
    ps.set_code,
    ps.total_printed,
    ps.total_priced,
    ROUND(ps.estimated_value, 2) AS estimated_value,
    tc.printing_name             AS top_card_name,
    CASE WHEN tc.price IS NULL THEN NULL ELSE ROUND(tc.price, 2) END AS top_card_price
  FROM per_set ps
  LEFT JOIN top_cards tc ON tc.set_code = ps.set_code;
$$;

GRANT EXECUTE ON FUNCTION public.mtg_set_aggregates(text[], text, text, text, text)
  TO anon, authenticated, service_role;
