# MTG unmapped-printings classification — Pass 2A

_Generated 2026-09-28 from `scripts/audit-unmapped-printings.mjs`._

## Authoritative counts

Three legitimate definitions of "unmapped MTG printings" exist. Only definition C is used for the Pass 2A ranking-risk conversation.

| Definition | Filter | Count |
|---|---|---:|
| A. All unmapped | `tcg_printings.game_id='mtg' AND mtg_printings_id IS NULL` | **145** |
| B. With any market row | A + at least one `tcg_market_prices_current` row (any currency) | **140** |
| C. With a USD market row | A + at least one `tcg_market_prices_current` (currency='USD') | **137** |

Definition C is the ranking-relevant slice — the earlier context's "137" refers to C.

The three prior-report figure of "134" reflected a snapshot 30-40 minutes earlier; three additional SLD rows landed between the audit-agent run and this reconcile. Feed churn only, not a definitional error.

The gap A→C (145 → 137) is:
- 5 rows with no market row at all (definition A only)
- 3 rows with non-USD-only market rows (all in `sld`)

## Set breakdown (definition C = 137 rows)

| set_code | rows | still unresolved by A/B/C joins |
|---|---:|---:|
| sld  | 103 | 103 |
| tdm  |  12 |  12 |
| rex  |  12 |  12 |
| ecl  |  10 |  10 |
| **total** | **137** | **137** |

## Join resolution (A / B / C)

Attempted joins on 137 unmapped rows:

- **A — `tcgplayer_id` peer-borrow**: 0 hits (no mapped sibling shares the same TCGplayer id).
- **B — `cardmarket_id` peer-borrow**: 0 hits.
- **C — `(set_code, collector_number, lang)` → `mtg_printings`**: 0 hits.

Zero of 137 resolve. Root cause: TCGGraph is ahead of the MTGJSON → Scryfall ingest for the listed sets. `mtg_printings` simply does not contain rows with these collector numbers yet.

Schema clarification: the earlier task briefing mentioned a `mtg_external_ids` table. That table does not exist. The real table is `tcg_external_ids` (mapping to `tcg_cards.id`, not to `mtg_printings.id`), which is why join A/B were rewritten as peer-borrow within `tcg_printings`.

## Top-3 highest-priced UNRESOLVED rows (do NOT silently delete)

Preserved verbatim from `docs/audit/unmapped-printings-report.csv`.

| price (USD) | set·num | tcg_printing_id | tcgplayer_id | cardmarket_id | finish |
|---:|---|---|---|---|---|
| **$1,771.40** | sld·745 | `mtg:print:mtg_9cd6a16f-1ef:foil:en` | 518241 | 750289 | foil |
| **$799.99**   | sld·747 | `mtg:print:mtg_94594d48-b72:foil:en` | 518235 | 750291 | foil |
| **$520.98**   | sld·746 | `mtg:print:mtg_4696f5de-fe5:foil:en` | 517502 | 750290 | foil |

## Recommendation

Do **not** delete or blank these rows. The correct remediation is to wait for the upstream Scryfall / MTGJSON ingest to add the missing `mtg_printings` rows, then re-run a remap. If a temporary user-facing hide is needed, gate on `mtg_printings_id IS NOT NULL` at read time — never delete `tcg_printings` rows that carry live market price data.

Follow-up: the reconcile script `scripts/audit-unmapped-count-reconcile.mjs` reprints A / B / C counts on demand and should be re-run periodically to confirm feed churn is trending down (implies MTGJSON catching up).
