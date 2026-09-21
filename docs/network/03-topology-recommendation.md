# Topology recommendation: where the shared TCG market DB lives

## The three options

**OPTION 1 — Reuse the existing shared Supabase project** (`egidpsrkqvymvioidatc.supabase.co`).
- PokePrices already lives here.
- MTGPrices already lives here.
- `auth.users` is here.
- New `tcg_*` tables land here alongside `mtg_*` and PokePrices's `daily_prices` / `portfolios` / `insights` / etc.

**OPTION 2 — New dedicated shared TCG market Supabase project.**
- Fresh project, only `tcg_*` tables, only TCGGraph-sourced data.
- MTG/Poké catalogues stay where they are.

**OPTION 3 — Something bespoke** (schema-per-app, read replica, split roles).

## Real numbers from the audit

- Two live products (PokePrices + MTGPrices) share the same Supabase already. That was an existing intentional decision, not one this slice is imposing.
- `auth.users` is the identity bridge that portfolios/decks/watchlists reference by FK.
- MTG catalogue: ~118 k printings, ~63 M price observations (partitioned monthly), ~72 k daily basket rows.
- PokePrices tables and MTG tables both live in `public.` today with no visible collision.

## Assessment against the criteria in the brief

| Criterion | Option 1 | Option 2 | Option 3 |
|---|---|---|---|
| Production risk | **Low** — no migration of live data. `tcg_*` is greenfield. | Medium — two projects to keep in step, cross-project joins impossible in SQL. | High — every custom architecture ships bespoke ops. |
| Current MTG DB size | Fine. Postgres handles 63 M rows in a partitioned table without breaking a sweat. Adding TCGGraph graded data (~small, per §credit-model) is not the marginal load. | Same. Isolation buys us nothing on the DB side because MTG isn't the bottleneck. | — |
| Auth separation | **N/A — already shared.** Single `auth.users`. | Requires either duplicated Supabase auth OR a JWT federation pattern (Sign in with Supabase A, verify in Supabase B). Real work. | — |
| Storage + row count | Adding 3 games at TCGGraph card counts (~40 k YGO, ~1.5 k OP, ~0.6 k SWU) is trivial next to MTG's 118 k. | Same. | — |
| Query performance | Every read stays in-project. Existing indexes untouched. New `tcg_*` gets its own indexes. | Every cross-cut read (e.g. "user's YGO portfolio value alongside their MTG portfolio") requires two round-trips at the app layer, or duplicating auth into project 2. | — |
| Backup / recovery | One PITR window covers everything. If Supabase Growth already handles PokéPrices + MTG's row volume today, adding 3 lower-volume games doesn't change the recovery story. | Two PITR windows to reason about. | — |
| Portfolio joins | **Free**: `tcg_printings.id`, `mtg_printings.id`, `pokemon.*` all live in the same DB. Cross-game "your total collection" is a single query. | Not free. Either federate or duplicate. | — |
| RLS + security | Existing `auth.users` FK pattern extends to `tcg_*` (add `user_id uuid REFERENCES auth.users` where user-owned; RLS by that column). No new posture to design. | Every RLS-gated table has to trust an external identity. Non-trivial. | — |
| Front-end access | Four Vercel projects hit one Supabase URL with one anon key + one service-role key. Same env-var pattern as today. | Four Vercel projects × two Supabase projects = double env matrix. | — |

## Recommendation

**OPTION 1.** Reuse the existing shared Supabase project.

The audit surfaced one concrete piece of evidence that seals it: PokePrices and MTGPrices already share this Supabase project by intentional design — the row-count / storage / backup story is a solved problem here and there is exactly one identity domain to reason about. Introducing a second Supabase project would multiply cost, split the auth story, and eliminate the ability to do a single-query portfolio join across games, without buying us any headroom the current DB doesn't already comfortably have.

Namespace discipline is what keeps this clean:
- Existing `mtg_*` tables — untouched.
- Existing PokePrices tables — untouched.
- New `tcg_*` tables — greenfield, all game-keyed via `game_id`.
- Existing `market_import_runs` — a future non-breaking `ADD COLUMN game_id` is optional; not required for Slice 0.

## Escape hatch if we're wrong

If future TCGGraph-fed volume ever pushes the shared DB over the operational envelope (e.g. `tcg_market_price_daily` grows to >30 M rows and starts affecting backup times), the migration to a separate DB is a bounded, well-defined operation: dump the `tcg_*` schema, restore into a fresh Supabase, point ingestion at the new URL, teach the front ends to open a second client. It is straightforward because the `tcg_*` schema is game-agnostic and self-contained by construction — no MTG or PokéPrices tables need to move.

This means picking Option 1 today is *not* a lock-in. It's the reversible, low-risk choice.

## What still requires explicit configuration

- `TCGGRAPH_API_KEY` in Vercel Production (all four front-end projects that will call TCGGraph — currently only MTGPrices ships this slice's client code, but Slice 1+ front-ends will also need it).
- `TCGGRAPH_API_BASE` if the real base URL isn't `https://api.tcggraph.com`.
- No `tcg_*` migrations are executed in this slice; deployment is deferred to Slice 1 after the API-key phase (D–G) validates the schema against real payload shapes.
