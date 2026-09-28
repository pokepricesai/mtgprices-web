// Ranking policy tests — Pass 2A.
//
// Covers robustHeadlinePrice + isHistoricallyImplausible. These are
// pure functions, so the tests do NOT touch Supabase and stay fast.

import { describe, it, expect } from 'vitest'
import {
  robustHeadlinePrice,
  isHistoricallyImplausible,
  CROSS_SOURCE_MAX_RATIO,
  HISTORICAL_MAX_RATIO,
} from '../lib/mtg/ranking'
import type { MtgCurrentPrice } from '../lib/mtg/prices'

function row(provider: string, price: number, overrides: Partial<MtgCurrentPrice> = {}): MtgCurrentPrice {
  return {
    printing_finish_id: 'pf-1',
    provider,
    market: 'paper',
    currency: 'USD',
    price_type: 'retail',
    condition: 'nm',
    price,
    observed_on: '2026-09-28',
    ingestion_source: 'test',
    ...overrides,
  }
}

describe('robustHeadlinePrice', () => {
  it('returns null on empty input', () => {
    const d = robustHeadlinePrice([])
    expect(d.price).toBeNull()
    expect(d.method).toBe('no-data')
    expect(d.suppressedOutlier).toBe(false)
  })

  it('single source is trusted unconditionally', () => {
    // Even a $237,559 single source survives — history is what catches
    // this case, not the cross-source rule. The rule cannot invent a
    // second opinion out of nothing.
    const d = robustHeadlinePrice([row('manapool', 237_559.44)])
    expect(d.method).toBe('single-source')
    expect(d.suppressedOutlier).toBe(false)
    expect(d.price?.provider).toBe('manapool')
    expect(d.price?.price).toBe(237_559.44)
  })

  it('ordinary in-range prices agree and produce headline via preferred order', () => {
    // Ragavan-style spread: five sources within 3x. All survive; TCGplayer
    // wins as the preferred display convention.
    const d = robustHeadlinePrice([
      row('cardhoarder', 65),
      row('cardmarket', 62),
      row('cardkingdom', 79.99),
      row('manapool', 61.5),
      row('tcgplayer', 60),
    ])
    expect(d.suppressedOutlier).toBe(false)
    expect(d.method).toBe('cross-source-agreement')
    expect(d.price?.provider).toBe('tcgplayer')
    expect(d.excludedProviders).toEqual([])
  })

  it('huge price with strong cross-source disagreement is suppressed', () => {
    // Living Artifact 30a scenario: ManaPool $237,559 vs Card Kingdom
    // $329. Min-anchor rule: 237559 / 329 = 722x >> 10x threshold.
    const d = robustHeadlinePrice([
      row('cardkingdom', 329.99),
      row('manapool', 237_559.44),
    ])
    expect(d.suppressedOutlier).toBe(true)
    expect(d.method).toBe('cross-source-filtered')
    expect(d.excludedProviders).toEqual(['manapool'])
    expect(d.price?.provider).toBe('cardkingdom')
    expect(d.reason).toMatch(/1 source\(s\) exceeded 10x/)
  })

  it('huge price with corroborating cross-source support is retained', () => {
    // Alpha Black Lotus scenario. Two sources agree in the $130-180k range,
    // one is meaningfully lower. All within 10x of every other, so NO
    // exclusion — a genuinely-expensive vintage card is preserved.
    const d = robustHeadlinePrice([
      row('cardkingdom', 149_999.99),
      row('tcgplayer', 165_000),
      row('cardmarket', 138_000),
    ])
    expect(d.suppressedOutlier).toBe(false)
    expect(d.method).toBe('cross-source-agreement')
    // Ratio check: 165000 / 138000 ≈ 1.20, well under 10x.
    expect(d.excludedProviders).toEqual([])
  })

  it('bimodal disagreement (two mirrored bad feeds vs two sane) still fingers the bad two', () => {
    // The exact case min-anchor was designed for: TCGGraph.manapool +
    // MTGJSON.manapool both mirror the same corruption. Median would
    // land between the two clusters and miss it. Min-anchor uses
    // per-source vs min-of-others so both bad sources are excluded.
    const d = robustHeadlinePrice([
      row('cardkingdom', 329.99),
      row('cardmarket', 285),
      row('manapool', 237_559.44),
      row('tcgplayer', 237_559.44),
    ])
    expect(d.suppressedOutlier).toBe(true)
    expect(new Set(d.excludedProviders)).toEqual(new Set(['manapool', 'tcgplayer']))
    // Chosen falls back to CK via preferred order (TCGplayer was
    // excluded, so CK is next-in-line).
    expect(d.price?.provider).toBe('cardkingdom')
  })

  it('below MIN_TEST_PRICE the ratio rule stays quiet (avoids penny-card noise)', () => {
    // Two sources: $0.10 vs $0.02 is a 5x ratio but not a data
    // problem. Both survive.
    const d = robustHeadlinePrice([
      row('tcgplayer', 0.10),
      row('cardmarket', 0.02),
    ])
    expect(d.suppressedOutlier).toBe(false)
  })

  it('constants are exposed and defensible', () => {
    expect(CROSS_SOURCE_MAX_RATIO).toBeGreaterThanOrEqual(5)
    expect(CROSS_SOURCE_MAX_RATIO).toBeLessThanOrEqual(15)
    expect(HISTORICAL_MAX_RATIO).toBeGreaterThanOrEqual(10)
  })
})

describe('isHistoricallyImplausible', () => {
  it('returns false when history is unavailable', () => {
    expect(isHistoricallyImplausible(50_000, null)).toBe(false)
    expect(isHistoricallyImplausible(50_000, undefined)).toBe(false)
    expect(isHistoricallyImplausible(50_000, 0)).toBe(false)
    expect(isHistoricallyImplausible(50_000, Number.NaN)).toBe(false)
  })

  it('flags current when it exceeds HISTORICAL_MAX_RATIO x median', () => {
    // Soul Net-style single-source spike. If we had a $329 median in
    // history, a $98,972 current is 300x — clearly implausible.
    expect(isHistoricallyImplausible(98_972, 329)).toBe(true)
    // Just over the threshold.
    expect(isHistoricallyImplausible(HISTORICAL_MAX_RATIO * 100 + 1, 100)).toBe(true)
  })

  it('does not flag when current is within HISTORICAL_MAX_RATIO x median', () => {
    // Real vintage-MTG spike: 5x jump on a $10,000 card. Not implausible.
    expect(isHistoricallyImplausible(50_000, 10_000)).toBe(false)
    // Right at the threshold.
    expect(isHistoricallyImplausible(HISTORICAL_MAX_RATIO * 100, 100)).toBe(false)
  })

  it('does not flag sub-$1 noise', () => {
    // A $0.50 current with a $0.01 median is 50x but not diagnostic.
    expect(isHistoricallyImplausible(0.50, 0.01)).toBe(false)
  })
})
