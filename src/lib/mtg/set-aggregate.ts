// src/lib/mtg/set-aggregate.ts
// Shared primitive for the set-level pricing methodology used by both
// /browse (batched via mtg_set_aggregates_v4) and /set/[setCode]
// (single-set via set-market.ts). Every rule that governs "is this
// number honest to show?" lives here, so both surfaces produce
// consistent answers.
//
// Definitions:
//   eligibleCount   Number of English paper printings with a real
//                   collector_number in the set. This is the "cards"
//                   population the user sees as belonging to the set.
//                   Pricing availability MUST NOT reduce this number.
//   pricedCount     Number of eligible printings that have at least one
//                   current basket price on the caller's basis.
//   pricedSubtotal  Sum of one price per priced printing. The chosen
//                   price is the cheapest nonfoil finish current price
//                   on the basis. If no nonfoil finish has a price, we
//                   fall back to the cheapest of any finish so a foil-
//                   only printing still contributes exactly one row.
//                   Foil and nonfoil of the same printing are never
//                   summed together.
//   coverage        pricedCount / eligibleCount, clamped to [0, 1].
//   mostValuable    The single most valuable priced printing in the
//                   set on the basis. Ties broken by lowest collector
//                   number so the result is stable across calls.
//
// The threshold for calling the total a "Set value" rather than a
// "Priced-card subtotal" is deliberately conservative. Below it the
// two numbers are qualitatively different: one is a set-value estimate,
// the other is a small subset total that would mislead if labelled the
// same way.

/** Coverage at or above this fraction earns the "Set value" label. */
export const SET_VALUE_COVERAGE_THRESHOLD = 0.8

/** 30D basket movement needs at least this fraction of the priced
 *  basket to have both endpoints, otherwise the number is dominated
 *  by a handful of movers and does not describe the whole set. */
export const HISTORY_COVERAGE_THRESHOLD = 0.8

/** Absolute floor for 30D basket movement. Below this the basket is
 *  small enough that noise dominates. */
export const MIN_HISTORY_BASKET_SIZE = 5

export type SetAggregate = {
  setCode: string
  eligibleCount: number
  pricedCount: number
  pricedSubtotal: number
  coverage: number
  mostValuableName: string | null
  mostValuableCollectorNumber: string | null
  mostValuablePrice: number | null
  /** 30D change of the basket value, present only when the basket
   *  passes the history coverage threshold. */
  pct30d: number | null
  abs30d: number | null
}

export function computeCoverage(priced: number, eligible: number): number {
  if (eligible <= 0) return 0
  const c = priced / eligible
  if (c < 0) return 0
  if (c > 1) return 1
  return c
}

/** Which headline label the tile should use. Callers should ALSO show
 *  the coverage line so the user can see why we chose it. */
export function setValueLabel(agg: Pick<SetAggregate, 'coverage'>): 'Set value' | 'Priced-card subtotal' {
  return agg.coverage >= SET_VALUE_COVERAGE_THRESHOLD ? 'Set value' : 'Priced-card subtotal'
}

/** Is the aggregate healthy enough that we should render a 30D chip? */
export function has30dCoverage(agg: Pick<SetAggregate, 'pct30d' | 'coverage'>): boolean {
  return agg.pct30d !== null && agg.coverage >= SET_VALUE_COVERAGE_THRESHOLD
}

export function emptyAggregate(setCode: string): SetAggregate {
  return {
    setCode,
    eligibleCount: 0,
    pricedCount: 0,
    pricedSubtotal: 0,
    coverage: 0,
    mostValuableName: null,
    mostValuableCollectorNumber: null,
    mostValuablePrice: null,
    pct30d: null,
    abs30d: null,
  }
}
