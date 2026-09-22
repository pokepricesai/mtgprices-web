# History-refresh queue - design (not activated)

Slice 4 Phase I. This document defines the queue but does **not**
implement or activate it. Nothing here runs today.

## Framing

TCGGraph v1 has no historical price endpoint (see Slice 4 report).
The only way to populate `tcg_market_price_daily` /
`tcg_graded_price_daily` is to observe a price today and store it.

So the "history-refresh queue" is not a backfill queue - there is
nothing to backfill. It is a **forward-looking refresh prioritiser**
that decides, given a daily credit budget, which cards get refreshed
today and which wait until tomorrow. Cards refreshed today gain a
data point; cards deferred lose today permanently.

Every card gets refreshed eventually via the full-catalogue passes
in `docs/network/12-refresh-strategy.md`. The queue exists to buy
**more granular history for the cards that matter**.

## Priority score inputs

For each `tcg_printing_id`, compute a score once per day:

1. **Organic traffic** - view count on the corresponding public
   page in the last 7 days (from Vercel Analytics / GA).
2. **Search Console impressions** - impressions in the last 30
   days for the page.
3. **Card market value** - current `tcg_market_prices_current.price`
   (max across sources).
4. **Graded quote exists** - boolean; +1 tier if the printing has
   any `grader != 'raw'` row.
5. **Sales volume** - `card_sales_volume` from
   `tcg_graded_prices_current` (proxy for real trading activity).
6. **User portfolio ownership** - once portfolios ship, count of
   users currently holding this printing.
7. **Large recent price movement** - 7-day price change vs 30-day
   average; large moves get boosted.
8. **Chase / iconic status** - hand-curated flag on card types
   like Lorcana Iconic, MTG Reserved List, YGO Ghost Rare, OP
   Manga Rare. Uses `tcg_data_overrides` field=`chase_flag`.
9. **Editorial importance** - operator-set flag for cards
   featured in editorial content.

All inputs are optional; missing signals contribute 0. The score
is a weighted sum stored on a new `tcg_refresh_priority` table
(spec below).

## Score decay / avoidance

- Cards refreshed within the last 24h get a huge negative bias so
  the queue does not pick the same card twice.
- Cards not refreshed in 14 days get a positive freshness boost so
  the long tail still gets a data point occasionally.

## Table (proposed - not created yet)

```sql
CREATE TABLE public.tcg_refresh_priority (
  tcg_printing_id   text NOT NULL PRIMARY KEY
    REFERENCES public.tcg_printings(id) ON DELETE CASCADE,
  game_id           text NOT NULL,
  score             numeric NOT NULL,
  last_refreshed_at timestamptz,
  next_earliest_at  timestamptz,
  reason            jsonb NOT NULL DEFAULT '{}'::jsonb,
  computed_at       timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ON public.tcg_refresh_priority (game_id, score DESC, last_refreshed_at NULLS FIRST);
```

## Worker contract

- Runs at most once per day (Vercel Cron).
- Reads `x-daily-remaining` on every response; refuses to keep
  going once daily remaining drops below **500 credits** (i.e.
  higher reserve than the bootstrap's 100 - we want live refresh
  budget to remain healthy).
- Reads `x-credits-remaining` and refuses to keep going once
  **monthly remaining is below 5 000 credits**.
- Never touches full-catalogue passes; those run on their own
  schedule.
- Picks the top-N scores from `tcg_refresh_priority` that satisfy
  `next_earliest_at <= now()`, then fetches each via
  `GET /cards/{id}` (1-2 credits each).
- Writes to `tcg_market_prices_current`, `tcg_graded_prices_current`
  AND appends to the `_daily` tables. Never bypasses the shared
  ingest library.
- Updates `last_refreshed_at` and `next_earliest_at` (24h
  cooldown) on the picked rows.
- On any TCGGraph error other than 200, records to
  `tcg_ingest_runs.errors` and stops for the day.

## Safety invariants

- **Live pricing takes priority over history granularity**. The
  worker must not run if the current scheduled full-catalogue
  refresh has failed today or is running.
- **No feature flag flip runs the worker in production**. The
  worker only starts when `TCGGRAPH_CRON_ENABLED=true` **and**
  `TCGGRAPH_HISTORY_QUEUE_ENABLED=true` (both default false).
- **Never enrich cards without market value**. If
  `tcg_market_prices_current.price IS NULL`, skip.
- **Cap per game**: no single game can consume more than 40% of
  the daily credit budget through this queue.

## When to activate

Do not activate this queue before:

1. Full-catalogue refresh has been running cleanly for 7
   consecutive days (i.e. Vercel Cron is on and stable).
2. Search Console + Analytics integration exists so score inputs
   are real, not stubs.
3. The read model on at least one launch site (MTG) is using
   `tcg_market_price_daily` for a "30-day trend" chart, so we
   can validate the extra granularity actually shows up in the
   UI.

Until then this document is the spec, and the priority table is
absent.
