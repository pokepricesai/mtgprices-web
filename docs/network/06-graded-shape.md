# Graded pricing shape (Slice 1, phase E + F)

Verified against live TCGGraph responses for MTG, YGO, One Piece, and SWU. Source data: `.tmp/tcggraph-slice1/E_graded_by_game.json`.

## Payload

Each card returned by `/cards` carries a `gradedPrices[]` array. Field shape:

```json
{
  "grader":       "raw" | "any" | "psa" | "bgs" | "cgc" | "sgc",
  "grade":        "ungraded" | "7" | "8" | "9" | "9.5" | "10" | ...,
  "currency":     "USD" | "EUR" | ...,
  "price":        4299,
  "salesVolume":  112,
  "updatedAt":    "2026-09-21T09:35:19.365Z"
}
```

Additional signal on the parent card:
```
priceStatus.graded  =  "priced" | "set_unlisted" | null
```

## Observed coverage

| Game | Cards sampled | With ≥1 non-raw graded quote | Comment |
|---|---|---|---|
| Magic: The Gathering | 200 | 8 quickly found by page-scan | Strong coverage on cards with real market interest (chase cards, valuable printings, tournament staples). The default `raw` row exists on essentially every card as an ungraded market snapshot. |
| Yu-Gi-Oh! | 200 | 8 quickly found | Comparable coverage. `grader='any'` is used more often for lower grades (7, 8, 9, 9.5) with grader-specific rows (`psa`, `bgs`, `cgc`, `sgc`) generally reserved for grade 10. |
| One Piece | 200 | 8 quickly found | Solid on OP06+ and ST-series cards. |
| Star Wars: Unlimited | 200 | **0 non-raw found** | Consistent with the game's age (public launch 2024) - the graded market has not developed at scale. `priceStatus.graded` is typically `null` on SWU cards. Design the pipeline to tolerate this. |

## Graders observed

- `raw` — the always-present ungraded market row (this is really the raw-cardmarket price, not a graded quote per se).
- `any` — cross-grader aggregate at lower grades where the grader-specific market is thin.
- `psa` — grade 10 dominant.
- `bgs` — grade 10 dominant.
- `cgc` — grade 10 dominant.
- `sgc` — grade 10 dominant.

## Grades observed

- `ungraded` (with `grader='raw'`).
- `7`, `8`, `9`, `9.5`, `10` — as text strings, not numeric. Storing as `text` in our schema keeps half-grades and future value like `'Auth'` or `'MP'` from breaking.

## Currency

USD in every sample. TCGGraph's marketplace default is `cardmarket` (EUR-native) for the paginated response, but the `gradedPrices[]` block is normalised to USD on all four games in the sample.

## `salesVolume` caveat

**Important**: `salesVolume` is identical across all `gradedPrices[]` rows on the same card. It's a per-card total volume, not per-grader/per-grade. Do not fan it out.

## `updatedAt` caveat

`updatedAt` is also identical across all rows for a given card in the same batch. Treat it as a per-card refresh timestamp, not a per-quote observation timestamp.

## Recommended internal schema

Aligns with `docs/network/01-shared-schema-proposal.md` §`tcg_graded_prices_current`. Refinements from Slice 1:

```sql
CREATE TABLE tcg_graded_prices_current (
  tcg_printing_id text NOT NULL REFERENCES tcg_printings(id),
  game_id         text NOT NULL REFERENCES tcg_games(id),
  grader          text NOT NULL,     -- 'raw'|'any'|'psa'|'bgs'|'cgc'|'sgc' as observed; add-on discovery goes here
  grade           text NOT NULL,     -- 'ungraded'|'7'|'8'|'9'|'9.5'|'10' etc.
  currency        char(3) NOT NULL,
  price           numeric(12,4) NOT NULL,
  card_sales_volume int,             -- per-card total, NOT per-grader
  status          text,              -- carry-over of priceStatus.graded when applicable
  observed_on     date NOT NULL,
  refreshed_at    timestamptz NOT NULL DEFAULT now(),
  source_run_id   uuid REFERENCES tcg_ingest_runs(id),
  PRIMARY KEY (tcg_printing_id, grader, grade, currency)
);
CREATE INDEX ON tcg_graded_prices_current (game_id);
```

Notes:
- **Absence = no data.** Never impute $0 for a missing (grader, grade) combination.
- Grader `raw` is stored the same as any other. UI code that wants "the raw market price" already has `tcg_market_prices_current` for it; the `raw` row in graded is redundant and can be filtered out at read time.
- The polymorphic `ref_table` design from Slice 0 is dropped in favour of `tcg_printing_id`. Reasoning in `docs/network/08-final-shared-schema.md`.

## History

TCGGraph's paginated response does not carry per-day graded history. There is no observed `history[]` field on the graded row. Historical graded backfill is therefore only feasible if TCGGraph exposes it via a separate endpoint we haven't yet found (see §07 bulk export note). For now, plan to accumulate history in-house by writing daily snapshots into `tcg_graded_price_daily`.
