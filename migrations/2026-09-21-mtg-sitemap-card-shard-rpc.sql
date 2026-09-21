-- migrations/2026-09-21-mtg-sitemap-card-shard-rpc.sql
--
-- Sitemap card shards were fetched from the client via 22 sequential
-- Postgrest paginations (.range() at 1000 rows each). Round-trip
-- overhead + growing OFFSET meant fetch time scaled with the shard
-- number:
--   shard 1 offset 0     : 2.5 s
--   shard 2 offset 22000 : 3.0 s
--   shard 3 offset 44000 : 4.1 s  <- user reported stalls here
--   shard 4 offset 66000 : 5.2 s
--   shard 5 offset 88000 : 4.7 s
-- If any cold ISR regeneration coincided with DB pressure, the total
-- could easily exceed the Vercel function timeout, giving Googlebot
-- the "Couldn't fetch" it reported for shard 3.
--
-- One RPC round-trip returns the whole shard's rows in a single
-- planner-optimised query, so total wire time drops from ~22 HTTP
-- hops per shard to ~1. Postgres still uses ORDER BY id with an
-- OFFSET/LIMIT, but only once, and the id index is small enough that
-- even OFFSET 88000 is a millisecond-class walk.

-- CREATE OR REPLACE cannot change a function's return type, so drop
-- the earlier tabular version first.
DROP FUNCTION IF EXISTS public.mtg_sitemap_card_shard(int, int);

-- Returns the whole shard as a single JSONB payload. A tabular RETURN
-- would be capped by Postgrest's max-rows setting (1000 on the
-- default Supabase config), which is exactly what would keep the RPC
-- fix from delivering all 22k rows in one call. Returning jsonb
-- sidesteps the cap because Postgrest ships a single top-level value
-- rather than a rowset.
CREATE OR REPLACE FUNCTION public.mtg_sitemap_card_shard(
  p_shard      int,
  p_shard_size int DEFAULT 22000
) RETURNS jsonb
LANGUAGE sql STABLE
AS $$
  SELECT COALESCE(
    jsonb_agg(
      jsonb_build_object(
        'set_code',         set_code,
        'collector_number', collector_number,
        'name',             name,
        'released_at',      released_at
      )
      ORDER BY id
    ),
    '[]'::jsonb
  )
  FROM (
    SELECT id, set_code, collector_number, name, released_at
    FROM public.mtg_printings
    WHERE lang = 'en'
      AND digital = false
      AND collector_number IS NOT NULL
    ORDER BY id
    OFFSET GREATEST(p_shard - 1, 0) * p_shard_size
    LIMIT p_shard_size
  ) t;
$$;

GRANT EXECUTE ON FUNCTION public.mtg_sitemap_card_shard(int, int)
  TO anon, authenticated, service_role;

NOTIFY pgrst, 'reload schema';
