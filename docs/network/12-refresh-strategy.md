# Refresh strategy for the launch-4 network

Applies from Slice 4. All schedules below are **proposals** - the
Vercel cron endpoint stays disabled (`TCGGRAPH_CRON_ENABLED=false`)
until an operator explicitly enables it.

## Constants

- **TCGGraph Starter plan**: 25 000 credits / month, 2 500 / day.
- **Historical price API**: does not exist. Every day of history is
  a day we ran the refresh (see Slice 4 report).
- **Endpoint costs**: `/games`=1, `/sets`=1, `/cards`=2 per 100-row
  page, `/cards/{id}`=1-2.
- **Daily reserve**: refuse to spend below 100 credits/day (bootstrap
  script enforces this).

## Full-catalogue costs (measured this slice)

| Game | Cards | Pages | Credits |
|---|---:|---:|---:|
| One Piece | 5 538 | 56 | 112 |
| Disney Lorcana | 3 198 | 32 | 64 |
| Yu-Gi-Oh | 38 435 | 385 | 770 |
| Magic: The Gathering | 105 841 | 1 056 | 2 112 |

## Recommended recurring refresh (Slice 4 proposal)

### Daily (highest volatility, smallest catalogues)

- **Disney Lorcana** - full refresh daily. **64 credits / day**.
  Rationale: small catalogue, high graded coverage in progress
  (12.9% and growing), premium treatments (Enchanted/Epic/Iconic)
  volatile.
- **One Piece** - full refresh daily. **112 credits / day**.
  Rationale: small catalogue, 68% slab coverage means graded
  markets move noticeably.

Daily subtotal: **176 credits / day** for these two.

### Every 2-3 days initially

- **Yu-Gi-Oh** - full refresh every 3 days initially. **770 / 3
  = 257 credits / day (average)**. Move to daily later once
  operators have observed how much of that data actually shifts.

Combined so far: **433 credits / day average**. Well within the
2 500 daily / 25 000 monthly budget.

### MTG - split strategy

MTG's 2 112-credit full pass is 84% of our daily budget. We do NOT
run a full MTG pass daily.

- **Full MTG catalogue**: every 7-14 days. **2 112 / 10 = ~211
  credits / day** amortised.
- **New / recent MTG sets** (last 90 days): daily. Estimated
  20-40 sets * ~5 pages each = 100-200 pages = 200-400 credits.
  Use `?set=<code>` query filter (see `cron/tcggraph-refresh`
  route's `set` param).
- **High-value MTG subset**: daily. Curated list of the top ~500
  chase cards by market price. Use `/cards/{id}` (1-2 credits
  each) = 500-1 000 credits. Only enable this once the priority
  queue in Section "History-refresh queue" below is live.

### Star Wars: Unlimited - not scheduled

Disabled. Bring back when the sixth-site plan is greenlit.

### Overall daily budget after Lorcana bootstrap

| Track | Credits / day |
|---|---:|
| Lorcana daily full | 64 |
| One Piece daily full | 112 |
| YGO every 3 days | 257 |
| MTG full every 10 days | 211 |
| MTG new-set daily | 300 |
| MTG high-value curated (optional) | 500 |
| **Total (headroom)** | **1 444 / 2 500** |

Leaves **~1 000 credits / day** free for on-demand refreshes,
error recovery, admin panel refreshes, and future history-queue
enrichment.

## Cron gating

Nothing in this document changes cron status:

- `TCGGRAPH_CRON_ENABLED` = **false** (default).
- Endpoint: `/api/cron/tcggraph-refresh`.
- Requires `Authorization: Bearer $CRON_SECRET`.
- When disabled: HTTP 202 `{ reason: 'cron_disabled' }`.
- When enabled + authorised: HTTP 202 `{ accepted: true, scheduled: false }` (worker not yet wired; see Slice 5+).

Operators enable this in Vercel by setting the env var and confirming
the reserved credit budget above still holds.
