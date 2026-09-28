// src/lib/mtg/ranking.ts
//
// Evidence-based outlier suppression for MTG pricing.
//
// Design constraints (Pass 2A):
//   * NEVER a global hard ceiling. Vintage MTG cards are genuinely
//     expensive — a $150,000 Alpha Black Lotus is a real price.
//   * NEVER mutate or delete historical data. Suppression is applied
//     at read/ranking time only.
//   * Prefer cross-source agreement. When a printing has ≥2 sources
//     and one disagrees with the median by more than
//     CROSS_SOURCE_MAX_RATIO, that source is a candidate outlier.
//   * Prefer historical context. A price that is > HISTORICAL_MAX_RATIO
//     times the printing's own 30-day historical median is implausible.
//
// The two functions here are pure and side-effect free so they can be
// unit tested + reused by an audit script that materialises the
// before/after top-20 for evidence.
//
// Usage:
//   const decision = robustHeadlinePrice(currentPriceRows)
//   if (decision.price) …
//   const bad = isHistoricallyImplausible(current, mtg30dMedian)

import type { MtgCurrentPrice } from './prices'

/** When one source's current price divided by the MINIMUM of every
 *  OTHER source's price for the same printing+finish exceeds this
 *  factor, that source is a probable outlier. Min-anchor beats
 *  median-anchor here because feed-corruption values tend to be
 *  bimodal: TCGGraph+MTGJSON might both mirror the same bad
 *  ManaPool value, so the median moves halfway to the corruption.
 *  Min-anchor stays pinned to the plausible price and reliably
 *  fingers the corruption. 10x is deliberately generous: real
 *  cross-marketplace variance is usually <3x. */
export const CROSS_SOURCE_MAX_RATIO = 10

/** When a single-source current price divided by the same printing's
 *  own 30-day historical median exceeds this factor, treat it as
 *  historically implausible. 20x is generous: real short-term spikes
 *  on speculation can be 5-10x, so 20x only catches feed corruption
 *  or a data provider spike we can already contradict from history. */
export const HISTORICAL_MAX_RATIO = 20

/** Minimum price we will consider "implausibility"-testable. Below
 *  this, ratios are noise (a $0.01 median vs $0.30 current is a 30x
 *  ratio but not actually a data quality problem). */
const MIN_TEST_PRICE = 1

export type RankingDecision = {
  /** The chosen headline row, or null if none survived. */
  price: MtgCurrentPrice | null
  /** True when at least one source was rejected as a probable outlier. */
  suppressedOutlier: boolean
  /** How the decision was made. */
  method: 'no-data' | 'single-source' | 'cross-source-agreement' | 'cross-source-filtered'
  /** Providers whose prices were excluded from ranking. */
  excludedProviders: string[]
  /** Human-readable note for logs / audits. */
  reason: string | null
}

/** Compute the median of an array of positive numbers. Retained for
 *  the historical-implausibility rule (single-source with long
 *  history — median is a fine central estimator there). */
function median(nums: number[]): number {
  if (nums.length === 0) return 0
  const sorted = nums.slice().sort((a, b) => a - b)
  const mid = Math.floor(sorted.length / 2)
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid]
}

// The preferred-provider order matches the display convention used by
// pickHeadlinePrice: TCGplayer paper retail is the canonical basis when
// multiple sources survive. This module ONLY reads paper/USD/retail
// rows — filtering to that basis is the caller's job so history and
// current stay comparable.
const PREFERRED_ORDER = ['tcgplayer', 'cardkingdom', 'cardmarket', 'manapool', 'cardhoarder']

function pickByPreferredOrder(rows: MtgCurrentPrice[]): MtgCurrentPrice | null {
  if (rows.length === 0) return null
  for (const p of PREFERRED_ORDER) {
    const hit = rows.find((r) => r.provider === p)
    if (hit) return hit
  }
  return rows[0]
}

/** Choose a robust headline price from same-basis current-price rows.
 *
 *  Contract:
 *    - Input rows MUST already be filtered to a single basis
 *      (market=paper, currency=USD, price_type=retail). Mixed bases
 *      would break the median comparison.
 *    - Returns the best surviving row + provenance describing what
 *      was excluded and why.
 *    - When only one source exists, the row is trusted (no
 *      cross-source signal to compare against).
 *    - When ≥2 sources exist and one is >CROSS_SOURCE_MAX_RATIO from
 *      the median, that source is dropped and re-selection runs on
 *      the remainder using preferred-provider order.
 */
export function robustHeadlinePrice(rows: MtgCurrentPrice[]): RankingDecision {
  if (rows.length === 0) {
    return { price: null, suppressedOutlier: false, method: 'no-data', excludedProviders: [], reason: null }
  }
  if (rows.length === 1) {
    return { price: rows[0], suppressedOutlier: false, method: 'single-source', excludedProviders: [], reason: null }
  }
  const usable = rows
    .map((r) => ({ row: r, price: Number(r.price) }))
    .filter((x) => Number.isFinite(x.price) && x.price > 0)
  if (usable.length < 2) {
    return {
      price: usable[0]?.row ?? pickByPreferredOrder(rows),
      suppressedOutlier: false,
      method: 'single-source',
      excludedProviders: [],
      reason: usable.length === 0 ? 'no usable numeric prices' : null,
    }
  }
  // Min-anchor rule: for each source, compare against the minimum
  // price across the OTHERS. If it exceeds CROSS_SOURCE_MAX_RATIO,
  // it's a probable outlier. This survives bimodal distributions
  // where two mirrored feeds report the same corruption.
  const surviving: MtgCurrentPrice[] = []
  const excluded: string[] = []
  for (let i = 0; i < usable.length; i++) {
    const me = usable[i]
    const others = usable.filter((_, j) => j !== i).map((x) => x.price)
    const minOther = Math.min(...others)
    if (minOther <= 0) { surviving.push(me.row); continue }
    const ratio = me.price / minOther
    if (ratio > CROSS_SOURCE_MAX_RATIO && me.price >= MIN_TEST_PRICE) {
      excluded.push(me.row.provider)
    } else {
      surviving.push(me.row)
    }
  }
  if (excluded.length === 0) {
    return {
      price: pickByPreferredOrder(rows),
      suppressedOutlier: false,
      method: 'cross-source-agreement',
      excludedProviders: [],
      reason: null,
    }
  }
  const chosen = pickByPreferredOrder(surviving) ?? pickByPreferredOrder(rows)
  const minAll = Math.min(...usable.map((x) => x.price))
  return {
    price: chosen,
    suppressedOutlier: true,
    method: 'cross-source-filtered',
    excludedProviders: excluded,
    reason: `${excluded.length} source(s) exceeded ${CROSS_SOURCE_MAX_RATIO}x min-of-others (min=$${minAll.toFixed(2)})`,
  }
}

/** True when a current price is more than HISTORICAL_MAX_RATIO times
 *  the same printing's 30-day historical median. Used to catch
 *  single-source spikes that cross-source agreement can't detect
 *  because there IS no second source.
 *
 *  Returns false when historicalMedian is null / zero / non-finite:
 *  we cannot reason about implausibility without history, so we
 *  err on the side of trusting the current price. */
export function isHistoricallyImplausible(
  currentPrice: number,
  historicalMedian: number | null | undefined,
): boolean {
  if (!Number.isFinite(currentPrice) || currentPrice < MIN_TEST_PRICE) return false
  if (historicalMedian == null || !Number.isFinite(historicalMedian) || historicalMedian <= 0) return false
  return currentPrice / historicalMedian > HISTORICAL_MAX_RATIO
}

/** Test-visible internals. Not part of the public API. */
export const __testables = { median, pickByPreferredOrder }
