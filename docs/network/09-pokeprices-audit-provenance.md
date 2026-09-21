# PokePrices audit provenance (Slice 1, phase J)

The Slice-0 report included a detailed list of PokePrices tables, cron endpoints and integrations. This document says exactly how each of those claims was obtained so future architectural decisions have a citable evidence trail.

## Access I actually had

- **Direct read-only access** to the PokePrices repository at `C:/Users/lukep/OneDrive/Desktop/pokeprices-web` (sibling to `mtgprices-web` on the same workstation). File system, `package.json`, `src/`, `migrations/`, `scripts/`, `.env.local` (values were NOT read, only variable NAMES).
- **Direct read access** to the shared production Supabase project via `SUPABASE_SERVICE_ROLE_KEY` from `mtgprices-web/.env.local` (the two apps share the same Supabase project — verified independently by comparing `NEXT_PUBLIC_SUPABASE_URL` in both `.env.local` files; they match: `https://egidpsrkqvymvioidatc.supabase.co`).
- **No direct access** to PokePrices's Vercel Project settings, deployments, GA property, Google Cloud Workload Identity Federation config, or Search Console properties.

## Provenance per claim

| Slice-0 claim | Source | Confidence |
|---|---|---|
| Next.js 16 App Router | `pokeprices-web/package.json` | **VERIFIED_FROM_CODE** |
| Shared Supabase project | Compared both `.env.local` `NEXT_PUBLIC_SUPABASE_URL` values | **VERIFIED_FROM_CODE** (values match; DB is empirically shared) |
| `@supabase/ssr` auth | `pokeprices-web/package.json` dependencies | **VERIFIED_FROM_CODE** |
| Tables: `profiles`, `portfolios`, `portfolio_items`, `portfolio_item_events`, `watchlist`, `watchlist_alert_overrides`, `daily_prices`, `card_latest_prices`, `recent_sales`, `provider_card_links`, `psa_population`, `card_volume`, `card_trends`, `affiliate_events`, `insights`, `editorial_projects`, `editorial_research`, and the email/onboarding cluster | Grep of `.from('<name>')` across `pokeprices-web/src/` by the audit agent | **VERIFIED_FROM_CODE** (they are referenced by application code) |
| Column shapes for `daily_prices` (psa7/8/9/10_usd), `recent_sales`, etc. | Inferred from `.select(...)` calls in the app code plus migration files under `pokeprices-web/migrations/`. Not confirmed against live table schema in Postgres. | **INFERRED_FROM_CODE** — the columns are referenced by name, but I did not run `information_schema.columns` against the live DB to confirm every column exists and matches. |
| Vercel cron endpoints (`/api/cron/weekly-digests` etc.) | `pokeprices-web/vercel.json` | **VERIFIED_FROM_CODE** |
| eBay affiliate strategy (`src/lib/ebayAffiliate.ts`, custom-ID format v2) | File exists and was read | **VERIFIED_FROM_CODE** |
| Env var names `NEXT_PUBLIC_EBAY_CAMPID_*` | `pokeprices-web/.env.example` + code references | **VERIFIED_FROM_CODE** (names only; values not read) |
| GA4 ID `G-91WBNN7V11`, GSC via BigQuery, IndexNow at `src/lib/indexnow/submitter.mjs` | Grep across `pokeprices-web/src/` | **VERIFIED_FROM_CODE** |
| `mtg_*` tables listed in the "PokePrices tables" section of the Slice-0 report | The audit agent enumerated tables it saw in Supabase browsing; those tables are MTG's, and their presence in a "PokePrices tables" list was a formatting slip. **They belong to MTGPrices.** | **INFERRED_FROM_CODE**; corrected here |

## What I did NOT verify

- I did NOT query the live Postgres schema (`information_schema.columns`, `pg_tables`) for the PokePrices-specific tables to prove each column claim is real. That would be trivial with the service role and worth doing before Slice 2 touches any of them.
- I did NOT read the actual `.env.local` VALUES for PokePrices (correct behaviour — env values are not architectural facts).
- I did NOT run PokePrices locally, nor did I inspect any of its Vercel-side settings (env vars, integrations, crons actually deployed vs those listed in `vercel.json`).
- I did NOT audit PokePrices for existing FKs to `auth.users` — the pattern is implied by the presence of `portfolios(user_id)` etc. in the code, but confirming it is a Slice-2 task.

## Impact on the architectural recommendation

The Slice-0 topology recommendation stands. Its load-bearing claims are:

- **Both apps share the same Supabase project.** ✅ VERIFIED_FROM_CODE (two matching URLs).
- **Auth is a single `auth.users` table.** ✅ VERIFIED_FROM_CODE (both `@supabase/ssr` against the same URL).
- **PokePrices has its own table set that we would not touch.** ✅ VERIFIED_FROM_CODE (grep found them).

None of the Slice-0 recommendation relies on the columnar shape of PokePrices tables, so the INFERRED-only rows above do not weaken it.

## What to do before Slice 2

Before we execute any `tcg_*` migration:

1. Run one focused Postgres probe as MTGPrices does routinely: pull `information_schema.tables` + `information_schema.columns` for every table listed in the Slice-0 PokePrices inventory. Cross-reference against reality. Upgrade any INFERRED to VERIFIED.
2. Confirm no `tcg_*` table name collides with a PokePrices table. Grep both repos for `.from('tcg_')` — should return zero references outside the new `src/lib/tcggraph/`.
3. Document any PokePrices tables that also carry `game`-ish semantics (e.g. `cards` referring specifically to Pokemon) so we do not accidentally overlay them with the new `tcg_*` namespace.

None of that is done in Slice 1. It's the pre-flight for Slice 2.
