-- ============================================================================
-- STATUS: DEFERRED — DO NOT APPLY
-- ============================================================================
--
-- This file is a design draft written during Stage 1D planning and was
-- explicitly REJECTED from the approved Stage 1D scope. It is retained
-- as a design record only. It must NOT be run against production.
--
-- Location: docs/deferred-migrations/ (deliberately outside migrations/).
--
-- If any of these ideas is revived in a later phase, promote it to a
-- new file under migrations/ with a fresh date + serial, do not simply
-- move this file back.
-- ============================================================================

-- migrations/2026-09-15c-mtg-scryfall-enrichment.sql
-- ============================================================================
-- Stage 1D — Scryfall enrichment columns on mtg_printings + mtg_oracle_cards.
-- Additive DDL only. The subsequent enrichment backfill script populates
-- the columns from a fresh Scryfall Default Cards + Oracle Cards bulk read.
-- ============================================================================
--
-- Why
--   The Phase 1 gap analysis (§3a) identified Scryfall fields that are
--   already present in the bulk feeds but not persisted on our
--   printings / oracle_cards rows. Adding them now lets the deck AI +
--   card pages reason about frame/showcase treatments, promo types,
--   security stamps, watermarks, related parts (tokens/melds), and
--   external marketplace identifiers (TCGplayer/Cardmarket/MTGO/Arena
--   product IDs).
--
--   Columns are nullable — the migration is safe even before the
--   backfill script runs. NULLs simply mean "we haven't loaded this
--   yet". Card pages must not assume the columns are populated until
--   the backfill completes.
--
-- Design
--   * Native array types (TEXT[]) for `frame_effects`, `promo_types`.
--     Scryfall emits them as JSON arrays; we already use TEXT[] for
--     colors / color_identity / keywords / produced_mana.
--   * `variation_of` references mtg_printings(scryfall_id) as a TEXT
--     UUID for now (deferred FK — Scryfall exposes it as a printing
--     UUID, and we resolve to our internal id lazily). Rationale:
--     variation_of relationships form cycles in edge cases (Un-set
--     art variations); avoiding a hard FK dodges any dependency-order
--     surprise at backfill time. We can promote to FK later once the
--     data is proven acyclic.
--   * `all_parts` on mtg_oracle_cards stays JSONB (unbounded shape,
--     small volume). Related-part queries can index into it via
--     jsonb_path_ops.
--   * `edhrec_rank`, `penny_rank` are 32-bit signed — Scryfall values
--     fit comfortably.
--
-- Idempotency
--   * ADD COLUMN IF NOT EXISTS for every column.
--   * No data mutation in this migration; population happens in the
--     separate backfill script.
--
-- ============================================================================

BEGIN;

-- ─── mtg_printings ─────────────────────────────────────────────────────────
ALTER TABLE public.mtg_printings
  ADD COLUMN IF NOT EXISTS frame            TEXT,
  ADD COLUMN IF NOT EXISTS frame_effects    TEXT[],
  ADD COLUMN IF NOT EXISTS promo_types      TEXT[],
  ADD COLUMN IF NOT EXISTS security_stamp   TEXT,
  ADD COLUMN IF NOT EXISTS border_color     TEXT,
  ADD COLUMN IF NOT EXISTS watermark        TEXT,
  ADD COLUMN IF NOT EXISTS oversized        BOOLEAN,
  ADD COLUMN IF NOT EXISTS story_spotlight  BOOLEAN,
  ADD COLUMN IF NOT EXISTS booster          BOOLEAN,
  ADD COLUMN IF NOT EXISTS variation_of     UUID,
  ADD COLUMN IF NOT EXISTS content_warning  BOOLEAN,
  ADD COLUMN IF NOT EXISTS flavor_text      TEXT,
  ADD COLUMN IF NOT EXISTS finishes_source  TEXT[];

COMMENT ON COLUMN public.mtg_printings.frame           IS 'Card frame era: 1993 | 1997 | 2003 | 2015 | future.';
COMMENT ON COLUMN public.mtg_printings.frame_effects   IS 'Frame treatments — legendary, miracle, nyxtouched, draft, devoid, tombstone, colorshifted, inverted, sunmoondfc, compasslanddfc, originpwdfc, mooneldrazidfc, waxingandwaningmoondfc, showcase, extendedart, companion, etched, snow, lesson, shatteredglass, convertdfc, fandfc, upsidedowndfc.';
COMMENT ON COLUMN public.mtg_printings.promo_types     IS 'Promo classification array from Scryfall (boosterfun, prerelease, promopack, buyabox, judgegift, playerrewards, gameday, textured, godzillaseries, planeswalkerstamp, …).';
COMMENT ON COLUMN public.mtg_printings.security_stamp  IS 'Anti-counterfeit stamp on modern cards: oval | triangle | acorn | arena | heart.';
COMMENT ON COLUMN public.mtg_printings.border_color    IS 'black | white | borderless | silver | gold. Kept alongside the pre-existing `borderless` boolean.';
COMMENT ON COLUMN public.mtg_printings.watermark       IS 'Set / faction watermark (rakdos, azorius, mardu, mtg, phyrexian, planeswalker, …).';
COMMENT ON COLUMN public.mtg_printings.oversized       IS 'Oversized cards (Commander decks, Planechase, Archenemy) — never tournament-legal, never publicly indexed.';
COMMENT ON COLUMN public.mtg_printings.story_spotlight IS 'Story-spotlight designation from Scryfall.';
COMMENT ON COLUMN public.mtg_printings.booster         IS 'Whether Scryfall marks this printing as coming from a normal booster pack.';
COMMENT ON COLUMN public.mtg_printings.variation_of    IS 'When this printing is a variation of another, the Scryfall UUID of the "primary" printing. Deferred FK.';
COMMENT ON COLUMN public.mtg_printings.content_warning IS 'Cards with WOTC-issued content warnings (racial/other).';
COMMENT ON COLUMN public.mtg_printings.flavor_text     IS 'Printing-level flavor text — not gameplay data, but useful for card pages / AI.';
COMMENT ON COLUMN public.mtg_printings.finishes_source IS 'Raw Scryfall finishes[] array kept for audit/reconciliation. Structural data still lives in mtg_printing_finishes.';

CREATE INDEX IF NOT EXISTS mtg_printings_frame_idx           ON public.mtg_printings (frame);
CREATE INDEX IF NOT EXISTS mtg_printings_border_color_idx    ON public.mtg_printings (border_color);
CREATE INDEX IF NOT EXISTS mtg_printings_watermark_idx       ON public.mtg_printings (watermark) WHERE watermark IS NOT NULL;
CREATE INDEX IF NOT EXISTS mtg_printings_oversized_idx       ON public.mtg_printings (oversized) WHERE oversized = true;
CREATE INDEX IF NOT EXISTS mtg_printings_frame_effects_gin   ON public.mtg_printings USING GIN (frame_effects);
CREATE INDEX IF NOT EXISTS mtg_printings_promo_types_gin     ON public.mtg_printings USING GIN (promo_types);

-- ─── mtg_oracle_cards ───────────────────────────────────────────────────────
ALTER TABLE public.mtg_oracle_cards
  ADD COLUMN IF NOT EXISTS edhrec_rank INTEGER,
  ADD COLUMN IF NOT EXISTS penny_rank  INTEGER,
  ADD COLUMN IF NOT EXISTS all_parts   JSONB;

COMMENT ON COLUMN public.mtg_oracle_cards.edhrec_rank IS 'EDHREC popularity rank (1 = most-played in Commander). NULL for cards outside EDHREC coverage.';
COMMENT ON COLUMN public.mtg_oracle_cards.penny_rank  IS 'Penny Dreadful format rank.';
COMMENT ON COLUMN public.mtg_oracle_cards.all_parts   IS 'Related-card graph from Scryfall (tokens produced, meld pieces, adventure/split faces, combos). JSONB of Scryfall''s all_parts array.';

CREATE INDEX IF NOT EXISTS mtg_oracle_cards_edhrec_rank_idx ON public.mtg_oracle_cards (edhrec_rank) WHERE edhrec_rank IS NOT NULL;
CREATE INDEX IF NOT EXISTS mtg_oracle_cards_all_parts_gin   ON public.mtg_oracle_cards USING GIN (all_parts jsonb_path_ops);

-- ─── Post-condition sanity ──────────────────────────────────────────────────
DO $$
DECLARE
  need_backfill boolean;
BEGIN
  SELECT EXISTS (
    SELECT 1 FROM public.mtg_printings
     WHERE frame IS NULL OR border_color IS NULL LIMIT 1
  ) INTO need_backfill;
  IF need_backfill THEN
    RAISE NOTICE 'enrichment columns added; run backfill_scryfall_enrichment.py to populate them.';
  END IF;
END $$;

COMMIT;
