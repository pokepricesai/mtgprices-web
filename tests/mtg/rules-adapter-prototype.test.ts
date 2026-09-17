// tests/mtg/rules-adapter-prototype.test.ts
//
// Phase 4B spike: end-to-end prototype WITHOUT running a real engine.
//
//   MTGPrices AdapterDeck
//     → toForgeDck / toXMageDck  (real code)
//     → MockAdapter               (in-process stub matching the contract)
//     → structured MatchGameResult
//
// The mock adapter behaves deterministically: given the same seed +
// deck it returns the same events. That lets the interface be tested
// today; swapping the mock for Manabrew's forge-harness or a home-
// grown Forge shim is a small delta.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import type {
  AdapterDeck, RulesEngineAdapter, StartMatchRequest, StartMatchResult,
  AdapterCapabilities, MatchGameResult, GameEvent,
} from '../../src/lib/mtg/simulation/rules-engine-adapter'
import { toForgeDck, toXMageDck, type ExportCardMeta } from '../../src/lib/mtg/simulation/deck-export'

// ── Fixture ────────────────────────────────────────────────────────

const CARD_META: Record<string, ExportCardMeta> = {
  'oracle-bolt':      { oracle_card_id: 'oracle-bolt',      name: 'Lightning Bolt',    set_code: 'M11', collector_number: '149' },
  'oracle-mountain':  { oracle_card_id: 'oracle-mountain',  name: 'Mountain',          set_code: 'M11', collector_number: '242' },
  'oracle-shock':     { oracle_card_id: 'oracle-shock',     name: 'Shock',             set_code: 'M15', collector_number: '156' },
  'oracle-fireblast': { oracle_card_id: 'oracle-fireblast', name: 'Fireblast',         set_code: 'VIS', collector_number: '82'  },
  'oracle-jeska':     { oracle_card_id: 'oracle-jeska',     name: 'Jeska, Thrice Reborn', set_code: 'C20', collector_number: '9' },
}

function bolt60(): AdapterDeck {
  return {
    name: 'Burn 60 (test)',
    format: 'modern',
    commanders: [],
    main: [
      { oracle_card_id: 'oracle-bolt',      quantity: 4 },
      { oracle_card_id: 'oracle-shock',     quantity: 4 },
      { oracle_card_id: 'oracle-fireblast', quantity: 4 },
      { oracle_card_id: 'oracle-mountain',  quantity: 48 },
    ],
  }
}

function jeska99(): AdapterDeck {
  return {
    name: 'Jeska Commander (test)',
    format: 'commander',
    commanders: [{ oracle_card_id: 'oracle-jeska', quantity: 1 }],
    main: [
      { oracle_card_id: 'oracle-bolt',     quantity: 1 },
      { oracle_card_id: 'oracle-shock',    quantity: 1 },
      { oracle_card_id: 'oracle-mountain', quantity: 97 },
    ],
  }
}

const metaMap = new Map(Object.entries(CARD_META))

// ── Mock adapter ───────────────────────────────────────────────────
//
// Deterministic pseudo-outcome derived from (seed, deck sizes). Never
// pretends to run rules. Only exists to prove the contract compiles
// and can be exercised end-to-end.

class MockAdapter implements RulesEngineAdapter {
  async capabilities(): Promise<AdapterCapabilities> {
    return {
      engine: 'mock', version: 'spike-1',
      supportsInteractive: false,
      supportsCommander: true,
      supportsDeterministicSeed: true,
      emitsStructuredEvents: true,
      emitsActionTrace: false,
    }
  }

  async validateDeck(deck: AdapterDeck) {
    const allIds = [...deck.commanders, ...deck.main, ...(deck.sideboard ?? []), ...(deck.companion ?? [])].map((c) => c.oracle_card_id)
    const unmapped = allIds.filter((id) => !metaMap.has(id))
    return { ok: unmapped.length === 0, unmapped_oracle_card_ids: unmapped, warnings: [] }
  }

  async startMatch(request: StartMatchRequest): Promise<StartMatchResult> {
    const seed = request.seed ?? 1
    const [p1, p2] = request.match.seats
    // Deterministic pseudo-outcome: whichever deck has more "damage"
    // cards (bolt/shock/fireblast) wins. Tie → seed decides.
    const dmg = (d: AdapterDeck) => d.main.filter((c) => ['oracle-bolt','oracle-shock','oracle-fireblast'].includes(c.oracle_card_id)).reduce((n, c) => n + c.quantity, 0)
    const s1 = dmg(p1.deck), s2 = dmg(p2.deck)
    let winner: 0 | 1
    if (s1 > s2) winner = 0
    else if (s2 > s1) winner = 1
    else winner = (seed % 2 === 0) ? 0 : 1

    const events: GameEvent[] = []
    for (let t = 1; t <= 5; t++) {
      events.push({ turn: t, kind: 'turn_start', player: (t % 2 === 1 ? 0 : 1) as 0 | 1 })
      events.push({ turn: t, kind: 'draw', player: (t % 2 === 1 ? 0 : 1) as 0 | 1, count: 1 })
    }
    events.push({ turn: 5, kind: 'game_end', winner, reason: `mock outcome by damage-count (${s1} vs ${s2})` })

    const game: MatchGameResult = {
      gameIndex: 0,
      outcome: winner === 0 ? 'p1_win' : 'p2_win',
      reason: 'mock',
      turns: 5,
      events,
      finalLife: winner === 0 ? [10, 0] : [0, 10],
      mulligans: [0, 0],
    }
    return {
      sessionId: `mock-${seed}`,
      status: 'complete',
      games: [game],
      totalWallMs: 3,
      engine: { name: 'mock', version: 'spike-1' },
    }
  }
}

// ── Tests ──────────────────────────────────────────────────────────

test('AdapterDeck → Forge .dck: 60-card burn', () => {
  const dck = toForgeDck(bolt60(), metaMap)
  assert.match(dck, /\[metadata\]/, 'has [metadata] header')
  assert.match(dck, /DeckType=Constructed/, 'DeckType=Constructed for modern')
  assert.match(dck, /\[main\]/, 'has [main] section')
  assert.match(dck, /4 Lightning Bolt\|M11/, '4 Lightning Bolt line')
  assert.match(dck, /4 Fireblast\|VIS/, '4 Fireblast line')
  assert.match(dck, /48 Mountain\|M11/, '48 Mountain line')
  assert.doesNotMatch(dck, /\[commander\]/, 'no commander section for constructed')
})

test('AdapterDeck → Forge .dck: Commander deck has [commander] section + DeckType=Commander', () => {
  const dck = toForgeDck(jeska99(), metaMap)
  assert.match(dck, /DeckType=Commander/, 'DeckType=Commander')
  assert.match(dck, /\[commander\]/, 'has [commander] section')
  assert.match(dck, /1 Jeska, Thrice Reborn\|C20/, 'commander line present')
})

test('AdapterDeck → XMage .dck: uses [SET:CN] name lines', () => {
  const dck = toXMageDck(bolt60(), metaMap)
  assert.match(dck, /4 \[M11:149\] Lightning Bolt/, 'Bolt with set + CN')
  assert.match(dck, /4 \[VIS:82\] Fireblast/, 'Fireblast with set + CN')
  assert.match(dck, /48 \[M11:242\] Mountain/, 'Mountain with set + CN')
})

test('AdapterDeck → XMage .dck: no leading SB: on main-deck lines', () => {
  const dck = toXMageDck(bolt60(), metaMap)
  for (const line of dck.split('\n').filter(Boolean)) {
    assert.doesNotMatch(line, /^SB:/, `main-deck line must not have SB: prefix: ${line}`)
  }
})

test('MockAdapter capabilities: supportsCommander + deterministicSeed true', async () => {
  const a = new MockAdapter()
  const caps = await a.capabilities()
  assert.strictEqual(caps.supportsCommander, true)
  assert.strictEqual(caps.supportsDeterministicSeed, true)
})

test('MockAdapter validateDeck: unmapped_oracle_card_ids surfaced', async () => {
  const a = new MockAdapter()
  const bad: AdapterDeck = {
    name: 'bad', format: 'modern', commanders: [],
    main: [
      { oracle_card_id: 'oracle-bolt', quantity: 4 },
      { oracle_card_id: 'oracle-unknown-xyz', quantity: 2 },
    ],
  }
  const r = await a.validateDeck(bad)
  assert.strictEqual(r.ok, false)
  assert.deepStrictEqual(r.unmapped_oracle_card_ids, ['oracle-unknown-xyz'])
})

test('MockAdapter startMatch: deterministic given the same seed', async () => {
  const a = new MockAdapter()
  const req: StartMatchRequest = {
    seed: 42,
    match: { format: 'modern', seats: [{ deck: bolt60() }, { deck: bolt60() }] },
  }
  const r1 = await a.startMatch(req)
  const r2 = await a.startMatch(req)
  assert.deepStrictEqual(r1.games[0].outcome, r2.games[0].outcome)
  assert.deepStrictEqual(r1.games[0].events, r2.games[0].events)
})

test('End-to-end: MTGPrices deck → deck-text → adapter → structured result', async () => {
  const a = new MockAdapter()
  const deck1 = bolt60()
  const deck2: AdapterDeck = {
    name: 'Slow 60 (test)', format: 'modern', commanders: [],
    main: [
      { oracle_card_id: 'oracle-mountain', quantity: 60 },  // no damage cards
    ],
  }
  // 1) Render deck text (this is what the adapter's own transport
  // would forward to Forge / XMage). Kept in-test as a sanity check.
  const forge1 = toForgeDck(deck1, metaMap)
  const forge2 = toForgeDck(deck2, metaMap)
  assert.ok(forge1.length > 0 && forge2.length > 0)

  // 2) Validate.
  const v1 = await a.validateDeck(deck1)
  const v2 = await a.validateDeck(deck2)
  assert.strictEqual(v1.ok, true)
  assert.strictEqual(v2.ok, true)

  // 3) Run the match.
  const result = await a.startMatch({
    seed: 7,
    match: { format: 'modern', seats: [{ deck: deck1 }, { deck: deck2 }] },
  })
  assert.strictEqual(result.status, 'complete')
  assert.strictEqual(result.games.length, 1)
  // Deck 1 has 12 damage cards → wins.
  assert.strictEqual(result.games[0].outcome, 'p1_win')
  // Result is structured: turns, events, finalLife, mulligans all present.
  assert.ok(result.games[0].turns > 0)
  assert.ok(result.games[0].events.length > 0)
  assert.strictEqual(result.games[0].events.at(-1)?.kind, 'game_end')
  assert.strictEqual(result.games[0].finalLife.length, 2)
  assert.strictEqual(result.games[0].mulligans.length, 2)
})
