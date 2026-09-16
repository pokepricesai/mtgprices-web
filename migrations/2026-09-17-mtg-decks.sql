-- migrations/2026-09-17-mtg-decks.sql
-- Phase 3A — Manual Deck Builder.
--
-- Adds two new MTG-specific tables owned per-user via Supabase Auth:
--
--   mtg_decks       — deck metadata (name, format, notes, timestamps)
--   mtg_deck_cards  — one row per (deck, oracle_card, zone). Optional
--                     preferred physical printing/finish.
--
-- Data-model principle:
--
--   `oracle_card_id` is the REQUIRED gameplay identity of every deck
--   entry. Four different printings of Lightning Bolt are still
--   Lightning Bolt for legality, duplicate and construction rules.
--
--   `printing_finish_id` is OPTIONAL — the user's preferred physical
--   version for collection matching, pricing, purchasing and
--   visualisation.
--
-- Rollback:
--   DROP TABLE IF EXISTS mtg_deck_cards;
--   DROP TABLE IF EXISTS mtg_decks;
--   DROP TYPE  IF EXISTS mtg_deck_zone;

BEGIN;

-- ── Zone enum ────────────────────────────────────────────────────────
-- Anticipates every zone MTG formats meaningfully use. Ordered so most
-- common (main) sorts naturally first via ordinal comparisons if we
-- ever need it.
DO $$ BEGIN
  CREATE TYPE mtg_deck_zone AS ENUM (
    'main',
    'commander',
    'sideboard',
    'companion',
    'maybeboard'
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ── mtg_decks ────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS mtg_decks (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  name            text NOT NULL CHECK (length(name) BETWEEN 1 AND 120),
  format          text NOT NULL,
  description     text,
  -- Future capabilities — nullable / defaulted so we don't need to
  -- migrate again to enable them.
  is_public       boolean NOT NULL DEFAULT false,
  slug            text,
  budget_target_cents integer,
  budget_currency text CHECK (budget_currency IN ('USD', 'EUR') OR budget_currency IS NULL),
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE mtg_decks IS
  'Phase 3A user-owned MTG decks. RLS-locked to auth.uid()=user_id. Sharing/public status shipped nullable/false — not yet used.';

CREATE INDEX IF NOT EXISTS ix_mtg_decks_user_updated
  ON mtg_decks (user_id, updated_at DESC);

-- Auto-bump updated_at on every mutation.
CREATE OR REPLACE FUNCTION mtg_decks_touch_updated()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at := now(); RETURN NEW; END $$;

DROP TRIGGER IF EXISTS trg_mtg_decks_touch ON mtg_decks;
CREATE TRIGGER trg_mtg_decks_touch
  BEFORE UPDATE ON mtg_decks
  FOR EACH ROW EXECUTE FUNCTION mtg_decks_touch_updated();

-- ── mtg_deck_cards ───────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS mtg_deck_cards (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  deck_id             uuid NOT NULL REFERENCES mtg_decks(id) ON DELETE CASCADE,
  oracle_card_id      uuid NOT NULL REFERENCES mtg_oracle_cards(id) ON DELETE RESTRICT,
  quantity            integer NOT NULL CHECK (quantity > 0),
  zone                mtg_deck_zone NOT NULL DEFAULT 'main',
  -- Optional preferred physical printing + finish.
  printing_finish_id  uuid REFERENCES mtg_printing_finishes(id) ON DELETE SET NULL,
  -- Optional per-card note.
  notes               text,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now(),
  -- Aggregation key. A card can appear in multiple zones (main +
  -- sideboard) as separate rows, but not twice in the same zone.
  UNIQUE (deck_id, oracle_card_id, zone)
);

COMMENT ON TABLE mtg_deck_cards IS
  'Phase 3A deck contents. Aggregated by (deck, oracle, zone) — quantity captures how many. oracle_card_id is REQUIRED (the playable identity); printing_finish_id is optional and represents the preferred physical version.';

CREATE INDEX IF NOT EXISTS ix_mtg_deck_cards_deck
  ON mtg_deck_cards (deck_id);
CREATE INDEX IF NOT EXISTS ix_mtg_deck_cards_deck_oracle
  ON mtg_deck_cards (deck_id, oracle_card_id);

CREATE OR REPLACE FUNCTION mtg_deck_cards_touch_updated()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at := now(); RETURN NEW; END $$;

DROP TRIGGER IF EXISTS trg_mtg_deck_cards_touch ON mtg_deck_cards;
CREATE TRIGGER trg_mtg_deck_cards_touch
  BEFORE UPDATE ON mtg_deck_cards
  FOR EACH ROW EXECUTE FUNCTION mtg_deck_cards_touch_updated();

-- ── Row-Level Security ───────────────────────────────────────────────
ALTER TABLE mtg_decks       ENABLE ROW LEVEL SECURITY;
ALTER TABLE mtg_deck_cards  ENABLE ROW LEVEL SECURITY;

-- mtg_decks: authenticated user reads/writes their own rows.
DROP POLICY IF EXISTS "decks: select own" ON mtg_decks;
CREATE POLICY "decks: select own" ON mtg_decks
  FOR SELECT TO authenticated USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "decks: insert own" ON mtg_decks;
CREATE POLICY "decks: insert own" ON mtg_decks
  FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "decks: update own" ON mtg_decks;
CREATE POLICY "decks: update own" ON mtg_decks
  FOR UPDATE TO authenticated
  USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "decks: delete own" ON mtg_decks;
CREATE POLICY "decks: delete own" ON mtg_decks
  FOR DELETE TO authenticated USING (auth.uid() = user_id);

-- mtg_deck_cards: parent-deck ownership decides. Never trust a raw
-- user_id column here; enforce via EXISTS on mtg_decks so even a bad
-- client can't spoof a foreign deck's id.
DROP POLICY IF EXISTS "deck_cards: through parent deck" ON mtg_deck_cards;
CREATE POLICY "deck_cards: through parent deck" ON mtg_deck_cards
  FOR ALL TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM mtg_decks d
       WHERE d.id = mtg_deck_cards.deck_id
         AND d.user_id = auth.uid()
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM mtg_decks d
       WHERE d.id = mtg_deck_cards.deck_id
         AND d.user_id = auth.uid()
    )
  );

-- ── Grants ───────────────────────────────────────────────────────────
GRANT SELECT, INSERT, UPDATE, DELETE ON mtg_decks       TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON mtg_deck_cards  TO authenticated;

COMMIT;
