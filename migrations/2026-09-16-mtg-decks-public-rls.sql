-- migrations/2026-09-16-mtg-decks-public-rls.sql
-- ============================================================================
-- Phase 3D — public deck sharing RLS + slug uniqueness
-- ============================================================================
--
-- Extends mtg_decks / mtg_deck_cards RLS so anonymous and non-owner
-- authenticated visitors may SELECT decks whose is_public=true. Every
-- write policy remains owner-only. The existing owner-scoped policies are
-- left as-is (they still cover writes and private reads).
--
-- What this migration adds:
--   1. SELECT-only policy for anon on mtg_decks WHERE is_public = true.
--   2. SELECT-only policy for authenticated (non-owner) on mtg_decks
--      WHERE is_public = true. Owners still hit the pre-existing
--      "decks: select own" policy so nothing changes for them.
--   3. SELECT-only policy for anon on mtg_deck_cards where the parent
--      deck is public.
--   4. SELECT-only policy for authenticated (non-owner) on
--      mtg_deck_cards where the parent deck is public.
--   5. Grants SELECT to `anon` on both tables (currently only
--      `authenticated` can SELECT).
--   6. Unique index on lower(slug) WHERE slug IS NOT NULL AND
--      is_public = true — public slugs must be unique but private
--      decks may retain any historic slug value.
--
-- Rollback: DROP the four new policies + REVOKE anon SELECT + DROP the
-- unique index. The original owner-only policies remain untouched.
-- ============================================================================

BEGIN;

-- ── Public read of decks ────────────────────────────────────────────
DROP POLICY IF EXISTS "decks: anon select public" ON mtg_decks;
CREATE POLICY "decks: anon select public" ON mtg_decks
  FOR SELECT TO anon
  USING (is_public = true);

-- Authenticated non-owners can also SELECT public decks. Owners keep
-- the "decks: select own" USING clause which fires first.
DROP POLICY IF EXISTS "decks: authenticated select public" ON mtg_decks;
CREATE POLICY "decks: authenticated select public" ON mtg_decks
  FOR SELECT TO authenticated
  USING (is_public = true);

-- ── Public read of deck contents ────────────────────────────────────
DROP POLICY IF EXISTS "deck_cards: anon select via public parent" ON mtg_deck_cards;
CREATE POLICY "deck_cards: anon select via public parent" ON mtg_deck_cards
  FOR SELECT TO anon
  USING (
    EXISTS (
      SELECT 1 FROM mtg_decks d
       WHERE d.id = mtg_deck_cards.deck_id
         AND d.is_public = true
    )
  );

DROP POLICY IF EXISTS "deck_cards: authenticated select via public parent" ON mtg_deck_cards;
CREATE POLICY "deck_cards: authenticated select via public parent" ON mtg_deck_cards
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM mtg_decks d
       WHERE d.id = mtg_deck_cards.deck_id
         AND d.is_public = true
    )
  );

-- ── Grants ──────────────────────────────────────────────────────────
-- anon needs SELECT on these tables now that public decks exist.
-- Writes remain restricted to authenticated + policy USING clauses.
GRANT SELECT ON mtg_decks       TO anon;
GRANT SELECT ON mtg_deck_cards  TO anon;

-- ── Slug uniqueness (public only) ──────────────────────────────────
-- Two different private decks can share a slug (they're never publicly
-- addressed). Public decks must have unique slugs so the /decks/public/[slug]
-- route resolves to at most one row. Case-insensitive.
CREATE UNIQUE INDEX IF NOT EXISTS ux_mtg_decks_public_slug_ci
  ON mtg_decks (lower(slug))
  WHERE slug IS NOT NULL AND is_public = true;

COMMIT;
