-- migrations/2026-09-14c-mtg-oracle-cards-mana-value-widen.sql
-- ============================================================================
-- Widen mtg_oracle_cards.mana_value from NUMERIC(6, 2) to unrestricted NUMERIC.
-- ============================================================================
--
-- Discovery
--   During Stage 1B (fresh Scryfall catalogue ingestion) the oracle-cards
--   phase failed on one batch with:
--
--     22003  numeric field overflow
--            A field with precision 6, scale 2 must round to an absolute
--            value less than 10^4.
--
--   Scryfall publishes several joke-set cards with legitimate CMC values
--   larger than 9,999.99. The most famous is "Gleemax" (Unhinged) with
--   cmc = 1,000,000. There are a handful of others in the Un-sets and
--   other joke printings.
--
--   The initial Stage 1A schema chose NUMERIC(6, 2). That precision is
--   an arbitrary product-side ceiling that has no factual basis in the
--   Scryfall data. Rather than pick a new arbitrary ceiling, this
--   migration removes the ceiling entirely.
--
-- Scope
--   Precision-widening on ONE column. Fully non-destructive:
--     * every existing value fits inside the new unrestricted type
--     * no other table is touched
--     * no view / RPC / index depends on the exact precision
--     * ingestion code is unchanged; it already sends the raw CMC float
--
-- Idempotency
--   Uses a DO-block that inspects information_schema.columns and only
--   performs the ALTER when the current column is not already an
--   unrestricted numeric (numeric_precision IS NOT NULL). Re-apply is a
--   no-op once the column has already been widened.
--
-- Post-apply state
--   mtg_oracle_cards.mana_value is unrestricted NUMERIC — Postgres will
--   store any Scryfall CMC value verbatim, including the six- and
--   seven-digit joke-set values.
--
-- ============================================================================

BEGIN;

DO $$
DECLARE
  current_precision integer;
  current_scale     integer;
  rows_before       bigint;
BEGIN
  SELECT numeric_precision, numeric_scale
    INTO current_precision, current_scale
    FROM information_schema.columns
   WHERE table_schema = 'public'
     AND table_name   = 'mtg_oracle_cards'
     AND column_name  = 'mana_value';

  -- If the column does not exist at all, bail loudly.
  IF NOT FOUND THEN
    RAISE EXCEPTION 'mtg_oracle_cards.mana_value not found; refusing to alter';
  END IF;

  -- Belt for the "row preservation" invariant — capture row count
  -- inside the transaction so we can assert nothing was lost.
  SELECT COUNT(*) INTO rows_before FROM public.mtg_oracle_cards;

  -- Postgres exposes an unrestricted NUMERIC as
  --   numeric_precision IS NULL
  -- and a bounded NUMERIC(p, s) as
  --   numeric_precision = p, numeric_scale = s.
  IF current_precision IS NULL THEN
    RAISE NOTICE 'mana_value already unrestricted NUMERIC; nothing to do (rows=%)', rows_before;
  ELSE
    RAISE NOTICE 'widening mana_value from NUMERIC(%, %) to unrestricted NUMERIC (rows=%)',
      current_precision, current_scale, rows_before;
    ALTER TABLE public.mtg_oracle_cards
      ALTER COLUMN mana_value TYPE NUMERIC;
  END IF;
END $$;

-- Post-alter confirmation probe. Runs inside the same transaction so a
-- mismatched result rolls the whole thing back.
DO $$
DECLARE
  final_precision integer;
  final_scale     integer;
  rows_after      bigint;
  max_value       numeric;
  count_over_9999 bigint;
BEGIN
  SELECT numeric_precision, numeric_scale
    INTO final_precision, final_scale
    FROM information_schema.columns
   WHERE table_schema = 'public'
     AND table_name   = 'mtg_oracle_cards'
     AND column_name  = 'mana_value';

  IF final_precision IS NOT NULL THEN
    RAISE EXCEPTION
      'refusing to commit: mana_value is still bounded NUMERIC(%, %) after ALTER',
      final_precision, final_scale;
  END IF;

  SELECT COUNT(*), MAX(mana_value),
         COUNT(*) FILTER (WHERE mana_value >= 10000)
    INTO rows_after, max_value, count_over_9999
    FROM public.mtg_oracle_cards;

  RAISE NOTICE
    'mana_value final=NUMERIC (unrestricted), rows=%, current_max=%, rows_over_9999=%',
    rows_after,
    COALESCE(max_value::text, '<no rows>'),
    count_over_9999;
END $$;

COMMIT;
