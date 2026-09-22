// graded-panel-integration.test.ts
// Slice 6. Integration-shape tests on the public graded panel.
// The component itself is server-rendered; here we exercise the
// underlying buildGradedView pipeline against realistic bundle
// shapes that mirror what getTcgBundleForMtgPrinting produces, and
// spot-check the render contract (no $0, no fabricated grades).

import { describe, it, expect } from 'vitest'
import { buildGradedView } from '@/lib/mtg/graded-view'
import type { TcgPrintingBundle } from '@/lib/tcggraph/read-model'

const NOW = '2026-09-22T00:00:00Z'
const RECENT = '2026-09-20T00:00:00Z'

function bundle(rawPrice: number | null, graded: Array<[string, string, number, string?]>): TcgPrintingBundle {
  return {
    mtgPrintingId: 'test-mtg',
    tcgPrintings: [{ id: 'test-tcg', tcggraph_card_id: 'tcg1', tcggraph_printing_key: 'normal', finish: 'nonfoil', mapping_confidence: 'exact' }],
    market: [],
    rawPrice: rawPrice == null ? null : { tcg_printing_id: 'test-tcg', price: rawPrice, currency: 'USD', card_sales_volume: null, updated_at: RECENT },
    gradedPrices: graded.map(([grader, grade, price, currency]) => ({
      tcg_printing_id: 'test-tcg', grader, grade, currency: currency ?? 'USD', price,
      card_sales_volume: null, updated_at: RECENT,
    })),
    cardScopedGraded: [],
    lastSourceUpdate: RECENT,
    latestObservationDate: '2026-09-22',
  }
}

describe('public graded panel integration semantics', () => {
  it('hides the entire panel when only a raw quote exists', () => {
    const v = buildGradedView(bundle(1500, []))
    expect(v.hasSlabbedData).toBe(false)   // GradedPricesPanel returns null in this case
  })

  it('surfaces PSA 10 and BGS 10 as slabTen when both exist', () => {
    const v = buildGradedView(bundle(1200, [
      ['psa', '10', 5800],
      ['bgs', '10', 5400],
    ]))
    expect(v.hasSlabbedData).toBe(true)
    expect(v.slabTen.map((c) => c.grader)).toEqual(['PSA', 'BGS'])
  })

  it('shows the premium only when raw + slab share USD', () => {
    const v = buildGradedView(bundle(1200, [
      ['psa', '10', 5800, 'USD'],
      ['bgs', '10', 5400, 'EUR'],
    ]), NOW)
    expect(v.premium).not.toBeNull()
    expect(v.premium!.slab.grader).toBe('PSA')
    expect(v.premium!.currency).toBe('USD')
    expect(v.premium!.percentDisplay).toBe('+383%')
  })

  it('never surfaces a $0 slot when a grader is missing', () => {
    const v = buildGradedView(bundle(50, [['psa', '10', 500]]))
    expect(v.slabTen).toHaveLength(1)
    for (const c of v.slabTen) expect(c.price).toBeGreaterThan(0)
  })

  it('never contains a row where grader is raw', () => {
    const b = bundle(50, [['psa', '10', 500]])
    //  Inject a rogue raw row and confirm it is dropped
    b.gradedPrices.push({ tcg_printing_id: 'test-tcg', grader: 'raw', grade: 'ungraded', currency: 'USD', price: 50, card_sales_volume: null, updated_at: RECENT })
    const v = buildGradedView(b, NOW)
    const flat = [...v.slabTen, ...v.anyGraded, ...v.other]
    expect(flat.every((c) => c.grader !== 'RAW' && c.grader.toLowerCase() !== 'raw')).toBe(true)
  })
})
