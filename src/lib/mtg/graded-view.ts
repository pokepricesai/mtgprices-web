// src/lib/mtg/graded-view.ts
//
// Pure-function transform from a TCGGraph read-model bundle into a
// display-ready graded view. No I/O, no server-only concerns - the
// server route imports this alongside getTcgBundleForMtgPrinting().
//
// Semantic rules:
//   * grader='raw' is NEVER shown as a slab quote. Anywhere.
//   * Only real stored values are surfaced. Missing (grader,grade)
//     combinations do not appear.
//   * Raw-vs-graded premium is only computed when
//       - both quotes exist for the SAME tcg_printing_id
//       - both share the same currency
//       - both have been updated within FRESH_HOURS
//     Otherwise the premium is omitted rather than fabricated.

import type { TcgPrintingBundle, TcgGradedRow, TcgRawQuote } from '@/lib/tcggraph/read-model'

export const FRESH_HOURS = 30 * 24  // 30 days: TCGGraph's own avg30 window

/** One display cell for a specific (grader, grade) row. */
export type GradedCell = {
  grader: string          // uppercase display, e.g. 'PSA'
  grade: string           // '10', '9.5', '9', ...
  price: number
  currency: string
  volume: number | null   // provider-supplied; may be card-level not grade-level
  updatedAt: string | null
  isSlabbed: boolean      // true for psa/bgs/cgc/sgc; false for 'any'
}

export type GradedPremium = {
  /** Reference raw quote. */
  raw: TcgRawQuote
  /** The slab quote we compared against - PSA 10 preferred. */
  slab: GradedCell
  /** Multiplier - slab.price / raw.price. */
  multiple: number
  /** Percent increase, formatted as an integer with a leading '+'. */
  percentDisplay: string
  currency: string
}

export type GradedView = {
  /** True if there is at least one slabbed quote worth showing. When
   *  false the caller should render NOTHING for the graded module. */
  hasSlabbedData: boolean
  /** The four-corner slab-10 line (PSA 10, BGS 10, CGC 10, SGC 10).
   *  Missing graders are absent - never rendered as $0. */
  slabTen: GradedCell[]
  /** The 'any'-graded fallback line covering non-10 grades (9.5, 9,
   *  8, 7). Also missing rows are absent. */
  anyGraded: GradedCell[]
  /** Everything else that survives - unusual graders/grades. */
  other: GradedCell[]
  /** Newest updatedAt across the surfaced slabbed rows. */
  lastSlabUpdate: string | null
  /** Set of unique currencies present in slabbed cells. */
  currencies: string[]
  /** Optional raw-vs-graded comparison. Only present when the strict
   *  rules above are met. */
  premium: GradedPremium | null
}

function upperGrader(g: string): string {
  const l = g.toLowerCase()
  if (l === 'psa') return 'PSA'
  if (l === 'bgs') return 'BGS'
  if (l === 'cgc') return 'CGC'
  if (l === 'sgc') return 'SGC'
  if (l === 'any') return 'Any'
  return g.toUpperCase()
}

function toCell(r: TcgGradedRow): GradedCell {
  const slabbed = ['psa', 'bgs', 'cgc', 'sgc'].includes(r.grader.toLowerCase())
  return {
    grader: upperGrader(r.grader),
    grade: r.grade,
    price: r.price,
    currency: r.currency,
    volume: r.card_sales_volume ?? null,
    updatedAt: r.updated_at ?? null,
    isSlabbed: slabbed,
  }
}

function newestOf(cells: GradedCell[]): string | null {
  let best: string | null = null
  for (const c of cells) {
    if (!c.updatedAt) continue
    if (!best || c.updatedAt > best) best = c.updatedAt
  }
  return best
}

/** Guard: reject stale quotes when we compute a premium. */
function isFresh(updatedAt: string | null, referenceIso: string): boolean {
  if (!updatedAt) return false
  const then = Date.parse(updatedAt)
  const now = Date.parse(referenceIso)
  if (!Number.isFinite(then) || !Number.isFinite(now)) return false
  return now - then <= FRESH_HOURS * 3600_000
}

export function buildGradedView(
  bundle: Pick<TcgPrintingBundle, 'rawPrice' | 'gradedPrices' | 'tcgPrintings'> | null,
  now: string = new Date().toISOString(),
): GradedView {
  if (!bundle) return emptyView()
  const slabTen: GradedCell[] = []
  const anyGraded: GradedCell[] = []
  const other: GradedCell[] = []
  //  Ensure only ONE row per (grader, grade) survives - defensive against
  //  duplicate rows across finish variants.
  const seen = new Set<string>()
  for (const r of bundle.gradedPrices) {
    const glow = r.grader.toLowerCase()
    if (glow === 'raw') continue  // BELT AND BRACES: never in graded output
    const key = `${glow}|${r.grade}|${r.currency}`
    if (seen.has(key)) continue
    seen.add(key)
    const cell = toCell(r)
    const g = glow
    const grade = r.grade
    if (grade === '10' && (g === 'psa' || g === 'bgs' || g === 'cgc' || g === 'sgc')) {
      slabTen.push(cell)
    } else if (g === 'any' && (grade === '9.5' || grade === '9' || grade === '8' || grade === '7')) {
      anyGraded.push(cell)
    } else {
      other.push(cell)
    }
  }

  const currencies = Array.from(new Set([...slabTen, ...anyGraded, ...other].map((c) => c.currency)))

  //  Raw-vs-graded premium.  Prefer PSA 10; fall back to BGS 10 / CGC 10
  //  / SGC 10 in that order. Only when the SAME currency as raw and both
  //  updated within FRESH_HOURS.
  const raw = bundle.rawPrice ?? null
  let premium: GradedPremium | null = null
  if (raw && raw.price > 0 && slabTen.length > 0) {
    if (!isFresh(raw.updated_at, now)) {
      //  raw is stale - skip premium
    } else {
      const preferOrder = ['PSA', 'BGS', 'CGC', 'SGC']
      const candidate = preferOrder
        .flatMap((g) => slabTen.filter((c) => c.grader === g))
        .find((c) => c.currency === raw.currency && isFresh(c.updatedAt, now))
      if (candidate) {
        const multiple = candidate.price / raw.price
        const pct = Math.round((multiple - 1) * 100)
        premium = {
          raw,
          slab: candidate,
          multiple,
          percentDisplay: `${pct >= 0 ? '+' : ''}${pct.toLocaleString()}%`,
          currency: raw.currency,
        }
      }
    }
  }

  const hasSlabbedData = slabTen.length > 0 || anyGraded.length > 0 || other.length > 0
  return {
    hasSlabbedData,
    slabTen,
    anyGraded,
    other,
    lastSlabUpdate: newestOf([...slabTen, ...anyGraded, ...other]),
    currencies,
    premium,
  }
}

function emptyView(): GradedView {
  return { hasSlabbedData: false, slabTen: [], anyGraded: [], other: [], lastSlabUpdate: null, currencies: [], premium: null }
}
