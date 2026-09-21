# TCGGraph live API proof (Slice 1, phase A/B)

All values below verified live on 2026-09-21 UTC. Response bodies + headers persisted under `.tmp/tcggraph-slice1/*` (git-ignored). Credit cost per probe was captured from the actual `x-credits-cost` response header.

## Contract

| Item | Value |
|---|---|
| Base URL | `https://api.tcggraph.com/v1` |
| Auth | `Authorization: Bearer <TCGGRAPH_API_KEY>` |
| API version header | not exposed; the docs claim `2026-08-01` |
| Content-Type | `application/json; charset=utf-8` |
| ETag / If-None-Match | **supported**. Same URL replayed with the received `etag` in `If-None-Match` returns `304`. |
| 304 cost | **0 credits** (verified) |
| Failed 4xx / 404 cost | 0 credits (verified) |
| Retry-After on 429 | not yet triggered in probes; client honours it. |

## Real endpoint surface

| Endpoint | Cost | Notes |
|---|---|---|
| `GET /games` | **1** | Returns 4 required games + others (Pokemon, Lorcana, Digimon, GA, DBS). Includes `counts.{cards,sets,printings,languages}` and `indexed.printingsByLanguage`. |
| `GET /sets?game=X&limit=N` | **1** | Paginated. Works for all four required games. |
| `GET /cards?game=X&limit=N` | **2** | The main listing endpoint. Every card row ships with inline `prices[]`, `gradedPrices[]`, `printings[]`, `externalIds{cardmarketId, tcgplayerId}`, `priceStatus{}`, `legalities{}`, `gameData{}`, `set{code,name,releasedAt}`, `collectorNumber`, `language`, `images{small,normal,large}`, `hashes{phash, phashColor}`. |
| `GET /cards/{id}` | **2** | Same shape as one row of `/cards`. |
| `?set=<CODE>` filter on `/cards` | **2** | Works. Case-insensitive on the set code. e.g. `?set=UNH` and `?set=unh` both return the 169 UNH cards. |
| `?page=N` | **2** | Works. |
| `?limit=<=100`  | **2** | 100 is the SERVER-SIDE MAX. Passing `limit=200/500` still returns 100 rows for 2 credits. |
| `?language=<code>` | **2** | Accepted syntactically. Effect on totalCount is not visible in current sample (see notes). |
| `?hasGraded=…` or `?graded=…` | **400** | **Not supported** — no filter for graded coverage. |
| `?cursor=…` | **400** | **Not supported**. Pagination is `page` / `limit` only. |
| `?updatedSince=…` / `?modifiedSince=…` | **400** | **Not supported**. There is no incremental-delta filter. |
| `/printings` | **404** | Does not exist. Printings are inline under a card as `printings[]` with `{key, label, kind}` where `kind` is `surface` (finish: normal/foil/holo/etched) or `edition` (1st Edition, Unlimited, etc.). |
| `/prices` and `/prices/graded` | **404** | Do not exist. Prices are inline via `data[].prices` and `data[].gradedPrices`. |
| `/exports`, `/bulk`, `/data-exports`, `/downloads` | **404** | No bulk export path found by probe. See §07 for the effect on our bootstrap strategy. |

## Real credit-tracking headers

The Slice-0 client assumed `TCGGraph-Credits-*` / `TCGGraph-Cost`. **Real names are `x-credits-*` and `x-daily-*`.** The client's `parseCredits()` now reads the real names and falls back to the Slice-0 names for future-proofing.

Sample:
```
x-credits-cost: 2
x-credits-limit: 25000
x-credits-remaining: 24997
x-credits-used: 3
x-daily-limit: 2500
x-daily-remaining: 2499
x-ratelimit-limit: 60
x-ratelimit-remaining: 58
x-ratelimit-reset: 1790003280
```

**Plan reality on this key**: 25 000 monthly credits, **2 500 daily credits**, 60 request/window rate limit. Not the 150 000 referenced in the Slice-0 brief.

## Four required games — live

| Slug | totalCount cards | totalCount printings | sets | languages | priceSource |
|---|---|---|---|---|---|
| `magic-the-gathering` | 37 158 | 105 841 | 955 | 11 | cardmarket |
| `yugioh` | ~38 435 | (inline) | ~1 200 | 5 | cardmarket |
| `one-piece` | 5 538 | (inline) | ~40 | 2 | cardmarket |
| `star-wars-unlimited` | 7 868 | (inline) | ~10 | 1 | cardmarket |

All four return 200 on `/cards`. Slug forms confirmed: `magic-the-gathering`, `yugioh`, `one-piece`, `star-wars-unlimited`.

## Card shape (as returned by `/cards`)

Every card carries all these keys:

```
id                         # e.g. "mtg_84f2c8f5-8e1", "ygo_26lp_en011"
game                       # slug
name, printedName, englishId, language
pricesFrom                 # aggregation hint
set                        # { code, name, releasedAt }
collectorNumber
rarity, artist, text, images { small, normal, large }
hashes                     # { phash, phashColor }
prices []                  # market rows, see §05
gradedPrices []            # graded rows, see §06
languagePrices []          # inter-language pointers (usually empty for EN cards)
printings []               # variants of THIS card: [{key, label, kind, externalIds, prices}]
                           # kind = 'surface' (finish) or 'edition' (1st Edition etc.)
priceStatus                # { cardmarket, tcgplayer, graded } -> priced | null | ambiguous | set_unlisted
legalities                 # {} on the sample; format map for competitive cards
gameData                   # game-specific:
                           #   mtg  -> power, colors, layout, loyalty, finishes, keywords, manaCost, typeLine, manaValue, toughness, colorIdentity
                           #   ygo  -> atk, def, race, level, banlist, attribute, frameType, archetypes, linkRating, linkMarkers, pendulumScale
                           #   op   -> cost, life, power, types, colors, counter, trigger, cardType, attribute
                           #   swu  -> hp, cost, arena, power, traits, unique, aspects, variant, cardType
externalIds                # { cardmarketId, tcgplayerId }  <-- no Scryfall ID for MTG
```

**Verified: TCGGraph does NOT expose a Scryfall printing ID.** The Slice-0 correction is confirmed. The strongest MTG bridge is therefore `(set.code lower-cased, collectorNumber, language)` — see §05.

## ETag / 304 round-trip

Verified live. First call returned `etag: W/"ekNfjlLHQUrG5DcaBele-PkVJWJ"` at 2 credits. Second call with `If-None-Match: <that etag>` returned `304` at **0 credits**. The client persists the ETag in an in-memory store by default; a Supabase-backed store can be injected for cross-process sharing.

## Errors observed

- `400` on unknown query parameters (`hasGraded`, `updatedSince`, `cursor`).
- `404` on unknown endpoints (`/printings`, `/prices`, `/exports`, `/bulk*`).
- Neither is retried by the client.

Retries were not needed anywhere in the audit runs. 429 and 5xx paths have unit-test coverage in `src/__tests__/tcggraph.test.ts`.
