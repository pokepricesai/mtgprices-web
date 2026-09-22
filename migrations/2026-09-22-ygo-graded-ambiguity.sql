-- migrations/2026-09-22-ygo-graded-ambiguity.sql
--
-- Yu-Gi-Oh! shared-data integrity slice. Split into three blocks that
-- the operator runs in sequence:
--
--   A1 (this file): schema + tcg_card_id backfill + historical
--                   attribution correction + CHECK constraints + new
--                   indexes. Purely metadata correction; no price
--                   data is modified or deleted.
--
--   A2 (2026-09-22a2-ygo-graded-current-wipe.sql):
--                   DELETE FROM tcg_graded_prices_current WHERE
--                   game_id='ygo'. Destructive. Operator runs this
--                   immediately before the re-ingest, once credit
--                   reserves have been re-checked.
--
--   B  (2026-09-22b-ygo-trgm-index.sql):
--                   pg_trgm extension + CONCURRENT partial index.
--                   Must run outside a transaction.
--
-- Ambiguity rule (matches src/lib/tcggraph/ingest-core.mjs
-- `resolveGradedAttribution`):
--   A YGO card is variant-ambiguous when it has more than one physical
--   printing. TCGGraph's gradedPrices[] payload carries NO per-printing
--   metadata at all - not for edition variants, not for foil vs normal,
--   not for any surface treatment. Every quote is a card-level
--   aggregate. Historical daily observations for such cards are
--   re-labelled to attribution='card' - the observed PRICE stays
--   exactly as recorded; only the accuracy of its attribution semantics
--   is corrected.
--
--   Impact under this broader rule (measured pre-migration):
--     * 31,830 YGO cards move to attribution='card' (28,761 under the
--       edition-only predicate + 3,069 foil/normal cards missed by it).
--     * ~15,698 additional current rows and ~15,698 additional daily
--       rows are correctly relabelled versus the edition-only rule.
--     * 6,605 single-printing YGO cards remain attribution='printing'.
--     * MTG, One Piece, Lorcana, SWU rows are untouched.

BEGIN;

-- --- 1. Add columns (defaults keep the CHECK trivially satisfied) -----
ALTER TABLE public.tcg_graded_prices_current
  ADD COLUMN IF NOT EXISTS attribution text NOT NULL DEFAULT 'printing',
  ADD COLUMN IF NOT EXISTS tcg_card_id text REFERENCES public.tcg_cards(id) ON DELETE SET NULL;

ALTER TABLE public.tcg_graded_price_daily
  ADD COLUMN IF NOT EXISTS attribution text NOT NULL DEFAULT 'printing',
  ADD COLUMN IF NOT EXISTS tcg_card_id text;   -- soft FK for history

-- --- 2. Backfill tcg_card_id from tcg_printings -----------------------
UPDATE public.tcg_graded_prices_current gpc
   SET tcg_card_id = tp.tcg_card_id
  FROM public.tcg_printings tp
 WHERE gpc.tcg_printing_id = tp.id
   AND gpc.tcg_card_id IS NULL;

UPDATE public.tcg_graded_price_daily gpd
   SET tcg_card_id = tp.tcg_card_id
  FROM public.tcg_printings tp
 WHERE gpd.tcg_printing_id = tp.id
   AND gpd.tcg_card_id IS NULL;

-- --- 3. Historical attribution correction -----------------------------
-- Rows for YGO cards that meet the ambiguity rule get relabelled to
-- attribution='card'. This is metadata correction: PSA/BGS/CGC/SGC and
-- 'any'/'raw' prices are preserved unchanged. Non-ambiguous cards keep
-- attribution='printing' (default). Other games are not touched.

WITH ambiguous_cards AS (
  --  Broader rule (matches resolveGradedAttribution in ingest-core.mjs):
  --  ANY YGO card with more than one physical tcg_printings row is
  --  edition/variant-ambiguous, because TCGGraph gradedPrices[] carries
  --  no per-printing metadata at all - not just for edition variants,
  --  but also for foil vs normal, showcase vs normal, etc. If upstream
  --  ever starts including a per-quote hint we escape via the ingest
  --  code path (SQL only sees the aggregate result).
  SELECT tcg_card_id
    FROM public.tcg_printings
   WHERE game_id = 'ygo'
     AND tcg_card_id IS NOT NULL
   GROUP BY tcg_card_id
  HAVING COUNT(*) > 1
)
UPDATE public.tcg_graded_prices_current d
   SET attribution = 'card'
 WHERE d.game_id = 'ygo'
   AND d.tcg_card_id IN (SELECT tcg_card_id FROM ambiguous_cards)
   AND d.tcg_card_id IS NOT NULL
   AND d.attribution <> 'card';

WITH ambiguous_cards AS (
  --  Broader rule (matches resolveGradedAttribution in ingest-core.mjs):
  --  ANY YGO card with more than one physical tcg_printings row is
  --  edition/variant-ambiguous, because TCGGraph gradedPrices[] carries
  --  no per-printing metadata at all - not just for edition variants,
  --  but also for foil vs normal, showcase vs normal, etc. If upstream
  --  ever starts including a per-quote hint we escape via the ingest
  --  code path (SQL only sees the aggregate result).
  SELECT tcg_card_id
    FROM public.tcg_printings
   WHERE game_id = 'ygo'
     AND tcg_card_id IS NOT NULL
   GROUP BY tcg_card_id
  HAVING COUNT(*) > 1
)
UPDATE public.tcg_graded_price_daily d
   SET attribution = 'card'
 WHERE d.game_id = 'ygo'
   AND d.tcg_card_id IN (SELECT tcg_card_id FROM ambiguous_cards)
   AND d.tcg_card_id IS NOT NULL
   AND d.attribution <> 'card';

-- --- 4. CHECK constraints ---------------------------------------------
-- Constraint added AFTER the correction so it validates the final data
-- state in one pass and any attribution='card' row provably has a
-- tcg_card_id.
ALTER TABLE public.tcg_graded_prices_current
  DROP CONSTRAINT IF EXISTS tcg_graded_prices_current_attribution_ck;
ALTER TABLE public.tcg_graded_prices_current
  ADD CONSTRAINT tcg_graded_prices_current_attribution_ck
      CHECK (
        attribution IN ('printing', 'card')
        AND (attribution <> 'card' OR tcg_card_id IS NOT NULL)
      );

ALTER TABLE public.tcg_graded_price_daily
  DROP CONSTRAINT IF EXISTS tcg_graded_price_daily_attribution_ck;
ALTER TABLE public.tcg_graded_price_daily
  ADD CONSTRAINT tcg_graded_price_daily_attribution_ck
      CHECK (
        attribution IN ('printing', 'card')
        AND (attribution <> 'card' OR tcg_card_id IS NOT NULL)
      );

-- --- 5. Indexes -------------------------------------------------------
CREATE INDEX IF NOT EXISTS tcg_graded_prices_current_card_idx
  ON public.tcg_graded_prices_current (tcg_card_id) WHERE tcg_card_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS tcg_graded_prices_current_attribution_idx
  ON public.tcg_graded_prices_current (game_id, attribution);
CREATE INDEX IF NOT EXISTS tcg_graded_price_daily_card_idx
  ON public.tcg_graded_price_daily (tcg_card_id) WHERE tcg_card_id IS NOT NULL;

COMMIT;

NOTIFY pgrst, 'reload schema';
