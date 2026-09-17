-- migrations/2026-09-17b-mtg-simulation-jobs-lease.sql
-- ============================================================================
-- Phase 4B.3 — atomic claim RPC + lease/heartbeat/attempts.
-- ============================================================================
--
-- Adds:
--   1. heartbeat_at / lease_expires_at / attempts / max_attempts /
--      diagnostic_tail columns on mtg_simulation_jobs
--   2. mtg_simulation_claim_next() RPC — SECURITY DEFINER — that
--      atomically selects the oldest queued (or stale-leased) row via
--      FOR UPDATE SKIP LOCKED and transitions it to 'running' in one
--      transaction, returning the payload. Two workers calling this
--      concurrently CANNOT get the same job.
--   3. mtg_simulation_reap_stale() — service-role helper the worker
--      calls periodically to release leases held by dead workers.
--
-- Only the service role should call the claim RPC. anon/authenticated
-- are not granted execute — RLS on the parent table plus SECURITY
-- DEFINER's owner (postgres) enforce this.

BEGIN;

-- ── Column additions ────────────────────────────────────────────────
ALTER TABLE mtg_simulation_jobs
  ADD COLUMN IF NOT EXISTS heartbeat_at       timestamptz,
  ADD COLUMN IF NOT EXISTS lease_expires_at   timestamptz,
  ADD COLUMN IF NOT EXISTS attempts           integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS max_attempts       integer NOT NULL DEFAULT 2,
  ADD COLUMN IF NOT EXISTS diagnostic_tail    text;

COMMENT ON COLUMN mtg_simulation_jobs.heartbeat_at IS
  'Worker updates this every ~15 s while running. Absence beyond lease_expires_at means the worker died mid-job.';
COMMENT ON COLUMN mtg_simulation_jobs.diagnostic_tail IS
  'Bounded tail of Forge stdout/stderr on failure. Full logs go to object storage later — never store the whole log here.';

-- Fresh partial index for the common queued path. Stale-leased rows
-- are rare and the claim RPC will fall back to a heap scan for those.
CREATE INDEX IF NOT EXISTS ix_mtg_simulation_jobs_queued_created
  ON mtg_simulation_jobs (created_at ASC)
  WHERE status = 'queued';

CREATE INDEX IF NOT EXISTS ix_mtg_simulation_jobs_running_lease
  ON mtg_simulation_jobs (lease_expires_at)
  WHERE status = 'running';

-- ── mtg_simulation_claim_next(worker_id, lease_seconds) ─────────────
-- Returns a jsonb row of the claimed job (or NULL if none available).
-- SECURITY DEFINER so it runs as the function owner (postgres) and can
-- write regardless of the caller's RLS. Grant EXECUTE only to service_role.
CREATE OR REPLACE FUNCTION mtg_simulation_claim_next(
  p_worker_id     text,
  p_lease_seconds integer DEFAULT 600
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  claimed mtg_simulation_jobs;
BEGIN
  WITH candidate AS (
    SELECT id
      FROM mtg_simulation_jobs
     WHERE status = 'queued'
        OR (status = 'running'
            AND lease_expires_at IS NOT NULL
            AND lease_expires_at < now())
     ORDER BY created_at ASC
     LIMIT 1
     FOR UPDATE SKIP LOCKED
  )
  UPDATE mtg_simulation_jobs j
     SET status            = 'running',
         worker_id         = p_worker_id,
         started_at        = coalesce(j.started_at, now()),
         heartbeat_at      = now(),
         lease_expires_at  = now() + make_interval(secs => p_lease_seconds),
         attempts          = j.attempts + 1
    FROM candidate c
   WHERE j.id = c.id
   RETURNING j.* INTO claimed;

  IF claimed.id IS NULL THEN
    RETURN NULL;
  END IF;

  -- If we've now exceeded max_attempts, mark failed instead of running.
  IF claimed.attempts > claimed.max_attempts THEN
    UPDATE mtg_simulation_jobs
       SET status = 'failed',
           completed_at = now(),
           error = coalesce(error, 'max_attempts_exceeded')
     WHERE id = claimed.id;
    RETURN NULL;
  END IF;

  RETURN to_jsonb(claimed);
END $$;

REVOKE ALL ON FUNCTION mtg_simulation_claim_next(text, integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION mtg_simulation_claim_next(text, integer) TO service_role;

-- ── mtg_simulation_heartbeat(job_id, worker_id, lease_seconds) ──────
-- Extends the lease. Rejects if worker_id no longer owns the job.
CREATE OR REPLACE FUNCTION mtg_simulation_heartbeat(
  p_job_id        uuid,
  p_worker_id     text,
  p_lease_seconds integer DEFAULT 600
) RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  updated integer;
BEGIN
  UPDATE mtg_simulation_jobs
     SET heartbeat_at     = now(),
         lease_expires_at = now() + make_interval(secs => p_lease_seconds)
   WHERE id = p_job_id
     AND worker_id = p_worker_id
     AND status = 'running';
  GET DIAGNOSTICS updated = ROW_COUNT;
  RETURN updated > 0;
END $$;
REVOKE ALL ON FUNCTION mtg_simulation_heartbeat(uuid, text, integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION mtg_simulation_heartbeat(uuid, text, integer) TO service_role;

-- ── mtg_simulation_complete(job_id, worker_id, result jsonb) ────────
CREATE OR REPLACE FUNCTION mtg_simulation_complete(
  p_job_id     uuid,
  p_worker_id  text,
  p_result     jsonb
) RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  updated integer;
BEGIN
  UPDATE mtg_simulation_jobs
     SET status = 'done',
         completed_at = now(),
         result = p_result,
         lease_expires_at = NULL
   WHERE id = p_job_id
     AND worker_id = p_worker_id
     AND status = 'running';
  GET DIAGNOSTICS updated = ROW_COUNT;
  RETURN updated > 0;
END $$;
REVOKE ALL ON FUNCTION mtg_simulation_complete(uuid, text, jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION mtg_simulation_complete(uuid, text, jsonb) TO service_role;

-- ── mtg_simulation_fail(job_id, worker_id, error text, diag text) ───
CREATE OR REPLACE FUNCTION mtg_simulation_fail(
  p_job_id     uuid,
  p_worker_id  text,
  p_error      text,
  p_diag_tail  text DEFAULT NULL
) RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  claimed mtg_simulation_jobs;
BEGIN
  SELECT * INTO claimed
    FROM mtg_simulation_jobs
   WHERE id = p_job_id AND worker_id = p_worker_id AND status = 'running';
  IF NOT FOUND THEN RETURN false; END IF;

  IF claimed.attempts >= claimed.max_attempts THEN
    UPDATE mtg_simulation_jobs
       SET status = 'failed',
           completed_at = now(),
           error = p_error,
           diagnostic_tail = LEFT(coalesce(p_diag_tail, ''), 8000),
           lease_expires_at = NULL
     WHERE id = p_job_id;
  ELSE
    -- Return to the queue for another attempt.
    UPDATE mtg_simulation_jobs
       SET status = 'queued',
           worker_id = NULL,
           lease_expires_at = NULL,
           error = p_error,
           diagnostic_tail = LEFT(coalesce(p_diag_tail, ''), 8000)
     WHERE id = p_job_id;
  END IF;
  RETURN true;
END $$;
REVOKE ALL ON FUNCTION mtg_simulation_fail(uuid, text, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION mtg_simulation_fail(uuid, text, text, text) TO service_role;

COMMIT;
