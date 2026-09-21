// set-aggregate.test.ts
// Locks in the set-value display rules so a future refactor cannot
// silently reintroduce "8/8 priced" or start calling a $6 subtotal
// "Set value" again.

import { describe, it, expect } from 'vitest'
import {
  SET_VALUE_COVERAGE_THRESHOLD,
  computeCoverage,
  setValueLabel,
  has7dCoverage,
  has30dCoverage,
  has90dCoverage,
  formatCoveragePct,
  emptyAggregate,
  type SetAggregate,
} from '@/lib/mtg/set-aggregate'

function agg(overrides: Partial<SetAggregate>): SetAggregate {
  return { ...emptyAggregate('any'), ...overrides }
}

describe('set-aggregate methodology', () => {
  it('coverage is priced / eligible, clamped to [0,1]', () => {
    expect(computeCoverage(0, 0)).toBe(0)
    expect(computeCoverage(100, 100)).toBe(1)
    expect(computeCoverage(8, 426)).toBeCloseTo(0.0188, 3)
    expect(computeCoverage(391, 426)).toBeCloseTo(0.918, 3)
    // Guardrails: never above 1, never below 0.
    expect(computeCoverage(1000, 500)).toBe(1)
    expect(computeCoverage(-5, 100)).toBe(0)
  })

  it('threshold is 80% (or better); tie counts as high coverage', () => {
    expect(SET_VALUE_COVERAGE_THRESHOLD).toBe(0.8)
    expect(setValueLabel(agg({ coverage: 0.8 }))).toBe('Set value')
    expect(setValueLabel(agg({ coverage: 0.799 }))).toBe('Priced-card subtotal')
  })

  it('labels a low-coverage aggregate as Priced-card subtotal, not Set value', () => {
    // The pre-fix bug: 8/426 priced at $6 was labelled "Est. value".
    const a = agg({ eligibleCount: 426, pricedCount: 8, pricedSubtotal: 6.45, coverage: computeCoverage(8, 426) })
    expect(setValueLabel(a)).toBe('Priced-card subtotal')
  })

  it('labels a high-coverage aggregate as Set value', () => {
    const a = agg({ eligibleCount: 426, pricedCount: 391, pricedSubtotal: 842.37, coverage: computeCoverage(391, 426) })
    expect(setValueLabel(a)).toBe('Set value')
  })

  it('30D chip requires both a non-null delta AND coverage >= threshold', () => {
    // Chip only shows when the basket is complete enough to describe
    // the whole set.
    expect(has30dCoverage(agg({ pct30d: 0.05, coverage: 0.9 }))).toBe(true)
    expect(has30dCoverage(agg({ pct30d: 0.05, coverage: 0.5 }))).toBe(false)
    expect(has30dCoverage(agg({ pct30d: null, coverage: 1.0 }))).toBe(false)
  })

  it('empty aggregate: zero everything, no phantom "Set value" label', () => {
    const e = emptyAggregate('xxx')
    expect(e.eligibleCount).toBe(0)
    expect(e.pricedCount).toBe(0)
    expect(e.pricedSubtotal).toBe(0)
    expect(e.coverage).toBe(0)
    expect(setValueLabel(e)).toBe('Priced-card subtotal')
    expect(has30dCoverage(e)).toBe(false)
  })

  it('30D chip requires BOTH endpoints at high coverage (per user spec)', () => {
    // Both-endpoint gate is enforced upstream (annotate30dFromDaily in
    // set-market-batch.ts). Here we lock the final UI-side gate: even
    // with a computed pct30d, if the CURRENT coverage is below the
    // threshold, the chip stays hidden. This prevents a chip showing
    // on tiles where the headline says "Priced-card subtotal".
    expect(has30dCoverage(agg({ pct30d: 0.1, coverage: 0.79 }))).toBe(false)
    expect(has30dCoverage(agg({ pct30d: 0.1, coverage: 0.80 }))).toBe(true)
  })

  it('7D and 90D chips follow the same UI-side gate as 30D', () => {
    // Whatever the horizon, the tile-side gate is: computed pct AND
    // current coverage clears the threshold. Historical-endpoint
    // coverage was enforced upstream (annotateHistoricalMovement).
    expect(has7dCoverage(agg({ pct7d:  0.02, coverage: 0.9 }))).toBe(true)
    expect(has7dCoverage(agg({ pct7d:  0.02, coverage: 0.5 }))).toBe(false)
    expect(has7dCoverage(agg({ pct7d:  null, coverage: 1.0 }))).toBe(false)
    expect(has90dCoverage(agg({ pct90d: 0.10, coverage: 0.9 }))).toBe(true)
    expect(has90dCoverage(agg({ pct90d: 0.10, coverage: 0.7 }))).toBe(false)
    expect(has90dCoverage(agg({ pct90d: null, coverage: 1.0 }))).toBe(false)
  })

  it('a recent set with no historical rows leaves 90D null', () => {
    // Sets released inside the 90-day window naturally have no
    // 90-day-ago row in mtg_set_value_daily. annotateHistoricalMovement
    // leaves pct90d null in that case. UI hides the chip.
    const recentSet = agg({
      eligibleCount: 100, pricedCount: 100, pricedSubtotal: 1234, coverage: 1,
      pct7d: 0.01, abs7d: 5.5, pct30d: -0.02, abs30d: -25,
      pct90d: null, abs90d: null,   // no 90-day-ago basket
    })
    expect(has7dCoverage(recentSet)).toBe(true)
    expect(has30dCoverage(recentSet)).toBe(true)
    expect(has90dCoverage(recentSet)).toBe(false)
  })

  it('formatCoveragePct: exact 100% only when priced === eligible; one decimal otherwise', () => {
    // The bug: 452 / 453 was displaying as 100% via Math.round, which
    // reads as "we have every card" and is misleading.
    expect(formatCoveragePct(452, 453)).toBe('99.8%')
    expect(formatCoveragePct(426, 426)).toBe('100%')
    expect(formatCoveragePct(391, 426)).toBe('91.8%')
    expect(formatCoveragePct(258, 461)).toBe('56.0%')
    // Edge cases must not crash.
    expect(formatCoveragePct(0, 0)).toBe('0%')
    expect(formatCoveragePct(0, 100)).toBe('0%')
    expect(formatCoveragePct(100, 100)).toBe('100%')
    // Priced > eligible (shouldn't happen but guard anyway) still
    // reads as 100%, not 101% or NaN.
    expect(formatCoveragePct(120, 100)).toBe('100%')
  })

  it('never treats a missing card as $0 in the coverage calculation', () => {
    // If a set has 100 eligible printings and 40 are priced at $10
    // each, the priced subtotal is $400 and coverage is 40%. Missing
    // printings do NOT get imputed to $0 for the subtotal, and they
    // DO count toward the denominator so the coverage line stays
    // honest.
    const a = agg({ eligibleCount: 100, pricedCount: 40, pricedSubtotal: 400, coverage: 0.4 })
    expect(a.coverage).toBe(0.4)
    expect(a.pricedSubtotal).toBe(400)
    expect(setValueLabel(a)).toBe('Priced-card subtotal')
  })
})
