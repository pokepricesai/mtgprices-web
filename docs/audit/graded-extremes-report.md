# MTG graded-price extremes audit

- Generated: 2026-09-28T09:51:47.236Z
- Scope: top 20 `tcg_graded_prices_current` rows for `game_id='mtg'` and `currency='USD'`
- History window: last 30 rows in `tcg_graded_price_daily` per (printing, grader, grade, currency)
- Read-only. No mutations issued.

## 1. Columns available for listings-vs-sales distinction

### `tcg_graded_prices_current`

| column | type |
|---|---|
| `tcg_printing_id` | string |
| `game_id` | string |
| `grader` | string |
| `grade` | string |
| `currency` | string |
| `price` | number |
| `card_sales_volume` | number |
| `updated_at` | string |
| `ingested_at` | string |
| `source_run_id` | string |
| `attribution` | string |
| `tcg_card_id` | string |

### `tcg_graded_price_daily`

| column | type |
|---|---|
| `tcg_printing_id` | string |
| `observed_on` | string |
| `grader` | string |
| `grade` | string |
| `currency` | string |
| `game_id` | string |
| `price` | number |
| `card_sales_volume` | number |
| `source_run_id` | string |
| `attribution` | string |
| `tcg_card_id` | string |

**Interpretation:**

- `card_sales_volume` present on current: YES
- Explicit "listing vs sale" flag column present: NO — no boolean/enum discriminator exists
- TCGGraph's upstream payload only carries `{grader, grade, currency, price, salesVolume, updatedAt}`. There is no per-quote 'sold' vs 'listed' flag from the provider. Our schema therefore cannot make the distinction either — we can only *infer* it from `card_sales_volume` (aggregate) and from history movement.

## 2. Top-20 rows

| # | Card | Set | Coll# | Finish | Grader | Grade | Price (USD) | sales_vol | distinct 30d | stddev 30d | classification | confidence |
|---|---|---|---|---|---|---|---:|---:|---:|---:|---|---|
| 1 | Black Lotus | LEA | 232 | nonfoil | bgs | 10 | $2,870,660.00 | 9 | 2/3 | 1297464.58 | minor drift (2 distinct prices) — likely re-listed / re-priced, not confirmed sales | medium |
| 2 | Black Lotus | LEA | 232 | nonfoil | psa | 10 | $2,208,200.00 | 9 | 2/3 | 998049.64 | minor drift (2 distinct prices) — likely re-listed / re-priced, not confirmed sales | medium |
| 3 | The One Ring | LTR | 748z | foil | raw | ungraded | $2,000,000.00 | 1 | 1/1 | 0.00 | flat price but sales_volume > 0 — possibly a thin-market anchor | low-medium |
| 4 | Black Lotus | LEA | 232 | nonfoil | sgc | 10 | $1,324,920.00 | 9 | 2/3 | 598829.88 | minor drift (2 distinct prices) — likely re-listed / re-priced, not confirmed sales | medium |
| 5 | Black Lotus | LEA | 232 | nonfoil | cgc | 10 | $1,324,920.00 | 9 | 2/3 | 598829.88 | minor drift (2 distinct prices) — likely re-listed / re-priced, not confirmed sales | medium |
| 6 | Taiga | LEA | 282 | nonfoil | bgs | 10 | $221,396.00 | 10 | 1/1 | 0.00 | flat price but sales_volume > 0 — possibly a thin-market anchor | low-medium |
| 7 | Taiga | LEA | 282 | nonfoil | psa | 10 | $170,304.58 | 10 | 1/1 | 0.00 | flat price but sales_volume > 0 — possibly a thin-market anchor | low-medium |
| 8 | Taiga | LEA | 282 | nonfoil | sgc | 10 | $102,183.00 | 10 | 1/1 | 0.00 | flat price but sales_volume > 0 — possibly a thin-market anchor | low-medium |
| 9 | Taiga | LEA | 282 | nonfoil | cgc | 10 | $102,183.00 | 10 | 1/1 | 0.00 | flat price but sales_volume > 0 — possibly a thin-market anchor | low-medium |
| 10 | Black Lotus | LEA | 232 | nonfoil | any | 9.5 | $83,615.00 | 9 | 2/3 | 86.27 | minor drift (2 distinct prices) — likely re-listed / re-priced, not confirmed sales | medium |
| 11 | Black Lotus | LEA | 232 | nonfoil | any | 9 | $76,013.56 | 9 | 2/3 | 78.47 | minor drift (2 distinct prices) — likely re-listed / re-priced, not confirmed sales | medium |
| 12 | Black Lotus | LEA | 232 | nonfoil | any | 8 | $70,000.00 | 9 | 1/3 | 0.00 | flat price but sales_volume > 0 — possibly a thin-market anchor | low-medium |
| 13 | Black Lotus | LEA | 232 | nonfoil | raw | ungraded | $57,469.00 | 9 | 2/3 | 3992.58 | minor drift (2 distinct prices) — likely re-listed / re-priced, not confirmed sales | medium |
| 14 | Black Lotus | LEA | 232 | nonfoil | any | 7 | $56,000.00 | 9 | 1/3 | 0.00 | flat price but sales_volume > 0 — possibly a thin-market anchor | low-medium |
| 15 | Taiga | LEA | 282 | nonfoil | any | 9.5 | $50,000.00 | 10 | 1/1 | 0.00 | flat price but sales_volume > 0 — possibly a thin-market anchor | low-medium |
| 16 | Black Lotus | 2ED | 233 | nonfoil | any | 9.5 | $49,054.82 | 45 | 2/3 | 0.01 | minor drift (2 distinct prices) — likely re-listed / re-priced, not confirmed sales | medium |
| 17 | Black Lotus | LEB | 233 | nonfoil | any | 9.5 | $48,168.00 | 13 | 1/3 | 0.00 | flat price but sales_volume > 0 — possibly a thin-market anchor | low-medium |
| 18 | The Soul Stone | SPM | 242 | foil | bgs | 10 | $45,500.00 | 12 | 1/1 | 0.00 | flat price but sales_volume > 0 — possibly a thin-market anchor | low-medium |
| 19 | Black Lotus | LEB | 233 | nonfoil | any | 9 | $43,789.00 | 13 | 1/3 | 0.00 | flat price but sales_volume > 0 — possibly a thin-market anchor | low-medium |
| 20 | Nightmare | LEA | 118 | nonfoil | any | 9.5 | $42,877.00 | 9 | 1/1 | 0.00 | flat price but sales_volume > 0 — possibly a thin-market anchor | low-medium |

## 3. Per-row detail

### 1. Black Lotus [LEA #232] — bgs 10

- Current price: **$2,870,660.00**
- `card_sales_volume`: 9
- History rows: 3, distinct prices: 2, stddev: 1297464.58
- Classification: minor drift (2 distinct prices) — likely re-listed / re-priced, not confirmed sales  _(confidence: medium)_
- 30d price range: $118,322.00 — $2,870,660.00
- Oldest observation in window: 2026-09-21 @ $118,322.00
- Newest observation in window: 2026-09-27 @ $2,870,660.00
- Attribution: `printing`  &middot;  tcg_printing_id: `mtg:print:mtg_b0faa7f2-b54:normal:en`

### 2. Black Lotus [LEA #232] — psa 10

- Current price: **$2,208,200.00**
- `card_sales_volume`: 9
- History rows: 3, distinct prices: 2, stddev: 998049.64
- Classification: minor drift (2 distinct prices) — likely re-listed / re-priced, not confirmed sales  _(confidence: medium)_
- 30d price range: $91,017.00 — $2,208,200.00
- Oldest observation in window: 2026-09-21 @ $91,017.00
- Newest observation in window: 2026-09-27 @ $2,208,200.00
- Attribution: `printing`  &middot;  tcg_printing_id: `mtg:print:mtg_b0faa7f2-b54:normal:en`

### 3. The One Ring [LTR #748z] — raw ungraded

- Current price: **$2,000,000.00**
- `card_sales_volume`: 1
- History rows: 1, distinct prices: 1, stddev: 0.00
- Classification: flat price but sales_volume > 0 — possibly a thin-market anchor  _(confidence: low-medium)_
- 30d price range: $2,000,000.00 — $2,000,000.00
- Oldest observation in window: 2026-09-21 @ $2,000,000.00
- Newest observation in window: 2026-09-21 @ $2,000,000.00
- Attribution: `printing`  &middot;  tcg_printing_id: `mtg:print:mtg_4e6fee52-33a:foil:en`

### 4. Black Lotus [LEA #232] — sgc 10

- Current price: **$1,324,920.00**
- `card_sales_volume`: 9
- History rows: 3, distinct prices: 2, stddev: 598829.88
- Classification: minor drift (2 distinct prices) — likely re-listed / re-priced, not confirmed sales  _(confidence: medium)_
- 30d price range: $54,610.00 — $1,324,920.00
- Oldest observation in window: 2026-09-21 @ $54,610.00
- Newest observation in window: 2026-09-27 @ $1,324,920.00
- Attribution: `printing`  &middot;  tcg_printing_id: `mtg:print:mtg_b0faa7f2-b54:normal:en`

### 5. Black Lotus [LEA #232] — cgc 10

- Current price: **$1,324,920.00**
- `card_sales_volume`: 9
- History rows: 3, distinct prices: 2, stddev: 598829.88
- Classification: minor drift (2 distinct prices) — likely re-listed / re-priced, not confirmed sales  _(confidence: medium)_
- 30d price range: $54,610.00 — $1,324,920.00
- Oldest observation in window: 2026-09-21 @ $54,610.00
- Newest observation in window: 2026-09-27 @ $1,324,920.00
- Attribution: `printing`  &middot;  tcg_printing_id: `mtg:print:mtg_b0faa7f2-b54:normal:en`

### 6. Taiga [LEA #282] — bgs 10

- Current price: **$221,396.00**
- `card_sales_volume`: 10
- History rows: 1, distinct prices: 1, stddev: 0.00
- Classification: flat price but sales_volume > 0 — possibly a thin-market anchor  _(confidence: low-medium)_
- 30d price range: $221,396.00 — $221,396.00
- Oldest observation in window: 2026-09-21 @ $221,396.00
- Newest observation in window: 2026-09-21 @ $221,396.00
- Attribution: `printing`  &middot;  tcg_printing_id: `mtg:print:mtg_60df6592-0b3:normal:en`

### 7. Taiga [LEA #282] — psa 10

- Current price: **$170,304.58**
- `card_sales_volume`: 10
- History rows: 1, distinct prices: 1, stddev: 0.00
- Classification: flat price but sales_volume > 0 — possibly a thin-market anchor  _(confidence: low-medium)_
- 30d price range: $170,304.58 — $170,304.58
- Oldest observation in window: 2026-09-21 @ $170,304.58
- Newest observation in window: 2026-09-21 @ $170,304.58
- Attribution: `printing`  &middot;  tcg_printing_id: `mtg:print:mtg_60df6592-0b3:normal:en`

### 8. Taiga [LEA #282] — sgc 10

- Current price: **$102,183.00**
- `card_sales_volume`: 10
- History rows: 1, distinct prices: 1, stddev: 0.00
- Classification: flat price but sales_volume > 0 — possibly a thin-market anchor  _(confidence: low-medium)_
- 30d price range: $102,183.00 — $102,183.00
- Oldest observation in window: 2026-09-21 @ $102,183.00
- Newest observation in window: 2026-09-21 @ $102,183.00
- Attribution: `printing`  &middot;  tcg_printing_id: `mtg:print:mtg_60df6592-0b3:normal:en`

### 9. Taiga [LEA #282] — cgc 10

- Current price: **$102,183.00**
- `card_sales_volume`: 10
- History rows: 1, distinct prices: 1, stddev: 0.00
- Classification: flat price but sales_volume > 0 — possibly a thin-market anchor  _(confidence: low-medium)_
- 30d price range: $102,183.00 — $102,183.00
- Oldest observation in window: 2026-09-21 @ $102,183.00
- Newest observation in window: 2026-09-21 @ $102,183.00
- Attribution: `printing`  &middot;  tcg_printing_id: `mtg:print:mtg_60df6592-0b3:normal:en`

### 10. Black Lotus [LEA #232] — any 9.5

- Current price: **$83,615.00**
- `card_sales_volume`: 9
- History rows: 3, distinct prices: 2, stddev: 86.27
- Classification: minor drift (2 distinct prices) — likely re-listed / re-priced, not confirmed sales  _(confidence: medium)_
- 30d price range: $83,432.00 — $83,615.00
- Oldest observation in window: 2026-09-21 @ $83,432.00
- Newest observation in window: 2026-09-27 @ $83,615.00
- Attribution: `printing`  &middot;  tcg_printing_id: `mtg:print:mtg_b0faa7f2-b54:normal:en`

### 11. Black Lotus [LEA #232] — any 9

- Current price: **$76,013.56**
- `card_sales_volume`: 9
- History rows: 3, distinct prices: 2, stddev: 78.47
- Classification: minor drift (2 distinct prices) — likely re-listed / re-priced, not confirmed sales  _(confidence: medium)_
- 30d price range: $75,847.09 — $76,013.56
- Oldest observation in window: 2026-09-21 @ $75,847.09
- Newest observation in window: 2026-09-27 @ $76,013.56
- Attribution: `printing`  &middot;  tcg_printing_id: `mtg:print:mtg_b0faa7f2-b54:normal:en`

### 12. Black Lotus [LEA #232] — any 8

- Current price: **$70,000.00**
- `card_sales_volume`: 9
- History rows: 3, distinct prices: 1, stddev: 0.00
- Classification: flat price but sales_volume > 0 — possibly a thin-market anchor  _(confidence: low-medium)_
- 30d price range: $70,000.00 — $70,000.00
- Oldest observation in window: 2026-09-21 @ $70,000.00
- Newest observation in window: 2026-09-27 @ $70,000.00
- Attribution: `printing`  &middot;  tcg_printing_id: `mtg:print:mtg_b0faa7f2-b54:normal:en`

### 13. Black Lotus [LEA #232] — raw ungraded

- Current price: **$57,469.00**
- `card_sales_volume`: 9
- History rows: 3, distinct prices: 2, stddev: 3992.58
- Classification: minor drift (2 distinct prices) — likely re-listed / re-priced, not confirmed sales  _(confidence: medium)_
- 30d price range: $48,999.46 — $57,469.00
- Oldest observation in window: 2026-09-21 @ $48,999.46
- Newest observation in window: 2026-09-27 @ $57,469.00
- Attribution: `printing`  &middot;  tcg_printing_id: `mtg:print:mtg_b0faa7f2-b54:normal:en`

### 14. Black Lotus [LEA #232] — any 7

- Current price: **$56,000.00**
- `card_sales_volume`: 9
- History rows: 3, distinct prices: 1, stddev: 0.00
- Classification: flat price but sales_volume > 0 — possibly a thin-market anchor  _(confidence: low-medium)_
- 30d price range: $56,000.00 — $56,000.00
- Oldest observation in window: 2026-09-21 @ $56,000.00
- Newest observation in window: 2026-09-27 @ $56,000.00
- Attribution: `printing`  &middot;  tcg_printing_id: `mtg:print:mtg_b0faa7f2-b54:normal:en`

### 15. Taiga [LEA #282] — any 9.5

- Current price: **$50,000.00**
- `card_sales_volume`: 10
- History rows: 1, distinct prices: 1, stddev: 0.00
- Classification: flat price but sales_volume > 0 — possibly a thin-market anchor  _(confidence: low-medium)_
- 30d price range: $50,000.00 — $50,000.00
- Oldest observation in window: 2026-09-21 @ $50,000.00
- Newest observation in window: 2026-09-21 @ $50,000.00
- Attribution: `printing`  &middot;  tcg_printing_id: `mtg:print:mtg_60df6592-0b3:normal:en`

### 16. Black Lotus [2ED #233] — any 9.5

- Current price: **$49,054.82**
- `card_sales_volume`: 45
- History rows: 3, distinct prices: 2, stddev: 0.01
- Classification: minor drift (2 distinct prices) — likely re-listed / re-priced, not confirmed sales  _(confidence: medium)_
- 30d price range: $49,054.82 — $49,054.85
- Oldest observation in window: 2026-09-21 @ $49,054.85
- Newest observation in window: 2026-09-27 @ $49,054.82
- Attribution: `printing`  &middot;  tcg_printing_id: `mtg:print:mtg_4a2e428c-dd2:normal:en`

### 17. Black Lotus [LEB #233] — any 9.5

- Current price: **$48,168.00**
- `card_sales_volume`: 13
- History rows: 3, distinct prices: 1, stddev: 0.00
- Classification: flat price but sales_volume > 0 — possibly a thin-market anchor  _(confidence: low-medium)_
- 30d price range: $48,168.00 — $48,168.00
- Oldest observation in window: 2026-09-21 @ $48,168.00
- Newest observation in window: 2026-09-27 @ $48,168.00
- Attribution: `printing`  &middot;  tcg_printing_id: `mtg:print:mtg_b3a69a1c-c80:normal:en`

### 18. The Soul Stone [SPM #242] — bgs 10

- Current price: **$45,500.00**
- `card_sales_volume`: 12
- History rows: 1, distinct prices: 1, stddev: 0.00
- Classification: flat price but sales_volume > 0 — possibly a thin-market anchor  _(confidence: low-medium)_
- 30d price range: $45,500.00 — $45,500.00
- Oldest observation in window: 2026-09-21 @ $45,500.00
- Newest observation in window: 2026-09-21 @ $45,500.00
- Attribution: `printing`  &middot;  tcg_printing_id: `mtg:print:mtg_2c3df372-09d:foil:en`

### 19. Black Lotus [LEB #233] — any 9

- Current price: **$43,789.00**
- `card_sales_volume`: 13
- History rows: 3, distinct prices: 1, stddev: 0.00
- Classification: flat price but sales_volume > 0 — possibly a thin-market anchor  _(confidence: low-medium)_
- 30d price range: $43,789.00 — $43,789.00
- Oldest observation in window: 2026-09-21 @ $43,789.00
- Newest observation in window: 2026-09-27 @ $43,789.00
- Attribution: `printing`  &middot;  tcg_printing_id: `mtg:print:mtg_b3a69a1c-c80:normal:en`

### 20. Nightmare [LEA #118] — any 9.5

- Current price: **$42,877.00**
- `card_sales_volume`: 9
- History rows: 1, distinct prices: 1, stddev: 0.00
- Classification: flat price but sales_volume > 0 — possibly a thin-market anchor  _(confidence: low-medium)_
- 30d price range: $42,877.00 — $42,877.00
- Oldest observation in window: 2026-09-21 @ $42,877.00
- Newest observation in window: 2026-09-21 @ $42,877.00
- Attribution: `printing`  &middot;  tcg_printing_id: `mtg:print:mtg_b8cdd6a7-f77:normal:en`

## 4. Aggregate signal

- Smells like a listing (flat, no volume): 0/20
- Shows sales-like movement: 0/20
- Flat price WITH some sales volume: 12/20
- Minor drift (2 distinct prices): 8/20

## 5. Frontend terminology check

- `src/components/mtg/GradedPricesPanel.tsx` labels the surface "Graded card prices" and describes them as **"market estimates for professionally graded copies of this exact printing where sufficient market data is available."** The UI does NOT claim these are confirmed sales. It also does NOT say "listings", and it does not surface `card_sales_volume`. A viewer sees only a price + a "last update N days ago" pill.
- `src/app/set/[setCode]/card/[cardSlug]/page.tsx` is the only route that renders the panel and it passes the TCGGraph bundle straight through — no extra copy claiming "sold for" or "sales history".
- Verdict: the UI does not lie, but it does not warn either. A $200k+ number with no sales-volume caveat can easily be read by a user as "this is the going rate" when it may be one seller's ask that has never transacted.

## 6. Recommendations (no code changes yet)

1. Surface `card_sales_volume` alongside every graded cell — even a small "N sales / period" pill is enough to let users spot thin-market anchors.
2. When `card_sales_volume` is 0/null AND the daily history shows a flat price for ≥14 days, either suppress the row or annotate it with "listing-based estimate — no recent sales observed".
3. Consider a server-side sanity threshold: if the current price is more than 10× the raw price AND `card_sales_volume` is null/0, flag the row rather than display it in the hero grid.
4. Add an admin-only 'graded outliers' view that runs this same query on a schedule so we notice new $200k+ ghost anchors when TCGGraph ingests them.
5. Long-term: ask TCGGraph if their gradedPrices payload can expose a `priceKind` (`listing` vs `sale`) or a `salesCount` per grade tier. Without that, we are always inferring.
