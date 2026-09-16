# MTGPrices product roadmap

Last updated 2026-09-16. This document is the **permanent** direction for
MTGPrices beyond the current in-flight phase. Anything picked up from
here should be scoped in a subsequent brief before implementation.

---

## Product philosophy

MTGPrices is both a **collector/pricing product** and a
**gameplay/deck product**. Pricing/collecting and gameplay are both
first-class parts of MTGPrices — neither is a bolt-on. Design decisions
should prefer keeping both audiences native to the same product.

The AI surface is retrieval-grounded over the live DB and **must not
invent** cards, rules, legality, prices, printings or format bans. Every
answer maps to a row that exists.

---

## Phased delivery

### Phase 1 — Data & Pricing Infrastructure  *(complete)*

- Scryfall + MTGJSON catalogue ingest (`mtg_sets`, `mtg_oracle_cards`,
  `mtg_printings`, `mtg_printing_finishes`, `mtg_oracle_legalities`,
  `mtg_rulings`, `mtg_external_identifiers`).
- Stage 1C historical pricing (`mtg_price_observations`).
- Stage 1D daily incremental pricing (`mtg_current_prices`) via GitHub
  Actions.

### Phase 2 — Core MTGPrices Platform  *(in flight)*

**2A — Product shell + Deep card intelligence** *(complete)*
- Nav restructured around Collect / Play / AI / Community.
- Homepage communicates both audiences.
- Deep card pages: layout-aware faces, capabilities, format legality,
  printings intelligence, finish-aware prices, rulings.
- Set page filter/sort. Search broadened beyond name.
- `/formats` area.

**2B — Smart Card Finder / Deep Search** *(current)*
- `/card-finder` with two modes: Find for Play, Find for Collecting.
- `mtg_oracle_cards.capabilities text[]` GIN-indexed — the single
  queryable capability surface.
- Single source-of-truth classifier at `src/lib/mtg/capabilities.ts`
  used by app + backfill + incremental scripts.
- Deterministic natural-language parser (`finder-nl.ts`) — NL → factual
  filter constraints. Never invents card recommendations.
- Currency-aware price semantics — USD and EUR only (no silent FX).
  "Budget"/"cheap" sorts ascending; "under $X" is a hard cap.
- Similar-cards foundation on card pages (shared capabilities / colour
  identity / mana value / type — factual only).
- Pagination.

**2C — Accounts + Collections** *(complete)*
- Supabase Auth: Google OAuth + email magic link (@supabase/ssr).
- Light theme refresh — warm off-white background, white surfaces,
  navy/charcoal text; violet primary; gold restrained. Applied across
  every existing surface (nav, home, card, set, finder, formats,
  chart, badges).
- Per-user owned cards — exact printing + finish + condition +
  quantity, optional acquired price/date/notes.
- `mtg_collection_items`, `mtg_collection_imports`, `mtg_user_prefs`
  with full RLS (`auth.uid() = user_id`). Aggregation key:
  (user, printing_finish, condition). Never one row per copy.
- Transparent, currency-aware valuation — user picks the provider /
  currency / price-type basis. USD and EUR never silently FX. Missing
  prices are reported, not treated as zero.
- CSV import: generic + auto-detects Moxfield / Deckbox / Archidekt
  columns. Matches on (set_code + collector_number) first, then
  name+set. Ambiguous rows are never silently imported. Import audit
  trail per invocation.
- Reusable collection module: `userOwns`, `getOwnedPrintings`,
  `findMissing`, `getCollectionSummary`, `computeValuation` — ready
  for Phase 3 Deck Builder to consume.
- Nav updates: My Collection live in Collect; Account chip top-right;
  auth-aware mobile menu.

### Phase 3 — Decks & MTG Intelligence

- Manual Deck Builder tied to `mtg_decks` / `mtg_deck_cards` (reviving
  the deferred Stage 1D migrations).
- Build for a chosen **format** with live legality / curve / composition.
- **Commander** support (partner, background, singleton, colour
  identity compatibility).
- Build around a card / commander / theme.
- Build **from your collection** — highlight owned vs missing.
- Choose exact printing + finish per slot.
- Deck value + cheapest available printing for each missing card.
- Save + share decks.
- **AI** (retrieval-grounded over `mtg_oracle_cards` + `mtg_rulings` +
  `mtg_oracle_legalities` + collection + decks + prices): build me a
  deck, improve my deck, explain card choices, find synergies, suggest
  budget upgrades. Never invents anything.

### Phase 4 — Test Your Deck / Gameplay

V1:
- Opening-hand + mulligan testing.
- Land-drop probability and mana / colour availability by turn.
- Curve and goldfish simulation.

Later:
- Opponent archetypes + interaction (blockers, removal, countermagic).
- Repeated batch simulations for expected win-rate against archetype
  proxies.
- AI-driven gameplay decisions.

**Do not attempt to rebuild the complete Magic rules engine from scratch
without first evaluating existing rules-engine options** (Forge, XMage,
Cockatrice logic, MTGA modding surfaces, published open-source rules
implementations).

### Phase 5 — Community

- **Events** — local game nights, organised play, tournaments, card
  shows.
- **Vendors** — LGSs, card shops, online sellers, show vendors.
- **Creators** — streamers, deck/strategy creators, video/content
  creators.
- **Event organisers / owners** — venues, organisers, promoters treated
  as first-class entities that persist across events.

### Phase 6 — Content, SEO & Public Launch

- Editorial format guides.
- Set spotlights and release calendar.
- Investing / collecting knowledge base.
- Bing/Google submissions.
- `SITE_LAUNCHED=true` — flip the pre-launch noindex gate.

---

## What is NOT on this roadmap

Anything that materially compromises the collector/pricing product to
serve gameplay, or vice versa. Both must be first-class. If a design
choice forces a tradeoff, escalate — do not silently pick one side.

The AI surface must never be used to freely invent cards, rules,
legalities or prices. Every claim maps to a row.
