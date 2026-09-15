-- ============================================================================
-- Stage 1D — storage baseline + 15b metadata probe.
-- Paste into Supabase SQL Editor. READ-ONLY.
-- ============================================================================

-- ─── 1. Overall DB size + free headroom against 48 GB disk ─────────────────
SELECT
  pg_size_pretty(pg_database_size(current_database()))                                          AS db_size_pretty,
  pg_database_size(current_database())                                                          AS db_size_bytes,
  pg_size_pretty(48::bigint * 1024 * 1024 * 1024)                                               AS disk_provisioned,
  pg_size_pretty(GREATEST(0, 48::bigint * 1024 * 1024 * 1024 - pg_database_size(current_database()))) AS free_headroom_pretty,
  GREATEST(0, 48::bigint * 1024 * 1024 * 1024 - pg_database_size(current_database()))           AS free_headroom_bytes;

-- ─── 2. Aggregate MTG partition sizes ──────────────────────────────────────
SELECT
  'mtg_price_observations partitions total'                                    AS metric,
  pg_size_pretty(sum(pg_total_relation_size(inhrelid)))                        AS total_pretty,
  pg_size_pretty(sum(pg_relation_size(inhrelid)))                              AS heap_pretty,
  pg_size_pretty(sum(pg_indexes_size(inhrelid)))                               AS indexes_pretty,
  sum(pg_total_relation_size(inhrelid))                                         AS total_bytes,
  sum(pg_relation_size(inhrelid))                                               AS heap_bytes,
  sum(pg_indexes_size(inhrelid))                                                AS indexes_bytes
FROM pg_inherits
WHERE inhparent = 'public.mtg_price_observations'::regclass;

-- ─── 3. Per-partition breakdown ────────────────────────────────────────────
SELECT
  inh.inhrelid::regclass::text                          AS partition,
  pg_get_expr(c.relpartbound, c.oid, true)              AS bound,
  pg_size_pretty(pg_relation_size(inh.inhrelid))        AS heap,
  pg_size_pretty(pg_indexes_size(inh.inhrelid))         AS indexes,
  pg_size_pretty(pg_total_relation_size(inh.inhrelid))  AS total,
  pg_stat_get_live_tuples(inh.inhrelid)                 AS live_rows
FROM pg_inherits inh
JOIN pg_class c ON c.oid = inh.inhrelid
WHERE inh.inhparent = 'public.mtg_price_observations'::regclass
ORDER BY inh.inhrelid::regclass::text;

-- ─── 4. Every MTG table's size ─────────────────────────────────────────────
SELECT
  c.relname                                             AS table_name,
  pg_size_pretty(pg_relation_size(c.oid))               AS heap,
  pg_size_pretty(pg_indexes_size(c.oid))                AS indexes,
  pg_size_pretty(pg_total_relation_size(c.oid))         AS total,
  pg_stat_get_live_tuples(c.oid)                        AS live_rows
FROM pg_class c
JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname='public'
  AND c.relkind IN ('r','p')
  AND c.relname LIKE 'mtg\_%'
ORDER BY pg_total_relation_size(c.oid) DESC;

-- ============================================================================
-- 15b metadata (pg_catalog cannot be reached from PostgREST)
-- ============================================================================

-- ─── 5. mtg_current_prices: RLS + policies + column shape ─────────────────
SELECT relname, relrowsecurity AS rls_enabled,
       (SELECT COUNT(*) FROM pg_policies
          WHERE schemaname='public' AND tablename='mtg_current_prices') AS policy_count
FROM pg_class WHERE oid = 'public.mtg_current_prices'::regclass;

SELECT column_name, data_type, is_nullable, column_default
  FROM information_schema.columns
 WHERE table_schema='public' AND table_name='mtg_current_prices'
 ORDER BY ordinal_position;

-- PK columns:
SELECT c.conname, pg_get_constraintdef(c.oid) AS def
  FROM pg_constraint c
  JOIN pg_class     t ON t.oid = c.conrelid
  JOIN pg_namespace n ON n.oid = t.relnamespace
 WHERE n.nspname='public' AND t.relname='mtg_current_prices' AND c.contype='p';

-- Index list:
SELECT indexname, indexdef FROM pg_indexes
 WHERE schemaname='public' AND tablename='mtg_current_prices' ORDER BY indexname;

-- Table ACL:
SELECT grantee, privilege_type
  FROM information_schema.role_table_grants
 WHERE table_schema='public' AND table_name='mtg_current_prices'
   AND grantee IN ('PUBLIC','anon','authenticated','service_role')
 ORDER BY grantee, privilege_type;

-- ─── 6. refresh_mtg_current_prices function metadata ───────────────────────
SELECT
  p.proname                              AS name,
  p.prosecdef                            AS security_definer,      -- expect FALSE (SECURITY INVOKER)
  pg_get_function_arguments(p.oid)       AS args,                  -- expect 'look_back_days integer DEFAULT 3'
  pg_get_function_result(p.oid)          AS returns,
  p.proconfig                            AS config                 -- expect ['search_path=pg_catalog, public']
FROM pg_proc p
JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname='public' AND p.proname='refresh_mtg_current_prices';

-- Function definition (visual sanity — schema-qualified references):
SELECT pg_get_functiondef(
  (SELECT p.oid FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname='public' AND p.proname='refresh_mtg_current_prices')
) AS function_definition;

-- Function ACL:
SELECT r.rolname                             AS grantee,
       has_function_privilege(r.oid,
         (SELECT p.oid FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
           WHERE n.nspname='public' AND p.proname='refresh_mtg_current_prices'),
         'EXECUTE')                          AS can_execute
FROM pg_roles r
WHERE r.rolname IN ('anon','authenticated','service_role','postgres')
ORDER BY r.rolname;
