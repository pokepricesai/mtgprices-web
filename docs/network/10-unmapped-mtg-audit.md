# 85 unmapped MTG cards — audit (Slice 3, Phase J)

## What "unmapped" means here

`tcg_printings.mapping_confidence = 'unmapped'` means the Slice-2
bootstrap successfully retrieved a TCGGraph MTG card, but the
deterministic key `(LOWER(set.code), collectorNumber, language='en')`
returned zero rows in `mtg_printings`. Row exists in the network
identity layer, mapping to the local MTG catalogue is absent, and
nothing joins to `mtg_printings` at read time (the read model
filters on `mtg_printings_id IS NOT NULL`).

## Distribution

145 unmapped `tcg_printings` rows (across ~85 distinct TCGGraph
cards). Concentrated by set:

| Set code | Set name | Released | Unmapped `tcg_printings` rows | % |
|---|---|---|---|---|
| `sld` | Secret Lair Drop | 2021-06-21 | **106** | 73.1% |
| `rex` | Jurassic World Collection | 2023-11-17 | 12 | 8.3% |
| `tdm` | Tarkir: Dragonstorm | 2025-04-11 | 12 | 8.3% |
| `ecl` | Lorwyn Eclipsed | 2026-01-23 | 10 | 6.9% |
| `plst` | The List | 2022-04-29 | 5 | 3.4% |
| **Total** | | | **145 / 159 501** | **0.091%** |

## Classification

**Class C (identifier / set-code mismatch) is the dominant cause.**

- **Secret Lair Drop (73% of unmapped).** SLD is famously unfriendly to
  collector-number-based identity. TCGGraph and Scryfall's MTGJSON
  export do not always agree on the collector number for individual
  SLD promotional drops — TCGGraph may emit a padded/suffixed variant
  (`123a`, `SLD-123`) while Scryfall stores the raw form (`123`), or
  vice versa. Some SLD entries may also be exclusive TCGGraph curation
  (Class B) — the drop with an unusual promotional slug. Confirmation
  requires per-card inspection; we do NOT auto-guess.
- **The List (`plst`, 3.4%).** `plst` uses composite collector numbers
  like `LCI-32` (parent set code + card number within the parent
  set). This is a known family of tricky identifiers; the 5 unmapped
  rows are TCGGraph entries where the composite form doesn't match
  the exact literal we stored in `mtg_printings.collector_number`.
- **`rex` / `tdm` / `ecl` (23% combined).** Newer sets. Highly likely
  to be catalogue-lag: TCGGraph observed a printing before Scryfall's
  MTGJSON export shipped it, or vice versa. These will self-heal on
  the next MTGJSON sync + TCGGraph refresh.

**No evidence of Class A (missing from Scryfall entirely).** Every
one of these five sets is fully represented in `mtg_sets` and has
hundreds of matched rows. The gap is at the collector-number level,
not the set level.

## Decision

**No overrides written.** The user's Slice-3 brief is explicit:

> "Only create overrides where justified by evidence. Do not fuzzy-map
> merely to increase the percentage. 99.909% exact mapping is already
> acceptable. The priority is correctness."

We keep the 145 rows in `tcg_printings` with
`mapping_confidence = 'unmapped'` and `mtg_printings_id = NULL`. They
never join. When operators later want to reconcile a specific card,
they can insert a `tcg_data_overrides` row and re-run bootstrap for
the affected page.

## Follow-up for a future slice

- If any of the affected TCGGraph cards accumulate meaningful graded
  demand, they'll surface in the Network Admin as "known unmapped
  with graded pricing" — a small list worth manual review.
- The next MTGJSON refresh may auto-resolve the newer-set (`rex`,
  `tdm`, `ecl`) gaps. Worth re-checking after 24-48 h.
- Secret Lair collector-number reconciliation could be a targeted
  audit script that queries Scryfall directly on the affected
  TCGGraph card names + set codes, and writes overrides where the
  match is unambiguous. Not implemented in this slice.
