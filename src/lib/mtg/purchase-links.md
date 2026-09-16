# Purchase-link + affiliate audit (Phase 3D)

## What we can construct today

| Provider    | URL scheme                                                    | Requires                                              | Ship-ready? |
| ----------- | ------------------------------------------------------------- | ----------------------------------------------------- | ----------- |
| Scryfall    | `https://scryfall.com/card/{scryfall_id}`                     | `mtg_printings.scryfall_id` (always present)          | ✅          |
| TCGplayer   | `https://www.tcgplayer.com/product/{tcgplayer_product_id}`    | `mtg_external_identifiers` row `provider=tcgplayer`   | ✅ where identifier ingested |
| Cardmarket  | `https://www.cardmarket.com/en/Magic/Products/Singles/{id}`   | `mtg_external_identifiers` row `provider=cardmarket`  | ✅ where identifier ingested |
| Card Kingdom| —                                                             | No stored product ID / stable URL scheme              | ❌ omitted   |
| Manapool    | —                                                             | No stored product ID                                  | ❌ omitted   |
| Cardhoarder | —                                                             | Digital only; product ID not stored                   | ❌ omitted   |

The generator (`src/lib/mtg/purchase-links.ts`) emits ONLY the rows for
which a URL can be built deterministically. Never guessed.

## Coverage note

Whether TCGplayer/Cardmarket product IDs are already present in
`mtg_external_identifiers` depends on how Stage 1C ingestion has been
run. Rows without identifiers simply won't include those provider
links. This degrades gracefully — the UI shows whichever links do
resolve.

## Affiliate / referral programmes — status

I have NOT confirmed any active affiliate account for MTGPrices as of
this audit. The generator supports the following env-var toggles so
you can turn tracking on without a redeploy the moment a programme is
registered:

| Env var                  | Effect when set                                                              |
| ------------------------ | ---------------------------------------------------------------------------- |
| `TCGPLAYER_PARTNER_ID`   | Appends `?partner=<id>` to every TCGplayer product URL                       |
| `CARDMARKET_PARTNER_ID`  | Appends `?utm_source=<id>` to every Cardmarket product URL                   |

**Both are unset in production.** No affiliate URLs are being emitted
today. Setting them is a no-code operation once the programmes are
approved.

## Action items required from Luke

Blocking affiliate tracking (non-blocking for Phase 3D itself — the
platform ships without it):

1. **TCGplayer / Partnerize:** register mtgprices.io as a Partnerize
   affiliate. The current published partner URL scheme is
   `https://www.tcgplayer.com/product/<id>?partner=<partner-id>` — I
   cannot verify the exact parameter name from public documentation
   right now, so once the account is approved please confirm the
   correct query-parameter format so I can adjust `purchase-links.ts`
   before setting `TCGPLAYER_PARTNER_ID`.
2. **Cardmarket:** apply for the Cardmarket affiliate programme.
   Confirm whether deep links are supported and what the tracking
   parameter is. Update the generator if the scheme differs from the
   speculative `utm_source` fallback shipped today.
3. **Card Kingdom / Manapool / Cardhoarder:** these are omitted
   because we do not have stored product IDs. Two options if we want
   coverage:
     a) Backfill `mtg_external_identifiers` from an ingest that maps
        Scryfall → each provider's SKU database.
     b) Fall back to Card Kingdom's card-search URL — this is a
        card-specific *search* not a *product* link, so it's
        acceptable but less direct. Currently omitted per Luke's
        "never guess URLs" directive.

## Provider-comparison guarantees (relevant to purchasing)

- The provider-comparison rowset (`shopping.ts` → `providerRows`)
  contains ONLY real `(provider, currency, price_type, market)`
  combinations from `mtg_current_prices`.
- Currencies are never blended. Rows are sorted with `currency` as
  the outer key so USD and EUR appear in separate blocks; within a
  currency, ascending price.
- A "cheapest" label at the SUITE level is only applied within a
  single currency.

## No affiliate = no problem

If both `TCGPLAYER_PARTNER_ID` and `CARDMARKET_PARTNER_ID` are unset:

- URLs still get emitted (users can click through to buy).
- `PurchaseLink.affiliate === false` — the UI can label these as
  "outbound reference link" if we want.
- No revenue is collected. Nothing is misrepresented.
