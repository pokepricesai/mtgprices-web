// tests/mtg/forge-poc.test.ts
//
// Phase 4B.2 spike tests. Uses the real Forge 2.0.14 CLI output
// captured from the CI workflow (run-1game.txt / run-10games.txt /
// run-100games.txt / run-commander.txt / replay.txt) as parser
// fixtures. Also validates deck export + adapter shape.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { createRequire } from 'node:module'

// Shim `server-only` — tsx runs outside Next.js and `server-only`'s
// entry throws when required from a non-server context.
const _req = createRequire(import.meta.url)
try {
  const p = _req.resolve('server-only')
  ;(_req as any).cache[p] = { id: p, filename: p, loaded: true, exports: {}, children: [], paths: [], parent: null, path: p, isPreloading: false, require: _req } as any
} catch { /* not installed */ }

// The parser is a plain .mjs so `import()` works without any TS setup.
const parserPath = join(process.cwd(), 'scripts/phase4b-parse-forge-output.mjs')
async function parser() {
  return await import(new URL('file://' + parserPath.replace(/\\/g, '/')).href)
}

const FIX = (name: string) => readFileSync(join(process.cwd(), 'tests/fixtures/forge', name), 'utf8')

test('forge parser: 1-game log yields exactly 1 game with a real winner name', async () => {
  const { parseForgeOutput } = await parser()
  const games = parseForgeOutput(FIX('run-1game.txt'))
  assert.strictEqual(games.length, 1, `expected 1 game, got ${games.length}`)
  const g = games[0]
  assert.ok(['p1_win', 'p2_win'].includes(g.outcome), `unexpected outcome ${g.outcome}`)
  assert.ok(g.winner_name && /Ai\(\d\)-/.test(g.winner_name), `unexpected winner_name: ${g.winner_name}`)
  assert.ok(typeof g.duration_ms === 'number' && g.duration_ms > 0)
  assert.ok(g.turns != null && g.turns > 0, `non-quiet log should have turns > 0`)
})

test('forge parser: 10-game log yields exactly 10 games', async () => {
  const { parseForgeOutput, aggregate } = await parser()
  const games = parseForgeOutput(FIX('run-10games.txt'))
  assert.strictEqual(games.length, 10)
  const agg = aggregate(games)
  assert.strictEqual(agg.total, 10)
  assert.strictEqual(agg.p1_wins + agg.p2_wins + agg.draws + agg.unknown, 10)
  assert.strictEqual(agg.unknown, 0, 'no games should be unclassified')
})

test('forge parser: 100-game log yields exactly 100 games and matches captured win totals', async () => {
  const { parseForgeOutput, aggregate } = await parser()
  const games = parseForgeOutput(FIX('run-100games.txt'))
  assert.strictEqual(games.length, 100)
  const agg = aggregate(games)
  // Captured actual run: burn 72, stompy 28 (see phase4b-forge-poc-artifacts).
  assert.strictEqual(agg.p1_wins, 72, `expected 72 burn wins from real run, got ${agg.p1_wins}`)
  assert.strictEqual(agg.p2_wins, 28)
  assert.strictEqual(agg.draws, 0)
  assert.strictEqual(agg.unknown, 0)
  assert.ok(agg.avg_duration_ms && agg.avg_duration_ms > 0)
})

test('forge parser: Commander log picks up the winner + Game Outcome turn', async () => {
  const { parseForgeOutput } = await parser()
  const games = parseForgeOutput(FIX('run-commander.txt'))
  assert.strictEqual(games.length, 1)
  const g = games[0]
  assert.ok(g.winner_name && /Krenko Goblins/.test(g.winner_name))
  assert.ok(g.turns != null && g.turns >= 5, `commander game should reach real turns, got ${g.turns}`)
})

test('forge parser: replay log — same seed produces identical winners across the two runs', async () => {
  const { parseForgeOutput } = await parser()
  const games = parseForgeOutput(FIX('replay.txt'))
  // 6 games (3 + 3) same seed 314159. Adjacent pairs must agree in
  // outcome — the FIRST and FOURTH game agree, the SECOND and FIFTH,
  // and the THIRD and SIXTH.
  assert.strictEqual(games.length, 6, `expected 6 games, got ${games.length}`)
  for (let i = 0; i < 3; i++) {
    assert.strictEqual(games[i].outcome, games[i + 3].outcome, `game ${i} outcome differs across runs: ${games[i].outcome} vs ${games[i + 3].outcome}`)
    assert.strictEqual(games[i].winner_name, games[i + 3].winner_name, `winner_name differs across runs`)
  }
})

// ── Deck exporter shape ────────────────────────────────────────────

test('toForgeDck: burn deck ships as expected — matches on-disk fixture', async () => {
  const { toForgeDck } = await import('../../src/lib/mtg/simulation/deck-export')
  const deck = {
    name: 'Phase4B Burn 60',
    format: 'modern' as const,
    commanders: [],
    main: [
      { oracle_card_id: 'o-bolt', quantity: 4 },
      { oracle_card_id: 'o-mountain', quantity: 24 },
    ],
  }
  const meta = new Map([
    ['o-bolt',     { oracle_card_id: 'o-bolt',     name: 'Lightning Bolt', set_code: 'M11', collector_number: '149' }],
    ['o-mountain', { oracle_card_id: 'o-mountain', name: 'Mountain',       set_code: 'M11', collector_number: '242' }],
  ])
  const dck = toForgeDck(deck as any, meta as any)
  assert.match(dck, /^\[metadata\]$/m)
  assert.match(dck, /Name=Phase4B Burn 60/)
  assert.match(dck, /DeckType=Constructed/)
  assert.match(dck, /\[main\]/)
  assert.match(dck, /4 Lightning Bolt\|M11/)
  assert.match(dck, /24 Mountain\|M11/)
})

// The legacy ForgeRulesEngineAdapter HTTP class was removed in
// Phase 4B.3 — Vercel Queues + the Forge container Function replace
// it. The RulesEngineAdapter contract lives on as a type-only
// interface for future engines.
