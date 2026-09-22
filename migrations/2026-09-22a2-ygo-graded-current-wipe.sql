-- migrations/2026-09-22a2-ygo-graded-current-wipe.sql
--
-- DESTRUCTIVE. Runs a single DELETE against tcg_graded_prices_current.
-- Only for YGO. History (tcg_graded_price_daily) is NOT touched.
--
-- Preconditions the operator MUST verify before running this:
--   1. A1 has already been applied (attribution/tcg_card_id columns
--      exist; historical daily rows for ambiguous YGO cards have been
--      re-labelled to attribution='card').
--   2. Fresh TCGGraph credit reserves have been re-checked and the
--      projected re-ingest cost (~770 credits based on the previous
--      successful bootstrap in tcg_ingest_runs) keeps the 500-daily
--      and 5,000-monthly reserves intact.
--   3. The re-ingest command is queued up and will run immediately
--      after this DELETE so the gap where YGO has no current graded
--      snapshot is measured in minutes, not hours.
--
-- Rationale: post-A1, existing YGO rows in tcg_graded_prices_current
-- are attached to the WRONG anchor printing (usually 'normal', because
-- upstream lists that first). A1 corrects their attribution to 'card'
-- so read paths no longer treat them as edition-specific, but the
-- anchor is still wrong. The re-ingest writes a clean snapshot with
-- attribution='card' anchored on the deterministic canonical printing
-- ('1st-edition' preferred, then normal/unlimited, then printings[0]).
-- Wiping the current rows before re-ingest guarantees the resulting
-- snapshot has exactly one card-scoped anchor per card, with no
-- orphans left behind on the old anchor.

BEGIN;

DELETE FROM public.tcg_graded_prices_current WHERE game_id = 'ygo';

COMMIT;

NOTIFY pgrst, 'reload schema';
