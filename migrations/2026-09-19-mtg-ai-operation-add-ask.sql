-- migrations/2026-09-19-mtg-ai-operation-add-ask.sql
--
-- The mtg_ai_operation enum was built for the four deck-scoped
-- actions (analyse_deck, improve_deck, replace_card, build_deck).
-- The new public "Ask MTGPrices AI" endpoint logs its calls with
-- operation = 'ask'. Without this value in the enum every insert
-- silently fails with SQLSTATE 22P02, so mtg_ai_usage rows for /ai
-- are lost and the daily quota never counts an Ask AI call.
--
-- ALTER TYPE ... ADD VALUE cannot run inside a transaction block, but
-- Supabase's Management API runs single-statement calls outside a
-- transaction, so this works via `supabase db query --file`.

ALTER TYPE public.mtg_ai_operation ADD VALUE IF NOT EXISTS 'ask';
