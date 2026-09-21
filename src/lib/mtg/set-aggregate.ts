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
//   pricedSubtotal  Sum of one price per priced printing.
//                   Basket rule (stable across dates, price-independent):
//                   for each eligible printing choose a CANONICAL FINISH
//                   from mtg_canonical_finish (nonfoil > foil > etched,
//                   then any other finish deterministically). Only that
//                   canonical finish's observations count. If the
//                   canonical finish has no observation on the endpoint
//                   date, the printing is unpriced for that endpoint;
//                   no silent finish substitution.
//   coverage        pricedCount / eligibleCount, clamped to [0, 1].
//   mostValuable    The single most valuable priced printing in the
//                   set on the basis. Ties broken by lowest collector
//                   number so the result is stable across calls.
//
// 7D / 30D / 90D basket movement is computed by
// annotateHistoricalMovement (src/lib/mtg/set-market-batch.ts) against
// mtg_set_value_daily. Each requires:
//   - current-endpoint coverage >= HISTORY_COVERAGE_THRESHOLD
//   - historical-endpoint coverage >= HISTORY_COVERAGE_THRESHOLD
//   - basket size >= MIN_HISTORY_BASKET_SIZE at both endpoints
//   - past basket value > 0
// Any failure -> that horizon's pct/abs stays null and the UI hides
// the chip for that horizon.
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
  /** 7D / 30D / 90D change of the basket value. Present only when
   *  BOTH endpoints on the horizon clear the coverage bar. */
  pct7d:  number | null
  abs7d:  number | null
  pct30d: number | null
  abs30d: number | null
  pct90d: number | null
  abs90d: number | null
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

/** Is the aggregate healthy enough that we should render a movement
 *  chip for this horizon? Requires (a) a computed pct and (b)
 *  current-endpoint coverage clearing the threshold. Historical-
 *  endpoint coverage is enforced upstream: the pct is null if the
 *  past side did not clear the bar. */
export function has30dCoverage(agg: Pick<SetAggregate, 'pct30d' | 'coverage'>): boolean {
  return agg.pct30d !== null && agg.coverage >= SET_VALUE_COVERAGE_THRESHOLD
}
export function has7dCoverage(agg: Pick<SetAggregate, 'pct7d' | 'coverage'>): boolean {
  return agg.pct7d !== null && agg.coverage >= SET_VALUE_COVERAGE_THRESHOLD
}
export function has90dCoverage(agg: Pick<SetAggregate, 'pct90d' | 'coverage'>): boolean {
  return agg.pct90d !== null && agg.coverage >= SET_VALUE_COVERAGE_THRESHOLD
}

/** Shared coverage-percentage formatter. /browse tile and
 *  /set/[setCode] market panel both use this so the numbers agree
 *  visually. Rules:
 *    - priced === eligible: show whole 100% (mathematically exact).
 *    - priced === 0 or eligible === 0: show whole 0%.
 *    - Otherwise: one decimal place. Keeps 452/453 = 99.8% instead
 *      of the misleading 100% you get from Math.round().
 */
export function formatCoveragePct(priced: number, eligible: number): string {
  if (eligible <= 0) return '0%'
  if (priced <= 0) return '0%'
  if (priced >= eligible) return '100%'
  const pct = (priced / eligible) * 100
  return `${pct.toFixed(1)}%`
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
    pct7d: null, abs7d: null,
    pct30d: null, abs30d: null,
    pct90d: null, abs90d: null,
  }
}
