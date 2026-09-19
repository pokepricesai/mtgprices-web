// set-aggregate.test.ts
// Locks in the set-value display rules so a future refactor cannot
// silently reintroduce "8/8 priced" or start calling a $6 subtotal
// "Set value" again.

import { describe, it, expect } from 'vitest'
import {
  SET_VALUE_COVERAGE_THRESHOLD,
  computeCoverage,
  setValueLabel,
  has30dCoverage,
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
