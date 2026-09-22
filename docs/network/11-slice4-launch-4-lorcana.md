# Slice 4 - launch-4 network + Disney Lorcana

## Launch scope

The five-site public launch is now:

1. **PokePrices** (Pokemon) - already live, untouched by this project.
2. **MTGPrices** (magic-the-gathering)
3. **Yu-Gi-Oh!** (yugioh)
4. **One Piece Card Game** (one-piece)
5. **Disney Lorcana** (disney-lorcana)

**Star Wars: Unlimited** remains registered in `tcg_games` (id `swu`)
and its schema support is intact, but it is **not part of the initial
launch**. It is a future sixth-site candidate. Nothing was renamed,
deleted, or repurposed.

## Verified Lorcana shape (live TCGGraph, 2026-09-22)

| Field | Value |
|---|---|
| slug | `disney-lorcana` |
| logical cards | 3 198 |
| sets | 23 |
| physical printings | 6 076 |
| Lorcana-specific `gameData` fields (100% populated) | `ink`, `lore`, `inkCost`, `inkable`, `version`, `cardType`, `moveCost`, `strength`, `willpower`, `classifications` |
| printing keys observed | `normal`, `foil` |
| rarities observed | Common, Uncommon, Rare, Super rare, Enchanted, Promo, Legendary, Epic, Iconic |
| market sources | `tcggraph.cardmarket` (EUR/EU), `tcggraph.tcgplayer` (USD/NA) |
| graders observed | `raw`, `any`, `psa`, `bgs`, `cgc`, `sgc` |
| grades observed | 10, 9.5, 9, 8, 7, ungraded |

Bootstrap cost: **64 credits** for the full catalogue (32 pages at 2 credits each).

## Logical card vs physical printing vs premium treatment

Lorcana's data model in this project follows the shared TCG schema
unchanged, and this is what the user asked for - premium treatments
are **not merged** into ordinary printings.

| Concept | Where it lives |
|---|---|
| Logical card (name + set + collector number + version) | `tcg_cards` |
| Base vs Enchanted / Epic / Iconic (rarity tier) | **Separate `tcg_cards` row** - TCGGraph gives each treatment its own `card.id`, and we honour that. |
| Physical printing (finish / edition variant) | `tcg_printings` - one row per `(card, printing.key, language)`. |
| `normal` vs `foil` finish | Separate `tcg_printings` rows for the same card. |
| Language variant | Separate `tcg_printings` row via `language` column. |
| Lorcana game data (ink, cost, etc.) | `tcg_cards.gamedata` jsonb, verbatim from provider. |

So the Enchanted 224-card cohort, the Epic 90-card cohort and the
Iconic 10-card cohort each get **their own logical card** and their
own `normal` + `foil` printings, priced independently. This matches
the collector-first requirement: a collector can compare the market
price of each physical version separately.

## Actual graded coverage (2026-09-22)

Slabbed = grader IN (`any`, `psa`, `bgs`, `cgc`, `sgc`); grader='raw' is
NOT slab.

- Slabbed rows: **3 957**
- **Distinct slabbed printings: 785 / 6 076 = 12.92%**
- Raw rows: 2 997 (each on a distinct printing)
- Grader distribution among slab rows: any 1 434, cgc 658, sgc 626, bgs 620, psa 619
- Grade distribution among slab rows: 10 = 2 523, 9.5 = 582, 9 = 548, 8 = 236, 7 = 68

Graded pricing is **materially useful** on Lorcana - 12.92% of
printings have real slabbed pricing, with distinct BGS-10, PSA-10,
CGC-10 and SGC-10 quotes, plus fallback `any` grades for 9.5 / 9 /
8 / 7. Enchanted / Epic / Iconic / Promo tiers concentrate at the
top of the graded distribution, reaching $35 000 (Promo BGS-10 "A
Whole New World") and $12 888 (Iconic PSA-10 "Mickey Mouse - Brave
Little Prince").

## Market price sources

Both US (tcgplayer NA / USD) and European (cardmarket EU / EUR)
sources exist for every observed printing. Every market row is
`retail` list type; TCGGraph does not currently emit a `buylist`
line on Lorcana.

Per-market-source fields observed:
`source, region, listType, finish, currency, market, low, trend,
avg1, avg7, avg30, updatedAt`. Same shape as MTG / OP / YGO.

## Yu-Gi-Oh bootstrap (this slice)

Completed 2026-09-22 08:23-08:33 UTC.

- 38 435 logical cards
- 86 141 physical printings
- 100 306 market rows current
- 236 942 graded rows current (includes 33 569 raw rows and 203 373 slab rows)
- 770 credits used
- 385 pages processed
- stop reason: `catalogue_exhausted`

## Star Wars: Unlimited

- Not bootstrapped in this slice - conserving credits and no
  urgency until the sixth-site plan.
- Row in `tcg_games` remains: `swu` / `star-wars-unlimited` /
  Star Wars: Unlimited.
- Status view surfaces it under `FUTURE / INACTIVE`.

## Historical API - not available on TCGGraph v1

We probed 18 URL variants across MTG / YGO / OP / Lorcana at ~8
credits total. Every history-flavoured path returns 404. The only
endpoints TCGGraph v1 exposes are:

- `GET /games` (1 credit)
- `GET /sets` (1 credit)
- `GET /cards` (2 credits per 100-row page)
- `GET /cards/{id}` (1-2 credits)

Query params like `include=history`, `fields=priceHistory`, `from`,
`to`, `withHistory` are silently ignored on `/cards/{id}`; the
response is the current snapshot only.

**Consequence**: historical prices in `tcg_market_price_daily` /
`tcg_graded_price_daily` will only ever contain days we observed
via our own refresh. There is no retroactive backfill. Every day
of history is a day we ran the refresh. See
`docs/network/12-refresh-strategy.md` for the refresh cadence that
this implies.

Raw probe results (nine primary variants + nine follow-up variants)
are persisted under `.tmp/history-probe/findings.json`.

## Cron status

`TCGGRAPH_CRON_ENABLED` remains `false` (Slice 3 default). The
Vercel cron endpoint returns HTTP 202 `{ reason: 'cron_disabled' }`
until an operator opts in.
