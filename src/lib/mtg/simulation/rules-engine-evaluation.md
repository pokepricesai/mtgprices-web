# Open-Source MTG Rules Engines — Evaluation Report (Phase 4A)

*Compiled 2026-09-17 for Phase 4B (rules-aware simulation) go/no-go.*

No integration work has been done. Phase 4A ships a **deterministic
probability + manual playtest sandbox**, not a rules-aware simulator.
This document exists to inform 4B planning.

## 1. Forge (Card-Forge/forge)

- **Language / runtime:** Java 17+. Maven multi-module.
- **Licence:** GPL-3.0.
- **Card / rules coverage:** Aims to cover the full printed cardbase.
  Community references note a card-script library above 32,000
  cards. No official % is published against Oracle. Handles a very
  wide range of mechanics, formats (Constructed, Commander, Cube,
  Oathbreaker, Momir, Planechase, Archenemy, Vanguard), and has a
  competent AI. Card behaviour is a text-based script DSL under
  `forge-gui/res/cardsfolder/…`, which is why third parties can
  reuse it.
- **Headless / server suitability:** Yes. Split into `forge-core`,
  `forge-game`, `forge-ai`, and separate GUI modules (`forge-gui-*`).
  Game/AI logic lives in the non-GUI modules. In-tree "Simulation
  Mode" runs AI-vs-AI from the CLI without Swing. Community fork
  `MimicByte/forge-dedicated-server` already runs headless lobby
  servers.
- **API / integration:** No stable, documented library API. `forge-
  game` is intended to be embedded, but the public contract is
  "read the source." Community tooling (`jborden/forge-mtg-tools`,
  `WintersRain/mtg-matchlab`) drives Forge as a subprocess and parses
  stdout / JSON emitted from Simulation Mode rather than linking
  against classes.
- **Development activity:** Very active. ~3,089 commits in the past
  year; 2,701 stars, 1,089 forks. Monthly-cadence set-themed releases
  through 2026 (Marvel Super Heroes June 2026, The Hobbit Aug 2026,
  `forge-2.0.14`). Nightly daily-snapshots build.
- **Realistic Node.js path:** Package Forge as a JVM sidecar. Two
  options — (a) spawn Simulation Mode per match and parse output
  (used by mtg-matchlab); (b) wrap `forge-game` / `forge-ai` in a thin
  Java HTTP or gRPC service and call from Next.js. (b) is cleaner
  but requires Java glue code you'd maintain.

Sources: Card-Forge/forge, Forge AI wiki, MimicByte/forge-dedicated-
server, WintersRain/mtg-matchlab, jborden/forge-mtg-tools.

## 2. XMage (magefree/mage)

- **Language / runtime:** Java. README says Java 8+; modern builds
  are Java 17+ in practice.
- **Licence:** MIT.
- **Card / rules coverage:** README claims "~32,000 unique cards and
  91,000 reprints," "~9,000 unit tests, ~80% coverage." Full rules
  enforcement — server never trusts client, which suggests deeper
  rules-correctness discipline than Forge.
- **Headless / server suitability:** Architecturally client/server
  already. `Mage.Server` is a standalone JBoss Remoting server;
  `Mage.Client` is the Swing UI. Server can run standalone; supports
  `-Djava.awt.headless=true` for CI. `Mage.Tests` provides a
  programmatic test harness for pre-defined game states.
- **API / integration:** Wire protocol is JBoss Remoting (Java
  RMI-style), **not** HTTP/JSON. Clients are expected to be Java.
  No documented REST/gRPC surface. To use from Node: (a) write a
  Java shim translating JSON &lt;-&gt; Remoting, or (b) embed
  `Mage.Server` internals directly from Java. `Mage.Tests`' harness
  is the closest thing to a public library API.
- **Development activity:** Very active. ~3,306 commits/year;
  2,361 stars, 941 forks; roughly monthly releases (`xmage_1.4.58V1`
  Oct 2025 → `xmage_1.4.61V1` Aug 2026).
- **Realistic Node.js path:** Same JVM sidecar story — but XMage is
  *harder* to embed because Remoting is baked in. Pragmatic route is
  to fork `Mage.Tests`' harness style into a JSON-over-HTTP shim.

Sources: magefree/mage, Development Testing Tools wiki.

## 3. Other engines considered

- **Cockatrice** — Netplay only, explicitly **not** a rules engine
  (state fully player-controlled). Useless for deterministic
  simulation.
- **Wagic** (WagicProject/wagic, C++, 403 stars, pushed Aug 2026) —
  Homebrew mobile-first engine with an `auto=` scripting DSL.
  wagicGPT fork claims ~26,000 cards expressible. Coverage of modern
  complex mechanics is uneven. Non-SPDX licence ("NOASSERTION") —
  needs manual review before commercial-adjacent use.
- **Manabrew** (witchesofthehill/manabrew, Rust + Tauri + React,
  48 stars, active daily 2026 releases up to v3.43.0) — Reuses
  Forge's card-script corpus but re-implements the engine in Rust;
  a WASM engine build exists (PR #924). Cards parse; mechanics
  don't all execute yet. Docs explicitly say "broad card coverage
  still in progress." Non-SPDX licence. Interesting long-term — a
  WASM engine would drop straight into Next.js — but not
  production-ready.
- **mtg-python-engine** / **open-mtg** / **open-mtg-env** — Toy /
  academic / RL-research subsets, not real rules.
- **MTG-Paradox-Engine** — TypeScript, small, unproven.
- **MagicTheGathering/mtg-sdk-\*** — API wrappers, not engines.
- **OpenSourcerer** — Long-dormant.
- **Manalink 3** — Historical Windows-only.

## 4. "Use it from Node" strategy

Neither Forge nor XMage is embeddable inside a Node process. Both
are JVM apps with heavy in-process state. The realistic pattern is
a **JVM sidecar microservice**:

- Wrap `forge-game` + `forge-ai` (or XMage's server internals) in a
  small Spring Boot / Javalin service exposing JSON endpoints
  (`POST /goldfish`, `POST /simulate`, streaming progress via SSE).
- Deploy the sidecar on **not Vercel** — Vercel Functions can't run
  a persistent JVM. Options: Fly.io, Railway, Render, a small VPS,
  or Google Cloud Run (JVM cold start real but tolerable for batch).
  Next.js on Vercel calls it over HTTPS; Supabase remains truth for
  decks/results.
- Cost/ops: one always-on 1–2 GB JVM instance (Forge/XMage both
  want ≥ 2 GB heap for stable play) — ~$5–20/month. Auto-scale is
  awkward because games are stateful.
- Licence caveat: **Forge is GPL-3.0**. Sidecar invoked over HTTP
  by Next.js is *probably* not a derivative work under mainstream
  FSF interpretation — but shipping modified Forge binaries triggers
  source-disclosure. XMage's MIT sidesteps this.

## 5. Recommendation for Phase 4B

For a solo maintainer, the least-risky, most realistic path is:

1. **Primary: Forge as a headless JVM sidecar in Simulation Mode.**
   It already exists, community precedent (`mtg-matchlab`,
   `forge-dedicated-server`) shows the exact pattern, card coverage
   is the largest in the open-source world, and Forge's AI is
   playable. Talk to it as a subprocess or a very thin HTTP shim.
2. **Fallback / longer-term: watch Manabrew.** If its WASM engine
   reaches usable card coverage, we get a browser-side/Node-side
   engine with no sidecar. Not close today.
3. **Do not build a rules engine from scratch.** Public evidence
   (Wingedsheep's Argentum: 41k Kotlin + 12k TS lines for a
   *partial* engine) confirms this is a multi-year commitment.

### Risks

- **Licensing (GPL-3.0):** distributed Forge modifications must be
  published; running an unmodified sidecar behind HTTP is safest.
- **No stable API:** Forge internals change between snapshots. Pin
  a specific release tag and re-qualify on upgrades.
- **Hosting:** Vercel cannot host the JVM. Second cloud
  (Fly/Railway/VPS) adds operational surface.
- **Latency/cost per simulation:** A goldfish game can take seconds
  to minutes of CPU. Budget for a queue rather than inline.
- **Card gaps:** Forge doesn't cover every printed card perfectly;
  some silver-border / Un-set / very new cards will be missing or
  buggy. Surface "simulation may be approximate" in UX.
- **Brand risk:** MTG is Wizards' IP. All these projects are
  "unofficial." Keep public messaging on *analysis of legal cards*,
  not "play MTG on our site."

### Unverified from public sources

- Exact card-coverage percentages for Forge/XMage (both quote raw
  counts, neither publishes a % against current Oracle).
- Forge's exact Java-version floor beyond "17+".
- XMage's actual embed API stability (no docs; inferred from module
  layout).
