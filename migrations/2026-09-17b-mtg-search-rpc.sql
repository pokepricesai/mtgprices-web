-- migrations/2026-09-17b-mtg-search-rpc.sql
-- Phase 3B — Smart Deck Discovery.
--
-- Adds:
--   1. A covering index on mtg_oracle_legalities so the legality EXISTS
--      subquery becomes an index-only scan.
--   2. mtg_search_oracle_cards RPC — a single-round-trip Oracle-card
--      search that joins capabilities (GIN) + legality + colour +
--      colour-identity + mana-value + name/type in one query.
--
-- The RPC returns Oracle-level rows only. Owned/missing/exclude filters
-- and per-printing pricing continue to live in the app layer (they
-- depend on the caller's collection which RLS-scopes to auth.uid()).
--
-- Runs as SECURITY DEFINER so the anon-safe service-role client can
-- call it. It touches only public catalogue data (no user rows).
--
-- Rollback:
--   DROP FUNCTION IF EXISTS mtg_search_oracle_cards(...);
--   DROP INDEX IF EXISTS ix_mtg_oracle_legalities_flor;

BEGIN;

-- ── 1. Covering index for legality EXISTS ────────────────────────────
CREATE INDEX IF NOT EXISTS ix_mtg_oracle_legalities_flor
  ON mtg_oracle_legalities (format, legality, oracle_card_id);

-- ── 2. Single-shot Oracle search RPC ─────────────────────────────────
CREATE OR REPLACE FUNCTION mtg_search_oracle_cards(
  p_name              text     DEFAULT NULL,
  p_type              text     DEFAULT NULL,
  p_capabilities      text[]   DEFAULT NULL,
  p_colors            text[]   DEFAULT NULL,
  p_include_colorless boolean  DEFAULT FALSE,
  p_color_identity    text[]   DEFAULT NULL,
  p_legal_in          text     DEFAULT NULL,
  p_mv_max            numeric  DEFAULT NULL,
  p_mv_min            numeric  DEFAULT NULL,
  p_reserved          boolean  DEFAULT NULL,
  p_game_changer      boolean  DEFAULT NULL,
  p_exclude_oracles   uuid[]   DEFAULT NULL,
  p_limit             integer  DEFAULT 60,
  p_offset            integer  DEFAULT 0
)
RETURNS TABLE (
  id             uuid,
  name           text,
  mana_cost      text,
  mana_value     numeric,
  type_line      text,
  oracle_text    text,
  colors         text[],
  color_identity text[],
  keywords       text[],
  capabilities   text[],
  layout         text,
  reserved       boolean,
  game_changer   boolean
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT oc.id, oc.name, oc.mana_cost, oc.mana_value, oc.type_line, oc.oracle_text,
         oc.colors, oc.color_identity, oc.keywords, oc.capabilities,
         oc.layout, oc.reserved, oc.game_changer
    FROM mtg_oracle_cards oc
   WHERE (p_name IS NULL OR oc.name ILIKE '%' || p_name || '%')
     AND (p_type IS NULL OR oc.type_line ILIKE '%' || p_type || '%')
     AND (p_capabilities IS NULL OR array_length(p_capabilities, 1) IS NULL OR oc.capabilities @> p_capabilities)
     AND (
       (p_colors IS NULL OR array_length(p_colors, 1) IS NULL)
         AND (NOT p_include_colorless)
       OR (p_colors IS NOT NULL AND array_length(p_colors, 1) > 0 AND oc.colors && p_colors)
       OR (p_include_colorless AND coalesce(array_length(oc.colors, 1), 0) = 0)
     )
     AND (p_color_identity IS NULL OR array_length(p_color_identity, 1) IS NULL OR oc.color_identity <@ p_color_identity)
     AND (p_mv_max IS NULL OR oc.mana_value <= p_mv_max)
     AND (p_mv_min IS NULL OR oc.mana_value >= p_mv_min)
     AND (p_reserved IS NULL OR oc.reserved IS NOT DISTINCT FROM p_reserved)
     AND (p_game_changer IS NULL OR oc.game_changer IS NOT DISTINCT FROM p_game_changer)
     AND (p_exclude_oracles IS NULL OR array_length(p_exclude_oracles, 1) IS NULL OR NOT (oc.id = ANY (p_exclude_oracles)))
     AND (
       p_legal_in IS NULL OR EXISTS (
         SELECT 1
           FROM mtg_oracle_legalities l
          WHERE l.format = p_legal_in
            AND l.legality = 'legal'
            AND l.oracle_card_id = oc.id
       )
     )
   ORDER BY oc.mana_value NULLS LAST, oc.name
   LIMIT COALESCE(p_limit, 60)
   OFFSET COALESCE(p_offset, 0);
$$;

REVOKE ALL ON FUNCTION mtg_search_oracle_cards(text, text, text[], text[], boolean, text[], text, numeric, numeric, boolean, boolean, uuid[], integer, integer) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION mtg_search_oracle_cards(text, text, text[], text[], boolean, text[], text, numeric, numeric, boolean, boolean, uuid[], integer, integer) TO anon, authenticated, service_role;

COMMIT;
