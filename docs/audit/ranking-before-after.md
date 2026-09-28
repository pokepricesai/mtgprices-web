# MTG ranking outlier policy — before / after top-20

_Generated 2026-09-28T10:51:33.978Z from tcg_market_prices_current (mtg, USD)._

Policy: cross-source min-anchor ratio > **10x** (when ≥2 sources exist across TCGGraph + MTGJSON pipelines) OR historical 30d-median ratio > **20x** (when only one source exists). No global ceiling.

Residual class: genuinely single-source rows where both current and history mirror the same feed (e.g. commons priced $XX,XXX by only one marketplace with no independent second observation) cannot be flagged by either rule and require rarity-based heuristics — out of scope for Pass 2A.

## Before — raw top-20 (no policy)

| # | Card · Set · Finish · Source | Price |
|---|---|---|
| 1 | Living Artifact · 30A·501 · nonfoil · tcggraph.manapool | $237,559.44 |
| 2 | Black Lotus · LEA·232 · nonfoil · tcggraph.cardkingdom | $149,999.99 |
| 3 | Soul Net · SUM·275 · nonfoil · tcggraph.manapool | $98,972.52 |
| 4 | Black Lotus · LEA·232 · nonfoil · tcggraph.cardkingdom | $68,000 |
| 5 | Black Lotus · LEB·233 · nonfoil · tcggraph.cardkingdom | $35,000 |
| 6 | Smaug the Magnificent · HOB·249 · foil · tcggraph.cardkingdom | $32,999.99 |
| 7 | The Soul Stone · SPM·242 · foil · tcggraph.cardkingdom | $32,000 |
| 8 | Mox Sapphire · LEA·265 · nonfoil · tcggraph.cardkingdom | $22,999.99 |
| 9 | Smaug the Magnificent · HOB·249 · foil · tcggraph.tcgplayer | $22,250 |
| 10 | Time Walk · LEA·83 · nonfoil · tcggraph.cardkingdom | $21,999.99 |
| 11 | Ancestral Recall · LEA·47 · nonfoil · tcggraph.cardkingdom | $21,999.99 |
| 12 | Timetwister · LEA·84 · nonfoil · tcggraph.cardkingdom | $20,999.99 |
| 13 | Black Lotus · 2ED·233 · nonfoil · tcggraph.cardkingdom | $20,400 |
| 14 | Smaug the Magnificent · HOB·249 · foil · tcggraph.cardkingdom | $20,000 |
| 15 | Mox Jet · LEA·262 · nonfoil · tcggraph.cardkingdom | $19,999.99 |
| 16 | Mox Emerald · LEA·261 · nonfoil · tcggraph.cardkingdom | $17,999.99 |
| 17 | Volcanic Island · LEB·287 · nonfoil · tcggraph.cardkingdom | $17,499.99 |
| 18 | Timetwister · LEB·85 · nonfoil · tcggraph.cardkingdom | $16,999.99 |
| 19 | Underground Sea · LEA·285 · nonfoil · tcggraph.cardkingdom | $16,999.99 |
| 20 | Emrakul, the World Anew · MH3·381z · foil · tcggraph.manapool | $16,672 |

## After — top-20 that survive the policy

| # | Card · Set · Finish · Source | Price |
|---|---|---|
| 1 | Black Lotus · LEA·232 · nonfoil · tcggraph.cardkingdom | $149,999.99 |
| 2 | Soul Net · SUM·275 · nonfoil · tcggraph.manapool | $98,972.52 |
| 3 | Black Lotus · LEA·232 · nonfoil · tcggraph.cardkingdom | $68,000 |
| 4 | Black Lotus · LEB·233 · nonfoil · tcggraph.cardkingdom | $35,000 |
| 5 | Smaug the Magnificent · HOB·249 · foil · tcggraph.cardkingdom | $32,999.99 |
| 6 | The Soul Stone · SPM·242 · foil · tcggraph.cardkingdom | $32,000 |
| 7 | Mox Sapphire · LEA·265 · nonfoil · tcggraph.cardkingdom | $22,999.99 |
| 8 | Smaug the Magnificent · HOB·249 · foil · tcggraph.tcgplayer | $22,250 |
| 9 | Time Walk · LEA·83 · nonfoil · tcggraph.cardkingdom | $21,999.99 |
| 10 | Ancestral Recall · LEA·47 · nonfoil · tcggraph.cardkingdom | $21,999.99 |
| 11 | Timetwister · LEA·84 · nonfoil · tcggraph.cardkingdom | $20,999.99 |
| 12 | Black Lotus · 2ED·233 · nonfoil · tcggraph.cardkingdom | $20,400 |
| 13 | Smaug the Magnificent · HOB·249 · foil · tcggraph.cardkingdom | $20,000 |
| 14 | Mox Jet · LEA·262 · nonfoil · tcggraph.cardkingdom | $19,999.99 |
| 15 | Mox Emerald · LEA·261 · nonfoil · tcggraph.cardkingdom | $17,999.99 |
| 16 | Volcanic Island · LEB·287 · nonfoil · tcggraph.cardkingdom | $17,499.99 |
| 17 | Timetwister · LEB·85 · nonfoil · tcggraph.cardkingdom | $16,999.99 |
| 18 | Underground Sea · LEA·285 · nonfoil · tcggraph.cardkingdom | $16,999.99 |
| 19 | Emrakul, the World Anew · MH3·381z · foil · tcggraph.manapool | $16,672 |
| 20 | Mox Pearl · LEA·263 · nonfoil · tcggraph.cardkingdom | $14,999.99 |

## Excluded (top 2) — reason

| Card · Set · Finish · Source | Price | Verdict |
|---|---|---|
| Living Artifact · 30A·501 · nonfoil · tcggraph.manapool | $237,559.44 | EXCLUDED · cross-source (min-anchor $329.99, ratio 719.9x, sources=4) |
| Arixmethes, Slumbering Isle · MUL·162z · foil · tcggraph.manapool | $6,336.5 | EXCLUDED · cross-source (min-anchor $299.95, ratio 21.1x, sources=4) |