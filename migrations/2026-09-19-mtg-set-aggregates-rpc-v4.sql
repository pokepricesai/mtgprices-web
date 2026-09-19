-- migrations/2026-09-19-mtg-set-aggregates-rpc-v4.sql
--
-- v4 of the /browse aggregates RPC. Corrects the coverage semantics
-- the launch audit caught:
--
--   - v3 chunked at 200 codes and timed out (statement_timeout=8s on
--     the free tier) on the largest chunk, so the caller silently
--     fell back to a batched TS pipeline that Postgrest-capped at
--     1000 rows and produced garbage totalPrinted values (8, 7, 15,
--     etc.) for every set instead of 200-900.
--   - The response payload did not carry enough info for the tile UI
--     to link the most valuable card back to its /card page.
--
-- v4 preserves the same semantics (denominator = full English paper
-- printings, one price per printing, prefer cheapest nonfoil then any
-- finish) but adds:
--
--   - most_valuable_collector_number: enables the tile to link
--     directly to /set/{code}/card/{n}-{slug}.
--   - Explicit stability for tied prices (min collector_number).
--
-- The caller (src/lib/mtg/set-market-batch.ts) is being updated in the
-- same commit to chunk 50 codes at a time, which finishes each chunk
-- in ~1.5-2 s on the current DB. That eliminates the statement-timeout
-- path that was making v3 fall through to the broken TS fallback.
--
-- v3 is intentionally left in place so a rollback is just a code-side
-- .rpc() name change. Drop v3 in a follow-up migration once v4 has
-- been live for at least one revalidate cycle.

DROP FUNCTION IF EXISTS public.mtg_set_aggregates_v4(text[], text, text, text, text);

CREATE FUNCTION public.mtg_set_aggregates_v4(
  p_set_codes  text[],
  p_provider   text DEFAULT 'tcgplayer',
  p_currency   text DEFAULT 'USD',
  p_market     text DEFAULT 'paper',
  p_price_type text DEFAULT 'retail'
)
RETURNS TABLE (
  set_code                       text,
  eligible_count                 int,
  priced_count                   int,
  priced_subtotal                numeric,
  most_valuable_name             text,
  most_valuable_collector_number text,
  most_valuable_price            numeric
)
LANGUAGE sql STABLE
AS $$
  WITH prints AS (
    -- Eligible population: every English, paper, real-collector-numbered
    -- printing in the set. This is the denominator for coverage.
    SELECT id AS printing_id, name AS printing_name, collector_number, set_code
    FROM mtg_printings
    WHERE set_code = ANY(p_set_codes)
      AND digital = false
      AND lang = 'en'
      AND collector_number IS NOT NULL
  ),
  per_printing AS (
    -- For each priced printing, capture:
    --   nonfoil_price = MIN retail on the chosen basis for a nonfoil finish
    --   any_price     = MIN retail on the chosen basis for ANY finish
    -- so we can pick "one price per printing, prefer nonfoil".
    SELECT
      p.set_code,
      p.printing_id,
      p.printing_name,
      p.collector_number,
      MIN(cp.price) FILTER (WHERE f.finish = 'nonfoil') AS nonfoil_price,
      MIN(cp.price)                                     AS any_price
    FROM prints p
    JOIN mtg_printing_finishes f ON f.printing_id = p.printing_id
    JOIN mtg_current_prices    cp
      ON cp.printing_finish_id = f.id
     AND cp.provider   = p_provider
     AND cp.currency   = p_currency
     AND cp.market     = p_market
     AND cp.price_type = p_price_type
     AND cp.price > 0
    GROUP BY p.set_code, p.printing_id, p.printing_name, p.collector_number
  ),
  basket AS (
    -- One row per PRICED printing. Nonfoil-preferred, no double-count.
    SELECT
      set_code, printing_id, printing_name, collector_number,
      COALESCE(nonfoil_price, any_price) AS price
    FROM per_printing
    WHERE COALESCE(nonfoil_price, any_price) IS NOT NULL
  ),
  per_set_eligible AS (
    SELECT set_code, COUNT(*)::int AS eligible_count
    FROM prints
    GROUP BY set_code
  ),
  per_set_priced AS (
    SELECT
      set_code,
      COUNT(*)::int                 AS priced_count,
      ROUND(SUM(price)::numeric, 2) AS priced_subtotal,
      MAX(price)                    AS most_valuable_price
    FROM basket
    GROUP BY set_code
  ),
  most_valuable AS (
    -- Card that hits MAX(price) per set. Tie-break by collector_number
    -- so the answer is stable across calls.
    SELECT DISTINCT ON (b.set_code)
      b.set_code, b.printing_name, b.collector_number, b.price
    FROM basket b
    JOIN per_set_priced ps ON ps.set_code = b.set_code AND ps.most_valuable_price = b.price
    ORDER BY b.set_code, b.collector_number
  )
  SELECT
    e.set_code,
    e.eligible_count,
    COALESCE(pp.priced_count, 0)   AS priced_count,
    COALESCE(pp.priced_subtotal, 0) AS priced_subtotal,
    mv.printing_name               AS most_valuable_name,
    mv.collector_number            AS most_valuable_collector_number,
    CASE WHEN pp.most_valuable_price IS NULL THEN NULL
         ELSE ROUND(pp.most_valuable_price, 2) END AS most_valuable_price
  FROM per_set_eligible e
  LEFT JOIN per_set_priced   pp ON pp.set_code = e.set_code
  LEFT JOIN most_valuable    mv ON mv.set_code = e.set_code;
$$;

GRANT EXECUTE ON FUNCTION public.mtg_set_aggregates_v4(text[], text, text, text, text)
  TO anon, authenticated, service_role;
