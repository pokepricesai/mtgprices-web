-- The Supabase authenticator role has a low statement_timeout by
-- default (~8s). That is fine for interactive queries, not fine for
-- admin operations that legitimately need to scan a monthly
-- partition. Raise the timeout only for our aggregate refresh
-- functions.
--
-- 120s ceiling. The compute typically finishes in 1-4s; the ceiling
-- exists so a bad plan does not silently succeed at 30s+ and mask
-- the underlying plan-cache problem.

ALTER FUNCTION public.mtg_set_value_daily_upsert(date, text, text, text, text)
  SET statement_timeout = '120s';

ALTER FUNCTION public.mtg_set_value_daily_upsert_slice(date, text[], text, text, text, text)
  SET statement_timeout = '120s';

ALTER FUNCTION public.mtg_set_value_daily_compute(date, text, text, text, text)
  SET statement_timeout = '120s';

ALTER FUNCTION public.mtg_canonical_finish_refresh()
  SET statement_timeout = '120s';

NOTIFY pgrst, 'reload schema';
