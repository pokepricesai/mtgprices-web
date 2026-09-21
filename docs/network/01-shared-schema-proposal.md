# Shared TCG schema proposal (Slice 0)

Status: **PROPOSAL** — not deployed. No migrations run.
Owner audit reference: reports at the end of `docs/network/00-*` in the eventual final report.

## Guiding principles

1. **Do not touch what works.** MTG catalogue (`mtg_*` tables, Scryfall/MTGJSON ingest, RPCs, aggregates, sitemap-cards shards) stays exactly as it is.
2. **Do not touch PokePrices data.** Its tables (`daily_prices`, `card_latest_prices`, `portfolios`, `watchlist` etc.) stay as they are.
3. **New games land in a game-agnostic namespace from day one.** No `ygo_*`, `op_*`, `swu_*` prefixes — one `tcg_*` schema keyed by `game_id`.
4. **TCGGraph supplements MTG, never replaces it.** MTG pricing continues to flow from MTGJSON into `mtg_price_observations`. TCGGraph's contribution to MTG is **graded pricing + supplementary market signals**, stored in the new `tcg_graded_prices_*` tables and joined to `mtg_printings` via `tcg_external_ids`.

## Existing shareable primitives (already in the shared Supabase)

| Object | Currently used by | Reusable? |
|---|---|---|
| `auth.users` | PokePrices + MTGPrices | **Yes** — canonical identity |
| `profiles` | PokePrices | Extend for network use (see §5) |
| `market_import_runs(provider, parser_version, status, notes, ...)` | MTG MTGJSON ingest | **Yes** — already game-agnostic; add optional `game_id` column |
| `mtg_*` catalogue | MTGPrices only | **No**, but bridged via `tcg_external_ids` |

## Proposed new tables (all in `public.`, prefix `tcg_`)

### `tcg_games`
```sql
CREATE TABLE tcg_games (
  id           text PRIMARY KEY,      -- 'mtg' | 'ygo' | 'onepiece' | 'swu' | 'pokemon' (future)
  name         text NOT NULL,          -- 'Magic: The Gathering', ...
  tcggraph_id  text UNIQUE,            -- TCGGraph's game identifier when it exists
  active       boolean NOT NULL DEFAULT true,
  created_at   timestamptz NOT NULL DEFAULT now()
);
```
Seed: `('mtg', 'Magic: The Gathering', <TCGGraph id>, true)`, `('ygo', ...)`, `('onepiece', ...)`, `('swu', 'Star Wars: Unlimited', ...)`.
Pokemon is intentionally left out for now — it stays in the PokePrices native schema.

### `tcg_sets`
```sql
CREATE TABLE tcg_sets (
  id              text PRIMARY KEY,     -- '{game_id}:{tcggraph_set_id}' or '{game_id}:{our_code}'
  game_id         text NOT NULL REFERENCES tcg_games(id),
  code            text,                 -- short human code (e.g. 'lea', 'lob', 'op01')
  name            text NOT NULL,
  released_at     date,
  card_count      int,
  icon_uri        text,
  tcggraph_set_id text,                 -- source-of-truth external id
  created_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (game_id, code)
);
CREATE INDEX ON tcg_sets (game_id, released_at DESC);
```
For MTG we keep `mtg_sets` as the primary catalogue; `tcg_sets` gets mirror rows only for sets we need TCGGraph pricing on. Bridge via `tcg_external_ids`.

### `tcg_cards`
```sql
CREATE TABLE tcg_cards (
  id            text PRIMARY KEY,      -- '{game_id}:card:{tcggraph_card_id}'
  game_id       text NOT NULL REFERENCES tcg_games(id),
  name          text NOT NULL,
  face_names    text[],
  type_line     text,
  rules_text    text,
  attributes    jsonb NOT NULL DEFAULT '{}',  -- game-specific fields
  tcggraph_card_id text,
  created_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ON tcg_cards (game_id, name);
```
Logical (oracle-level) card. For MTG this is optional; MTG uses `mtg_oracle_cards`. For YGO/OP/SWU this is the canonical logical card.

### `tcg_printings`
```sql
CREATE TABLE tcg_printings (
  id                  text PRIMARY KEY,   -- '{game_id}:print:{tcggraph_printing_id}'
  game_id             text NOT NULL REFERENCES tcg_games(id),
  card_id             text NOT NULL REFERENCES tcg_cards(id),
  set_id              text REFERENCES tcg_sets(id),
  collector_number    text,
  finish              text,               -- 'nonfoil' | 'foil' | 'holo' | 'reverse_holo' | 'etched' | ...
  variant             text,               -- 'showcase' | 'borderless' | '1st_edition' | ...
  language            text NOT NULL DEFAULT 'en',
  image_uri           text,
  tcggraph_printing_id text NOT NULL,
  created_at          timestamptz NOT NULL DEFAULT now(),
  UNIQUE (game_id, tcggraph_printing_id)
);
CREATE INDEX ON tcg_printings (game_id, set_id);
```
Physical printing. MTG existing rows stay in `mtg_printings`; we bridge via `tcg_external_ids`.

### `tcg_external_ids` (the bridge)
```sql
CREATE TABLE tcg_external_ids (
  scope         text NOT NULL,   -- 'game' | 'set' | 'card' | 'printing'
  source        text NOT NULL,   -- 'tcggraph' | 'scryfall' | 'mtgjson' | 'tcgplayer' | 'cardmarket' | 'ygoprodeck' | ...
  external_id   text NOT NULL,   -- the id in that source
  ref_id        text NOT NULL,   -- the id in OUR system (e.g. mtg_printings.id::text, tcg_printings.id, etc.)
  ref_table     text NOT NULL,   -- 'mtg_printings' | 'tcg_printings' | 'mtg_sets' | 'tcg_sets' | ...
  confidence    text NOT NULL DEFAULT 'exact',  -- 'exact' | 'high' | 'ambiguous' | 'unmapped'
  mapped_at     timestamptz NOT NULL DEFAULT now(),
  mapped_by     text,            -- 'auto' | 'manual' | 'audit'
  notes         jsonb,
  PRIMARY KEY (scope, source, external_id)
);
CREATE INDEX ON tcg_external_ids (ref_table, ref_id);
```
**Central table.** Every external identifier the pipeline ever sees lands here. Never fuzzy-match at read time — the mapping is materialised once (during backfill) and looked up.

### `tcg_market_prices_current`
```sql
CREATE TABLE tcg_market_prices_current (
  ref_table     text NOT NULL,   -- 'mtg_printings' | 'tcg_printings'
  ref_id        text NOT NULL,   -- primary key in that table
  game_id       text NOT NULL REFERENCES tcg_games(id),
  provider      text NOT NULL,   -- 'tcggraph' | 'tcgplayer' | ...
  market        text NOT NULL,   -- 'paper' | 'online'
  currency      char(3) NOT NULL,
  price_type    text NOT NULL,   -- 'retail' | 'market' | 'buylist'
  condition     text NOT NULL DEFAULT 'NM',
  finish        text NOT NULL DEFAULT 'nonfoil',
  language      text NOT NULL DEFAULT 'en',
  price         numeric(12,4) NOT NULL,
  observed_on   date NOT NULL,
  source_run_id uuid,           -- FK to tcg_ingest_runs
  PRIMARY KEY (ref_table, ref_id, game_id, provider, market, currency, price_type, condition, finish, language)
);
```
Shape mirrors `mtg_current_prices` so cross-game reader code stays uniform. `ref_table + ref_id` polymorphic key is the trade-off for keeping MTG catalogue where it is.

### `tcg_graded_prices_current`
```sql
CREATE TABLE tcg_graded_prices_current (
  ref_table    text NOT NULL,
  ref_id       text NOT NULL,
  game_id      text NOT NULL REFERENCES tcg_games(id),
  grader       text NOT NULL,   -- 'PSA' | 'BGS' | 'CGC' | 'SGC' | 'Beckett' | ...
  grade        text NOT NULL,   -- '10', '9.5', '9', ... store as text so half-grades and 'Auth' etc. fit
  currency     char(3) NOT NULL,
  price        numeric(12,4) NOT NULL,
  sales_volume int,
  confidence   text,            -- 'thick_market' | 'thin_market' | 'estimated' | 'single_sale'
  status       text,            -- upstream status: 'active' | 'stale' | ...
  observed_on  date NOT NULL,
  source_run_id uuid,
  PRIMARY KEY (ref_table, ref_id, game_id, grader, grade, currency)
);
```
Absence of a row for `(printing, grader, grade)` means **no data**, not "worth $0". Callers must check row existence.

### `tcg_market_price_daily` + `tcg_graded_price_daily`
Same shapes as their `_current` cousins but with `observed_on` as part of the primary key. Optional partitioning by month once row count crosses ~30M.

### `tcg_ingest_runs`
```sql
CREATE TABLE tcg_ingest_runs (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  game_id           text REFERENCES tcg_games(id),
  source            text NOT NULL,   -- 'tcggraph.games' | 'tcggraph.sets' | 'tcggraph.prices.raw' | 'tcggraph.prices.graded'
  status            text NOT NULL,   -- 'running' | 'success' | 'failure'
  started_at        timestamptz NOT NULL DEFAULT now(),
  completed_at     timestamptz,
  rows_read         int,
  rows_upserted     int,
  credits_used      int,
  credits_remaining int,
  etag_used         text,
  notes             jsonb
);
CREATE INDEX ON tcg_ingest_runs (game_id, source, started_at DESC);
```
Analogous to `market_import_runs`, kept separate so MTG's existing gates aren't perturbed.

### `tcg_ingest_locks`
Advisory locks for daily runs. Same shape as `mtg_daily_ingest_locks`, keyed by `(game_id, source, observed_on)`.

### `tcg_data_overrides`
Manual overrides for known bad data upstream (e.g. TCGGraph reports $9,999 on a card known to be worth $2). `(ref_table, ref_id, field, value_json, valid_from, valid_to, reason)`.

## What we DON'T change

- No changes to `mtg_*` tables.
- No changes to PokePrices tables.
- No changes to `auth.users`.
- No changes to `market_import_runs` in this slice (a future non-breaking `ALTER TABLE ADD COLUMN game_id text DEFAULT 'mtg'` is optional).

## Reader convention

- MTG UI reads MTG price data from **`mtg_current_prices`** (unchanged).
- MTG UI reads MTG **graded** data from **`tcg_graded_prices_current`** joined to `mtg_printings` via `tcg_external_ids`.
- YGO / OP / SWU UIs read everything from `tcg_*`.

This gives the new games one shared pipeline without disrupting anything running today.
