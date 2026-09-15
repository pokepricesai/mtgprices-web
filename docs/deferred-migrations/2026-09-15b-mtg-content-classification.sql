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

-- migrations/2026-09-15b-mtg-content-classification.sql
-- ============================================================================
-- Stage 1D — content classification + public_indexable on mtg_printings.
-- Additive, non-destructive. Rules-based backfill included.
-- ============================================================================
--
-- Why
--   Stage 1B loaded every Scryfall printing we could reach — tokens,
--   emblems, art cards, digital-only cards, memorabilia, funny/unfinity
--   sets. That is correct for AI reasoning (we need to know what token
--   a card produces, what the meld piece looks like, what's Un-format),
--   but it is NOT correct for public indexing (a user searching for
--   "Lightning Bolt" should not see 12 emblems and 4 tokens ahead of the
--   card).
--
--   This migration decouples "is this row valid catalogue data" from
--   "should this row appear in public search / on the sitemap / in the
--   card grid".
--
-- Design
--   * content_class TEXT with a fixed vocabulary (`card`, `token`,
--     `emblem`, `art_card`, `digital_only`, `oversized`, `memorabilia`,
--     `minigame`, `funny`, `other`). No ENUM — additions are cheap.
--   * public_indexable BOOLEAN, defaulting to false. The backfill sets
--     it to TRUE only for content_class='card' and non-digital and
--     non-funny set types.
--   * Everything derives from Scryfall fields already present on
--     mtg_printings + mtg_sets (layout, digital, oversized, set_type).
--     No new external data is fetched by this migration.
--   * A companion table mtg_content_class_rules keeps the SQL rules
--     auditable and re-runnable.
--
-- Idempotency
--   * ADD COLUMN IF NOT EXISTS.
--   * Backfill uses NULL-check: does not overwrite manual admin edits.
--
-- Reversibility
--   * ALTER TABLE ... DROP COLUMN public_indexable, content_class
--     if the schema needs to be rolled back.
--
-- ============================================================================

BEGIN;

-- ─── Add columns ────────────────────────────────────────────────────────────
ALTER TABLE public.mtg_printings
  ADD COLUMN IF NOT EXISTS content_class    TEXT,
  ADD COLUMN IF NOT EXISTS public_indexable BOOLEAN NOT NULL DEFAULT false;

COMMENT ON COLUMN public.mtg_printings.content_class    IS 'Classification for indexing/display gating. Vocabulary: card | token | emblem | art_card | digital_only | oversized | memorabilia | minigame | funny | other.';
COMMENT ON COLUMN public.mtg_printings.public_indexable IS 'Whether this printing should appear in public search / sitemap / card grid. Auto-set by content_class rules, overridable by admin.';

CREATE INDEX IF NOT EXISTS mtg_printings_content_class_idx
  ON public.mtg_printings (content_class);
CREATE INDEX IF NOT EXISTS mtg_printings_public_indexable_idx
  ON public.mtg_printings (public_indexable) WHERE public_indexable = true;

-- ─── Rule catalogue (for audit + re-runnability) ────────────────────────────
CREATE TABLE IF NOT EXISTS public.mtg_content_class_rules (
  rule_id      INT PRIMARY KEY,
  rule_name    TEXT NOT NULL,
  match_expr   TEXT NOT NULL,   -- human-readable SQL predicate description
  assigns_to   TEXT NOT NULL,
  is_public    BOOLEAN NOT NULL,
  notes        TEXT,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

INSERT INTO public.mtg_content_class_rules (rule_id, rule_name, match_expr, assigns_to, is_public, notes) VALUES
  (1, 'token',           'mtg_oracle_cards.layout = ''token'' OR mtg_sets.set_type = ''token''', 'token',        false, 'Scryfall token layouts + dedicated token sets.'),
  (2, 'emblem',           'mtg_oracle_cards.layout = ''emblem''',                            'emblem',       false, 'Planeswalker emblems.'),
  (3, 'art_card',         'mtg_oracle_cards.layout = ''art_series''',                        'art_card',     false, 'Scryfall art_series layout — collectible art cards.'),
  (4, 'digital_only',     'mtg_printings.digital = true',                                    'digital_only', false, 'Digital-only printings (Arena/MTGO exclusives).'),
  (5, 'oversized',        'mtg_printings.oversized = true (post-enrichment)',                'oversized',    false, 'Oversized cards (Commander/Planechase).'),
  (6, 'memorabilia',      'mtg_sets.set_type = ''memorabilia''',                             'memorabilia',  false, 'Playmats, oversized promotional pieces, etc.'),
  (7, 'minigame',         'mtg_sets.set_type = ''minigame''',                                'minigame',     false, 'Minigame cards (e.g. Duel Decks Anthology minigames).'),
  (8, 'funny',            'mtg_sets.set_type = ''funny''',                                   'funny',        false, 'Un-sets and other explicitly non-tournament-legal sets.'),
  (9, 'card_default',     'everything else',                                                  'card',         true,  'Ordinary MTG card printings — the public catalogue.')
ON CONFLICT (rule_id) DO UPDATE SET
  rule_name = EXCLUDED.rule_name,
  match_expr = EXCLUDED.match_expr,
  assigns_to = EXCLUDED.assigns_to,
  is_public  = EXCLUDED.is_public,
  notes      = EXCLUDED.notes;

-- ─── Backfill — rules-based, additive (only fills NULL content_class) ──────
-- Order matters: more specific rules run first.

-- Rule 1: token — via oracle_card layout OR set_type
UPDATE public.mtg_printings p
   SET content_class = 'token', public_indexable = false
  FROM public.mtg_oracle_cards oc,
       public.mtg_sets s
 WHERE p.content_class IS NULL
   AND p.oracle_card_id = oc.id
   AND p.set_id         = s.id
   AND (oc.layout = 'token' OR s.set_type = 'token');

-- Rule 2: emblem
UPDATE public.mtg_printings p
   SET content_class = 'emblem', public_indexable = false
  FROM public.mtg_oracle_cards oc
 WHERE p.content_class IS NULL
   AND p.oracle_card_id = oc.id
   AND oc.layout = 'emblem';

-- Rule 3: art_card
UPDATE public.mtg_printings p
   SET content_class = 'art_card', public_indexable = false
  FROM public.mtg_oracle_cards oc
 WHERE p.content_class IS NULL
   AND p.oracle_card_id = oc.id
   AND oc.layout = 'art_series';

-- Rule 4: digital_only
UPDATE public.mtg_printings
   SET content_class = 'digital_only', public_indexable = false
 WHERE content_class IS NULL AND digital = true;

-- Rule 5: oversized — deferred until 2026-09-15c enriches printings with `oversized`.
-- We tag NOTHING here so that after the enrichment backfill lands, a
-- separate re-run of this rule (or a manual UPDATE) can pick them up.

-- Rule 6-8: set_type = memorabilia / minigame / funny
UPDATE public.mtg_printings p
   SET content_class = s.set_type, public_indexable = false
  FROM public.mtg_sets s
 WHERE p.content_class IS NULL
   AND p.set_id = s.id
   AND s.set_type IN ('memorabilia','minigame','funny');

-- Rule 9: card_default — everything remaining gets 'card' + public_indexable=true
UPDATE public.mtg_printings
   SET content_class = 'card', public_indexable = true
 WHERE content_class IS NULL;

-- ─── Post-condition sanity ──────────────────────────────────────────────────
DO $$
DECLARE
  n_null  int;
  n_card  int;
  n_token int;
BEGIN
  SELECT COUNT(*) INTO n_null  FROM public.mtg_printings WHERE content_class IS NULL;
  SELECT COUNT(*) INTO n_card  FROM public.mtg_printings WHERE content_class = 'card';
  SELECT COUNT(*) INTO n_token FROM public.mtg_printings WHERE content_class = 'token';
  IF n_null > 0 THEN
    RAISE EXCEPTION 'backfill left % NULL content_class rows', n_null;
  END IF;
  RAISE NOTICE 'content_class distribution: card=% token=% (see mtg_content_class_rules for the rest)', n_card, n_token;
END $$;

COMMIT;
