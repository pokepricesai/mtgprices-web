// src/lib/mtg/simulation/rules-engine-adapter.ts
//
// Phase 4B — RulesEngineAdapter contract.
//
// This file DEFINES ONLY. It does not implement or link to any engine
// (Forge, XMage, Manabrew). Phase 4B's spike keeps engines out of
// this repository entirely; production code interacts with them via
// this interface across an HTTP or process boundary.
//
// The adapter deliberately hides:
//   - which engine is behind the API
//   - how cards are identified inside the engine (see `EngineCardRef`)
//   - process/host details
//
// Everything that MTGPrices sends to the adapter is expressed in
// MTGPrices-native types (oracle_card_id, printing_id). The adapter
// implementation is responsible for translating those into whatever
// its engine expects. This keeps the app decoupled from Forge's `.dck`
// format, XMage's `[SET:CN] Name` format, or any other syntax.
//
// See `rules-engine-evaluation.md` (Phase 4A) and the Phase 4B spike
// report for the actual decision.

import type { FormatKey } from '../formats.data'

// ── Deck reference ──────────────────────────────────────────────────

/** A card in a deck sent to the adapter. MTGPrices identifies cards
 *  by oracle_card_id (the gameplay identity) with an optional
 *  printing_id (for the exact physical printing to prefer — mostly
 *  irrelevant to rules-aware simulation but useful for consistent art
 *  in game logs). */
export type AdapterDeckCard = {
  oracle_card_id: string
  quantity: number
  printing_id?: string
}

export type AdapterDeck = {
  name: string
  format: FormatKey
  commanders: AdapterDeckCard[]
  main: AdapterDeckCard[]
  sideboard?: AdapterDeckCard[]
  companion?: AdapterDeckCard[]
}

// ── Session lifecycle ──────────────────────────────────────────────

export type EngineSessionId = string  // opaque

export type StartMatchRequest = {
  seed?: number
  match: {
    format: FormatKey
    /** Standard 2-player AI-vs-AI. For Commander multiplayer we'll
     *  extend this to support more seats later. */
    seats: [
      { deck: AdapterDeck; ai_profile?: string },
      { deck: AdapterDeck; ai_profile?: string },
    ]
    /** "Best of X" games. 1 = single game. */
    gamesPerMatch?: number
    /** Wall-clock cap on the whole match, seconds. Adapter enforces. */
    timeoutSec?: number
  }
}

/** Response from `startMatch` when running to completion inline
 *  (blocking). For queue-based hosting the adapter also exposes
 *  `enqueueMatch(request)` returning a job id — see the queue
 *  design in Phase 4B report. */
export type StartMatchResult = {
  sessionId: EngineSessionId
  status: 'complete' | 'timeout' | 'error'
  /** Per-game breakdown. gamesPerMatch=1 produces a single entry. */
  games: MatchGameResult[]
  totalWallMs: number
  engine: { name: string; version: string }
}

export type MatchGameResult = {
  gameIndex: number
  outcome: 'p1_win' | 'p2_win' | 'draw' | 'timeout' | 'error'
  reason: string
  turns: number
  events: GameEvent[]
  finalLife: [number, number]
  mulligans: [number, number]
  /** Deterministic action trace — the sequence of decisions each AI
   *  made. Suitable for replay. Some engines emit this; others don't.
   *  When unavailable, the field is omitted. */
  actionTrace?: EngineAction[]
}

// ── Event stream ────────────────────────────────────────────────────

/** A structured event from the game. Adapters serialise as many
 *  events as they can into this shape. Fields that don't apply to an
 *  event kind are omitted rather than nulled. */
export type GameEvent =
  | { turn: number; kind: 'turn_start'; player: 0 | 1 }
  | { turn: number; kind: 'draw'; player: 0 | 1; count: number }
  | { turn: number; kind: 'mulligan'; player: 0 | 1; toCount: number }
  | { turn: number; kind: 'play_land'; player: 0 | 1; oracle_card_id: string }
  | { turn: number; kind: 'cast'; player: 0 | 1; oracle_card_id: string; targets?: string[] }
  | { turn: number; kind: 'attack'; attacker_oracle_card_id: string; defender: 0 | 1 }
  | { turn: number; kind: 'block'; blocker_oracle_card_id: string; attacker_oracle_card_id: string }
  | { turn: number; kind: 'life_change'; player: 0 | 1; delta: number; toLife: number }
  | { turn: number; kind: 'zone_move'; player: 0 | 1; oracle_card_id: string; from: EngineZone; to: EngineZone }
  | { turn: number; kind: 'trigger'; source_oracle_card_id: string; description: string }
  | { turn: number; kind: 'game_end'; winner: 0 | 1 | 'draw'; reason: string }

export type EngineZone = 'library' | 'hand' | 'battlefield' | 'graveyard' | 'exile' | 'command' | 'stack'

// ── Interactive play (for future Phase 4C AI-analysis flows) ────────

/** Optional interactive API. Adapters that can't step a game one
 *  action at a time (e.g. Forge Simulation Mode) can return
 *  `supportsInteractive === false` from `capabilities()` and only
 *  implement startMatch. */
export type EngineAction =
  | { kind: 'play_land'; oracle_card_id: string }
  | { kind: 'cast'; oracle_card_id: string; targets?: string[] }
  | { kind: 'activate'; oracle_card_id: string; ability_index: number; targets?: string[] }
  | { kind: 'attack'; assignments: Array<{ attacker_oracle_card_id: string; defender: 0 | 1 }> }
  | { kind: 'block'; assignments: Array<{ blocker_oracle_card_id: string; attacker_oracle_card_id: string }> }
  | { kind: 'pass_priority' }
  | { kind: 'mulligan'; keep_after_mulligans: number; bottom_oracle_card_ids: string[] }

export type GameSnapshot = {
  sessionId: EngineSessionId
  turn: number
  activePlayer: 0 | 1
  priorityPlayer: 0 | 1
  players: [PlayerSnapshot, PlayerSnapshot]
  legalActions: EngineAction[]
  finished: boolean
}

export type PlayerSnapshot = {
  life: number
  library: number         // count only; hidden information
  hand: Array<{ oracle_card_id: string }>
  battlefield: Array<{ oracle_card_id: string; tapped: boolean; summoning_sick: boolean }>
  graveyard: Array<{ oracle_card_id: string }>
  exile: Array<{ oracle_card_id: string }>
  command: Array<{ oracle_card_id: string }>
  commander_tax?: number
}

// ── Adapter capabilities descriptor ────────────────────────────────

export type AdapterCapabilities = {
  engine: string
  version: string
  supportsInteractive: boolean
  supportsCommander: boolean
  supportsDeterministicSeed: boolean
  emitsStructuredEvents: boolean
  emitsActionTrace: boolean
  cardCoverageNotes?: string
}

// ── The adapter interface ──────────────────────────────────────────

export interface RulesEngineAdapter {
  capabilities(): Promise<AdapterCapabilities>

  /** Server-side sanity check that an MTGPrices deck can be mapped
   *  into engine terms. Returns unmapped oracle_card_ids so the UI
   *  can flag them BEFORE running an expensive simulation. */
  validateDeck(deck: AdapterDeck): Promise<{
    ok: boolean
    unmapped_oracle_card_ids: string[]
    warnings: string[]
  }>

  /** Run one match end-to-end. Blocks until complete or `timeoutSec`. */
  startMatch(request: StartMatchRequest): Promise<StartMatchResult>

  /** Optional bulk mode. Adapter decides whether to parallelise
   *  internally. Never accept `iterations > 1000` in one call from
   *  the app — chunk at the caller. */
  simulateMany?(request: StartMatchRequest & { iterations: number }): Promise<{
    aggregate: {
      p1_wins: number; p2_wins: number; draws: number; timeouts: number; errors: number
      averageTurns: number
      averageWallMs: number
    }
    perGame?: MatchGameResult[]
  }>

  /** Interactive-mode entry points (optional). */
  createGame?(request: StartMatchRequest): Promise<{ sessionId: EngineSessionId; initialSnapshot: GameSnapshot }>
  submitAction?(sessionId: EngineSessionId, action: EngineAction): Promise<{ snapshot: GameSnapshot; events: GameEvent[] }>
  getSnapshot?(sessionId: EngineSessionId, viewer?: 0 | 1): Promise<GameSnapshot>
  endGame?(sessionId: EngineSessionId): Promise<void>
}

// ── Notes on card identity ─────────────────────────────────────────

/** MTGPrices identifies a card by `oracle_card_id` (UUID) — the
 *  gameplay identity. Every rules engine has its OWN identifier
 *  system:
 *
 *    - Forge: card NAME + `.dck` deck file with `<count> <Name>|<SET>`.
 *             The engine's card_id at runtime is `name`.
 *    - XMage: card NAME + `[<SET>:<CN>] <Name>` deck file. Runtime
 *             identifier is also `name`.
 *    - Manabrew (Forge-backed): reuses Forge's card scripts →
 *             `name` again, plus a Scryfall-cross-referenced JSON
 *             mapping in `forge-carddb` for oracle-id lookup.
 *
 *  Given every engine keys on `name`, adapters translate:
 *
 *    oracle_card_id  →  oracle name (via mtg_oracle_cards)
 *                     + optional (set_code, collector_number) hint
 *
 *  and produce the engine-native deck text. `AdapterDeckCard` keeps
 *  `oracle_card_id` as the source of truth so we can round-trip the
 *  result back into MTGPrices data. Names alone aren't safe because
 *  of split/dfc/adventure cards where multiple oracle rows can share
 *  a display name — the adapter must resolve those unambiguously
 *  using the printing_id / (set, cn) hint. */
export type EngineCardRef = {
  engine_name: string
  set_code?: string
  collector_number?: string
}

// silence
void ({} as EngineCardRef)
