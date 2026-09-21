-- migrations/2026-09-21-tcg-shared-schema.sql
--
-- Slice 2, shared TCG network foundation. Creates the tcg_* namespace
-- for supplementary market + graded data across four games:
-- Magic: The Gathering, Yu-Gi-Oh!, One Piece, Star Wars Unlimited.
--
-- Explicit non-goals (see docs/network/08-final-shared-schema.md):
--   * Do NOT duplicate the MTG catalogue. mtg_* remains authoritative
--     for MTG oracle/printing data. The tcg_printings row for an MTG
--     card is a lightweight mapping row that carries mtg_printings_id.
--   * Do NOT replace the MTGJSON pipeline. mtg_current_prices and
--     mtg_price_observations stay. tcg_market_prices_current sits
--     alongside them.
--   * Do NOT modify market_import_runs. tcg_ingest_runs is a new
--     dedicated table.
--   * Do NOT touch PokePrices tables.
--
-- All ingestion runs as service_role. Public/anon can read the
-- catalogue + price tables; nothing user-owned lives here yet
-- (portfolios are a later slice).

-- ---------------------------------------------------------------------
-- tcg_games
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.tcg_games (
  id            text PRIMARY KEY,          -- 'mtg' | 'ygo' | 'onepiece' | 'swu'
  slug          text NOT NULL UNIQUE,      -- TCGGraph slug
  name          text NOT NULL,
  active        boolean NOT NULL DEFAULT true,
  created_at    timestamptz NOT NULL DEFAULT now()
);

INSERT INTO public.tcg_games (id, slug, name) VALUES
  ('mtg',       'magic-the-gathering', 'Magic: The Gathering'),
  ('ygo',       'yugioh',              'Yu-Gi-Oh!'),
  ('onepiece',  'one-piece',           'One Piece Card Game'),
  ('swu',       'star-wars-unlimited', 'Star Wars: Unlimited')
ON CONFLICT (id) DO NOTHING;

-- ---------------------------------------------------------------------
-- tcg_sets
-- ---------------------------------------------------------------------
-- One row per (game, set-code) as seen from TCGGraph. For MTG this is
-- a lightweight mirror of the interesting set codes we ingest, NOT a
-- replacement for mtg_sets.
CREATE TABLE IF NOT EXISTS public.tcg_sets (
  id              text PRIMARY KEY,               -- '{game_id}:set:{code_lower}'
  game_id         text NOT NULL REFERENCES public.tcg_games(id) ON DELETE CASCADE,
  code            text NOT NULL,                  -- lower-case
  name            text NOT NULL,
  released_at     date,
  tcggraph_meta   jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (game_id, code)
);
CREATE INDEX IF NOT EXISTS tcg_sets_game_release_idx ON public.tcg_sets (game_id, released_at DESC);

-- ---------------------------------------------------------------------
-- tcg_cards
-- ---------------------------------------------------------------------
-- Logical card. For MTG we usually skip this (mtg_oracle_cards is
-- authoritative) and go straight to tcg_printings + mtg_printings_id.
-- For YGO/OP/SWU this is the primary logical-card record.
CREATE TABLE IF NOT EXISTS public.tcg_cards (
  id                  text PRIMARY KEY,           -- '{game_id}:card:{tcggraph_card_id}'
  game_id             text NOT NULL REFERENCES public.tcg_games(id) ON DELETE CASCADE,
  tcggraph_card_id    text NOT NULL,
  name                text NOT NULL,
  english_id          text,                       -- when TCGGraph exposes an EN twin id
  language            text NOT NULL DEFAULT 'en',
  rarity              text,
  artist              text,
  rules_text          text,
  images              jsonb NOT NULL DEFAULT '{}'::jsonb,
  gamedata            jsonb NOT NULL DEFAULT '{}'::jsonb,   -- game-specific fields verbatim
  set_id              text REFERENCES public.tcg_sets(id) ON DELETE SET NULL,
  collector_number    text,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now(),
  UNIQUE (game_id, tcggraph_card_id, language)
);
CREATE INDEX IF NOT EXISTS tcg_cards_game_set_idx ON public.tcg_cards (game_id, set_id);
CREATE INDEX IF NOT EXISTS tcg_cards_game_name_idx ON public.tcg_cards (game_id, name);

-- ---------------------------------------------------------------------
-- tcg_printings  -- canonical network identity
-- ---------------------------------------------------------------------
-- One row per physical variant. For MTG carries mtg_printings_id.
-- For YGO/OP/SWU this is the primary physical printing.
CREATE TABLE IF NOT EXISTS public.tcg_printings (
  id                     text PRIMARY KEY,        -- '{game_id}:print:{tcggraph_card_id}:{key}:{lang}'
  game_id                text NOT NULL REFERENCES public.tcg_games(id) ON DELETE CASCADE,
  tcg_card_id            text REFERENCES public.tcg_cards(id) ON DELETE SET NULL,
  set_id                 text REFERENCES public.tcg_sets(id) ON DELETE SET NULL,
  tcggraph_card_id       text NOT NULL,           -- 'mtg_84f2c8f5-8e1' etc.
  tcggraph_printing_key  text NOT NULL,           -- 'normal' | 'foil' | 'etched' | '1st-edition' | ...
  finish                 text,                    -- normalised: 'nonfoil'|'foil'|'etched'|'holo'|'1st_edition'...
  edition                text,                    -- '1st-edition'|null (YGO)
  language               text NOT NULL DEFAULT 'en',
  collector_number       text,
  -- Cross-catalogue bridge:
  mtg_printings_id       uuid REFERENCES public.mtg_printings(id) ON DELETE SET NULL,
  -- External IDs (secondary; canonical bridge is per-game):
  cardmarket_id          bigint,
  tcgplayer_id           bigint,
  mapping_confidence     text NOT NULL DEFAULT 'exact',  -- 'exact'|'high_confidence'|'ambiguous'|'unmapped'
  created_at             timestamptz NOT NULL DEFAULT now(),
  updated_at             timestamptz NOT NULL DEFAULT now(),
  UNIQUE (game_id, tcggraph_card_id, tcggraph_printing_key, language)
);
CREATE INDEX IF NOT EXISTS tcg_printings_game_idx           ON public.tcg_printings (game_id);
CREATE INDEX IF NOT EXISTS tcg_printings_set_idx            ON public.tcg_printings (set_id);
CREATE INDEX IF NOT EXISTS tcg_printings_mtg_idx            ON public.tcg_printings (mtg_printings_id) WHERE mtg_printings_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS tcg_printings_tcggraph_card_idx  ON public.tcg_printings (tcggraph_card_id);

-- ---------------------------------------------------------------------
-- tcg_external_ids
-- ---------------------------------------------------------------------
-- Audit trail of every identity we've seen. Multiple sources per
-- internal object; each (source, external_id) is globally unique.
CREATE TABLE IF NOT EXISTS public.tcg_external_ids (
  id            bigserial PRIMARY KEY,
  scope         text NOT NULL,        -- 'game' | 'set' | 'card' | 'printing'
  source        text NOT NULL,        -- 'tcggraph' | 'tcgplayer' | 'cardmarket' | 'scryfall' | 'mtg-printing' | 'oracle' | 'mtgjson'
  external_id   text NOT NULL,
  ref_table     text NOT NULL,        -- 'tcg_games' | 'tcg_sets' | 'tcg_cards' | 'tcg_printings' | 'mtg_printings' | 'mtg_oracle_cards' | 'mtg_sets'
  ref_id        text NOT NULL,        -- primary key of ref_table as text
  game_id       text REFERENCES public.tcg_games(id) ON DELETE SET NULL,
  confidence    text NOT NULL DEFAULT 'exact',
  mapped_at     timestamptz NOT NULL DEFAULT now(),
  mapped_by     text NOT NULL DEFAULT 'auto',   -- 'auto' | 'manual' | 'audit'
  notes         jsonb
);
-- One (source, external_id) may map to at most one internal object per scope.
CREATE UNIQUE INDEX IF NOT EXISTS tcg_external_ids_uq
  ON public.tcg_external_ids (scope, source, external_id);
CREATE INDEX IF NOT EXISTS tcg_external_ids_ref_idx
  ON public.tcg_external_ids (ref_table, ref_id);
CREATE INDEX IF NOT EXISTS tcg_external_ids_game_source_idx
  ON public.tcg_external_ids (game_id, source);

-- ---------------------------------------------------------------------
-- tcg_ingest_runs  (must NOT modify market_import_runs)
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.tcg_ingest_runs (
  id                       uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  game_id                  text REFERENCES public.tcg_games(id) ON DELETE SET NULL,
  resource                 text NOT NULL,          -- 'cards.full'|'cards.set'|'cards.new-sets'|'sets'
  provider                 text NOT NULL DEFAULT 'tcggraph',
  provider_version         text,
  started_at               timestamptz NOT NULL DEFAULT now(),
  finished_at              timestamptz,
  status                   text NOT NULL,          -- 'running'|'success'|'failure'|'partial'|'aborted_credit'
  pages_requested          int,
  pages_completed          int,
  rows_fetched             int,
  rows_inserted            int,
  rows_updated             int,
  rows_rejected            int,
  credits_used             int,
  credits_remaining        int,
  daily_credits_remaining  int,
  etag_hits                int,
  http_304_count           int,
  errors                   int,
  notes                    jsonb NOT NULL DEFAULT '{}'::jsonb
);
CREATE INDEX IF NOT EXISTS tcg_ingest_runs_recent_idx
  ON public.tcg_ingest_runs (game_id, resource, started_at DESC);

-- ---------------------------------------------------------------------
-- tcg_ingest_locks
-- ---------------------------------------------------------------------
-- Advisory locking so two workers cannot process the same
-- (game, resource) at once. Rows are cleared when the lease expires
-- or is released cleanly. A crashed worker's stale lock is auto-
-- reclaimable by the next attempt when leased_until < now().
CREATE TABLE IF NOT EXISTS public.tcg_ingest_locks (
  game_id       text NOT NULL REFERENCES public.tcg_games(id) ON DELETE CASCADE,
  resource      text NOT NULL,
  leased_by     text NOT NULL,             -- caller-supplied worker id
  leased_at     timestamptz NOT NULL DEFAULT now(),
  leased_until  timestamptz NOT NULL,      -- caller-provided expiry
  notes         jsonb NOT NULL DEFAULT '{}'::jsonb,
  PRIMARY KEY (game_id, resource)
);

-- ---------------------------------------------------------------------
-- tcg_data_overrides
-- ---------------------------------------------------------------------
-- Manual overrides / aliases (finish rename, bad-price scrub, etc.).
CREATE TABLE IF NOT EXISTS public.tcg_data_overrides (
  id           bigserial PRIMARY KEY,
  ref_table    text NOT NULL,
  ref_id       text NOT NULL,
  field        text NOT NULL,
  value_json   jsonb NOT NULL,
  valid_from   timestamptz NOT NULL DEFAULT now(),
  valid_to     timestamptz,
  reason       text,
  created_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS tcg_data_overrides_ref_idx ON public.tcg_data_overrides (ref_table, ref_id, field);

-- ---------------------------------------------------------------------
-- tcg_market_prices_current
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.tcg_market_prices_current (
  tcg_printing_id  text NOT NULL REFERENCES public.tcg_printings(id) ON DELETE CASCADE,
  game_id          text NOT NULL REFERENCES public.tcg_games(id) ON DELETE CASCADE,
  source           text NOT NULL,          -- 'tcggraph.cardmarket'|'tcggraph.tcgplayer'|'tcggraph.cardkingdom'|'tcggraph.manapool'
  list_type        text NOT NULL,          -- 'retail'|'buylist'
  region           text,                   -- 'NA'|'EU'|NULL
  currency         char(3) NOT NULL,
  finish           text,                   -- printing-level; captured for reader convenience
  price            numeric(12,4),          -- 'market'
  price_low        numeric(12,4),
  price_trend      numeric(12,4),
  avg_1d           numeric(12,4),
  avg_7d           numeric(12,4),
  avg_30d          numeric(12,4),
  updated_at       timestamptz,            -- provider timestamp
  ingested_at      timestamptz NOT NULL DEFAULT now(),
  source_run_id    uuid REFERENCES public.tcg_ingest_runs(id) ON DELETE SET NULL,
  PRIMARY KEY (tcg_printing_id, source, list_type, currency, finish)
);
CREATE INDEX IF NOT EXISTS tcg_market_prices_current_game_idx
  ON public.tcg_market_prices_current (game_id, source);

-- ---------------------------------------------------------------------
-- tcg_graded_prices_current
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.tcg_graded_prices_current (
  tcg_printing_id  text NOT NULL REFERENCES public.tcg_printings(id) ON DELETE CASCADE,
  game_id          text NOT NULL REFERENCES public.tcg_games(id) ON DELETE CASCADE,
  grader           text NOT NULL,          -- 'raw'|'any'|'psa'|'bgs'|'cgc'|'sgc'|...
  grade            text NOT NULL,          -- 'ungraded'|'7'|'8'|'9'|'9.5'|'10'|...
  currency         char(3) NOT NULL,
  price            numeric(12,4) NOT NULL,
  card_sales_volume int,                    -- per-card total (same across all grader/grade rows for one card)
  updated_at       timestamptz,
  ingested_at      timestamptz NOT NULL DEFAULT now(),
  source_run_id    uuid REFERENCES public.tcg_ingest_runs(id) ON DELETE SET NULL,
  PRIMARY KEY (tcg_printing_id, grader, grade, currency)
);
CREATE INDEX IF NOT EXISTS tcg_graded_prices_current_game_idx
  ON public.tcg_graded_prices_current (game_id);

-- ---------------------------------------------------------------------
-- tcg_market_price_daily  -- append-only history
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.tcg_market_price_daily (
  tcg_printing_id  text NOT NULL,
  observed_on      date NOT NULL,
  source           text NOT NULL,
  list_type        text NOT NULL,
  currency         char(3) NOT NULL,
  finish           text,
  game_id          text NOT NULL,
  price            numeric(12,4),
  price_low        numeric(12,4),
  price_trend      numeric(12,4),
  avg_1d           numeric(12,4),
  avg_7d           numeric(12,4),
  avg_30d          numeric(12,4),
  source_run_id    uuid,
  PRIMARY KEY (tcg_printing_id, observed_on, source, list_type, currency, finish)
);
-- BRIN on observed_on for cheap chronological pruning as history grows.
CREATE INDEX IF NOT EXISTS tcg_market_price_daily_date_brin
  ON public.tcg_market_price_daily USING brin (observed_on) WITH (pages_per_range = 32);
CREATE INDEX IF NOT EXISTS tcg_market_price_daily_printing_idx
  ON public.tcg_market_price_daily (tcg_printing_id, observed_on DESC);

-- ---------------------------------------------------------------------
-- tcg_graded_price_daily  -- append-only history
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.tcg_graded_price_daily (
  tcg_printing_id  text NOT NULL,
  observed_on      date NOT NULL,
  grader           text NOT NULL,
  grade            text NOT NULL,
  currency         char(3) NOT NULL,
  game_id          text NOT NULL,
  price            numeric(12,4) NOT NULL,
  card_sales_volume int,
  source_run_id    uuid,
  PRIMARY KEY (tcg_printing_id, observed_on, grader, grade, currency)
);
CREATE INDEX IF NOT EXISTS tcg_graded_price_daily_date_brin
  ON public.tcg_graded_price_daily USING brin (observed_on) WITH (pages_per_range = 32);
CREATE INDEX IF NOT EXISTS tcg_graded_price_daily_printing_idx
  ON public.tcg_graded_price_daily (tcg_printing_id, observed_on DESC);

-- ---------------------------------------------------------------------
-- Row-Level Security
-- ---------------------------------------------------------------------
-- Catalogue tables: public read, service-role write.
-- Ingest bookkeeping (runs, locks, overrides, external_ids): server-only.
-- These policies mirror the mtg_* + PokePrices conventions in this
-- project (public/anon can read the catalogue and price tables; only
-- service_role writes).

ALTER TABLE public.tcg_games                    ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tcg_sets                     ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tcg_cards                    ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tcg_printings                ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tcg_market_prices_current    ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tcg_graded_prices_current    ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tcg_market_price_daily       ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tcg_graded_price_daily       ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tcg_external_ids             ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tcg_ingest_runs              ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tcg_ingest_locks             ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tcg_data_overrides           ENABLE ROW LEVEL SECURITY;

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'tcg_games','tcg_sets','tcg_cards','tcg_printings',
    'tcg_market_prices_current','tcg_graded_prices_current',
    'tcg_market_price_daily','tcg_graded_price_daily'
  ] LOOP
    EXECUTE format($p$
      DROP POLICY IF EXISTS %I ON public.%I;
      CREATE POLICY %I ON public.%I FOR SELECT TO anon, authenticated USING (true);
    $p$, t || '_public_read', t, t || '_public_read', t);
  END LOOP;
  -- Server-only tables. No read/write policy for anon or authenticated;
  -- only service_role bypasses RLS.
  FOREACH t IN ARRAY ARRAY[
    'tcg_external_ids','tcg_ingest_runs','tcg_ingest_locks','tcg_data_overrides'
  ] LOOP
    EXECUTE format($p$
      DROP POLICY IF EXISTS %I ON public.%I;
    $p$, t || '_public_read', t);
  END LOOP;
END $$;

NOTIFY pgrst, 'reload schema';
