-- migrations/2026-09-17-mtg-simulation-jobs.sql
-- ============================================================================
-- Phase 4B — mtg_simulation_jobs queue.
-- ============================================================================
--
-- Job table for rules-aware simulations. A user posts a request; a
-- separate worker (Forge Simulation Mode container) claims it via
-- SELECT ... FOR UPDATE SKIP LOCKED and writes the result back.
--
-- Owner-scoped RLS: users only see their own jobs. The worker uses
-- the service-role key and bypasses RLS.
--
-- Not linked to Auth.users → deck.user_id chain: we accept a
-- user_id foreign key directly so the worker can update the row
-- without loading a user session.

BEGIN;

CREATE TABLE IF NOT EXISTS mtg_simulation_jobs (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id             uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  -- Both decks are captured as inline JSON so the job survives if the
  -- underlying deck is edited or deleted after enqueue. Deck A is the
  -- user's saved deck (referenced by id below for provenance); deck B
  -- is the "opponent" — either another saved deck or a stored
  -- opposing brew captured at enqueue time.
  deck_a_id           uuid REFERENCES mtg_decks(id) ON DELETE SET NULL,
  deck_a_snapshot     jsonb NOT NULL,
  deck_b_snapshot     jsonb NOT NULL,
  format              text NOT NULL,
  engine              text NOT NULL DEFAULT 'forge',
  engine_version      text,
  seed                bigint,
  requested_iterations integer NOT NULL CHECK (requested_iterations BETWEEN 1 AND 100),
  timeout_sec         integer NOT NULL DEFAULT 120 CHECK (timeout_sec BETWEEN 30 AND 600),
  status              text NOT NULL DEFAULT 'queued'
                        CHECK (status IN ('queued','running','done','failed','cancelled')),
  worker_id           text,
  started_at          timestamptz,
  completed_at        timestamptz,
  result              jsonb,       -- final MatchGameResult[] aggregate + engine metadata
  error               text,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS ix_mtg_simulation_jobs_user_created
  ON mtg_simulation_jobs (user_id, created_at DESC);

-- Worker queue: pending, oldest-first. Partial so index stays small
-- as completed jobs accumulate.
CREATE INDEX IF NOT EXISTS ix_mtg_simulation_jobs_queued
  ON mtg_simulation_jobs (created_at ASC)
  WHERE status = 'queued';

-- Bump updated_at on any mutation.
CREATE OR REPLACE FUNCTION mtg_simulation_jobs_touch()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at := now(); RETURN NEW; END $$;

DROP TRIGGER IF EXISTS trg_mtg_simulation_jobs_touch ON mtg_simulation_jobs;
CREATE TRIGGER trg_mtg_simulation_jobs_touch
  BEFORE UPDATE ON mtg_simulation_jobs
  FOR EACH ROW EXECUTE FUNCTION mtg_simulation_jobs_touch();

-- ── RLS ──────────────────────────────────────────────────────────
ALTER TABLE mtg_simulation_jobs ENABLE ROW LEVEL SECURITY;

-- Owners can SELECT their own jobs.
DROP POLICY IF EXISTS "sim jobs: select own" ON mtg_simulation_jobs;
CREATE POLICY "sim jobs: select own" ON mtg_simulation_jobs
  FOR SELECT TO authenticated USING (auth.uid() = user_id);

-- Owners can INSERT their own jobs (server-side path is preferred,
-- but a direct insert from the browser via anon-key + JWT is also
-- safe now because RLS matches).
DROP POLICY IF EXISTS "sim jobs: insert own" ON mtg_simulation_jobs;
CREATE POLICY "sim jobs: insert own" ON mtg_simulation_jobs
  FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);

-- Owners can CANCEL their own queued jobs by moving status → 'cancelled'.
DROP POLICY IF EXISTS "sim jobs: update own cancel" ON mtg_simulation_jobs;
CREATE POLICY "sim jobs: update own cancel" ON mtg_simulation_jobs
  FOR UPDATE TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);
-- Worker updates (running/done/failed) run under the service-role
-- key which bypasses RLS entirely; no policy needed.

GRANT SELECT, INSERT, UPDATE ON mtg_simulation_jobs TO authenticated;

COMMIT;
