# MTGPrices Stage 1D — operational runbook

Version: 2026-09-15 (post-hardening)

Stage 1D adds a daily MTGJSON pricing ingest, an automatic Scryfall
catalogue refresh (invoking the existing Stage 1B importer), an
MTGJSON UUID identifier delta, a weekly deep AllPrices gap repair, an
internal current-price table (server-side reducer), and a DB-backed
run lock on top of the Stage 1C bootstrap.

Three migrations are approved. No canonical/aggregate/deck/
enrichment/admin schema is added.

## Migrations (apply order)

Three files, in `migrations/`. All additive, idempotent, and wrapped
in `BEGIN … COMMIT` with DO-block sanity checks.

1. `2026-09-15a-mtg-daily-ingest-lock-and-partition-helper.sql`
2. `2026-09-15b-mtg-current-prices.sql`
3. `2026-09-15c-refresh-mtg-current-prices-timeout.sql`
   (widens the ETL function's `statement_timeout` to 10 min — required
   for the DISTINCT ON reducer to complete on multi-million-row windows)

`2026-09-15b` installs both the table and the SECURITY INVOKER
`refresh_mtg_current_prices(look_back_days INTEGER)` reducer function.
The daily pipeline calls that function; it never pages raw
observations through PostgREST.

Deferred design drafts live in `docs/deferred-migrations/`. They must
**not** be run.

## Post-migration first-day tasks

1. **Measure current storage baseline.** Needed before disk-pressure
   claims. Save output to `reports/stage1d-baseline-storage.txt`.
   ```sql
   SELECT pg_size_pretty(pg_database_size(current_database())) AS db_total;

   SELECT c.relname                            AS table_name,
          pg_size_pretty(pg_relation_size(c.oid))       AS heap,
          pg_size_pretty(pg_indexes_size(c.oid))        AS indexes,
          pg_size_pretty(pg_total_relation_size(c.oid)) AS total,
          pg_stat_get_live_tuples(c.oid)                AS live_rows
     FROM pg_class c
     JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname='public'
      AND c.relkind IN ('r','p')
      AND (c.relname LIKE 'mtg\_%')
    ORDER BY pg_total_relation_size(c.oid) DESC;

   SELECT sum(pg_total_relation_size(inhrelid))::bigint AS mtg_price_obs_bytes,
          pg_size_pretty(sum(pg_total_relation_size(inhrelid))) AS mtg_price_obs_pretty
     FROM pg_inherits
    WHERE inhparent = 'public.mtg_price_observations'::regclass;
   ```

2. **Sanity smoke** — RPC + lock + partition helper:
   ```sql
   SELECT public.ensure_mtg_price_partition('2026-11-01');  -- exists: or created:
   SELECT count(*) FROM public.mtg_daily_ingest_locks;       -- 0
   SELECT count(*) FROM pg_policies WHERE tablename
     IN ('mtg_daily_ingest_locks','mtg_current_prices');    -- 0
   ```

3. **Initial current-price population** (server-side; no rows over the wire):
   ```powershell
   $env:SUPABASE_URL="https://egidpsrkqvymvioidatc.supabase.co"
   $env:SUPABASE_SERVICE_KEY="<legacy eyJ… service role key>"
   $env:MTG_DAILY_INGEST_ENABLED="true"
   $env:MTG_PRICING_INGESTION_ENABLED="true"
   python mtg_daily_pipeline.py --verbose --initial-current-price-population --skip-prices --skip-scryfall --skip-identifiers
   ```
   Expected summary keys:
   - `current_prices.raw_rows_transferred = 0`
   - `current_prices.keys_upserted` ≈ 800-900 K
   - `current_prices.distinct_finishes` in the 250-350 K range
   - `current_prices.provider_breakdown` covers all five providers
   - `current_prices.latest_observed_on` = the latest observed_on in
     the raw table (2026-09-13 at the time of writing)

## Manual gates before enabling cron

Cron in `.github/workflows/mtg-daily-ingest.yml` is commented out. Enable
ONLY after all these pass. Each numbered gate is a distinct action.

**Gate 1 — Migrations applied + validated.**
Paste 15a then 15b into Supabase SQL Editor. Watch for each `RAISE NOTICE`.
Run the sanity smoke queries above.

**Gate 2 — Dry-run passes.**
```powershell
python mtg_daily_pipeline.py --dry-run --verbose
```
Expected: summary JSON printed, no DB writes, `lock.skipped=True`, Scryfall
+ identifier steps report their `action` / `scanned` counts (identifiers
step still downloads AllIdentifiers.json.gz and computes the delta in
memory — dry-run just suppresses the write flush).

**Gate 3 — One real manual daily import passes.**
```powershell
python mtg_daily_pipeline.py --verbose
```
Expected: `scryfall.action` = `unchanged` or `invoked`;
`identifiers.newly_inserted` = 0 (usually);
`prices.status` = `success`;
`validation.status` = `success` or `partial` (warnings only);
`current_prices.raw_rows_transferred = 0` (server-side reducer).

**Gate 4 — Same-build idempotency rerun.**
Rerun Gate 3 within the same MTGJSON build window.
Expected: `prices.action='skipped_duplicate_build'`. Pipeline exits 0.

**Gate 5 — Warnings-only guard.**
Temporarily lower `PROVIDER_MEDIAN_MIN_RATIO` in
`mtg_stage1d/validation.py` from 0.7 → 0.99 locally. Rerun the pipeline
(the mtgjson row will still show `status='success'` because `errors=0`,
but the pipeline's own `validation.status` becomes `partial`). Rerun a
third time immediately — must short-circuit on the build-guard.
Revert the code change.

**Gate 6 — Gap-detection over the historical window (DRY RUN, no writes).**
```powershell
python mtg_daily_pipeline.py --dry-run --verbose \
    --skip-prices --skip-current-refresh \
    --gap-window-days 45
```
Expected: `gap_check` contains 2026-08-06 and 2026-08-29 with
`status='missing'`.

**Gate 7 — Weekly deep repair over the historical window (LIVE, persists
classifications).**
This gate writes. It is the FIRST run that populates
`market_import_runs.notes.gap_repair.classifications`.
```powershell
python mtg_daily_pipeline.py --verbose \
    --skip-prices --skip-current-refresh \
    --weekly-gap-repair --gap-window-days 45
```
Expected: `gap_repair.downloaded_allprices=True` (or `False` on the
fast path if a previous test already persisted classifications);
`gap_repair.classifications['2026-08-06'].status='source_side_confirmed'`;
`gap_repair.classifications['2026-08-29'].status='source_side_confirmed'`;
non-zero `gap_repair.per_date_stats` entries for both.

**Gate 8 — Weekly deep repair short-circuits on re-run.**
Immediately re-run Gate 7.
Expected: `gap_repair.dates_skipped_prior` contains both dates,
`downloaded_allprices=False` (fast path — same AllPrices SHA as prior
classification), no new HTTP-level ingestion attempts for those dates.

**Gate 9 — DB-backed concurrency lock (fail-fast).**
In two terminals within ~10 s of each other:
```powershell
python mtg_daily_pipeline.py --verbose --skip-prices --skip-current-refresh --skip-scryfall --skip-identifiers --skip-gap-check
```
The second must exit code 4 immediately with `lock.error` referencing
the first invocation. It does NOT wait behind the first.

**Gate 10 — Current-price refresh sanity.**
```sql
SELECT count(*)                                       AS rows,
       count(DISTINCT printing_finish_id)             AS finishes,
       max(observed_on)                                AS latest,
       jsonb_pretty(
         (SELECT jsonb_object_agg(provider, cnt)
            FROM (SELECT provider, count(*) AS cnt
                    FROM public.mtg_current_prices
                   GROUP BY provider) t)
       )                                               AS providers
  FROM public.mtg_current_prices;
```
Expected: rows ~800-900 K, five providers, `latest` equals the target
date.

Once all 10 gates pass: edit
`.github/workflows/mtg-daily-ingest.yml`, uncomment the two `schedule:`
cron lines, commit, push.

## Dry-run vs live: what persists

| Command | Writes to `market_import_runs` | Writes classifications | Writes prices |
|---|:---:|:---:|:---:|
| `--dry-run` | no | **no** | no |
| plain daily run | yes (mtgjson row) | if `--weekly-gap-repair` triggered | yes |
| `--weekly-gap-repair` (no dry) | yes (backfill rows per repaired date) | **yes** | yes for repaired dates |

Dry-run inspects only. It does not persist gap classifications, so the
build-SHA short-circuit cannot be tested from two consecutive dry-runs.
Use Gate 7 → Gate 8 (live then live) for that specific test.

## Provider policy

**Deferred entirely in Stage 1D.** `mtg_current_prices` is not
publicly readable; card pages cannot query it via anon / authenticated
until a follow-up migration adds a scoped RLS policy AFTER legal
review of the provider mix.

## Scryfall automation

`mtg_stage1d.scryfall_delta.check_and_maybe_invoke()`:
1. Queries Scryfall `/bulk-data`.
2. Compares each `updated_at` (oracle_cards / default_cards / rulings)
   against the last **completed** Scryfall run's notes
   (status='success' OR status='partial' with notes.errors==0).
3. If unchanged → returns `action='unchanged'`; no ingester touched.
4. If any moved → instantiates the existing
   `scryfall_ingestion.ScryfallCatalogueIngestion` (no re-implementation)
   and runs `start() → run() → finish(status)`.
5. If invocation fails → returns `action='failed'` with error message;
   surfaced loudly. Does not stop the price ingest.

Regression tests cover all four branches (`ScryfallDeltaTests`).

## MTGJSON UUID identifier delta

Runs BEFORE the price ingest (step D). Downloads
`AllIdentifiers.json.gz`, SHA-256 verifies, streams via ijson, inserts
only new UUIDs whose Scryfall printing is already known.

**ON CONFLICT target:** `(provider, identifier_type, identifier_value)`
— matches the Stage 1C `2026-09-14d` schema which deliberately allows
multiple UUIDs per (printing, provider, identifier_type). The wrong
target `(printing_id, provider, identifier_type)` no longer exists as
a unique constraint and any code using it would raise
`there is no unique or exclusion constraint matching the ON CONFLICT
specification`. Regression test `IdentifierConflictTargetTests` pins
the correct target.

## Current-price refresh (server-side)

`mtg_stage1d.current_prices.refresh(look_back_days)` / `initial_populate()`
POST to `/rest/v1/rpc/refresh_mtg_current_prices`. The function:
- DISTINCT ON reduces raw observations within the window to newest
  per composite key.
- INSERT … ON CONFLICT DO UPDATE merges into `mtg_current_prices`
  (only overwrites when the incoming observed_on is ≥ the stored one).
- Returns one summary row: `keys_upserted`, `distinct_finishes`,
  `latest_observed_on`, `provider_breakdown`.

**Rows transferred over HTTP: one summary row per call.** Regardless of
whether the look-back window covers 2.1 million or 21 million raw rows.

## Gap repair

* **Daily cheap check:** `assess_recent(supabase, window_days=14)` —
  runs every daily job; per-day counts + status.
* **Weekly deep repair:** the Monday 15:00 UTC cron (detected inside
  the workflow via `date -u +%u`) triggers `run_weekly_repair`. Fast
  path skips the AllPrices download if every candidate is already
  `source_side_confirmed` **against the current SHA AND classified
  under the modern date-scoped counter**. Classifications made under
  the legacy `obs_mapped`-only signal are re-probed once.
* **Source-side confirmation is now date-scoped.** The
  `mtgjson_ingestion.IngestionStats.obs_source_for_date` counter
  tallies every observation in AllPrices whose `date_str == only_date`
  — including observations under UNMAPPED UUIDs. A date is
  `source_side_confirmed` only when that counter is zero, so a date
  whose only observations sit under unmapped UUIDs is correctly
  classified `ingestion_side_unfilled` rather than being mistaken for
  a genuine source gap.
* **`--gap-window-days N` CLI flag** widens the manual-test window
  beyond the production 14 days so historical gaps (e.g. 2026-08-06)
  can still be probed while they remain in the AllPrices file.

## Duplicate-build fallback (18:00 UTC path)

Pipeline order is deliberately arranged so a duplicate-build fallback
is genuinely cheap:

```
A. acquire lock
B. ensure current + next partitions
C. cheap Scryfall metadata probe (1 HTTP GET)
D. download AllPricesToday (~5-15 MB) + SHA-256 verify
E. read target_date from AllPricesToday meta
F. build_guard: target_date <= most recent completed build?
       → YES  →  skip G/H/I; only J/K/L (gap + validate) still run
       → NO   →  continue G/H/I
G. Scryfall invocation (only if freshness changed AND not duplicate;
   otherwise action='changed_deferred')
H. MTGJSON identifier delta (only if not duplicate)
I. AllPricesToday ingest (only if not duplicate)
J. current-price refresh (gated by _should_skip_current_refresh)
K. gap check (always)  + optional weekly gap repair (Monday flag)
L. validate
M. release lock
```

On duplicate-build fallback:

- The ~50 MB AllIdentifiers download is skipped.
- The ScryfallCatalogueIngestion (~185 MB) is skipped; a moved Scryfall
  bulk is logged with `scryfall.action='changed_deferred'` and picked
  up on the next primary run.
- `mtg_current_prices` refresh is skipped (already fresh from primary).
- The ~5-15 MB AllPricesToday download DOES happen — it's the source
  of truth for the target_date used by the guard.

Explicit overrides:

- `--force-current-price-refresh` — force the refresh even on duplicate build.
- `--force-identifier-delta` — force the identifier delta.
- `--force-scryfall-invoke` — force the Scryfall ingester even on duplicate.
- `--initial-current-price-population` — first-run wider 30-day refresh.

### Skip reasons

**`summary.current_prices.reason`** (when `skipped: true`):

- `skip_flag` — `--skip-current-refresh` passed.
- `no_prices_step` — no prices summary at all.
- `prices_step_skipped` — `--skip-prices` passed.
- `duplicate_build` — build-guard fired.
- `prices_step_errored` — prices step reported an error.
- `no_new_prices` — prices ran but inserted 0 rows (all conflicts).

**`summary.identifiers.reason`** (when `skipped: true`):

- `skip_flag` — `--skip-identifiers` passed.
- `no_prices_step` — prices summary missing (defensive).
- `prices_step_skipped` — `--skip-prices` passed.
- `duplicate_build` — build-guard fired; identifiers already up to date.
- `prices_step_errored` — prices step reported an error.

**`summary.scryfall.action`**:

- `unchanged` — Scryfall bulk metadata hasn't moved.
- `changed_pending` — moved; awaiting build-guard verdict.
- `invoked` — moved AND not duplicate → existing ingester ran.
- `changed_deferred` — moved BUT price build is duplicate → deferred
  to next primary run.
- `skipped_by_flag` — `--skip-scryfall` passed.
- `failed` — invocation raised.

## Retention

**No retention pruning in Stage 1D.** Raw history stays indefinite.
Retention/rollup is scoped after real disk-pressure measurement.

## Storage

### Measured

**Pending.** Run the queries in the "Post-migration first-day tasks"
section immediately after applying migrations. Save to
`reports/stage1d-baseline-storage.txt`. Until we have that anchor we
cannot answer "how much headroom on the 48 GB disk?" with confidence.

### Projected (from Stage 1C empirical density)

- Daily rows: ~727,000 (measured across 2026-09-04 → 2026-09-13).
- Bytes/row estimate: ~170 heap + ~160 indexes ≈ ~330 bytes/row.
- Daily growth: ~228 MB/day.
- Monthly: ~6.7-7.2 GB/month.
- Annual: ~80-90 GB/year at today's density.

Time to next resize depends on the measured current baseline. The
`StorageForecastMathTests` suite pins the daily/monthly/annual numbers;
any refactor that changes bytes-per-row must update the tests too.

### AllPrices file sizes (reference)

- Verified Stage 1C download of `AllPrices.json.gz`: **~149 MB
  compressed** (SHA `3e8eb1ec…`). Decompressed JSON is much larger.
- `AllPricesToday.json.gz`: smaller (single day's slice).
- `AllIdentifiers.json.gz`: ~50 MB compressed at time of Stage 1B.

## Rollback

- Migration `2026-09-15b`:
  ```sql
  DROP FUNCTION public.refresh_mtg_current_prices(INTEGER);
  DROP TABLE    public.mtg_current_prices;
  ```
- Migration `2026-09-15a`:
  ```sql
  DROP FUNCTION public.ensure_mtg_price_partition(DATE);
  DROP TABLE    public.mtg_daily_ingest_locks;
  ```
  Rolling back the partition helper leaves the pipeline unable to
  create the next month's partition; only do this when rolling back
  the entire Stage 1D deployment.
