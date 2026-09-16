-- migrations/2026-09-17c-mtg-ai-usage.sql
-- Phase 3C — AI Deck Intelligence.
--
-- Usage + cost log for every AI operation. Users can inspect their
-- own usage; only service_role sees the full log.
--
-- The `estimated_cost_cents` column stores the app's cost estimate
-- (informational only — the Vercel AI Gateway is the authoritative
-- billing source). Every row records enough metadata to reconstruct
-- who called what and how much reasoning happened.
--
-- Rollback:
--   DROP TABLE IF EXISTS mtg_ai_usage;
--   DROP TYPE  IF EXISTS mtg_ai_operation;

BEGIN;

DO $$ BEGIN
  CREATE TYPE mtg_ai_operation AS ENUM (
    'analyse_deck',
    'improve_deck',
    'replace_card',
    'build_deck'
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS mtg_ai_usage (
  id                      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id                 uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  operation               mtg_ai_operation NOT NULL,
  provider                text NOT NULL,
  model                   text NOT NULL,
  tokens_input            integer,
  tokens_output           integer,
  tokens_reasoning        integer,
  estimated_cost_cents    integer,
  deck_id                 uuid REFERENCES mtg_decks(id) ON DELETE SET NULL,
  outcome                 text NOT NULL DEFAULT 'ok',   -- 'ok' | 'validation_blocked' | 'error' | 'rate_limited'
  error_kind              text,
  latency_ms              integer,
  created_at              timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE mtg_ai_usage IS
  'Phase 3C AI-call log. One row per operation. Users read their own via RLS; service_role sees everything for cost oversight.';

CREATE INDEX IF NOT EXISTS ix_mtg_ai_usage_user_created
  ON mtg_ai_usage (user_id, created_at DESC);

ALTER TABLE mtg_ai_usage ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "ai_usage: select own" ON mtg_ai_usage;
CREATE POLICY "ai_usage: select own" ON mtg_ai_usage
  FOR SELECT TO authenticated USING (auth.uid() = user_id);

-- Only the service_role should INSERT — user code writes via server
-- routes that use the service-role client. No public INSERT policy.

GRANT SELECT ON mtg_ai_usage TO authenticated;

COMMIT;
