# MTGPrices canonical daily-price methodology

> **STATUS: DEFERRED — NOT APPROVED FOR STAGE 1D**
>
> This document was drafted during the initial Stage 1D scoping and was
> explicitly rejected by the 2026-09-15 rescope: creating a second
> permanent daily-price table at the raw table's cardinality doubles
> storage before there is any measured product/query requirement for
> it. The design is retained here as a record for possible later
> revival, but no code, migration, or scheduler in the active Stage 1D
> depends on it.
>
> Do not implement, reference, or infer approval from this document.

Version: `v1.0-draft` — 2026-09-15

## Purpose

MTGPrices' long-term daily price chart must remain trustworthy for years without retaining every raw provider observation forever. This document defines the deterministic methodology by which one representative "canonical" price is derived per `(printing_finish, day, market, currency)`.

The canonical value is stored in `mtg_price_daily_canonical` and is what the public price chart reads. It is intentionally simple, transparent, and re-derivable.

## Design constraints

1. **Never average incompatible values.** paper and mtgo prices are different products; retail and buylist are different concepts; USD and EUR are different currencies. No averaging across those dimensions.
2. **Provider policy respected.** A provider whose data we may not commercially derive from does not contribute to the *public* canonical series. It may still contribute to the *internal* canonical series.
3. **Deterministic + auditable.** Given the same input observations and provider policies, the same canonical value must be reproducible.
4. **Immutable once written.** Once a canonical row for a given `(printing_finish, day, market, currency, series_scope, methodology_version)` is stored, it is never overwritten. A methodology revision bumps `methodology_version` and stores the new series alongside.
5. **No carry-forward.** On days where no permitted provider has data, no canonical row is written for that day. Consumers plot the actual data points; gaps are visible as gaps.

## Series scopes

Two parallel series exist, distinguished by `series_scope`:

| `series_scope` | Contributing providers | Where it appears |
|---|---|---|
| `internal` | Any provider with `derived_use_internal = true` | AI reasoning, private admin dashboards, portfolio valuations for signed-in users when policy permits, internal analytics |
| `public` | Only providers with `derived_use_public = true` | Public card pages, sitemap-visible charts, public REST responses, RSS/data-feeds |

Both series are stored in the same table, differentiated only by `series_scope`. RLS gates public reads to `series_scope = 'public'`.

## Derivation — `v1.0`

For each `(printing_finish_id, observed_on, market, currency, series_scope)` tuple:

1. **Filter** `mtg_price_observations` rows matching:
   - `observed_on = <day>`
   - `market = <market>` (paper | mtgo | arena)
   - `currency = <currency>` (USD | EUR | TIX)
   - `price_type = 'retail'`
   - `is_anomalous = false`
   - `provider` such that:
     - For `series_scope='internal'`: `mtg_provider_policies.derived_use_internal = true`
     - For `series_scope='public'`: `mtg_provider_policies.derived_use_public = true`
2. **If zero rows** survive the filter → no canonical row is written for that tuple.
3. **If one row** survives → canonical `price = that row's price`; `sample_count = 1`.
4. **If two+ rows** survive → canonical `price = MEDIAN(price)`; `sample_count = n`.
   - Median is the classical statistical median. For `n=2` it is the mean of the two values.
   - Postgres `percentile_cont(0.5) WITHIN GROUP (ORDER BY price)`.
5. **`contributing_providers`** = alphabetically sorted array of the surviving providers.
6. **`methodology_version`** = `'v1.0'`.

### Rationale for median (not mean)

Median is robust to a single provider quoting a wildly stale or wildly aggressive price. In a 3-provider quorum, one outlier moves the mean substantially but not the median. Since our public series will typically involve 2-3 providers, median is the safer default.

### Rationale for retail only

Buylist prices (what dealers *pay*) are a different economic signal from retail. Long-term public charts should track sell-side (retail) so users comparing "what's this card worth" reason correctly. Buylist prices remain in `mtg_price_provider_weekly` / `mtg_price_provider_monthly` for deeper analytics.

### Rationale for excluding anomalies

`is_anomalous=true` observations are excluded to prevent a single erroneous provider spike from polluting the permanent record. If an anomaly is later cleared (`mtg_price_anomaly_flags.cleared_at IS NOT NULL`), a re-derivation may include it.

## Non-goals of `v1.0`

- **Currency conversion.** EUR-only observations produce a EUR canonical row; USD-only observations produce a USD canonical row. We do not convert. Future `v1.1` may introduce a canonical-USD series that folds EUR through a daily FX table.
- **Cross-provider volume weighting.** We do not weight by provider inventory / trade volume. Data isn't available consistently.
- **Foil-specific normalization.** Foil vs nonfoil is already separated by `printing_finish_id`. Etched is a distinct finish. Nothing more needed.
- **Historical smoothing.** We do NOT apply rolling averages or Kalman filters. The canonical series is per-day, discrete.

## Backfill semantics

The one-time backfill (part of Stage 1D deployment) will derive canonical rows for every day from `2026-06-15` (bootstrap start) to `2026-09-13` (last day in the current dataset), for both `series_scope='internal'` and `series_scope='public'` where permitted providers exist.

- Expected canonical row count after backfill:
  - Internal series: full coverage — all 89 days.
  - Public series: coverage depends on which providers ultimately end up with `derived_use_public=true`. If only Cardhoarder gets flipped, we have MTGO-only public coverage. If CardKingdom + ManaPool also flip after review, we have full paper US-retail coverage.

## Retention

`mtg_price_daily_canonical` is retained **indefinitely**. Yearly partitions (2026, 2027, …) can be moved to slower storage classes if needed, but never dropped.

Raw `mtg_price_observations` retention is separate — 90 days at full granularity, then rollup to `mtg_price_provider_weekly` / `mtg_price_provider_monthly` and the raw partition is dropped.

## Re-derivation policy

- The canonical values for a given `methodology_version` are frozen.
- If we ever change methodology (e.g. include volume weighting), we increment `methodology_version` to `v1.1`, `v2.0`, etc., and store the new series alongside `v1.0`. Consumers pin their series by `methodology_version`.
- Anomaly clearances that would change a historical canonical value are logged in `mtg_price_retention_log` and *may* trigger a targeted re-derivation. Default policy: **do not re-derive historical days**. Historical stability outweighs perfect accuracy on cleared anomalies.

## Testing

Automated tests must cover:

- Empty-input tuple → no row written.
- Single-provider tuple → price equals that provider's price.
- 2-provider tuple → price equals mean.
- 3-provider tuple with one outlier → price equals the middle value.
- Anomalous rows excluded.
- Wrong-market or wrong-currency rows excluded.
- `series_scope='public'` respects `derived_use_public`.

These are captured in `scripts/mtg_validate_golden.mjs` (Stage 1D validation harness).
