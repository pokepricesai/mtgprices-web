-- migrations/2026-09-16-mtg-oracle-capabilities.sql
-- Phase 2B — Smart Card Finder.
--
-- Adds a queryable, GIN-indexed capability array to every Oracle card so
-- /card-finder can filter across the whole ~40k catalogue instead of
-- scanning a 300-candidate slice (the current Phase 2A limit).
--
-- Ground truth for what goes in this column is the shared classifier at
-- src/lib/mtg/capabilities.ts. Used by:
--   - scripts/phase2b-backfill-capabilities.ts   (one-shot initial fill)
--   - scripts/phase2b-classify-changed.ts        (permanent freshness path
--                                                  — only touches rows
--                                                  with empty caps or
--                                                  updated_at ≥ --since)
--
-- Every capability tag stored here must be regex-verifiable against the
-- row it lives on. Never invented.
--
-- NOT NULL DEFAULT '{}'::text[]  ── new Oracle rows always have an empty
-- array, not NULL. On existing rows, Postgres 11+ takes the metadata-only
-- fast path so this ALTER completes in milliseconds regardless of row
-- count.
--
-- Rollback:
--   DROP FUNCTION IF EXISTS mtg_bulk_update_capabilities(jsonb);
--   DROP INDEX IF EXISTS ix_mtg_oracle_cards_capabilities;
--   ALTER TABLE mtg_oracle_cards DROP COLUMN IF EXISTS capabilities;

-- ── 1. Column ────────────────────────────────────────────────────────
ALTER TABLE mtg_oracle_cards
  ADD COLUMN IF NOT EXISTS capabilities text[] NOT NULL DEFAULT '{}'::text[];

COMMENT ON COLUMN mtg_oracle_cards.capabilities IS
  'Phase 2B deterministic capability tags. Ground truth: src/lib/mtg/capabilities.ts. Every tag is regex-derived from the row it lives on. Never invented. Empty array = classifier found no confident tag; new Stage 1D rows land here by default and are backfilled by scripts/phase2b-classify-changed.ts.';

-- ── 2. GIN index ─────────────────────────────────────────────────────
-- Enables:
--   WHERE capabilities @> ARRAY['card-draw']          (AND — all present)
--   WHERE capabilities && ARRAY['creature-removal','board-wipe']  (OR — any)
-- across the full catalogue in microseconds.
CREATE INDEX IF NOT EXISTS ix_mtg_oracle_cards_capabilities
  ON mtg_oracle_cards USING GIN (capabilities);

-- ── 3. Bulk update helper ────────────────────────────────────────────
-- Called by the backfill + incremental scripts in chunks of 1000.
-- Payload shape:
--   [{ "id": "<uuid>", "capabilities": ["card-draw","ramp"] }, ...]
-- Runs as SECURITY DEFINER so the service_role client can call it via
-- .rpc(). REVOKEd from anon/authenticated — never called from the
-- browser.
CREATE OR REPLACE FUNCTION mtg_bulk_update_capabilities(payload jsonb)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  updated integer;
BEGIN
  WITH src AS (
    SELECT (elem->>'id')::uuid AS id,
           ARRAY(
             SELECT jsonb_array_elements_text(elem->'capabilities')
           ) AS capabilities
      FROM jsonb_array_elements(payload) AS elem
  )
  UPDATE mtg_oracle_cards oc
     SET capabilities = s.capabilities
    FROM src s
   WHERE oc.id = s.id;
  GET DIAGNOSTICS updated = ROW_COUNT;
  RETURN updated;
END;
$$;

REVOKE ALL ON FUNCTION mtg_bulk_update_capabilities(jsonb) FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION mtg_bulk_update_capabilities(jsonb) TO service_role;
