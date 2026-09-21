// tcggraph-read-model.test.ts
// Locks the raw / graded separation and the deterministic ordering
// of graded quotes. Tests target the pure helpers exposed via
// __testables so we don't need a live DB.

import { describe, it, expect } from 'vitest'
import { __testables } from '@/lib/tcggraph/read-model'

const { partitionRawAndGraded, sortGraded, pickRaw, newestTimestamp } = __testables

const now = '2026-09-22T12:00:00.000Z'
const rows = [
  { tcg_printing_id: 'x', grader: 'psa',  grade: '10',  currency: 'USD', price: 100, card_sales_volume: 5, updated_at: now },
  { tcg_printing_id: 'x', grader: 'raw',  grade: 'ungraded', currency: 'USD', price: 3, card_sales_volume: 5, updated_at: now },
  { tcg_printing_id: 'x', grader: 'bgs',  grade: '10',  currency: 'USD', price: 120, card_sales_volume: 5, updated_at: now },
  { tcg_printing_id: 'x', grader: 'cgc',  grade: '10',  currency: 'USD', price: 90,  card_sales_volume: 5, updated_at: now },
  { tcg_printing_id: 'x', grader: 'sgc',  grade: '10',  currency: 'USD', price: 80,  card_sales_volume: 5, updated_at: now },
  { tcg_printing_id: 'x', grader: 'any',  grade: '9.5', currency: 'USD', price: 60,  card_sales_volume: 5, updated_at: now },
  { tcg_printing_id: 'x', grader: 'any',  grade: '9',   currency: 'USD', price: 30,  card_sales_volume: 5, updated_at: now },
  { tcg_printing_id: 'x', grader: 'any',  grade: '8',   currency: 'USD', price: 15,  card_sales_volume: 5, updated_at: now },
  { tcg_printing_id: 'x', grader: 'any',  grade: '7',   currency: 'USD', price: 10,  card_sales_volume: 5, updated_at: now },
]

describe('tcggraph read model: raw vs graded separation', () => {
  it('pickRaw returns exactly the raw row when present', () => {
    const raw = pickRaw(rows)
    expect(raw).not.toBeNull()
    expect(raw!.price).toBe(3)
    expect(raw!.currency).toBe('USD')
  })

  it('pickRaw returns null when no raw row exists', () => {
    expect(pickRaw(rows.filter((r) => r.grader !== 'raw'))).toBeNull()
  })

  it('partitionRawAndGraded strips grader=raw out of gradedPrices[]', () => {
    const { raw, graded } = partitionRawAndGraded(rows)
    expect(raw).not.toBeNull()
    for (const r of graded) expect(r.grader).not.toBe('raw')
  })

  it('gradedPrices[] preserves count minus the raw row(s)', () => {
    const { graded } = partitionRawAndGraded(rows)
    expect(graded.length).toBe(rows.length - 1)
  })

  it('sortGraded produces PSA 10, BGS 10, CGC 10, SGC 10, any 9.5, 9, 8, 7', () => {
    const { graded } = partitionRawAndGraded(rows)
    const sig = graded.map((r) => `${r.grader}:${r.grade}`)
    expect(sig).toEqual([
      'psa:10', 'bgs:10', 'cgc:10', 'sgc:10',
      'any:9.5', 'any:9', 'any:8', 'any:7',
    ])
  })

  it('never imputes $0 for a missing graded quote', () => {
    // Absence of a (grader, grade) MUST be represented by the row
    // simply not existing. The helpers must NEVER manufacture a row.
    const { graded } = partitionRawAndGraded(rows.filter((r) => r.grade !== '10'))
    // There is now no grade-10 row for any grader.
    for (const r of graded) expect(r.grade).not.toBe('10')
    // And there is no row with price = 0.
    for (const r of graded) expect(r.price).not.toBe(0)
  })

  it('sortGraded tolerates unknown graders and grades without crashing', () => {
    const weird = [
      ...rows,
      { tcg_printing_id: 'x', grader: 'weird', grade: 'Auth', currency: 'USD', price: 20, card_sales_volume: null, updated_at: null },
      { tcg_printing_id: 'x', grader: 'psa',   grade: '11',   currency: 'USD', price: 200, card_sales_volume: null, updated_at: null },
    ]
    const sorted = sortGraded(weird.filter((r) => r.grader !== 'raw'))
    // Known-grader known-grade rows come first, unknowns land at the tail.
    expect(sorted[0].grader).toBe('psa')
    expect(sorted[0].grade).toBe('10')
    expect(sorted[sorted.length - 1].grader).toBe('weird')
  })

  it('newestTimestamp picks the max ISO timestamp and null-safes', () => {
    expect(newestTimestamp([{ updated_at: '2026-09-01T00:00:00Z' }, { updated_at: '2026-09-15T00:00:00Z' }])).toBe('2026-09-15T00:00:00Z')
    expect(newestTimestamp([])).toBeNull()
    expect(newestTimestamp([{ updated_at: null }])).toBeNull()
  })
})
