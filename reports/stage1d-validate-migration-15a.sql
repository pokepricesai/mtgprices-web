-- ============================================================================
-- Stage 1D — post-apply validation of migration 2026-09-15a.
-- Paste into Supabase SQL Editor. READ-ONLY.
-- Confirms RLS state, policy absence, ACL grants, and function metadata
-- that PostgREST cannot expose from pg_catalog directly.
-- ============================================================================

-- ─── 1. Table exists + RLS enabled + no policies ────────────────────────────
SELECT
  c.relname                       AS table_name,
  c.relrowsecurity                AS rls_enabled,       -- expect TRUE
  c.relforcerowsecurity           AS force_rls,        -- FALSE is fine
  (SELECT COUNT(*) FROM pg_policies
    WHERE schemaname='public' AND tablename='mtg_daily_ingest_locks')
                                  AS policy_count      -- expect 0
FROM pg_class c
JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname='public' AND c.relname='mtg_daily_ingest_locks';

-- ─── 2. Table column shape ─────────────────────────────────────────────────
SELECT column_name, data_type, is_nullable, column_default
  FROM information_schema.columns
 WHERE table_schema='public' AND table_name='mtg_daily_ingest_locks'
 ORDER BY ordinal_position;

-- ─── 3. Table ACL grants — expect anon/authenticated to have NO privileges ─
SELECT grantee, privilege_type
  FROM information_schema.role_table_grants
 WHERE table_schema='public' AND table_name='mtg_daily_ingest_locks'
   AND grantee IN ('PUBLIC','anon','authenticated','service_role')
 ORDER BY grantee, privilege_type;
-- Expected result: only 'service_role' rows (or empty for the others).
-- If any row shows grantee='anon' or 'authenticated' with a privilege,
-- the REVOKE step in the migration did not take effect.

-- ─── 4. Function exists + is SECURITY DEFINER + has search_path pinned ─────
SELECT
  n.nspname                             AS schema,
  p.proname                             AS name,
  p.prosecdef                           AS security_definer,   -- expect TRUE
  pg_get_function_arguments(p.oid)      AS args,               -- expect 'target_month date'
  pg_get_function_result(p.oid)         AS returns,            -- expect 'text'
  p.proconfig                           AS config              -- expect ['search_path=pg_catalog, public']
FROM pg_proc p
JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname='public' AND p.proname='ensure_mtg_price_partition';

-- ─── 5. Function definition — inspect body for schema-qualification ────────
-- Look for public.mtg_price_observations, pg_catalog.pg_class, etc.
SELECT pg_get_functiondef(
  (SELECT p.oid FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname='public' AND p.proname='ensure_mtg_price_partition')
) AS function_definition;

-- ─── 6. Function ACL grants ────────────────────────────────────────────────
SELECT
  r.rolname                             AS grantee,
  has_function_privilege(r.oid,
    (SELECT p.oid FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
      WHERE n.nspname='public' AND p.proname='ensure_mtg_price_partition'),
    'EXECUTE')                          AS can_execute
FROM pg_roles r
WHERE r.rolname IN ('anon','authenticated','service_role','postgres')
ORDER BY r.rolname;
-- Expected:
--   anon           = FALSE
--   authenticated  = FALSE
--   service_role   = TRUE
--   postgres       = TRUE (owner)

-- ─── 7. Confirm no OTHER unexpected mtg_stage1d objects exist ──────────────
SELECT c.relname, c.relkind
FROM pg_class c
JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname='public'
  AND (c.relname LIKE 'mtg_daily_%' OR c.relname LIKE 'mtg_current%' OR c.relname LIKE 'mtg_price_provider%')
ORDER BY c.relname;
-- Expected AFTER 15a only: mtg_daily_ingest_locks (r). Nothing else.
-- After 15b lands later: also mtg_current_prices (r).

-- ─── 8. Existing partition list, for context (rolling buffer status) ───────
SELECT inh.inhrelid::regclass::text                       AS partition,
       pg_get_expr(c.relpartbound, c.oid, true)           AS bound,
       pg_size_pretty(pg_total_relation_size(inh.inhrelid)) AS total
FROM pg_inherits inh
JOIN pg_class c ON c.oid = inh.inhrelid
WHERE inh.inhparent = 'public.mtg_price_observations'::regclass
ORDER BY inh.inhrelid::regclass::text;
