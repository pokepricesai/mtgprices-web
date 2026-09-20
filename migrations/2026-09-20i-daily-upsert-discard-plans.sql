-- Combat the plan-cache oscillation for mtg_set_value_daily_upsert.
-- Empirically the function alternates between a ~2 s custom plan
-- and an ~8+ s generic plan depending on plan-cache state. Discard
-- any prior plans at entry so every call re-plans with the actual
-- parameter values it received.
--
-- Trade-off: ~10 ms of extra planning cost per call, but eliminates
-- the sporadic statement_timeout failures.

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
  -- Fresh plan for every call. Cheap; the win is deterministic
  -- performance instead of occasional 8-second timeouts.
  DISCARD PLANS;

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

NOTIFY pgrst, 'reload schema';
