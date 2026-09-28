# MTG Pass 2B follow-ups

Items surfaced during Pass 2B that were deliberately deferred per the
"only fix what materially affects user experience / data trust /
account functionality / conversion" rule. Listed with severity + one-liner
rationale.

## Product completeness

- **Card Finder set-scope filter still under-returns** — `?set=lea` returns ≪295 because the RPC caps at 400 name-alphabetical oracles before the set filter is applied client-side. Users have a working alternative at `/set/lea`. Fix is a query-flow inversion (~50-100 LOC); not narrow enough for this pass.
- **Card Finder rarity/legality result cap** — same underlying RPC ceiling. Rarity=mythic returns ~5 instead of thousands. Same root fix as above.
- **Grader / grade columns on `mtg_collection_items`** — a user cannot record "PSA 10 Black Lotus" distinctly from a raw near-mint copy. Requires schema migration + `AddToCollection.tsx` redesign + hydration path updates. Out of Pass 2B scope; separate work item.
- **AI `getCardFacts` does not expose `card_faces` / back-face oracle** — DFC/MDFC back-face queries (Delver, Werewolves, MDFCs) risk fabrication. Small tool-schema fix (~15 LOC).
- **Global search autocomplete** — Navbar + HomeSearch are plain forms. Adding typeahead against `mtg_oracle_cards.name` would help discovery. Not in scope for Pass 2B.

## Discoverability + information architecture

- **Graded surface not in header/footer nav** — only reachable via homepage promo. Adding a Tools-dropdown entry + Footer link would help.
- **`/about` route absent** — Footer references non-existent About page. Either add a small About page or remove the reference.
- **Related-set navigation** — Set pages only expose Breadcrumb JSON-LD, no visible prev/next-in-block strip.
- **Visible breadcrumb on set pages** — Card pages render one; set pages do not.
- **Rarity/finish summary tiles on set pages** — currently the set page shows Most Valuable but no rarity distribution or finish availability strip.

## Editorial + copy

- **Scryfall attribution footer on card pages** — Oracle text is imported from Scryfall; a visible attribution is polite and standard.
- **Commander bracket guidance on `/formats/commander`** — informational surface for WotC bracket 1-5 rules.

## Cleanup

- **Unused `resend` dependency in package.json** — no import sites. Cosmetic.
- **Pre-existing `card-seo-content-graded.test.tsx` fixture type errors** — 4 pre-existing tsc errors from Pass 2A. `next build` unaffected. Fixture-update.
- **Residual single-source price outliers** (Pass 2A follow-up, unchanged) — Soul Net SUM·275 $98,972 ManaPool: no cross-source signal and history mirrors current, so neither rule fires.
- **DFC composite-name cosmetic** — "Fable of the Mirror-Breaker" only resolves under its full DFC composite name.

## Post-merge verifications (from Pass 2A)

- **Stale-run sweep on next real MTG cron** (scheduled Sep 30 03:00 UTC). Re-run `scripts/pass2a-check-stuck-runs.mjs` to confirm the 4 orphan `running` rows have been converted to `timed_out`.
