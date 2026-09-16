-- migrations/2026-09-16b-mtg-collections.sql
-- Phase 2C — Accounts + Collections.
--
-- Adds three MTG-specific tables that live alongside the existing
-- catalogue but are owned per-user via Supabase Auth (auth.users):
--
--   mtg_collection_items      — every user's owned printings
--   mtg_collection_imports    — audit trail for CSV imports
--   mtg_user_prefs            — per-user MTGPrices preferences
--                               (default valuation basis, etc.)
--
-- Every table has:
--   - `user_id uuid references auth.users(id) on delete cascade`
--   - Row-Level Security enabled
--   - `select/insert/update/delete` policies restricted to
--     `auth.uid() = user_id`
--
-- Aggregation model: **one row per (user, printing_finish, condition)**.
-- Not per physical copy. This matches how collectors think about their
-- boxes ("4 NM Lightning Bolt (2ED)"), and it makes deck-builder queries
-- ("do I own this Oracle card?") efficient.
--
-- Conditions use a controlled enum matching the TCGplayer/Cardmarket
-- 5-tier convention. If we need graded slabs later, they get their own
-- shape (probably a separate `mtg_collection_slabs` table).
--
-- Rollback:
--   DROP TABLE IF EXISTS mtg_collection_imports;
--   DROP TABLE IF EXISTS mtg_collection_items;
--   DROP TABLE IF EXISTS mtg_user_prefs;
--   DROP TYPE  IF EXISTS mtg_card_condition;

BEGIN;

-- ── Enum for card condition ──────────────────────────────────────────
DO $$ BEGIN
  CREATE TYPE mtg_card_condition AS ENUM (
    'near_mint',
    'lightly_played',
    'moderately_played',
    'heavily_played',
    'damaged'
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ── mtg_collection_items ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS mtg_collection_items (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id               uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  printing_finish_id    uuid NOT NULL REFERENCES mtg_printing_finishes(id) ON DELETE RESTRICT,
  condition             mtg_card_condition NOT NULL DEFAULT 'near_mint',
  quantity              integer NOT NULL CHECK (quantity > 0),
  -- Optional acquired-price metadata. Currency is text (USD/EUR) to
  -- match mtg_current_prices; we NEVER silently FX between them.
  acquired_price_cents  integer,
  acquired_currency     text CHECK (acquired_currency IN ('USD', 'EUR') OR acquired_currency IS NULL),
  acquired_at           date,
  notes                 text,
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now(),
  -- Aggregation key: one row per (user, printing_finish, condition).
  UNIQUE (user_id, printing_finish_id, condition)
);

COMMENT ON TABLE mtg_collection_items IS
  'Per-user owned MTG cards. Aggregated by (printing_finish, condition) — quantity captures how many. RLS-locked to the owning user.';

-- Fast lookups: "does user X own oracle card Y?" and "what does user X
-- own across all printings of this Oracle?"
CREATE INDEX IF NOT EXISTS ix_mtg_collection_items_user
  ON mtg_collection_items (user_id);
CREATE INDEX IF NOT EXISTS ix_mtg_collection_items_user_finish
  ON mtg_collection_items (user_id, printing_finish_id);

-- Update timestamp on write.
CREATE OR REPLACE FUNCTION mtg_collection_items_touch_updated()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at := now(); RETURN NEW; END $$;

DROP TRIGGER IF EXISTS trg_mtg_collection_items_touch ON mtg_collection_items;
CREATE TRIGGER trg_mtg_collection_items_touch
  BEFORE UPDATE ON mtg_collection_items
  FOR EACH ROW EXECUTE FUNCTION mtg_collection_items_touch_updated();

-- ── mtg_collection_imports ───────────────────────────────────────────
CREATE TABLE IF NOT EXISTS mtg_collection_imports (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id           uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  filename          text,
  source            text NOT NULL DEFAULT 'generic',
  total_rows        integer NOT NULL DEFAULT 0,
  imported_rows     integer NOT NULL DEFAULT 0,
  ambiguous_rows    integer NOT NULL DEFAULT 0,
  unresolved_rows   integer NOT NULL DEFAULT 0,
  summary           jsonb,
  created_at        timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE mtg_collection_imports IS
  'CSV import audit trail. One row per import invocation. Summary is a jsonb blob describing what matched and what did not.';

CREATE INDEX IF NOT EXISTS ix_mtg_collection_imports_user
  ON mtg_collection_imports (user_id, created_at DESC);

-- ── mtg_user_prefs ───────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS mtg_user_prefs (
  user_id                  uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  valuation_provider       text NOT NULL DEFAULT 'tcgplayer',
  valuation_currency       text NOT NULL DEFAULT 'USD',
  valuation_price_type     text NOT NULL DEFAULT 'retail',
  valuation_market         text NOT NULL DEFAULT 'paper',
  updated_at               timestamptz NOT NULL DEFAULT now(),
  CHECK (valuation_currency IN ('USD', 'EUR')),
  CHECK (valuation_price_type IN ('retail', 'buylist')),
  CHECK (valuation_market IN ('paper', 'mtgo'))
);

COMMENT ON TABLE mtg_user_prefs IS
  'Per-user MTGPrices preferences. Valuation basis is currency/provider explicit — MTGPrices never silently FX between USD and EUR.';

-- ── Row-Level Security ───────────────────────────────────────────────
ALTER TABLE mtg_collection_items    ENABLE ROW LEVEL SECURITY;
ALTER TABLE mtg_collection_imports  ENABLE ROW LEVEL SECURITY;
ALTER TABLE mtg_user_prefs          ENABLE ROW LEVEL SECURITY;

-- mtg_collection_items: authenticated users read/write their own rows.
DROP POLICY IF EXISTS "collection_items: select own" ON mtg_collection_items;
CREATE POLICY "collection_items: select own" ON mtg_collection_items
  FOR SELECT TO authenticated USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "collection_items: insert own" ON mtg_collection_items;
CREATE POLICY "collection_items: insert own" ON mtg_collection_items
  FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "collection_items: update own" ON mtg_collection_items;
CREATE POLICY "collection_items: update own" ON mtg_collection_items
  FOR UPDATE TO authenticated
  USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "collection_items: delete own" ON mtg_collection_items;
CREATE POLICY "collection_items: delete own" ON mtg_collection_items
  FOR DELETE TO authenticated USING (auth.uid() = user_id);

-- mtg_collection_imports: same shape.
DROP POLICY IF EXISTS "collection_imports: select own" ON mtg_collection_imports;
CREATE POLICY "collection_imports: select own" ON mtg_collection_imports
  FOR SELECT TO authenticated USING (auth.uid() = user_id);
DROP POLICY IF EXISTS "collection_imports: insert own" ON mtg_collection_imports;
CREATE POLICY "collection_imports: insert own" ON mtg_collection_imports
  FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);

-- mtg_user_prefs: same.
DROP POLICY IF EXISTS "user_prefs: select own" ON mtg_user_prefs;
CREATE POLICY "user_prefs: select own" ON mtg_user_prefs
  FOR SELECT TO authenticated USING (auth.uid() = user_id);
DROP POLICY IF EXISTS "user_prefs: upsert own" ON mtg_user_prefs;
CREATE POLICY "user_prefs: upsert own" ON mtg_user_prefs
  FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);
DROP POLICY IF EXISTS "user_prefs: update own" ON mtg_user_prefs;
CREATE POLICY "user_prefs: update own" ON mtg_user_prefs
  FOR UPDATE TO authenticated
  USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

-- ── Grants for authenticated role ────────────────────────────────────
GRANT SELECT, INSERT, UPDATE, DELETE ON mtg_collection_items    TO authenticated;
GRANT SELECT, INSERT                 ON mtg_collection_imports  TO authenticated;
GRANT SELECT, INSERT, UPDATE         ON mtg_user_prefs          TO authenticated;

-- The service-role bypass RLS as usual — no explicit grants needed.

COMMIT;
