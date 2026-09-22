-- migrations/2026-09-22-tcg-slice4-lorcana.sql
--
-- Slice 4. Register Disney Lorcana as a first-class TCG in the
-- shared tcg_* namespace. Star Wars: Unlimited stays in the registry
-- untouched (future launch candidate; not part of the initial five-
-- site launch).
--
-- Also adds a read-only summary view (tcg_network_summary) so the
-- operator status command can pull correct DISTINCT slab coverage in
-- one query instead of hammering PostgREST with per-game counts.
-- Anon and authenticated get SELECT; nothing writes through the view.

BEGIN;

-- ---------------------------------------------------------------------
-- 1. Register Lorcana in tcg_games (idempotent).
-- ---------------------------------------------------------------------
INSERT INTO public.tcg_games (id, slug, name) VALUES
  ('lorcana', 'disney-lorcana', 'Disney Lorcana')
ON CONFLICT (id) DO NOTHING;

-- ---------------------------------------------------------------------
-- 2. Network summary view.
--    Distinct-slab-printings is what "graded coverage" MEANS operationally
--    (one printing can carry multiple grader,grade rows: psa-10 + bgs-10 +
--    cgc-10 + sgc-10 + any-9 + any-8 all attach to the same printing).
--    Counting rows instead of distinct printings inflates >100 % on games
--    with dense slab data (e.g. YGO shows 236 % if we count rows).
-- ---------------------------------------------------------------------
CREATE OR REPLACE VIEW public.tcg_network_summary AS
SELECT
  g.id   AS game_id,
  g.slug AS game_slug,
  g.name AS game_name,
  (SELECT COUNT(*) FROM public.tcg_cards      WHERE game_id = g.id) AS cards,
  (SELECT COUNT(*) FROM public.tcg_printings  WHERE game_id = g.id) AS printings,
  (SELECT COUNT(*) FROM public.tcg_printings  WHERE game_id = g.id AND mtg_printings_id IS NOT NULL) AS mapped_to_mtg,
  (SELECT COUNT(*) FROM public.tcg_printings  WHERE game_id = g.id AND mapping_confidence = 'ambiguous') AS ambiguous_printings,
  (SELECT COUNT(*) FROM public.tcg_printings  WHERE game_id = g.id AND mapping_confidence = 'unmapped')  AS unmapped_printings,
  (SELECT COUNT(*) FROM public.tcg_market_prices_current WHERE game_id = g.id) AS market_rows_current,
  (SELECT COUNT(*) FROM public.tcg_graded_prices_current WHERE game_id = g.id) AS graded_rows_current,
  (SELECT COUNT(*) FROM public.tcg_graded_prices_current WHERE game_id = g.id AND grader <> 'raw') AS slab_rows_current,
  (SELECT COUNT(DISTINCT tcg_printing_id)
     FROM public.tcg_graded_prices_current
    WHERE game_id = g.id AND grader <> 'raw') AS distinct_slab_printings,
  (SELECT COUNT(*) FROM public.tcg_graded_prices_current WHERE game_id = g.id AND grader = 'raw') AS raw_rows_current,
  (SELECT COUNT(*) FROM public.tcg_market_price_daily WHERE game_id = g.id) AS market_history_rows,
  (SELECT COUNT(*) FROM public.tcg_graded_price_daily WHERE game_id = g.id) AS graded_history_rows
FROM public.tcg_games g;

GRANT SELECT ON public.tcg_network_summary TO anon, authenticated;

NOTIFY pgrst, 'reload schema';

COMMIT;
