// graded-view.test.ts
// Slice 6. Locks the semantics of the public graded view:
//   * grader='raw' never appears inside slabbed output
//   * empty (no slab data) short-circuits to hasSlabbedData=false
//   * PSA/BGS/CGC/SGC grade-10 populate the "slabTen" line
//   * 'any' grader 9.5/9/8/7 populate the fallback line
//   * raw-vs-slab premium is ONLY computed when:
//       - both quotes exist for the same tcg_printing_id
//       - they share the same currency
//       - both are fresh (<=30d since updated_at)
//     Otherwise premium is null.
//   * multiple rows per (grader, grade, currency) are de-duped
//   * currencies list surfaces every currency in the surfaced cells

import { describe, it, expect } from 'vitest'
import { buildGradedView, FRESH_HOURS } from '@/lib/mtg/graded-view'
import type { TcgGradedRow, TcgRawQuote } from '@/lib/tcggraph/read-model'

function raw(price: number, currency = 'USD', updated = '2026-09-01T00:00:00Z'): TcgRawQuote {
  return { tcg_printing_id: 'test-print', price, currency, card_sales_volume: null, updated_at: updated }
}
function row(grader: string, grade: string, price: number, opts: Partial<TcgGradedRow> = {}): TcgGradedRow {
  return {
    tcg_printing_id: 'test-print',
    grader, grade,
    currency: opts.currency ?? 'USD',
    price,
    card_sales_volume: opts.card_sales_volume ?? null,
    updated_at: opts.updated_at ?? '2026-09-01T00:00:00Z',
  }
}

describe('buildGradedView - basic shape', () => {
  it('returns hasSlabbedData=false when there are no graded rows at all', () => {
    const v = buildGradedView({ rawPrice: null, gradedPrices: [], tcgPrintings: [] })
    expect(v.hasSlabbedData).toBe(false)
    expect(v.slabTen).toEqual([])
    expect(v.anyGraded).toEqual([])
    expect(v.other).toEqual([])
    expect(v.premium).toBeNull()
  })

  it('returns hasSlabbedData=false when the bundle argument is null', () => {
    const v = buildGradedView(null)
    expect(v.hasSlabbedData).toBe(false)
  })

  it('rejects grader="raw" defensively even if it slips into gradedPrices', () => {
    const v = buildGradedView({
      rawPrice: null,
      gradedPrices: [row('raw', 'ungraded', 100), row('psa', '10', 500)],
      tcgPrintings: [],
    })
    expect(v.slabTen.every((c) => c.grader !== 'RAW' && c.grader !== 'Raw')).toBe(true)
    expect(v.slabTen).toHaveLength(1)
    expect(v.slabTen[0].grader).toBe('PSA')
  })
})

describe('buildGradedView - populates the four-slab and any-graded rows', () => {
  it('populates PSA10 / BGS10 / CGC10 / SGC10 into slabTen and Any 9.5/9/8/7 into anyGraded', () => {
    const v = buildGradedView({
      rawPrice: null,
      gradedPrices: [
        row('psa', '10', 500),
        row('bgs', '10', 480),
        row('cgc', '10', 450),
        row('sgc', '10', 420),
        row('any', '9.5', 380),
        row('any', '9', 320),
        row('any', '8', 200),
        row('any', '7', 140),
      ],
      tcgPrintings: [],
    })
    expect(v.hasSlabbedData).toBe(true)
    expect(v.slabTen.map((c) => c.grader)).toEqual(['PSA', 'BGS', 'CGC', 'SGC'])
    expect(v.anyGraded.map((c) => c.grade)).toEqual(['9.5', '9', '8', '7'])
    expect(v.other).toEqual([])
  })

  it('does not fabricate a $0 slot for a missing grader', () => {
    const v = buildGradedView({
      rawPrice: null,
      gradedPrices: [row('psa', '10', 500)],
      tcgPrintings: [],
    })
    expect(v.slabTen).toHaveLength(1)
    expect(v.slabTen[0].grader).toBe('PSA')
    expect(v.slabTen.every((c) => c.price > 0)).toBe(true)
  })

  it('de-dupes across duplicate rows for the same (grader,grade,currency)', () => {
    const v = buildGradedView({
      rawPrice: null,
      gradedPrices: [row('psa', '10', 500), row('psa', '10', 500)],
      tcgPrintings: [],
    })
    expect(v.slabTen).toHaveLength(1)
  })

  it('places unusual (grader, grade) combos into `other`, not into slabTen or anyGraded', () => {
    const v = buildGradedView({
      rawPrice: null,
      gradedPrices: [row('psa', '9', 300), row('any', '10', 999)],
      tcgPrintings: [],
    })
    expect(v.slabTen).toHaveLength(0)
    expect(v.anyGraded).toHaveLength(0)
    expect(v.other).toHaveLength(2)
  })

  it('surfaces every currency present in the surfaced cells', () => {
    const v = buildGradedView({
      rawPrice: null,
      gradedPrices: [
        row('psa', '10', 500, { currency: 'USD' }),
        row('bgs', '10', 450, { currency: 'EUR' }),
      ],
      tcgPrintings: [],
    })
    expect(v.currencies.sort()).toEqual(['EUR', 'USD'])
  })
})

describe('buildGradedView - raw-vs-graded premium safety', () => {
  const NOW = '2026-09-22T00:00:00Z'

  it('computes a premium when raw + PSA10 share currency and both are fresh', () => {
    const v = buildGradedView({
      rawPrice: raw(100, 'USD', '2026-09-20T00:00:00Z'),
      gradedPrices: [row('psa', '10', 500, { updated_at: '2026-09-21T00:00:00Z' })],
      tcgPrintings: [],
    }, NOW)
    expect(v.premium).not.toBeNull()
    expect(v.premium!.slab.grader).toBe('PSA')
    expect(v.premium!.multiple).toBe(5)
    expect(v.premium!.percentDisplay).toBe('+400%')
    expect(v.premium!.currency).toBe('USD')
  })

  it('does NOT compute a premium when raw and slab are in different currencies', () => {
    const v = buildGradedView({
      rawPrice: raw(100, 'USD', '2026-09-20T00:00:00Z'),
      gradedPrices: [row('psa', '10', 500, { currency: 'EUR', updated_at: '2026-09-21T00:00:00Z' })],
      tcgPrintings: [],
    }, NOW)
    expect(v.premium).toBeNull()
  })

  it('does NOT compute a premium when the raw quote is stale (>30 days old)', () => {
    const v = buildGradedView({
      rawPrice: raw(100, 'USD', '2026-01-01T00:00:00Z'),
      gradedPrices: [row('psa', '10', 500, { updated_at: '2026-09-21T00:00:00Z' })],
      tcgPrintings: [],
    }, NOW)
    expect(v.premium).toBeNull()
  })

  it('does NOT compute a premium when the slab quote is stale (>30 days old)', () => {
    const v = buildGradedView({
      rawPrice: raw(100, 'USD', '2026-09-21T00:00:00Z'),
      gradedPrices: [row('psa', '10', 500, { updated_at: '2026-01-01T00:00:00Z' })],
      tcgPrintings: [],
    }, NOW)
    expect(v.premium).toBeNull()
  })

  it('does NOT compute a premium when raw price is zero (defensive guard)', () => {
    const v = buildGradedView({
      rawPrice: raw(0, 'USD', '2026-09-21T00:00:00Z'),
      gradedPrices: [row('psa', '10', 500, { updated_at: '2026-09-21T00:00:00Z' })],
      tcgPrintings: [],
    }, NOW)
    expect(v.premium).toBeNull()
  })

  it('falls back to BGS 10 if PSA 10 has no matching-currency quote', () => {
    const v = buildGradedView({
      rawPrice: raw(100, 'EUR', '2026-09-20T00:00:00Z'),
      gradedPrices: [
        row('psa', '10', 500, { currency: 'USD', updated_at: '2026-09-21T00:00:00Z' }),
        row('bgs', '10', 480, { currency: 'EUR', updated_at: '2026-09-21T00:00:00Z' }),
      ],
      tcgPrintings: [],
    }, NOW)
    expect(v.premium).not.toBeNull()
    expect(v.premium!.slab.grader).toBe('BGS')
    expect(v.premium!.currency).toBe('EUR')
  })

  it('reports FRESH_HOURS = 30 days', () => {
    expect(FRESH_HOURS).toBe(30 * 24)
  })
})

describe('buildGradedView - order + no data invention', () => {
  it('never invents rows: input has one row, output has one cell total', () => {
    const v = buildGradedView({
      rawPrice: null,
      gradedPrices: [row('cgc', '10', 300)],
      tcgPrintings: [],
    })
    const total = v.slabTen.length + v.anyGraded.length + v.other.length
    expect(total).toBe(1)
    expect(v.slabTen[0].grader).toBe('CGC')
  })
})
