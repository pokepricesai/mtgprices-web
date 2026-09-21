# Credit model (Slice 1, phase G + H)

## Measured facts

| Endpoint | Cost per call | Rows per call |
|---|---|---|
| `/games` | **1** | up to ~10 |
| `/sets?game=X` | **1** | up to `limit` (server-side max not confirmed; likely 100) |
| `/cards?game=X[&set=Y][&page=N][&limit=M]` | **2** | **max 100 rows** (server caps `limit` at 100) |
| `/cards/{id}` | **2** | 1 |
| Any 4xx/404 | **0** | — |
| **304 replay via `If-None-Match`** | **0** | 0 (cached body returned) |

## Plan reality (this key)

```
x-credits-limit:    25,000  (monthly)
x-daily-limit:       2,500  (rolling per day)
x-ratelimit-limit:      60  (per short window)
```

Not the 150 000 mentioned in the Slice-0 brief. Model below assumes **25 000 monthly / 2 500 daily**. If the plan is later upgraded, the safety margin grows proportionally.

## Per-game catalogue sweep cost

`/cards` returns 100 rows / 2 credits. Sweep cost = `ceil(printings ÷ 100) × 2`.

| Game | Indexed printings (en) | Pages | Full sweep credits |
|---|---|---|---|
| MTG | 105 841 | 1 059 | **2 118** |
| YGO | ~38 000 (of ~38 435 total) | 380 | **760** |
| One Piece | 5 538 | 56 | **112** |
| SWU | 7 868 | 79 | **158** |
| **Total per sweep** | ~157 000 | 1 574 | **3 148** |

`/sets` per game is negligible (~1 credit each, 4 games → 4 credits).

## Model A — everything daily (rejected)

`3 148 × 30 ≈ 94 440 credits/month`. **377 % of the 25 000 allowance.** Infeasible on this plan. Also violates the 2 500/day hard cap on the days where a full MTG sweep alone (2 118) is close to the ceiling.

## Model B — recommended tiering

Tier A **daily** for the small games (SWU + OP): fresh prices matter more; catalogue is tiny.
Tier B **every 3 days** for YGO: mid-size catalogue; graded/market shifts slower than a modern SWU set.
Tier C **weekly** for MTG: full sweep on Sundays; graded specifically is a low-velocity data source and MTGJSON already covers our headline market prices. TCGGraph's marginal MTG value is graded, which barely moves week-to-week.

Monthly:

| Tier | Games | Cost per sweep | Sweeps / month | Monthly credits |
|---|---|---|---|---|
| A daily | OP + SWU | 112 + 158 = 270 | 30 | **8 100** |
| B every 3 days | YGO | 760 | 10 | **7 600** |
| C weekly | MTG | 2 118 | 4.3 | **9 107** |
| **Total** | — | — | — | **24 807** |

Against 25 000 that's a **~1 % safety margin. Too tight.** Any single-sweep miss forces a catch-up run that would breach the plan.

## Model C — recommended tiering with MTG graded-only optimisation

Since TCGGraph's marginal MTG value is graded pricing (market prices duplicate MTGJSON), we can drop MTG's weekly cost by narrowing the sweep to sets that actually have graded coverage or to a monthly cadence instead of weekly.

Two levers:

1. **MTG monthly instead of weekly**: `2 118 × 1 = 2 118 credits/month`.
2. **MTG bootstrap once, incremental never**: MTG's graded prices for older cards move slowly. If we sweep once per month and additionally sweep only *sets released in the last 60 days* daily (small subset), the marginal cost per day is a handful of pages.

Recommended for launch: **MTG monthly full + 3-day partial for MTG new sets**.

Rough numbers, with MTG monthly-only:

| Tier | Games | Cost/sweep | Sweeps/month | Monthly credits |
|---|---|---|---|---|
| A daily | OP + SWU | 270 | 30 | 8 100 |
| B every 3 days | YGO | 760 | 10 | 7 600 |
| D monthly | MTG (full) | 2 118 | 1 | 2 118 |
| E every 3 days | MTG new sets only (~50 sets × ~200 cards each = ~10 000 cards) | 200 | 10 | 2 000 |
| **Total** | — | — | — | **19 818** |

**Against 25 000: 5 182 credits headroom (20.7 %).** That is the recommended launch policy.

If TCGGraph confirms the plan is actually the 150 000-credit variant, headroom on Model B trivially expands to `(150 000 – 24 807) / 150 000 = 83.5 %`. Either way, tiering is what makes it viable; daily-everything is not.

## Daily-cap check

`x-daily-limit: 2 500`. Biggest single-day event in Model C:
- OP + SWU + YGO (on a YGO day) + MTG new-set: 270 + 760 + 200 = **1 230 credits**. Fits.
- MTG full monthly sweep alone: **2 118 credits**. Fits.
- MTG full sweep on the same day as everything else: exceeds 2 500. Schedule these on different days (calendar coordination — trivial).

## Historical backfill allowance

The `/cards` response has no `history[]` array. Historical price snapshots are built by us running the daily/weekly sweeps and writing rows into `tcg_market_price_daily` / `tcg_graded_price_daily`. There is no separate credit cost for history — it's just the accumulated cost of the ongoing sweeps.

Bootstrap month cost ≈ `24 807` (Model B) or `19 818` (Model C). No extra allocation needed for backfill.

## Bulk export path

No `/exports`, `/bulk`, `/downloads`, `/data-exports`, `/data/download`, `/bulk-catalogs`, `/bulk-exports` endpoint responded. If TCGGraph offers bulk export on a separate host or via a different path, ask them directly — otherwise plan to bootstrap via paginated REST.

**Bootstrap cost via paginated REST (four games at once):** `1 574 pages × 2 credits = 3 148 credits`. That's a single-day operation if we spread it (still under the 2 500/day cap with modest care — schedule MTG on one day, the other three games the next).

## 304 optimisation caveat

304 is free (verified). However, `/cards` responses embed daily-changing price data, so their ETag WILL rotate every day. 304 optimisation therefore does not reduce ongoing price-refresh costs. It IS useful for `/games` (rarely changes) and possibly `/sets` (rare changes). Include ETag storage in the client (already done) but don't budget savings against it.

## Recommendation

Adopt **Model C**: OP + SWU daily, YGO every 3 days, MTG monthly-full + 3-day for new sets. **Total ≈ 19 818 credits/month, ~20.7 % safety margin.** Reserve the remaining 5 000+ credits for ad-hoc backfills, retries, and headroom for the two new games we haven't launched yet (planning already reserves capacity).

Do not activate any of this in Slice 1. This is the plan for Slice 2.
