-- Helper RPC used by scripts/backfill-set-value-daily.mjs to answer
-- "which dates already have data on this basis?" without paginating
-- through mtg_set_value_daily one row at a time. Returns one row per
-- observed_on with a row count so the backfill script can decide
-- whether to skip.

CREATE OR REPLACE FUNCTION public.mtg_set_value_daily_row_counts(
  p_from        date,
  p_to          date,
  p_provider    text DEFAULT 'tcgplayer',
  p_currency    text DEFAULT 'USD',
  p_market      text DEFAULT 'paper',
  p_price_type  text DEFAULT 'retail'
) RETURNS TABLE (observed_on date, n int)
LANGUAGE sql STABLE
AS $$
  SELECT observed_on, COUNT(*)::int AS n
  FROM public.mtg_set_value_daily
  WHERE observed_on BETWEEN p_from AND p_to
    AND provider   = p_provider
    AND currency   = p_currency
    AND market     = p_market
    AND price_type = p_price_type
  GROUP BY observed_on
  ORDER BY observed_on
$$;

GRANT EXECUTE ON FUNCTION public.mtg_set_value_daily_row_counts(date, date, text, text, text, text)
  TO service_role, authenticated, anon;

NOTIFY pgrst, 'reload schema';
