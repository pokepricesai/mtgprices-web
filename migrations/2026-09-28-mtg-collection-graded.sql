-- migrations/2026-09-28-mtg-collection-graded.sql
-- Pass 2B mini — add grader / grade columns to mtg_collection_items so a
-- user can record a PSA 10 Black Lotus distinctly from a raw near-mint
-- copy. Purely additive; existing rows unaffected (grader defaults to
-- NULL, meaning "raw"). Idempotent — safe to re-run.
--
-- Design:
--   * grader text NULL           — NULL means raw. Populated for slabs.
--   * grade  text NULL           — free-text tier (e.g. "10", "9.5", "8").
--                                  Constrained to a small enum-ish set
--                                  via CHECK so the UI never has to
--                                  guess casing.
--   * (grader, grade) both NULL for raw, both NOT NULL for graded.
--   * The pre-existing UNIQUE (user_id, printing_finish_id, condition)
--     is REPLACED with a partial-unique-index pair so raw + graded
--     copies coexist:
--       - one row per (user, finish, condition) for raw (grader IS NULL)
--       - one row per (user, finish, grader, grade) for graded
--   * condition is preserved (still valid for raw; for graded copies
--     it stays 'near_mint' — the grade IS the condition signal).
--
-- Rollback:
--   ALTER TABLE mtg_collection_items DROP CONSTRAINT IF EXISTS chk_mtg_collection_items_graded_pair;
--   ALTER TABLE mtg_collection_items DROP CONSTRAINT IF EXISTS chk_mtg_collection_items_grader;
--   ALTER TABLE mtg_collection_items DROP CONSTRAINT IF EXISTS chk_mtg_collection_items_grade;
--   DROP INDEX  IF EXISTS ux_mtg_collection_items_raw;
--   DROP INDEX  IF EXISTS ux_mtg_collection_items_slab;
--   -- Recreate the original constraint if needed:
--   -- ALTER TABLE mtg_collection_items ADD CONSTRAINT mtg_collection_items_user_id_printing_finish_id_condition_key
--   --   UNIQUE (user_id, printing_finish_id, condition);
--   ALTER TABLE mtg_collection_items DROP COLUMN IF EXISTS grader;
--   ALTER TABLE mtg_collection_items DROP COLUMN IF EXISTS grade;

BEGIN;

-- ── 1. Columns ───────────────────────────────────────────────────────
ALTER TABLE mtg_collection_items
  ADD COLUMN IF NOT EXISTS grader text,
  ADD COLUMN IF NOT EXISTS grade  text;

-- ── 2. Constrain grader to a known set. Case-normalised to upper.
--    Same allowlist as tcg_graded_prices_current so a user's records
--    line up with the graded-market data (excluding 'raw' — a raw
--    collection row is expressed by grader IS NULL, not grader='raw').
ALTER TABLE mtg_collection_items
  DROP CONSTRAINT IF EXISTS chk_mtg_collection_items_grader;
ALTER TABLE mtg_collection_items
  ADD  CONSTRAINT chk_mtg_collection_items_grader
  CHECK (
    grader IS NULL
    OR grader IN ('PSA', 'BGS', 'CGC', 'SGC')
  );

-- ── 3. Constrain grade to the tiers those graders actually issue.
--    Two decimal notations exist across graders ('9.5' BGS, '10' PSA,
--    '10.0' would be redundant). Keep the string values simple and
--    documented in the UI.
ALTER TABLE mtg_collection_items
  DROP CONSTRAINT IF EXISTS chk_mtg_collection_items_grade;
ALTER TABLE mtg_collection_items
  ADD  CONSTRAINT chk_mtg_collection_items_grade
  CHECK (
    grade IS NULL
    OR grade IN (
      '10', '9.5', '9', '8.5', '8', '7.5', '7',
      '6.5', '6', '5.5', '5', '4.5', '4',
      '3.5', '3', '2.5', '2', '1.5', '1'
    )
  );

-- ── 4. grader + grade must be either both present or both absent.
ALTER TABLE mtg_collection_items
  DROP CONSTRAINT IF EXISTS chk_mtg_collection_items_graded_pair;
ALTER TABLE mtg_collection_items
  ADD  CONSTRAINT chk_mtg_collection_items_graded_pair
  CHECK (
    (grader IS NULL AND grade IS NULL)
    OR (grader IS NOT NULL AND grade IS NOT NULL)
  );

-- ── 5. Aggregation keys.
--    We need raw and graded copies of the same printing to coexist,
--    with graded copies further separable per (grader, grade). The
--    original UNIQUE (user_id, printing_finish_id, condition) would
--    block a PSA 10 alongside a raw near-mint. Replace it with two
--    partial-unique indexes.
ALTER TABLE mtg_collection_items
  DROP CONSTRAINT IF EXISTS mtg_collection_items_user_id_printing_finish_id_condition_key;

DROP INDEX IF EXISTS ux_mtg_collection_items_raw;
CREATE UNIQUE INDEX ux_mtg_collection_items_raw
  ON mtg_collection_items (user_id, printing_finish_id, condition)
  WHERE grader IS NULL;

DROP INDEX IF EXISTS ux_mtg_collection_items_slab;
CREATE UNIQUE INDEX ux_mtg_collection_items_slab
  ON mtg_collection_items (user_id, printing_finish_id, grader, grade)
  WHERE grader IS NOT NULL;

COMMENT ON COLUMN mtg_collection_items.grader IS
  'Slab grader (PSA/BGS/CGC/SGC). NULL means raw / ungraded.';
COMMENT ON COLUMN mtg_collection_items.grade IS
  'Grade tier as string (10, 9.5, 9, …). NULL means raw. Paired with grader.';

COMMIT;
