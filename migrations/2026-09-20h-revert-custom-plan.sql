-- Revert plan_cache_mode override. force_custom_plan made things
-- worse, not better. The default 'auto' cadence is what worked
-- during the earlier ad-hoc probe.

ALTER FUNCTION public.mtg_set_value_daily_upsert(date, text, text, text, text)
  RESET plan_cache_mode;
ALTER FUNCTION public.mtg_set_value_daily_upsert_slice(date, text[], text, text, text, text)
  RESET plan_cache_mode;
ALTER FUNCTION public.mtg_set_value_daily_compute(date, text, text, text, text)
  RESET plan_cache_mode;
NOTIFY pgrst, 'reload schema';
