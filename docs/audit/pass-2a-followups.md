# Pass 2A follow-ups

Items surfaced during Pass 2A that were intentionally NOT addressed to keep the diff scoped.

## Pre-existing typecheck errors in `src/__tests__/card-seo-content-graded.test.tsx`

`npm run typecheck` reports 4 errors on both `main` HEAD and `mtg-quality-audit`, all in that single test file:

- Line 33: `Type '"market"' is not assignable to type '"retail" | "buylist"'` — the mock passes `price_type: 'market'` but `MtgCurrentPrice.price_type` is narrowed to `'retail' | 'buylist'` now.
- Lines 37-39: mocked `WindowStat` objects are missing `windowDays`, `start_price`, `latest_price`, `abs_delta`, `points`.

`next build` does not surface these because Next's build-time typecheck excludes `src/__tests__/` from its compile set. `vitest` continues to run the file with looser type checking.

**Not blocking Preview.** Correct fix is to update the test fixtures to match the current `MtgCurrentPrice` and `WindowStat` shapes. Out of scope for Pass 2A.

## Residual single-source outliers

The ranking policy has a residual class it cannot flag: printings where only one source exists across BOTH the TCGGraph and MTGJSON pipelines, AND that source has been reporting the same anomalous value for ≥30 days. The Soul Net SUM·275 $98,972 ManaPool row is the canonical example.

Neither the cross-source rule nor the historical-implausibility rule fires here — there is no second opinion, and the historical median mirrors the current price because both come from the same feed.

**Fix candidates for a later pass:**
1. Rarity-based sanity heuristic (a common in a non-vintage set > $1000 requires ≥2 sources or a sales-volume signal).
2. Ask TCGGraph upstream for a `sold_recently` / `sales_count_30d` field per source and demote listings-only rows below a volume threshold.
3. Cross-check against Scryfall's `prices.usd` which is periodically refreshed from TCGplayer market data.

## Graded UI honesty

`GradedPricesPanel` says "market estimates" without surfacing `card_sales_volume` or warning when a quote is essentially one unsold listing. The graded-extremes audit recommends adding a small volume pill + a "listing-based estimate" warning when history is flat + no volume. Out of scope for Pass 2A (data-quality copy change, not a functional fix).

## `Fable of the Mirror-Breaker`

The URL crawl found this specific name has no `mtg_oracle_cards` row — it is almost certainly stored under the full DFC composite `"Fable of the Mirror-Breaker // Reflection of Kiki-Jiki"`. Nothing broken; noting for the future if we ever add a name-resolution fallback that strips DFC halves.
