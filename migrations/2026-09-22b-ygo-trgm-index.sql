-- migrations/2026-09-22b-ygo-trgm-index.sql
--
-- Standalone. MUST be executed OUTSIDE any transaction. Postgres does
-- not permit CREATE INDEX CONCURRENTLY inside a BEGIN/COMMIT block.
-- Paste each statement into the Supabase SQL Editor one at a time OR
-- run them via psql without wrapping BEGIN.
--
-- Purpose: trigram GIN index on tcg_cards.name for YGO only. Backs the
-- partial-name search used by Collector Network Slice 5 (blue eye /
-- blue-eyes / sky striker / etc.). Partial WHERE game_id='ygo' avoids
-- indexing MTG/One Piece/Lorcana entries that already have their own
-- name-lookup paths.

CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE INDEX CONCURRENTLY IF NOT EXISTS tcg_cards_ygo_name_trgm
  ON public.tcg_cards
  USING gin (name gin_trgm_ops)
  WHERE game_id = 'ygo';
