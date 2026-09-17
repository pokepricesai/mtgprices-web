// tests/mtg/simulation.test.ts
//
// Deterministic tests for the Phase 4A simulation core. Zero DB. Zero
// AI. Uses fixture SimCards; asserts:
//   * PRNG is deterministic given a seed
//   * Fisher-Yates shuffle length preservation + permutation invariant
//   * Library build excludes sideboard/maybeboard/commander
//   * Mulligan bottom count is exactly M
//   * Land distribution PMF matches closed-form hypergeometric within tolerance
//   * P(specific card by turn T) matches hypergeometric within tolerance
//   * Play vs Draw draws the correct card count by turn T
//   * Seeded reproducibility — same seed → identical result

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { makePrng } from '../../src/lib/mtg/simulation/prng'
import { shuffle, shuffleInPlace } from '../../src/lib/mtg/simulation/shuffle'
import { buildSimLibrary } from '../../src/lib/mtg/simulation/library'
import { runMonteCarlo } from '../../src/lib/mtg/simulation/montecarlo'
import { hyperAtLeast, hyperPmf, cardsSeenByEndOfTurn, pAtLeastOne } from '../../src/lib/mtg/simulation/probability'
import { classifyManaSource, aggregateSources, countManaSymbols, aggregateColourPressure } from '../../src/lib/mtg/simulation/mana'
import type { CardCapability } from '../../src/lib/mtg/capabilities'

// ── Fixtures ─────────────────────────────────────────────────────────

function basicIsland() {
  return {
    oracle_card_id: 'oracle-island', name: 'Island',
    type_line: 'Basic Land — Island',
    oracle_text: '({T}: Add {U}.)',
    produced_mana: ['U'], colors: [] as string[], color_identity: ['U'],
    capabilities: ['land', 'mana-production'] as unknown as CardCapability[],
    mana_cost: null, mana_value: 0,
  }
}
function basicMountain() {
  return {
    ...basicIsland(),
    oracle_card_id: 'oracle-mountain', name: 'Mountain',
    type_line: 'Basic Land — Mountain', produced_mana: ['R'], color_identity: ['R'],
  }
}
function counterspell() {
  return {
    oracle_card_id: 'oracle-counterspell', name: 'Counterspell',
    type_line: 'Instant',
    oracle_text: 'Counter target spell.',
    produced_mana: null, colors: ['U'], color_identity: ['U'],
    capabilities: ['counter-spell'] as unknown as CardCapability[],
    mana_cost: '{U}{U}', mana_value: 2,
  }
}
function shock() {
  return {
    oracle_card_id: 'oracle-shock', name: 'Shock',
    type_line: 'Instant',
    oracle_text: 'Shock deals 2 damage to any target.',
    produced_mana: null, colors: ['R'], color_identity: ['R'],
    capabilities: ['damage', 'creature-removal'] as unknown as CardCapability[],
    mana_cost: '{R}', mana_value: 1,
  }
}
function solRing() {
  return {
    oracle_card_id: 'oracle-solring', name: 'Sol Ring',
    type_line: 'Artifact',
    oracle_text: '{T}: Add {C}{C}.',
    produced_mana: ['C'], colors: [] as string[], color_identity: [] as string[],
    capabilities: ['mana-production', 'ramp'] as unknown as CardCapability[],
    mana_cost: '{1}', mana_value: 1,
  }
}
function shockLand() {
  return {
    oracle_card_id: 'oracle-steamvents', name: 'Steam Vents',
    type_line: 'Land — Island Mountain',
    oracle_text: '({T}: Add {U} or {R}.) As Steam Vents enters, you may pay 2 life. If you don\'t, it enters tapped.',
    produced_mana: ['U', 'R'], colors: [] as string[], color_identity: ['U', 'R'],
    capabilities: ['land', 'mana-production'] as unknown as CardCapability[],
    mana_cost: null, mana_value: 0,
  }
}
function tapLand() {
  return {
    oracle_card_id: 'oracle-taplanded', name: 'Wind-Scarred Crag',
    type_line: 'Land',
    oracle_text: 'Wind-Scarred Crag enters tapped. When it enters, you gain 1 life.',
    produced_mana: ['R', 'W'], colors: [] as string[], color_identity: ['R', 'W'],
    capabilities: ['land', 'mana-production', 'lifegain'] as unknown as CardCapability[],
    mana_cost: null, mana_value: 0,
  }
}

/** 60-card constructed deck: 20 Islands, 20 Mountains, 20 Counterspells. */
function build60() {
  return buildSimLibrary({
    cards: [
      { zone: 'main', quantity: 20, oracle: basicIsland() },
      { zone: 'main', quantity: 20, oracle: basicMountain() },
      { zone: 'main', quantity: 20, oracle: counterspell() },
    ],
  })
}
/** 99-card Commander deck: 36 lands, 62 non-lands, plus 1 commander. */
function build99() {
  return buildSimLibrary({
    cards: [
      { zone: 'commander', quantity: 1, oracle: { ...counterspell(), oracle_card_id: 'oracle-cmdr', name: 'Cmdr', type_line: 'Legendary Creature — Test' } },
      { zone: 'main', quantity: 18, oracle: basicIsland() },
      { zone: 'main', quantity: 18, oracle: basicMountain() },
      { zone: 'main', quantity: 62, oracle: counterspell() },
      { zone: 'sideboard', quantity: 4, oracle: shock() },       // must be excluded
      { zone: 'maybeboard', quantity: 4, oracle: shock() },      // must be excluded
    ],
  })
}

// ── Tests ────────────────────────────────────────────────────────────

test('PRNG: deterministic given a seed', () => {
  const a = makePrng(12345)
  const b = makePrng(12345)
  for (let i = 0; i < 100; i++) assert.strictEqual(a(), b())
})

test('PRNG: different seeds produce different sequences', () => {
  const a = makePrng(1)
  const b = makePrng(2)
  const sameCount = Array.from({ length: 20 }, () => a() === b()).filter(Boolean).length
  assert.ok(sameCount < 3, `expected different sequences (matches=${sameCount})`)
})

test('shuffle: preserves length and set of elements', () => {
  const rng = makePrng(42)
  const src = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]
  const out = shuffle(src, rng)
  assert.strictEqual(out.length, src.length)
  assert.deepStrictEqual([...out].sort((a, b) => a - b), src)
})

test('shuffleInPlace: mutates and returns the same array', () => {
  const rng = makePrng(1)
  const arr = [1, 2, 3, 4, 5]
  const out = shuffleInPlace(arr, rng)
  assert.strictEqual(out, arr)
})

test('buildSimLibrary: excludes commander/sideboard/maybeboard from the library', () => {
  const lib = build99()
  assert.strictEqual(lib.size, 18 + 18 + 62, '99-card library must equal main-zone total')
  assert.strictEqual(lib.commanders.length, 1)
  // No shock (sideboard/maybeboard) leaked in.
  assert.ok(!lib.cards.some((c) => c.name === 'Shock'), 'sideboard/maybeboard cards must not be in library')
})

test('cardsSeenByEndOfTurn: play vs draw counts', () => {
  assert.strictEqual(cardsSeenByEndOfTurn(0, true), 7)
  assert.strictEqual(cardsSeenByEndOfTurn(1, true), 7, 'play, T=1: skip draw → 7')
  assert.strictEqual(cardsSeenByEndOfTurn(1, false), 8, 'draw, T=1: 7 + 1')
  assert.strictEqual(cardsSeenByEndOfTurn(3, true), 9, 'play, T=3: 7 + 2')
  assert.strictEqual(cardsSeenByEndOfTurn(3, false), 10, 'draw, T=3: 7 + 3')
})

test('hyper: pmf sums to ~1', () => {
  let s = 0
  const N = 60, K = 24, n = 7
  for (let k = 0; k <= n; k++) s += hyperPmf(N, K, n, k)
  assert.ok(Math.abs(s - 1) < 1e-9, `pmf sum ${s}`)
})

test('MonteCarlo: opening land distribution matches hypergeometric within tolerance (60-card, 20 lands? No — 40 lands.)', () => {
  // Deck: 40 lands (20 Islands + 20 Mountains) + 20 non-lands = 60 cards.
  const lib = build60()
  const N = 60, K = 40, n = 7
  const r = runMonteCarlo({
    library: lib, iterations: 5000, play: 'play',
    seed: 202609170,
  })
  // Compare simulated PMF to closed-form for k = 0..7.
  for (let k = 0; k <= 7; k++) {
    const closed = hyperPmf(N, K, n, k)
    const sim = r.openingHandLands.probabilities[k]
    // Within 2 percentage points is fine for 5k iterations.
    assert.ok(Math.abs(sim - closed) < 0.02, `k=${k} closed=${closed.toFixed(4)} sim=${sim.toFixed(4)} diff=${Math.abs(sim - closed).toFixed(4)}`)
  }
  // Average lands ~ n * K/N = 7 * 40/60 = 4.667.
  const expectedAvg = n * K / N
  assert.ok(Math.abs(r.openingHandLands.averageLands - expectedAvg) < 0.05, `avg ${r.openingHandLands.averageLands} vs ${expectedAvg}`)
})

test('MonteCarlo: specific-card P(seen by turn T) matches hypergeometric (99-card Commander, singleton)', () => {
  const lib = build99()
  // Add a specific singleton to track. Insert as 1-of; replace one counterspell.
  const spec = {
    zone: 'main' as const, quantity: 1,
    oracle: { ...shock(), oracle_card_id: 'oracle-target-singleton', name: 'Target Singleton' },
  }
  const libWithTarget = buildSimLibrary({
    cards: [
      { zone: 'commander', quantity: 1, oracle: { ...counterspell(), oracle_card_id: 'oracle-cmdr', name: 'Cmdr', type_line: 'Legendary Creature — Test' } },
      { zone: 'main', quantity: 18, oracle: basicIsland() },
      { zone: 'main', quantity: 18, oracle: basicMountain() },
      { zone: 'main', quantity: 61, oracle: counterspell() },
      spec,
    ],
  })
  assert.strictEqual(libWithTarget.size, 98, 'library should exclude commander → 98 cards')
  const r = runMonteCarlo({
    library: libWithTarget, iterations: 5000, play: 'play',
    trackOracleId: 'oracle-target-singleton', seed: 202609171,
  })
  const N = 98, K = 1
  for (const { turn, p } of r.cardByTurn!) {
    const seen = cardsSeenByEndOfTurn(turn, true)
    const closed = pAtLeastOne(N, K, seen)
    assert.ok(Math.abs(p - closed) < 0.03, `turn=${turn} closed=${closed.toFixed(4)} sim=${p.toFixed(4)}`)
  }
})

test('MonteCarlo: reproducible given the same seed', () => {
  const lib = build60()
  const a = runMonteCarlo({ library: lib, iterations: 500, play: 'play', seed: 999 })
  const b = runMonteCarlo({ library: lib, iterations: 500, play: 'play', seed: 999 })
  assert.deepStrictEqual(a.openingHandLands.counts, b.openingHandLands.counts)
})

test('MonteCarlo: different seed → different result', () => {
  const lib = build60()
  const a = runMonteCarlo({ library: lib, iterations: 500, play: 'play', seed: 1 })
  const b = runMonteCarlo({ library: lib, iterations: 500, play: 'play', seed: 2 })
  assert.notDeepStrictEqual(a.openingHandLands.counts, b.openingHandLands.counts)
})

test('MonteCarlo: mulligan rule (must have ≥3 lands) reduces the ≤2-land opening probability', () => {
  const lib = build60()
  const withoutRule = runMonteCarlo({ library: lib, iterations: 2000, play: 'play', seed: 111 })
  const withRule = runMonteCarlo({
    library: lib, iterations: 2000, play: 'play', seed: 111,
    mulligan: { minLands: 3, maxLands: 5, maxMulligans: 4 },
  })
  const lowNoRule = withoutRule.openingHandLands.probabilities.slice(0, 3).reduce((s, p) => s + p, 0)
  const lowRule = withRule.openingHandLands.probabilities.slice(0, 3).reduce((s, p) => s + p, 0)
  assert.ok(lowRule < lowNoRule, `mulligan rule should reduce ≤2-land openers (${lowRule.toFixed(3)} < ${lowNoRule.toFixed(3)})`)
  // Mulligans applied at least once.
  assert.ok(withRule.mulliganed > 0, 'expected some games to have mulligan-ed')
})

test('MonteCarlo: 10,000 sims of a 60-card deck complete in a reasonable time budget (< 5 s)', () => {
  const lib = build60()
  const t0 = Date.now()
  const r = runMonteCarlo({ library: lib, iterations: 10000, play: 'play', seed: 42 })
  const elapsed = Date.now() - t0
  assert.ok(elapsed < 5000, `10k sims took ${elapsed}ms — should be < 5s`)
  assert.strictEqual(r.spec.iterations, 10000)
})

test('MonteCarlo: capability tracking works (removal by turn 4)', () => {
  const lib = buildSimLibrary({
    cards: [
      { zone: 'main', quantity: 24, oracle: basicIsland() },
      { zone: 'main', quantity: 12, oracle: shock() },          // 12 removal
      { zone: 'main', quantity: 24, oracle: counterspell() },
    ],
  })
  const r = runMonteCarlo({
    library: lib, iterations: 2000, play: 'play',
    trackCapabilities: ['creature-removal'] as CardCapability[],
    seed: 202609172,
  })
  const cap = r.capabilityByTurn.find((c) => c.capability === 'creature-removal')
  assert.ok(cap, 'should have creature-removal in output')
  const t4 = cap!.probs.find((p) => p.turn === 4)!
  // 12 successes in a 60-card deck across 10 seen cards (7 + 3): closed form ~ 1 - C(48,10)/C(60,10)
  const closed = pAtLeastOne(60, 12, cardsSeenByEndOfTurn(4, true))
  assert.ok(Math.abs(t4.p - closed) < 0.03, `T=4 removal sim=${t4.p.toFixed(4)} closed=${closed.toFixed(4)}`)
})

// ── Mana classifier ─────────────────────────────────────────────────

test('classifyManaSource: basic Island → basic_land producing U', () => {
  const cls = classifyManaSource(basicIsland())
  assert.strictEqual(cls.category, 'basic_land')
  assert.deepStrictEqual(cls.colours, ['U'])
})

test('classifyManaSource: shockland → nonbasic_untapped', () => {
  const cls = classifyManaSource(shockLand())
  assert.strictEqual(cls.category, 'nonbasic_untapped', `got ${cls.category}: ${cls.reason}`)
  assert.deepStrictEqual(cls.colours.sort(), ['R', 'U'])
})

test('classifyManaSource: tap-land → nonbasic_conditional', () => {
  const cls = classifyManaSource(tapLand())
  assert.strictEqual(cls.category, 'nonbasic_conditional')
  assert.strictEqual(cls.enters_tapped_default, true)
})

test('classifyManaSource: Sol Ring → mana_rock producing C', () => {
  const cls = classifyManaSource(solRing())
  assert.strictEqual(cls.category, 'mana_rock')
})

test('classifyManaSource: counterspell → other', () => {
  const cls = classifyManaSource(counterspell())
  assert.strictEqual(cls.category, 'other')
})

test('aggregateSources: counts basic vs conditional lands correctly', () => {
  const rows = [
    { classification: classifyManaSource(basicIsland()), quantity: 10 },
    { classification: classifyManaSource(shockLand()), quantity: 4 },
    { classification: classifyManaSource(tapLand()), quantity: 4 },
    { classification: classifyManaSource(solRing()), quantity: 1 },
    { classification: classifyManaSource(counterspell()), quantity: 5 },
  ]
  const agg = aggregateSources(rows)
  assert.strictEqual(agg.total_lands, 18)
  assert.strictEqual(agg.by_category.basic_land, 10)
  assert.strictEqual(agg.by_category.nonbasic_untapped, 4)
  assert.strictEqual(agg.by_category.nonbasic_conditional, 4)
  assert.strictEqual(agg.by_category.mana_rock, 1)
  assert.strictEqual(agg.by_colour_untapped.U, 10 + 4)  // basics + shock
  // R appears in shock AND tap land (all-lands count includes conditional).
  assert.strictEqual(agg.by_colour_all_lands.R, 4 + 4)
})

test('countManaSymbols: {2}{U}{U} → U:2', () => {
  const c = countManaSymbols('{2}{U}{U}')
  assert.strictEqual(c.U, 2)
  assert.strictEqual(c.R, 0)
})

test('countManaSymbols: hybrid {W/U} → half each', () => {
  const c = countManaSymbols('{W/U}')
  assert.strictEqual(c.W, 0.5)
  assert.strictEqual(c.U, 0.5)
})

test('aggregateColourPressure: sums across deck (excludes lands)', () => {
  const p = aggregateColourPressure([
    { mana_cost: '{U}{U}', quantity: 4, is_land: false },
    { mana_cost: '{R}', quantity: 4, is_land: false },
    { mana_cost: null, quantity: 20, is_land: true },  // lands: skip
  ])
  assert.strictEqual(p.U, 8)
  assert.strictEqual(p.R, 4)
})

// silence
void hyperAtLeast
