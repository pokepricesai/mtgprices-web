// src/lib/mtg/simulation/forge-adapter.ts
//
// HTTP-based implementation of RulesEngineAdapter. Delegates to a
// remote Forge Simulation Mode service — the container built from
// pinned forge-2.0.14, running the shipped `sim` CLI. No engine code
// is embedded in the app.
//
// The endpoint speaks a tiny protocol:
//
//   POST <base>/simulate
//     Content-Type: application/json
//     { "seed": number, "iterations": number,
//       "format": "constructed" | "commander",
//       "decks": [
//         { "seat": 0, "dck": "...Forge .dck text..." },
//         { "seat": 1, "dck": "...Forge .dck text..." }
//       ],
//       "timeoutSec": number
//     }
//   → 200 { "engine": { name, version },
//          "raw_log_lines": [<string>], "raw_stdout": "..." (optional),
//          "games": [<per-game parsed result>], "aggregate": {...} }
//
// The service is expected to run `xvfb-run java -jar forge-gui-desktop-...jar sim ...`
// with the decks written to ~/.forge/decks/... first, and to parse
// output via the same parser used here. See Phase 4B report §
// "Deployment shape" for hosting recommendations.

import 'server-only'
import type {
  AdapterCapabilities, AdapterDeck, MatchGameResult, RulesEngineAdapter,
  StartMatchRequest, StartMatchResult, GameEvent,
} from './rules-engine-adapter'
import { toForgeDck, type ExportCardMeta } from './deck-export'
import { getSupabaseServiceClient } from '@/lib/supabaseService'

const ENGINE_NAME = 'forge'

export class ForgeRulesEngineAdapter implements RulesEngineAdapter {
  private endpoint: string
  private engineVersion: string

  constructor(opts?: { endpoint?: string; version?: string }) {
    // Endpoint is intentionally optional — when unset the adapter
    // rejects every call with a clear error. This is the "not
    // provisioned" default and matches the launch gate.
    this.endpoint = opts?.endpoint ?? process.env.RULES_ENGINE_ENDPOINT ?? ''
    this.engineVersion = opts?.version ?? process.env.RULES_ENGINE_VERSION ?? 'forge-2.0.14'
  }

  async capabilities(): Promise<AdapterCapabilities> {
    return {
      engine: ENGINE_NAME,
      version: this.engineVersion,
      supportsInteractive: false,        // Simulation Mode is batch-only
      supportsCommander: true,
      supportsDeterministicSeed: true,
      emitsStructuredEvents: false,      // free text log — parser extracts structure best-effort
      emitsActionTrace: false,
      cardCoverageNotes: 'Forge 2.0.14 card corpus (~33,867 scripts). Coverage is nearly complete for constructed and Commander formats. Very recent set releases and Un-set cards may be missing.',
    }
  }

  async validateDeck(deck: AdapterDeck): Promise<{ ok: boolean; unmapped_oracle_card_ids: string[]; warnings: string[] }> {
    // Hydrate names + set + collector-number from the DB.
    const meta = await hydrateExportMeta([...deck.commanders, ...deck.main, ...(deck.sideboard ?? []), ...(deck.companion ?? [])])
    // Any card missing name/set is a mapping failure. We do not attempt
    // to reach the remote engine — that lives behind the endpoint and
    // its coverage is measured out-of-band.
    const unmapped: string[] = []
    for (const c of [...deck.commanders, ...deck.main, ...(deck.sideboard ?? []), ...(deck.companion ?? [])]) {
      const m = meta.get(c.oracle_card_id)
      if (!m || !m.name) unmapped.push(c.oracle_card_id)
    }
    return { ok: unmapped.length === 0, unmapped_oracle_card_ids: unmapped, warnings: [] }
  }

  async startMatch(request: StartMatchRequest): Promise<StartMatchResult> {
    if (!this.endpoint) {
      return {
        sessionId: 'forge-no-endpoint',
        status: 'error',
        games: [],
        totalWallMs: 0,
        engine: { name: ENGINE_NAME, version: this.engineVersion },
      }
    }
    const t0 = Date.now()
    const [seatA, seatB] = request.match.seats
    const metaA = await hydrateExportMeta([...seatA.deck.commanders, ...seatA.deck.main])
    const metaB = await hydrateExportMeta([...seatB.deck.commanders, ...seatB.deck.main])
    const dckA = toForgeDck(seatA.deck, metaA)
    const dckB = toForgeDck(seatB.deck, metaB)
    const iterations = Math.max(1, request.match.gamesPerMatch ?? 1)
    const format = seatA.deck.format === 'commander' ? 'commander' : 'constructed'

    let resp: Response
    try {
      resp = await fetch(`${this.endpoint.replace(/\/$/, '')}/simulate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          seed: request.seed ?? Date.now() & 0x7fffffff,
          iterations,
          format,
          decks: [{ seat: 0, dck: dckA }, { seat: 1, dck: dckB }],
          timeoutSec: request.match.timeoutSec ?? 120,
        }),
        // Node fetch has no default timeout; wrap in AbortController.
        signal: AbortSignal.timeout(Math.min(600_000, ((request.match.timeoutSec ?? 120) + 60) * 1000 * iterations)),
      })
    } catch (err) {
      return {
        sessionId: `forge-net-${Date.now()}`, status: 'error', games: [],
        totalWallMs: Date.now() - t0,
        engine: { name: ENGINE_NAME, version: this.engineVersion },
      }
    }
    if (!resp.ok) {
      return {
        sessionId: `forge-http-${resp.status}`, status: 'error', games: [],
        totalWallMs: Date.now() - t0,
        engine: { name: ENGINE_NAME, version: this.engineVersion },
      }
    }
    const body = await resp.json() as {
      engine?: { name?: string; version?: string }
      games: Array<{
        game_index: number
        outcome: 'p1_win' | 'p2_win' | 'draw' | 'unknown'
        winner_name?: string | null
        turns?: number | null
        duration_ms?: number | null
        reason?: string
        mulligans?: { p1: number; p2: number } | null
      }>
    }
    const games: MatchGameResult[] = body.games.map((g) => ({
      gameIndex: g.game_index,
      outcome: g.outcome === 'unknown' ? 'error' : g.outcome,
      reason: g.reason ?? 'forge-sim',
      turns: g.turns ?? 0,
      events: [] as GameEvent[],
      finalLife: [0, 0],
      mulligans: [g.mulligans?.p1 ?? 0, g.mulligans?.p2 ?? 0],
    }))
    return {
      sessionId: `forge-${Date.now()}`,
      status: 'complete',
      games,
      totalWallMs: Date.now() - t0,
      engine: { name: body.engine?.name ?? ENGINE_NAME, version: body.engine?.version ?? this.engineVersion },
    }
  }
}

async function hydrateExportMeta(cards: Array<{ oracle_card_id: string }>): Promise<Map<string, ExportCardMeta>> {
  const out = new Map<string, ExportCardMeta>()
  const ids = Array.from(new Set(cards.map((c) => c.oracle_card_id)))
  if (ids.length === 0) return out
  const s = getSupabaseServiceClient()
  const { data: oracles } = await s.from('mtg_oracle_cards').select('id, name').in('id', ids)
  const oracleName = new Map<string, string>()
  for (const o of (oracles ?? []) as any[]) oracleName.set(o.id, o.name)

  // Pick the freshest English paper printing for each oracle — that's
  // what Forge's card DB most reliably has.
  const IN_CHUNK = 60
  const printings: any[] = []
  for (let i = 0; i < ids.length; i += IN_CHUNK) {
    const chunk = ids.slice(i, i + IN_CHUNK)
    const { data } = await s.from('mtg_printings')
      .select('oracle_card_id, set_code, collector_number, released_at')
      .in('oracle_card_id', chunk)
      .eq('lang', 'en')
      .eq('digital', false)
      .order('released_at', { ascending: false, nullsFirst: false })
    for (const p of (data ?? []) as any[]) printings.push(p)
  }
  const preferredPrinting = new Map<string, any>()
  for (const p of printings) if (!preferredPrinting.has(p.oracle_card_id)) preferredPrinting.set(p.oracle_card_id, p)

  for (const id of ids) {
    const name = oracleName.get(id)
    const p = preferredPrinting.get(id)
    if (name) {
      out.set(id, {
        oracle_card_id: id,
        name,
        set_code: p?.set_code,
        collector_number: p?.collector_number,
      })
    }
  }
  return out
}
