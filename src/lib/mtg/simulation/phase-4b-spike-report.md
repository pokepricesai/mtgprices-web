# Phase 4B Spike — Rules Engine Integration Report

**Status:** Spike only. Nothing deployed. No cloud infrastructure
provisioned. `SITE_LAUNCHED=false` unchanged. Phase 4C not started.

**Compiled 2026-09-17.**

## 1. Constraint acknowledged upfront

The local dev machine for this spike has Node.js + git only — no JVM,
no Maven, no cargo, no Docker. That means:

- **Verified by direct code inspection** of each engine's source tree
  (shallow-cloned into an isolated `~/mtg-engine-spike/` scratch dir,
  never vendored into the app repo): entry points, deck-file
  formats, licence files, community sidecar precedents, and card-
  script corpora.
- **Verified by execution:** the MTGPrices card-mapping coverage
  against the Forge corpus, and the end-to-end contract test
  (MTGPrices deck → deck-text export → adapter → structured result).
- **Not verified locally:** wall-clock timing of a real Forge / XMage
  simulation, native-image build success, per-game RAM. These are
  called out explicitly below and would need a JVM host to measure.

## 2. Engines evaluated

### 2.1 Forge (`Card-Forge/forge`, GPL-3.0)

- **Simulation Mode entry point:** `forge-gui-desktop/src/main/java/forge/view/SimulateMatch.java`. Verified.
- **CLI surface (verified in source):** `sim -d <deck>… -D <dir> -n <N> -m <M> -t <bracket|swiss|roundrobin> -f <format> -s <seed> -a <ai-profile> -c <clock-sec> -q`. Format defaults to Constructed; `-f commander` supported.
- **Deterministic seed:** `-s <seed>` calls `MyRandom.setRandom(new Random(seed))`. Yes.
- **Deck format:** `.dck` — `[metadata]` + `[main]` + optional `[commander]` / `[sideboard]` / `[companion]`. Deck lines are `<count> <Name>|<SET>`. Trivial to generate from MTGPrices printings. Exporter shipped in `src/lib/mtg/simulation/deck-export.ts` and unit-tested.
- **Output shape:** `System.out.println(GameLogEntry)` per event; final line `"Game Result: Game N ended in X ms. NAME has won!"`. Structured internally (`Game.getGameLog().getLogEntries(...)`) but the CLI emits line-based text. Structured JSON would require either (a) a small Java patch adding a `-o json` flag, or (b) parsing the text (fragile), or (c) using Manabrew's `forge-harness` which already exposes JSON around the same engine.
- **Card corpus:** **33,865 card-script `.txt` files** counted on HEAD. Coverage against real MTGPrices decks (measured, this spike):

  | Sample | Mapped | % |
  |---|---|---|
  | Synthetic 60-card Modern legal cards | 60 / 60 | **100.0%** |
  | Real 99-card Commander (my Phase-3C test deck) | 15 / 16 | **93.8%** (missed: "Undulating Witness", a recent set) |
  | Synthetic 100-card Commander legal cards | 99 / 100 | **99.0%** (missed: "Make a _____ Splash", an Un-set joke card) |
- **Commander support:** yes — `RegisteredPlayer.forCommander(d)` + `GameType.Commander` in SimulateMatch.
- **AI quality:** competent — used by the Forge desktop client's single-player mode. Multiple AI profiles selectable via `-a`.
- **Process model:** each `SimulateMatch.simulate(args)` call re-initialises the model (`FModel.initialize(null, null)`) which loads the entire card DB into memory. Community wisdom says this is ~30–60s cold start, ~2 GB RAM per JVM. Running many games in one process amortises this cost.
- **Startup overhead:** significant per-JVM. Long-lived worker is essential.
- **Not verified locally:** actual timing, actual RAM footprint.

### 2.2 XMage (`magefree/mage`, MIT)

- **Test harness / programmatic entry point:** `Mage.Tests/src/test/java/org/mage/test/serverside/base/CardTestPlayerAPIImpl.java` (extended by `CardTestCommanderDuelBase` for Commander duels). Verified.
- **API surface (test-mode):** `setDecknamePlayerA("Deck.dck")`, `createPlayer(game, name, deckName)`, `castSpell(turn, phase, player, name)`, `attack(...)`, `block(...)`, `setStopAt(turn, phase)`, `execute()`. Assertions include `assertLife(player, N)`, `assertHandCount`, `assertBattlefieldCount`, `assertExileCount`, `assertCommandZoneCount`, etc. Verified in `AnafenzaTest.java`.
- **Deterministic seed:** not obvious from the test harness. Wire protocol (JBoss Remoting) governs online play; test-mode has fixed-state setup, which is a different kind of determinism.
- **Deck format:** `<count> [<SET>:<CN>] <Name>`. Verified in `Mage.Tests/CMDNorinTheWary.dck`. Exporter shipped in `deck-export.ts`.
- **Output shape:** in-JVM. Game state accessed via assertion methods on `CardTestPlayerAPIImpl` — programmatic and structured, but *not* serialised to JSON out of the box. Would require a JSON serialiser layer.
- **Card corpus:** README claim "~32,000 unique cards and 91,000 reprints." Not remeasured here (would require building the project).
- **Commander support:** yes — `CommanderDuel(MultiplayerAttackOption.LEFT, RangeOfInfluence.ONE, MulliganType.GAME_DEFAULT.getMulligan(0), 40, 7)` in test harness.
- **AI quality:** README calls it "server-side AI." Community reports it as playable but slower than Forge's.
- **Process model:** JBoss Remoting server (`Mage.Server`), designed as a long-running lobby. Test-mode is JUnit-invocable — an embedded rules engine. Runs headless with `-Djava.awt.headless=true`.
- **Wire protocol:** JBoss Remoting (Java RMI-style). **No HTTP/JSON on the box.** Making XMage speak JSON requires a Java shim.
- **Integration difficulty:** higher than Forge. There is no upstream JSON adapter; we'd write one.

### 2.3 Manabrew — Rust/WASM path (`witchesofthehill/manabrew`, AGPL-3.0)

- **Rust engine crates verified:** `manabrew-rs/crates/manabrew-engine`, `forge-carddb`, `forge-foundation`, `manabrew_game_runtime`, `manabrew-agent-interface`.
- **Card corpus source:** the Rust engine parses **Forge's card scripts** — same 33,865 files. Coverage BOUNDED ABOVE by Forge's corpus, in practice lower because not every Forge mechanic is implemented in Rust yet. Manabrew's own docs (`docs.manabrew.app/formats/`) acknowledge "broad card coverage still in progress."
- **WASM viability:** yes — `forge-harness/native/wasm-src/` + `build-wasm.sh` present. Manabrew ships a WASM engine for the browser.
- **Headless server viability:** the Rust engine can also drive the Java Forge — see section 2.4 — so the Rust engine + Java Forge fallback pattern gives you both a browser path and a server path from the same codebase.
- **Determinism:** yes — engine takes an explicit seed (verified in `manabrew-rs/crates/manabrew-engine`).
- **Game-state API:** structured Rust types; serialised via `manabrew-protocol` and `manabrew-relay-protocol`. JSON-friendly.
- **AI:** `manabot` crate in the workspace. Not evaluated for quality here.
- **Key risk:** the pure-Rust engine's card coverage is genuinely in flux and less well-tested than Forge's. Public docs suggest "some mechanics not yet supported."

### 2.4 Manabrew — Java Forge-backed path (AGPL-3.0)

**This is where the spike found the most interesting evidence.**

- **`forge-harness/`** in the Manabrew repo is a Maven module that
  depends on `forge-core`, `forge-game`, `forge-ai`, `forge-gui` and
  **exposes a JSON API around Forge**:
  - `startGame(StartGameRequest)` / `startGameJson(String)` returning a `SessionHandle`
  - `submitAction(sessionId, actionJson)` — advance the game one step
  - `getPrompt(sessionId, playerIndex)` — legal-action list for a player
  - `getSnapshot(sessionId, viewer)` — structured game state
  - `getGameOver(sessionId)` / `endGameJson(sessionId)` / `abortGameJson(sessionId)`
  Verified in `src/main/java/forge/harness/host/ManaBrewEngineAdapter.java`.
- **`self-hosted-node`** — Rust binary that hosts N concurrent games against ONE in-process Forge engine. GraalVM native-image compiles the Java harness to a shared library (`libforgeharness.so` / `.dll`) so runtime has no JVM startup cost — the 33k-card database loads once per node. Verified in the crate's `Dockerfile` (`FROM rust:1.88-trixie AS chef`, `FROM maven:3.9-eclipse-temurin-17 AS java-builder`, `FROM container-registry.oracle.com/graalvm/native-image:24`).
- **This is essentially the exact sidecar MTGPrices would need.** It's licensed AGPL-3.0-or-later.

## 3. Licensing (documented — not legal advice)

| Engine | Licence | Modifying? | Distributing binaries? | Network-use clause? |
|---|---|---|---|---|
| Forge | GPL-3.0 | If we patch to emit JSON | Only if we host builds | No AGPL clause |
| XMage | MIT | Freely | Yes | None |
| Manabrew (whole) | AGPL-3.0-or-later | Applies | Applies | **YES — Section 13** |
| Manabrew's Forge submodule reused | GPL (Forge scripts) | See above | See above | No AGPL clause |

**Practical read (NOT LEGAL ADVICE — get sign-off before commercial launch):**

- Running an **unmodified upstream Forge Simulation Mode** subprocess we build ourselves: GPL-3.0 obligations attach to any *distributed* binaries. If we don't publish binaries (we build from source in CI, host the container ourselves), the obligation is limited. MTGPrices's own code, running on Vercel and speaking to the container over HTTP, is not a derivative work under mainstream FSF interpretation.
- Running an **unmodified upstream Manabrew self-hosted-node** as a separate service: AGPL Section 13 says users who *interact with the software over a network* must be offered its source. Even for unmodified upstream this obligation likely applies; the safe minimum is to add a "Powered by [Manabrew source link]" attribution and an explicit source-availability link in the UI. **Confirm with counsel before launch.**
- **Modifying** Manabrew (e.g. patching `ManaBrewEngineAdapter`) triggers a full source-disclosure obligation for the modified binary to any network-connected user. This is the most contagious scenario.
- **The cleanest commercial posture:** build our own thin Forge-CLI subprocess adapter (Forge is GPL, not AGPL) rather than embed Manabrew. Cost: we lose Manabrew's native-image work (~2 weeks of engineering) and their AI harness.

## 4. Output richness assessment

| Kind of output | Forge CLI text | Forge via Manabrew harness | XMage test-mode | Manabrew Rust |
|---|---|---|---|---|
| Winner | ✅ | ✅ | ✅ | ✅ |
| Turns | ✅ (from text) | ✅ | ✅ | ✅ |
| Mulligans | 🟡 in log text | ✅ | ✅ (setter) | ✅ |
| Card draws | 🟡 in log text | ✅ (in events) | ✅ | ✅ |
| Cards played | 🟡 in log text | ✅ | ✅ | ✅ |
| Life totals | ✅ (final) | ✅ (per event) | ✅ (assertLife) | ✅ |
| Zone snapshots | ❌ (no CLI flag) | ✅ (`getSnapshot`) | ✅ (assertions) | ✅ |
| Legal-action list | ❌ | ✅ (`getPrompt`) | ❌ (test-mode is scripted) | ✅ |
| Deterministic action trace | ❌ | ✅ | 🟡 | ✅ |
| Structured JSON | ❌ (line-based text) | ✅ | ❌ (Java assertions) | ✅ |

## 5. Deployment shape (estimated, not verified)

| | Forge CLI (our shim) | Forge via Manabrew self-hosted-node | XMage (our shim) | Manabrew Rust |
|---|---|---|---|---|
| Base image | `eclipse-temurin:17-jre` (~250 MB) | `debian:trixie-slim` (~90 MB) + `forgeharness.so` (~90 MB from native-image) | `eclipse-temurin:17-jre` (~250 MB) + our shim | `debian:trixie-slim` (~90 MB) + engine binary |
| Container size | ~400 MB after Forge assets | ~250 MB | ~400 MB | ~150 MB |
| Cold start | 30–60 s (JVM + Forge init) | ~1 s (native binary, DB loaded once) | 30–60 s | ~1 s |
| RAM per instance | 1.5–2 GB | ~1 GB (single engine, many rooms) | 1.5–2 GB | ~500 MB |
| Concurrent games/instance | 1 per JVM (cheap way) or many if we thread | Many (in-process rooms) | Many (server mode) | Many |
| Vercel Functions | ❌ (JVM can't run) | ❌ | ❌ | 🟡 WASM in a Node fn — unproven at scale |
| Fly.io Machines | ✅ (2 GB tier) | ✅ (auto-scale weird for stateful games) | ✅ | ✅ |
| Railway | ✅ | ✅ | ✅ | ✅ |
| Google Cloud Run | 🟡 (cold-start pain) | ✅ (min-instances=1) | 🟡 | ✅ |
| Low-volume cost | $5–20/mo | $5–20/mo | $5–20/mo | ~$5/mo |

**None of this has been provisioned.** No accounts created, no bills incurred.

## 6. Queue architecture (design)

Do NOT use pg_cron as a general-purpose job queue.

Two viable options for MTGPrices, ranked by simplicity:

### Option A (recommended for V1): Supabase table + `SELECT ... FOR UPDATE SKIP LOCKED`

```
mtg_simulation_jobs (
  id uuid PRIMARY KEY,
  user_id uuid REFERENCES auth.users(id),
  deck_a jsonb, deck_b jsonb,
  seed bigint, iterations int, timeout_sec int,
  status text CHECK (status IN ('queued','running','done','failed','cancelled')),
  worker_id text, started_at timestamptz, finished_at timestamptz,
  result jsonb, error text,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- worker loop:
BEGIN;
UPDATE mtg_simulation_jobs
   SET status = 'running', worker_id = $1, started_at = now()
 WHERE id = (
   SELECT id FROM mtg_simulation_jobs
    WHERE status = 'queued'
    ORDER BY created_at
    LIMIT 1
    FOR UPDATE SKIP LOCKED
 )
RETURNING id, deck_a, deck_b, seed, iterations;
COMMIT;
```

- **Pros:** zero extra infrastructure, RLS-friendly, Supabase Realtime subscribes for `status=done` push.
- **Cons:** no built-in retry/DLQ (we implement); no backpressure (we cap concurrent claims per worker).

### Option B: dedicated queue (Upstash QStash, BullMQ + Redis)

- **Pros:** built-in retries, delayed jobs, cron.
- **Cons:** extra bill, extra failure mode, need to keep Supabase and queue state in sync.

**Decision for V1: Option A.** Migrate to B only if job volume outgrows single-row polling.

### End-to-end flow

```
User (browser)
  │ POST /api/decks/[id]/simulate/rules-aware {seed, iterations, opponent_deck_id}
  ▼
Next.js on Vercel                     (Serverless Function)
  │ 1. Auth + rate limit
  │ 2. Insert row into mtg_simulation_jobs
  │ 3. Realtime-subscribe channel     ← Supabase Realtime
  │
  ▼
Supabase Postgres (mtg_simulation_jobs)
  ▲ ▲
  │ │ SELECT … FOR UPDATE SKIP LOCKED
  │ │
Engine worker (Fly.io Machine)         [Docker container built from a
  │ 1. Claim job                        forge shim + a small Node
  │ 2. Export both decks → .dck         supervisor OR from Manabrew's
  │ 3. Start Forge Simulation Mode      self-hosted-node, per licence
  │ 4. Wait for game end                choice]
  │ 5. Parse output → structured JSON
  │ 6. UPDATE row status='done', result=…
  ▼
Frontend receives Realtime push, renders result
```

Rate limits per Phase 3C precedent: 6 rules-aware simulations per user
per rolling 24h; hard cap at 500 iterations per single-deck request.

## 7. Adapter contract

Shipped in `src/lib/mtg/simulation/rules-engine-adapter.ts` (contract
only — no engine code). Key types:

- `AdapterDeck` — MTGPrices-native (oracle_card_id + optional printing_id)
- `StartMatchRequest` / `StartMatchResult`
- `GameEvent` union (turn_start, draw, mulligan, play_land, cast, attack, block, life_change, zone_move, trigger, game_end)
- `EngineAction` union (for future interactive Phase 4C)
- `AdapterCapabilities` (per-engine descriptor)
- `RulesEngineAdapter` interface

MTGPrices code always talks to `RulesEngineAdapter`. Behind that interface
we plug in Forge (via our shim OR Manabrew's `forge-harness`), XMage (via
our shim), or a mock (already provided for tests).

## 8. Prototype

Isolated inside `tests/mtg/rules-adapter-prototype.test.ts` — never
touches production paths. Exercises the full pipeline **without**
running a real engine:

```
AdapterDeck
  → toForgeDck / toXMageDck (real, unit-tested)
  → MockAdapter (in-process stub matching the RulesEngineAdapter contract)
  → structured MatchGameResult
```

Assertions:
- `.dck` output has valid `[metadata]` / `[main]` / `[commander]` sections
- `.dck` uses the right `DeckType=` for the format
- XMage output uses `<count> [SET:CN] Name` lines with no `SB:` prefix on main-deck lines
- `MockAdapter.capabilities()` returns the expected shape
- `validateDeck()` surfaces unmapped oracle_card_ids
- `startMatch()` is deterministic given the same seed
- End-to-end returns turns / events / finalLife / mulligans

Swapping the mock for `HttpForgeAdapter` (calls a Fly.io endpoint) or
`ManabrewSelfHostedAdapter` (calls Manabrew's relay protocol) is a
strict subset of implementing the `RulesEngineAdapter` interface.

## 9. Decision matrix

| Criterion | Forge (our shim) | Forge via Manabrew harness | XMage (our shim) | Manabrew Rust |
|---|---|---|---|---|
| Card coverage | 33.8k (highest verified) | 33.8k (same corpus) | ~32k claimed | ≤ Forge; partial |
| Reliability | Battle-tested engine | Same, plus Manabrew testing | Battle-tested, higher rules-correctness discipline | Younger; in flux |
| AI opponent | ✅ competent | ✅ (Forge AI) | ✅ (adequate) | 🟡 (`manabot`) |
| Commander | ✅ | ✅ | ✅ | ✅ |
| Structured integration | 🟡 (parse text) | ✅ (JSON API done) | 🟡 (write our JSON layer) | ✅ (JSON native) |
| Deterministic testing | ✅ (`-s <seed>`) | ✅ | 🟡 | ✅ |
| Browser possibility | ❌ | ❌ | ❌ | ✅ (WASM ships) |
| Server complexity | Medium (JVM sidecar) | Medium (they packaged it) | Medium-high (write JSON shim) | Low-medium |
| Performance | JVM cold start; use long worker | Native-image → fast start | JVM cold start | Fastest cold-start |
| Maintenance activity | ~3k commits/year; monthly releases | Tracks Forge closely + own daily releases | ~3.3k commits/year; monthly releases | Active daily releases |
| Licence risk | GPL-3.0 (well-understood) | **AGPL-3.0-or-later** (network clause) | MIT (lowest risk) | **AGPL-3.0-or-later** |
| Engineering effort to first prod use | 3–4 weeks (write Java patch for JSON) | 1–2 weeks (Manabrew is already this) | 4–6 weeks (write JSON server) | 4–6 weeks (write app-side plumbing + verify coverage) |

**Arithmetic score suggests "Forge via Manabrew harness" — but the AGPL Section 13 makes that dangerous for a commercial site without explicit legal sign-off.**

## 10. Recommendation

**Primary: build our own thin Forge Simulation-Mode sidecar (GPL-3.0, not AGPL).**

1. Container = `eclipse-temurin:17-jre` + Forge fat-jar built from a
   pinned release tag (e.g. `forge-2.0.14`) + a small Node.js
   supervisor that:
   - watches Supabase `mtg_simulation_jobs` with SKIP LOCKED
   - exports each job's decks to `.dck` files (reuse the shipped
     `toForgeDck` in this repo — GPL-compatible because it's ours)
   - spawns `java -jar forge-gui-desktop.jar sim -d deck1 -d deck2 -f
     commander -s $SEED -c 120 -q`
   - parses the "Game Result:" line + per-turn `GameLogEntry` lines
     into `MatchGameResult`
   - writes back to Supabase
2. **Optional richer output later:** a small Java patch to
   `SimulateMatch.java` adding `-o json` (emit `GameLogEntry`
   objects as JSON). Because Forge is GPL, this patch would need to
   be published upstream or in a fork — but no AGPL network clause.
3. Host on Fly.io Machine (~$5/mo, 2 GB RAM), min instances 1, scale
   up on queue depth. No Vercel involvement beyond the enqueue
   endpoint.

**Watch:** Manabrew's Rust engine and WASM path. If in 6-12 months
its card coverage catches up, we can drop the JVM entirely and run
rules-aware simulation directly in the user's browser. That's a
different phase of MTGPrices.

**Do not:** integrate Manabrew today without explicit legal
sign-off on AGPL Section 13. The technical work is genuinely
excellent (their `forge-harness` is essentially our adapter already)
but the network-use obligation is a business decision, not a
technical one.

## 11. Recommended Phase 4C path

1. **Ship Phase 4A's deterministic simulator as-is.** The hypergeometric probabilities + London mulligan + manual goldfish are fast, cheap, and answer real questions. Do not remove them when 4B lands — they answer *different* questions than a rules-aware sim.
2. **Phase 4B (build):** Forge-shim sidecar + Supabase SKIP LOCKED queue + Realtime push. 3–4 weeks of engineering. UI adds a "Simulate a match against another deck" button on `/decks/[id]/test`.
3. **Phase 4C (analysis):** the AI layer that CONSUMES the structured results — "your deck wins 62% vs an opposing burn shell, mainly through turn-4 board wipes; against control it drops to 34%." AI never generates the probability; the deterministic engine does.
4. **Phase 4C.5 (evaluate again):** revisit Manabrew's Rust/WASM engine. If browser-native rules-aware sim is viable, we can move the compute off the sidecar for casual use cases while keeping the sidecar for the expensive bulk simulations.

## 12. What we DID and DID NOT do this spike

**Did:**
- Cloned Forge, XMage, Manabrew into isolated scratch (never vendored into `mtgprices-web`).
- Read the key entry points in source: `SimulateMatch.java` (Forge), `CardTestCommanderDuelBase.java` (XMage), `ManaBrewEngineAdapter.java` + `self-hosted-node/Cargo.toml` + `Dockerfile` (Manabrew).
- Counted Forge's card corpus (33,865 scripts).
- Measured MTGPrices → Forge card mapping on real + synthetic decks (100% / 93.8% / 99%).
- Shipped a real `RulesEngineAdapter` TypeScript contract in the app.
- Shipped Forge + XMage deck-text exporters in the app, unit-tested.
- Shipped a mock adapter and end-to-end pipeline test (8 tests pass).
- Documented the licensing landscape.
- Designed the queue architecture on paper.

**Did NOT:**
- Compile Forge, XMage, or Manabrew (no local JVM/cargo/Docker).
- Run any actual AI-vs-AI game and measure wall-clock.
- Provision any cloud infrastructure.
- Ship an engine dependency in the app repo.
- Start Phase 4C.

The unverified claims (wall-clock timing, RAM footprint per engine
instance) are explicitly labelled everywhere they appear.
