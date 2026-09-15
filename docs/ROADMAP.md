# MTGPrices product roadmap

Approved 2026-09-15. This document is the **permanent** direction for MTGPrices
beyond V1. Items here are **not** V1 launch requirements — the V1 scope is
homepage / search / browse / set / card + 90-day chart only.

Nothing below should be treated as short-term work. Anything picked up from
here should be scoped in a subsequent brief before implementation.

---

## Product philosophy

MTGPrices is both a **collector/pricing product** and, eventually, a
**gameplay/deck product**. Pricing/collecting and gameplay should both be
first-class parts of MTGPrices — neither is a bolt-on. Design decisions
should prefer keeping both audiences native to the same product.

---

## Pillar 1 — Deep card intelligence

Card pages must eventually go considerably beyond PokePrices in depth. Every
card page should support the full picture of what a Magic card *is* and
*does*, not just what it *costs*:

- Abilities / Oracle text (already Stage 1B data).
- Mechanics.
- Keywords.
- Rulings (already ingested via `mtg_rulings`).
- Legality across formats (already ingested via `mtg_oracle_legalities`).
- Colour identity.
- Formats where the card is relevant / played.
- Strategic capabilities / card role (control, ramp, removal, finisher, …).
- Synergies and interactions with other cards.
- Commander / deck relevance.
- Other printings — visual variants, borderless / showcase / etched.
- Finishes (nonfoil / foil / etched) at the printing level.
- Current prices per printing × finish × provider.
- Historical price series.

Everything on this list is either already present in `mtg_*` catalogue tables,
already parsed from Scryfall, or a downstream derivation. **No new external
data source is required to reach this depth.**

---

## Pillar 2 — Deck Builder

A first-class Deck Builder is a core MTGPrices feature. It must support:

- Build manually — traditional decklist editor.
- Build around a selected **commander**, key card or theme.
- Build **from cards the user already owns** (integration with Pillar 4).
- Show at all times: legality per format, mana curve, colour breakdown,
  card categories (creatures / removal / ramp / draw / lands / …), total
  deck value, list of missing cards, and the cheapest available printing
  for each missing card.
- Future: **AI-assisted deck creation and analysis** — draft a deck around a
  brief, critique an existing list, suggest upgrades, explain choices.

Deck data model — the `mtg_decks` / `mtg_deck_cards` tables were designed
for this in Stage 1D planning (currently deferred in
`docs/deferred-migrations/`) and can be revived when the Deck Builder is
scoped.

---

## Pillar 3 — Test Your Deck / gameplay

Future feature that comes **after** Deck Builder is real, not before.

- User designs a deck before a match.
- Eventually test / simulate the deck against AI opponents or archetype
  proxies.
- **Do NOT build a complete Magic rules engine now.** Rules-engine parity is
  out of scope for the foreseeable future. Early versions can approximate
  matchups statistically (goldfish simulations, expected-turn milestones,
  archetype-vs-archetype win-rate estimates) without simulating full games.

---

## Pillar 4 — Collections

Owned-card tracking that eventually feeds directly into Deck Builder and
AI. Examples of what users should be able to do:

- Build a deck **from my collection**.
- **Suggest upgrades** to a deck I already own.
- Identify **missing cards** required for a target list.
- Value the deck at current market prices.
- Migrate a Pokemon-style portfolio schema to MTG (per-printing, per-finish
  quantity + condition + acquired-price).

---

## Pillar 5 — Events

MTG event directory beyond a simple "card show" list:

- **Game nights / local organised play** at LGSs.
- **Tournaments** — RCQs, RCs, Pro Tours, community tournaments.
- **MTG card shows / collector fairs**.

Data model must support **venues** as first-class entities and **organisers /
event owners** as first-class entities (so a store or a series can be
followed across many events).

---

## Pillar 6 — Vendors

Reintroduce the PokePrices-style vendor directory, MTG-specific:

- Local Game Stores (LGSs).
- Online card shops.
- Marketplace sellers.
- Tournament stores.
- Show vendors.

Vendor profiles should link to their event presence (Pillar 5) and their
current listings where a marketplace integration exists.

---

## Pillar 7 — Creators

Reintroduce the creator directory:

- MTG creators (YouTube / Twitch / long-form writers).
- Streamers.
- Deck-builders.
- Strategy creators.
- Community figures (podcast hosts, cEDH voices, judges, …).

Creator profiles link to their public decks (Pillar 2) and any decks they've
publicly reviewed / featured.

---

## Pillar 8 — AI

Major future product pillar. Non-negotiable constraints:

- **Retrieval-grounded in live MTGPrices data.** Every answer must be able
  to cite the specific `mtg_oracle_cards.id`, `mtg_printings.id`,
  `mtg_rulings.id`, `mtg_oracle_legalities` row, `mtg_current_prices`
  observation or `mtg_price_observations` history point that supports it.
- **AI must not invent** cards, rules, legality, prices, printings, or
  format bans. Every claim maps to a row that exists in the DB.
- **Eventually supports:** deck building, deck analysis, synergy explanations,
  gameplay coaching, and Test Your Deck (Pillar 3). AI is the connective
  tissue across every other pillar.

Data foundation is already in place: Stage 1B catalogue + Stage 1C historical
pricing + Stage 1D daily incremental. Retrieval architecture (embeddings,
vector store, tool-use over the `mtg_*` tables) is a future workstream that
will be scoped separately.

---

## What is NOT on this roadmap

Anything that materially compromises the collector/pricing product to serve
gameplay, or vice versa. Both must be first-class. If a design choice forces
a tradeoff, escalate — do not silently pick one side.
