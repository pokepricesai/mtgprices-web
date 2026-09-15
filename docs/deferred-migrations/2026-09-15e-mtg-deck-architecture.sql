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

-- migrations/2026-09-15e-mtg-deck-architecture.sql
-- ============================================================================
-- Stage 1D — MTG deck architecture (schema only; no data yet).
-- Additive; safe; no writes; no destructive changes.
-- ============================================================================
--
-- Why
--   Deck Builder + gameplay AI are major MTGPrices features on the
--   roadmap. Getting the identity model right NOW means the future
--   valuation, portfolio-integration, public-deck-sharing and AI
--   recommendation features do not need a data migration when they
--   land.
--
-- Design constraints (from Phase 1 approval)
--   * Support: format, commander(s), oracle card, optional exact
--     printing, optional finish, quantity, main deck, sideboard,
--     maybeboard, companion.
--   * Ownership / missing status: leave a column for later.
--   * Live price / value: computed at read time, not stored here.
--   * Public/private decks: is_public flag.
--
-- Design decisions
--   * mtg_decks.user_id NULLABLE — supports:
--     - "system decks" (netdecks, official products, editorial decks)
--     - "guest decks" (rare; anonymous deck build), keyed by session id
--     Real user decks reference auth.users(id) when present.
--   * commander_of stored INSIDE mtg_deck_cards via `zone='commander'`
--     rather than a top-level FK on mtg_decks. Rationale:
--     - Partner / Companion / Background introduce multi-commander cases
--       that a single FK cannot express.
--     - The zone enum already distinguishes commander from mainboard,
--       so no additional structure is needed.
--   * mtg_deck_cards.printing_id NULLABLE — a deck may cite an oracle
--     card without pinning to a specific printing. Card art / prices
--     are resolved lazily.
--   * mtg_deck_cards.finish NULLABLE — respected only when printing_id
--     is set. Enforced by CHECK.
--   * Format list is TEXT (Scryfall's format names). Not enumerated at
--     the type level so new formats (Timeless, Explorer, etc.) don't
--     require a schema change.
--   * Zone is a CHECK-constrained TEXT — updates to the vocabulary are
--     cheap.
--
-- Idempotency
--   * IF NOT EXISTS everywhere.
--
-- ============================================================================

BEGIN;

-- ─── mtg_decks ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.mtg_decks (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- ownership
  user_id        UUID,                                     -- FK to auth.users when present; NULL for system/guest decks
  slug           TEXT UNIQUE,                              -- URL slug; nullable until made public

  -- descriptive
  title          TEXT NOT NULL,
  description    TEXT,
  format         TEXT NOT NULL,                            -- 'standard' | 'modern' | 'legacy' | 'vintage' | 'commander' | 'pioneer' | 'pauper' | 'brawl' | 'oathbreaker' | 'cube' | 'casual' | 'other'
  color_identity TEXT[],                                   -- W U B R G — derived at write time; can be NULL

  -- gameplay
  is_singleton   BOOLEAN NOT NULL DEFAULT false,           -- Commander/Highlander enforcement
  min_size       INTEGER,                                  -- format min deck size, cached at write
  max_size       INTEGER,

  -- visibility
  is_public      BOOLEAN NOT NULL DEFAULT false,
  published_at   TIMESTAMPTZ,

  -- provenance
  source         TEXT NOT NULL DEFAULT 'user',             -- 'user' | 'editorial' | 'imported' | 'system'
  import_source_url TEXT,                                  -- e.g. moxfield / archidekt URL when imported

  -- future-proofing (reserved for later phases)
  ownership_summary JSONB,                                 -- filled by portfolio-integration phase
  valuation_summary JSONB,                                 -- filled by live-pricing phase
  ai_summary        JSONB,                                 -- filled by AI phase

  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE  public.mtg_decks IS 'Deck header. Cards live in mtg_deck_cards. Ownership, valuation, AI summaries deferred to later phases.';
COMMENT ON COLUMN public.mtg_decks.user_id           IS 'auth.users(id); NULL for system/guest decks.';
COMMENT ON COLUMN public.mtg_decks.ownership_summary IS 'Reserved for portfolio-integration phase: JSONB shape TBD (owned/missing counts, estimated missing value).';
COMMENT ON COLUMN public.mtg_decks.valuation_summary IS 'Reserved for live-pricing phase: JSONB shape TBD (total_usd, breakdown by zone, staleness marker).';
COMMENT ON COLUMN public.mtg_decks.ai_summary        IS 'Reserved for AI phase: JSONB shape TBD (archetype tag, strategy, top synergies). No AI-generated content stored in this migration.';

CREATE INDEX IF NOT EXISTS mtg_decks_user_id_idx     ON public.mtg_decks (user_id) WHERE user_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS mtg_decks_public_idx      ON public.mtg_decks (is_public, published_at DESC) WHERE is_public = true;
CREATE INDEX IF NOT EXISTS mtg_decks_format_idx      ON public.mtg_decks (format);

-- ─── mtg_deck_cards ────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.mtg_deck_cards (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  deck_id         UUID NOT NULL REFERENCES public.mtg_decks(id) ON DELETE CASCADE,

  oracle_card_id  UUID NOT NULL REFERENCES public.mtg_oracle_cards(id) ON DELETE RESTRICT,
  printing_id     UUID           REFERENCES public.mtg_printings(id)    ON DELETE SET NULL,
  finish          TEXT,                                    -- must be a valid mtg_printing_finishes.finish when printing_id is set

  quantity        INTEGER NOT NULL DEFAULT 1 CHECK (quantity >= 0),

  zone            TEXT    NOT NULL CHECK (zone IN (
                    'mainboard','sideboard','maybeboard','commander','companion','signature_spell'
                  )),
  is_foil         BOOLEAN,                                 -- convenience flag; NULL means "no preference"

  order_index     INTEGER NOT NULL DEFAULT 0,              -- optional visual ordering within a zone
  notes           TEXT,

  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  -- A deck may not list the same oracle in the same zone twice with the
  -- same printing/finish. Reordering is done via order_index.
  UNIQUE (deck_id, zone, oracle_card_id, printing_id, finish),

  -- If finish is set, printing must be set too.
  CHECK (finish IS NULL OR printing_id IS NOT NULL)
);

COMMENT ON TABLE  public.mtg_deck_cards IS 'Deck contents. Commander(s) live in this table with zone=''commander''.';
COMMENT ON COLUMN public.mtg_deck_cards.oracle_card_id IS 'REQUIRED. The game-rules identity of the card.';
COMMENT ON COLUMN public.mtg_deck_cards.printing_id    IS 'OPTIONAL. Which physical printing the user chose. Resolved lazily for pricing.';
COMMENT ON COLUMN public.mtg_deck_cards.finish         IS 'OPTIONAL. nonfoil | foil | etched. Only meaningful when printing_id is set.';
COMMENT ON COLUMN public.mtg_deck_cards.zone           IS 'Which zone the card belongs to in the deck.';

CREATE INDEX IF NOT EXISTS mtg_deck_cards_deck_idx     ON public.mtg_deck_cards (deck_id);
CREATE INDEX IF NOT EXISTS mtg_deck_cards_oracle_idx   ON public.mtg_deck_cards (oracle_card_id);
CREATE INDEX IF NOT EXISTS mtg_deck_cards_printing_idx ON public.mtg_deck_cards (printing_id) WHERE printing_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS mtg_deck_cards_deck_zone_idx ON public.mtg_deck_cards (deck_id, zone);

-- ─── updated_at triggers ───────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.mtg_decks_bump_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at := NOW();
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS mtg_decks_touch ON public.mtg_decks;
CREATE TRIGGER mtg_decks_touch
  BEFORE UPDATE ON public.mtg_decks
  FOR EACH ROW EXECUTE FUNCTION public.mtg_decks_bump_updated_at();

-- Bump the parent deck's updated_at whenever a card row changes.
CREATE OR REPLACE FUNCTION public.mtg_deck_cards_bump_deck_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  UPDATE public.mtg_decks
     SET updated_at = NOW()
   WHERE id = COALESCE(NEW.deck_id, OLD.deck_id);
  RETURN COALESCE(NEW, OLD);
END $$;

DROP TRIGGER IF EXISTS mtg_deck_cards_touch_parent ON public.mtg_deck_cards;
CREATE TRIGGER mtg_deck_cards_touch_parent
  AFTER INSERT OR UPDATE OR DELETE ON public.mtg_deck_cards
  FOR EACH ROW EXECUTE FUNCTION public.mtg_deck_cards_bump_deck_updated_at();

-- ─── RLS ────────────────────────────────────────────────────────────────────
ALTER TABLE public.mtg_decks       ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.mtg_deck_cards  ENABLE ROW LEVEL SECURITY;

-- Public decks are readable by anon; authenticated users can read their own.
DROP POLICY IF EXISTS mtg_decks_read_public ON public.mtg_decks;
CREATE POLICY mtg_decks_read_public
  ON public.mtg_decks
  FOR SELECT
  TO anon, authenticated
  USING (is_public = true OR (auth.uid() IS NOT NULL AND user_id = auth.uid()));

DROP POLICY IF EXISTS mtg_decks_write_own ON public.mtg_decks;
CREATE POLICY mtg_decks_write_own
  ON public.mtg_decks
  FOR ALL
  TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

-- Card rows follow the parent deck's visibility.
DROP POLICY IF EXISTS mtg_deck_cards_read ON public.mtg_deck_cards;
CREATE POLICY mtg_deck_cards_read
  ON public.mtg_deck_cards
  FOR SELECT
  TO anon, authenticated
  USING (EXISTS (
    SELECT 1 FROM public.mtg_decks d
     WHERE d.id = mtg_deck_cards.deck_id
       AND (d.is_public = true OR (auth.uid() IS NOT NULL AND d.user_id = auth.uid()))
  ));

DROP POLICY IF EXISTS mtg_deck_cards_write ON public.mtg_deck_cards;
CREATE POLICY mtg_deck_cards_write
  ON public.mtg_deck_cards
  FOR ALL
  TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.mtg_decks d
     WHERE d.id = mtg_deck_cards.deck_id
       AND d.user_id = auth.uid()
  ))
  WITH CHECK (EXISTS (
    SELECT 1 FROM public.mtg_decks d
     WHERE d.id = mtg_deck_cards.deck_id
       AND d.user_id = auth.uid()
  ));

-- ─── Post-condition sanity ──────────────────────────────────────────────────
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_tables WHERE tablename='mtg_decks') THEN
    RAISE EXCEPTION 'mtg_decks not created';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_tables WHERE tablename='mtg_deck_cards') THEN
    RAISE EXCEPTION 'mtg_deck_cards not created';
  END IF;
  RAISE NOTICE 'mtg_decks + mtg_deck_cards created; RLS enabled';
END $$;

COMMIT;
