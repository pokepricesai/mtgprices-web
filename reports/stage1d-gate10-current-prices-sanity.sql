-- ============================================================================
-- Stage 1D — Gate 10: mtg_current_prices sanity SQL.
-- Paste into Supabase SQL Editor. READ-ONLY.
-- ============================================================================

-- 1. Overall shape.
SELECT COUNT(*)                                                       AS rows,
       COUNT(DISTINCT printing_finish_id)                             AS distinct_finishes,
       MIN(observed_on)                                               AS earliest_observed_on,
       MAX(observed_on)                                               AS latest_observed_on
  FROM public.mtg_current_prices;

-- 2. Per-provider row counts + latest observed_on per provider.
SELECT provider,
       COUNT(*)                                                       AS rows,
       COUNT(DISTINCT printing_finish_id)                             AS distinct_finishes,
       MIN(observed_on)                                               AS earliest,
       MAX(observed_on)                                               AS latest,
       jsonb_object_agg(currency, cnt) FILTER (WHERE currency IS NOT NULL) AS currencies
  FROM (
    SELECT provider, printing_finish_id, observed_on, currency,
           COUNT(*) OVER (PARTITION BY provider, currency) AS cnt
      FROM public.mtg_current_prices
  ) t
 GROUP BY provider
 ORDER BY provider;

-- 3. Latest observed_on distribution (top 10 days).
SELECT observed_on, COUNT(*) AS rows
  FROM public.mtg_current_prices
 GROUP BY observed_on
 ORDER BY observed_on DESC
 LIMIT 10;

-- 4. Price-type breakdown.
SELECT price_type, COUNT(*) AS rows
  FROM public.mtg_current_prices
 GROUP BY price_type
 ORDER BY rows DESC;

-- 5. Market breakdown.
SELECT market, COUNT(*) AS rows
  FROM public.mtg_current_prices
 GROUP BY market
 ORDER BY rows DESC;

-- 6. Consistency: every printing_finish_id in mtg_current_prices should
--    exist in mtg_printing_finishes. Expect 0 rows.
SELECT COUNT(*) AS orphan_current_prices
  FROM public.mtg_current_prices cp
 WHERE NOT EXISTS (
   SELECT 1 FROM public.mtg_printing_finishes f
    WHERE f.id = cp.printing_finish_id
 );
