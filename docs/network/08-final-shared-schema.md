# Final shared TCG schema (Slice 1, phase I)

**Supersedes** `docs/network/01-shared-schema-proposal.md` after live payload verification.

## Change summary vs Slice 0

- **Option B wins.** Every network printing gets a canonical `tcg_printings.id`. MTG rows in `tcg_printings` are lightweight mapping rows pointing at `mtg_printings.id`. YGO / OP / SWU rows carry native catalogue identity. Price tables foreign-key to `tcg_printings.id` (single column) instead of the polymorphic `(ref_table, ref_id)` from Slice 0.
- **Do not duplicate MTG catalogue.** `tcg_printings` for MTG stores only the fields the network needs (game_id, tcggraph_printing_id, mtg_printings_id, finish alias). Names, oracle text, Scryfall data stay in `mtg_*` — the source of truth.
- **Dedicated `tcg_ingest_runs`.** Do not modify `market_import_runs`. That table is proven production infrastructure for MTGJSON and should stay untouched.
- **`tcg_graded_prices_current` uses `salesVolume` as a card-level total** (verified live).
- **`printings[].key` → finish alias** mapping is stored in `tcg_data_overrides` (e.g. `normal → nonfoil`).

## Why Option B beats the polymorphic design from Slice 0

| Criterion | Option A (polymorphic ref_table + ref_id) | **Option B (canonical tcg_printings)** |
|---|---|---|
| FK enforcement | No — polymorphic keys can't be FK'd | **Yes** — one FK per price table. Postgres enforces integrity. |
| Query complexity | JOIN with a CASE on `ref_table` in every reader | Single JOIN on `tcg_printing_id`. |
| Cross-game portfolio join | Difficult; users' MTG holdings and YGO holdings need different resolvers | Trivial: one `tcg_printing_id` column across all games. |
| Slice-N front ends (YGO / OP / SWU / potentially Pokemon) | Each has to know MTG-specific `mtg_printings` shape | Each queries `tcg_printings` uniformly. |
| Storage overhead | Zero for MTG; catalogue lives in `mtg_printings` | Small: one row per MTG printing carrying only mapping fields (~50 bytes × 105 841 rows ≈ 5 MB). Negligible. |
| Risk of MTG UI regression | Higher — MTG UI reads may need to switch conditionally on ref_table | Zero — MTG UI stays on `mtg_*`; the network layer opts into `tcg_printings` when it needs cross-game logic. |

Option A gave up genuine foreign keys to save 5 MB of storage. Not a good trade.

## Final schema

### `tcg_games`
```sql
CREATE TABLE tcg_games (
  id           text PRIMARY KEY,     -- 'mtg' | 'ygo' | 'onepiece' | 'swu' | ('pokemon' reserved)
  slug         text NOT NULL UNIQUE, -- TCGGraph slug: 'magic-the-gathering' | 'yugioh' | 'one-piece' | 'star-wars-unlimited'
  name         text NOT NULL,
  active       boolean NOT NULL DEFAULT true,
  created_at   timestamptz NOT NULL DEFAULT now()
);
```
Seed rows for 4 games. Pokemon deliberately not seeded — PokePrices does not migrate in this slice.

### `tcg_sets`
```sql
CREATE TABLE tcg_sets (
  id              text PRIMARY KEY,          -- '{game_id}:set:{tcggraph_set_code_lower}'
  game_id         text NOT NULL REFERENCES tcg_games(id),
  code            text NOT NULL,             -- lower-case TCGGraph code
  name            text NOT NULL,
  released_at     date,
  tcggraph_meta   jsonb NOT NULL DEFAULT '{}',
  created_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (game_id, code)
);
CREATE INDEX ON tcg_sets (game_id, released_at DESC);
```
For MTG, `tcg_sets` mirrors `mtg_sets` entries lazily on first observation (populated during ingest, not backfilled up front).

### `tcg_printings` — the canonical identity
```sql
CREATE TABLE tcg_printings (
  id                    text PRIMARY KEY,           -- '{game_id}:print:{tcggraph_card_id}[:{printing_key}]'
                                                    -- MTG: 'mtg:print:mtg_84f2c8f5-8e1:foil'
  game_id               text NOT NULL REFERENCES tcg_games(id),
  set_id                text REFERENCES tcg_sets(id),
  tcggraph_card_id      text NOT NULL,              -- 'mtg_84f2c8f5-8e1'
  tcggraph_printing_key text NOT NULL,              -- 'normal' | 'foil' | 'etched' | '1st-edition' | ...
  language              text NOT NULL DEFAULT 'en',
  collector_number      text,
  -- Bridge fields (nullable; populated per-game):
  mtg_printings_id      uuid REFERENCES mtg_printings(id) ON DELETE SET NULL,  -- MTG only
  mtg_finish            text,                       -- 'nonfoil' | 'foil' | 'etched' when game_id='mtg'
  -- External IDs:
  cardmarket_id         int,
  tcgplayer_id          int,
  created_at            timestamptz NOT NULL DEFAULT now(),
  UNIQUE (game_id, tcggraph_card_id, tcggraph_printing_key, language)
);
CREATE INDEX ON tcg_printings (game_id, set_id);
CREATE INDEX ON tcg_printings (mtg_printings_id) WHERE mtg_printings_id IS NOT NULL;
```

Key points:
- **`tcggraph_printing_key`** captures TCGGraph's `printings[].key` (normal, foil, etched, 1st-edition, …). This is the finish/edition dimension.
- **`mtg_printings_id`** is the bridge into the existing MTG catalogue for MTG rows. NULL for the other games.
- **`mtg_finish`** is the aliased finish name usable by MTG-side code (`normal → nonfoil` etc.).
- **`cardmarket_id`/`tcgplayer_id`** are recorded when present, but are secondary — the strong bridge for MTG is (mtg_printings_id, printing_key).

### `tcg_external_ids`
Unchanged from Slice 0 (still valuable as an audit trail of every ID we've ever seen and any confidence downgrade / manual override).

### `tcg_market_prices_current`
```sql
CREATE TABLE tcg_market_prices_current (
  tcg_printing_id text NOT NULL REFERENCES tcg_printings(id) ON DELETE CASCADE,
  game_id         text NOT NULL REFERENCES tcg_games(id),
  source          text NOT NULL,           -- 'tcggraph.cardmarket' | 'tcggraph.tcgplayer' | 'tcggraph.cardkingdom' | 'tcggraph.manapool'
  list_type       text NOT NULL,           -- 'retail' | 'buylist'
  region          text,                    -- 'NA' | 'EU' | ...
  currency        char(3) NOT NULL,
  price           numeric(12,4) NOT NULL,  -- 'market' value
  price_low       numeric(12,4),
  price_trend     numeric(12,4),
  avg_1d          numeric(12,4),
  avg_7d          numeric(12,4),
  avg_30d         numeric(12,4),
  observed_on     date NOT NULL,
  refreshed_at    timestamptz NOT NULL DEFAULT now(),
  source_run_id   uuid REFERENCES tcg_ingest_runs(id) ON DELETE SET NULL,
  PRIMARY KEY (tcg_printing_id, source, list_type, currency)
);
CREATE INDEX ON tcg_market_prices_current (game_id, source);
```

### `tcg_graded_prices_current`
```sql
CREATE TABLE tcg_graded_prices_current (
  tcg_printing_id text NOT NULL REFERENCES tcg_printings(id) ON DELETE CASCADE,
  game_id         text NOT NULL REFERENCES tcg_games(id),
  grader          text NOT NULL,       -- 'raw' | 'any' | 'psa' | 'bgs' | 'cgc' | 'sgc'
  grade           text NOT NULL,       -- 'ungraded' | '7' | '8' | '9' | '9.5' | '10' | ...
  currency        char(3) NOT NULL,
  price           numeric(12,4) NOT NULL,
  card_sales_volume int,               -- per-card total; SAME on every grader/grade row
  observed_on     date NOT NULL,
  refreshed_at    timestamptz NOT NULL DEFAULT now(),
  source_run_id   uuid REFERENCES tcg_ingest_runs(id) ON DELETE SET NULL,
  PRIMARY KEY (tcg_printing_id, grader, grade, currency)
);
CREATE INDEX ON tcg_graded_prices_current (game_id);
```

### `tcg_market_price_daily` and `tcg_graded_price_daily`
Same schemas as the `_current` tables plus `observed_on` in the primary key. Populated by daily upsert. Monthly partitioning added at the ~30 M-row threshold; not required at launch.

### `tcg_ingest_runs`
```sql
CREATE TABLE tcg_ingest_runs (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  game_id         text REFERENCES tcg_games(id),
  source          text NOT NULL,               -- 'tcggraph.cards.full' | 'tcggraph.cards.set:X' | 'tcggraph.sets' | ...
  scope           jsonb NOT NULL DEFAULT '{}', -- what was requested: {page_start, page_end, set_filter, ...}
  status          text NOT NULL,               -- 'running' | 'success' | 'failure' | 'partial'
  started_at      timestamptz NOT NULL DEFAULT now(),
  completed_at    timestamptz,
  rows_read       int,
  rows_upserted   int,
  credits_used    int,
  credits_remaining int,
  daily_remaining int,
  etag_used       text,
  error           text,
  notes           jsonb
);
CREATE INDEX ON tcg_ingest_runs (game_id, source, started_at DESC);
```
**Kept separate from `market_import_runs`.** MTGJSON ingest continues to record its runs in `market_import_runs`; TCGGraph ingest records its runs in `tcg_ingest_runs`. No column added to `market_import_runs` in this slice.

### `tcg_ingest_locks`
Small advisory lock table keyed by `(game_id, source, scope_hash)` to prevent overlapping runs.

### `tcg_data_overrides`
As Slice 0 (`ref_table`, `ref_id`, `field`, `value_json`, `valid_from`, `valid_to`, `reason`).

## Concrete Slice-2 seeding plan

1. Apply migration `2026-09-2N-tcg-shared-schema.sql`.
2. Seed `tcg_games` with the four rows (slugs verified live).
3. Bootstrap MTG mapping:
   - `/cards?game=magic-the-gathering&page=1..1059&limit=100` (~2 118 credits, one day).
   - For each row: upsert into `tcg_sets` (lazy), upsert into `tcg_printings` (one row per `printings[].key`), copy `externalIds`, resolve `mtg_printings_id` via the deterministic bridge from `docs/network/05-mtg-mapping-report.md`.
   - Every mapping recorded in `tcg_external_ids` for provenance.
4. Bootstrap YGO / OP / SWU catalogue similarly. Cheaper: OP 112 credits, SWU 158 credits, YGO 760 credits.
5. First price/graded snapshot lands in `_current` tables the same day.
6. Cron activation deferred to a later slice — Slice 1 explicitly does NOT activate any production cron.
