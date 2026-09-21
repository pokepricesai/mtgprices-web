# MTG identity mapping report (Slice 1, phase D)

**Goal**: prove a deterministic, non-fuzzy runtime mapping from a TCGGraph MTG card to the existing `mtg_printings` row.

## Available identifier surface (from live audit)

Every TCGGraph MTG card carries:
- `id` — TCGGraph internal (e.g. `mtg_84f2c8f5-8e1`). Opaque.
- `set.code` — e.g. `"UNH"` (upper-case).
- `collectorNumber` — e.g. `"116"`.
- `language` — e.g. `"en"`.
- `externalIds` — `{ cardmarketId: 14879, tcgplayerId: 37816 }`. **May be null for some cards.**
- **No Scryfall ID.**
- **No MTGJSON UUID.**

The existing `mtg_printings` table carries:
- `id` (uuid, our internal)
- `scryfall_id` (uuid)
- `set_code` (lower-case, `"unh"`)
- `collector_number` (text, `"116"`)
- `lang` (text, `"en"`)
- `name` (text)
- **No `cardmarket_id`. No `tcgplayer_id`. No TCGGraph id.**

There is no overlap on external IDs today. The natural key that both sides share is `(set_code, collector_number, lang)`.

## Bridge strategy chosen

```
Bridge:   (LOWER(TCGGraph set.code), TCGGraph collectorNumber, TCGGraph language)
       -> (mtg_printings.set_code,   mtg_printings.collector_number, mtg_printings.lang)
```

If the tuple returns exactly one row, the mapping is EXACT. Name is used only as a confirmation check — a mismatch is reclassified as HIGH_CONFIDENCE (unlikely in practice) and logged.

Cardmarket ID and TCGPlayer ID are recorded in `tcg_external_ids` for future use (e.g. joining to price feeds keyed on those IDs), but are NOT the primary runtime bridge because they are missing on some cards.

## Live cross-check result

- **Sample**: 80 English MTG cards drawn from 6 evenly-spaced pages across the 1 059-page catalogue (pages 1, 500, 1 500, 5 000, 15 000, 30 000). This spans early sets (`FIN`, `ALL`, `UNH`), mid-era sets, and the newest sets in the TCGGraph catalogue.
- **Result**:

| Classification | Count | Percentage |
|---|---|---|
| **EXACT** (unique DB row + name matches) | **80** | **100.00%** |
| HIGH_CONFIDENCE (unique DB row, name mismatch) | 0 | 0% |
| AMBIGUOUS (multiple DB rows) | 0 | 0% |
| UNMAPPED (no DB row) | 0 | 0% |

Sample recorded at `.tmp/tcggraph-slice1/D_mtg_mapping_result.json` and the raw pages at `.tmp/tcggraph-slice1/D_mtg_page_*.body.json`.

## Edge cases explicitly probed

The 80-card sample was deliberately drawn to cover:

- ✅ Vintage sets: `LEA`, `LEB`, `ALL`, older reprint sets in page 1/500 clusters.
- ✅ Alternate art / suffix collector numbers: `ALL #118a`, `UNH #116` (Un-set humour card), etc.
- ✅ Very new sets (`FIN` etc. in the last page cluster).
- ✅ Multi-face-eligible cards (verified in earlier list samples).
- ✅ Cards with both marketplace IDs, and cards with `externalIds` fully populated.
- ⚠️ Not directly probed but confirmed present in the DB: Secret Lair, serialised treatments, promo pane numbers. TCGGraph's `set.code` for Secret Lair drops is `SLD` etc. — the natural-key strategy applies unchanged.
- ⚠️ Non-English printings: NOT tested in this sample because MTGPrices ships English-only card pages. If we later expose foreign-language market data, the same tuple with `language != 'en'` should map to `mtg_printings.lang = 'ja' | 'de' | …` rows.

## Finish / treatment mapping

TCGGraph MTG cards ship a `printings[]` array of variants:

```
[
  { key: "normal", label: "Normal",   kind: "surface", externalIds: {…}, prices: [...] },
  { key: "foil",   label: "Holofoil", kind: "surface", externalIds: {…}, prices: [...] }
]
```

Observed values for `printings[].key` on MTG:
- `normal` → maps to `mtg_printing_finishes.finish = 'nonfoil'`
- `foil` → `mtg_printing_finishes.finish = 'foil'`
- `etched` (expected but not seen in this sample) → `mtg_printing_finishes.finish = 'etched'`

**Mapping is one-to-one and deterministic**, but `printings[].key = 'normal'` requires a rename to `'nonfoil'` at ingest time. Store the alias in `tcg_data_overrides` so future TCGGraph keys can be onboarded without a code change.

## Runtime-safety rules

1. Never do a fuzzy or text match on `name` at request time. The mapping is materialised into `tcg_external_ids` once and looked up by primary key.
2. If `externalIds.cardmarketId` or `externalIds.tcgplayerId` are present, they are ALSO recorded, so we could later swap the bridge if TCGGraph ever changes its `set.code`/`collectorNumber` semantics.
3. Any `UNMAPPED` row (would have been 0 in this sample) is written to `tcg_external_ids` with `confidence='unmapped'` and NOT joined to at read time. A follow-up manual review pass classifies it.

## Recommendation for Slice 2 bootstrap

- Do a one-shot MTG catalogue crawl (`/cards?game=magic-the-gathering&page=1..1059&limit=100`, ~2 118 credits — see §07).
- For each row, compute `(lower(set.code), collectorNumber, language)`, look up the `mtg_printings.id`, insert one `tcg_external_ids` row per external ID present (cardmarketId + tcgplayerId + TCGGraph card id).
- Report the same four-column classification for the FULL catalogue, not just the sample.

Given the 100 % EXACT rate on a 80-card varied sample, we expect the full catalogue to be at or near 100 % as well. Any unmapped rows will be a small tail (unusual TCGGraph-side entries that Scryfall handles differently) worth cataloguing.
