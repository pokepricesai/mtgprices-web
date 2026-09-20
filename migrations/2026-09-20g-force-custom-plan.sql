-- Force the daily upsert to always plan with the actual parameter
-- values (custom plan) rather than a cached generic plan. Postgres'
-- default plan_cache_mode is 'auto', which switches to a generic
-- plan after 5 calls with a parameterised query. For our
-- partition-pruning-dependent query the generic plan is much slower
-- (~8s+, tripping statement_timeout) than a custom plan (~1-2s).

ALTER FUNCTION public.mtg_set_value_daily_upsert(date, text, text, text, text)
  SET plan_cache_mode = 'force_custom_plan';

ALTER FUNCTION public.mtg_set_value_daily_upsert_slice(date, text[], text, text, text, text)
  SET plan_cache_mode = 'force_custom_plan';

ALTER FUNCTION public.mtg_set_value_daily_compute(date, text, text, text, text)
  SET plan_cache_mode = 'force_custom_plan';

NOTIFY pgrst, 'reload schema';
