# Purchase-link + affiliate audit (Phase 3D, post sign-off)

## Verified URL schemes

| Provider    | URL scheme                                                    | Requires                                              | Ship-ready? |
| ----------- | ------------------------------------------------------------- | ----------------------------------------------------- | ----------- |
| Scryfall    | `https://scryfall.com/card/{scryfall_id}`                     | `mtg_printings.scryfall_id` (always present)          | ✅          |
| TCGplayer   | `https://www.tcgplayer.com/product/{tcgplayer_product_id}`    | `mtg_external_identifiers` row with `provider='tcgplayer'` and `identifier_type='product_id'` | ✅ where identifier ingested |
| Cardmarket  | `https://www.cardmarket.com/Magic/Products?idProduct=<id>`    | `mtg_external_identifiers` row with `provider='cardmarket'` and `identifier_type='product_id'` | ✅ where identifier ingested |
| Card Kingdom|,                                                             | No stored product ID / no stable programmatic URL     | ❌ omitted   |
| Manapool    |,                                                             | No stored product ID                                  | ❌ omitted   |
| Cardhoarder |,                                                             | Digital only, product ID not stored                   | ❌ omitted   |

The generator (`src/lib/mtg/purchase-links.ts`) emits ONLY the rows
for which a URL can be built deterministically. Nothing is guessed.

**Cardmarket URL note:** we use the documented `idProduct` redirect
pattern. The alternative `/en/Magic/Products/Singles/{id}` path is
NOT used because it requires the URL-name slug we do not have stored
and would fail deterministic construction.

## Current identifier coverage in production

Probed against production `mtg_external_identifiers` (2026-09-17):

```
total rows:       123,083
provider=mtgjson: 123,083   (MTGJSON UUIDs, not marketplace product IDs)
provider=tcgplayer:     0
provider=cardmarket:    0
provider=cardkingdom:   0
```

Stage 1D currently ingests only `provider='mtgjson' identifier_type='uuid'`
rows. TCGplayer and Cardmarket product IDs are present in MTGJSON's
per-card payload (`tcgplayerProductId`, `mcmId`) but are not currently
fanned out into `mtg_external_identifiers`. Until that changes, the
generator emits only Scryfall reference links.

That fan-out is a Stage 1D concern and is out of scope for Phase 3D
(per Luke's directive not to alter Stage 1D). Enabling it later is a
one-time backfill; no app changes required.

## Affiliate / referral programmes, status

**No affiliate tracking is active.** URL construction is fully
separated from affiliate decoration:

- `buildPurchaseLinksForOracle` produces plain, verified marketplace
  URLs.
- Per-provider decorator functions (`decorateTcgplayer`,
  `decorateCardmarket`) are wired but ARE NO-OPS today. They exist
  purely so tracking can be added later by editing that one function,
  with no change to the URL builder or the caller.
- The env vars `TCGPLAYER_PARTNER_ID` and `CARDMARKET_PARTNER_ID` are
  **not read anywhere** at present. Setting them does nothing until
  we ship verified decorators. That is deliberate, the previous
  design of "env var set ⇒ append ?partner=..." risked appending a
  parameter whose actual name/semantics we hadn't confirmed with the
  affiliate programme.

`PurchaseLink.affiliate` is therefore `false` on every emitted link
today.

## Action items required from Luke

Blocking affiliate tracking (non-blocking for Phase 3D itself):

1. **TCGplayer / Partnerize:** register mtgprices.io as a Partnerize
   affiliate. When approved, share the confirmed tracking-parameter
   name and semantics; `decorateTcgplayer` in `purchase-links.ts`
   will then be updated to append it, and the env var will be read.
   No redeploy of the platform is needed, only edit + release.
2. **Cardmarket:** confirm whether Cardmarket runs a deep-link
   affiliate programme and what the tracking parameter is. Same
   update path as above.
3. **Card Kingdom / Manapool / Cardhoarder:** these are omitted
   because we do not have stored product IDs. Add coverage by
   backfilling `mtg_external_identifiers` from a data source that
   maps Scryfall → each provider's SKU database. Guessing URLs is
   NOT an option.

## Provider-comparison guarantees

- `providerRows` on each `MissingLine` contains only real
  `(provider, currency, price_type, market)` combinations from
  `mtg_current_prices`.
- Rows are sorted with `currency` as the outer key: USD and EUR
  appear in separate blocks; within a currency, ascending price.
- A "cheapest" label is only ever applied within a single currency.

## No affiliate = no problem

If both `TCGPLAYER_PARTNER_ID` and `CARDMARKET_PARTNER_ID` are unset
(current state), URLs still get emitted and users can click through
to buy. `PurchaseLink.affiliate === false`, the UI is free to label
these as "outbound reference link" if desired. No revenue is
collected. Nothing is misrepresented.
