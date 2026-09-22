// tcggraph-graded-attribution.test.ts
//
// Regression tests for the Yu-Gi-Oh! 1st Edition vs Unlimited graded
// integrity fix (Collector Network Slice 3/5 audit).
//
// Semantic boundary under test:
//   * TCGGraph gradedPrices[] for YGO/OPCG vintage cards carries no
//     per-printing metadata. Ingest must classify those quotes as
//     attribution='card' and anchor them to a deterministic canonical
//     printing.
//   * Frontends and read paths must NEVER treat an attribution='card'
//     row as an edition-specific slab value. `partitionRawAndGraded`
//     is the ground-truth splitter: rows tagged 'card' land in
//     cardScoped, printing-scoped rows land in graded. There is no
//     overlap and no duplication.
//   * Modern cards with a single printing must keep the old behaviour
//     (attribution='printing').
//   * When upstream ever DOES include a printing hint, we honour it
//     (attribution='printing').
//   * Absent gradedPrices must produce zero rows (no fabrication).

import { describe, it, expect } from 'vitest'
import { buildGradedRows, resolveGradedAttribution, tcgPrintingId, tcgCardId } from '@/lib/tcggraph/ingest-core.mjs'
import { __testables } from '@/lib/tcggraph/read-model'

const { partitionRawAndGraded } = __testables

// Live TCGGraph payload for ygo_lob_001 captured 2026-09-22.
// Two printings, gradedPrices with no edition metadata.
const YGO_LOB_001 = {
  id: 'ygo_lob_001',
  name: 'Blue-Eyes White Dragon',
  language: 'en',
  printings: [
    { key: 'normal',      label: 'Normal',      kind: 'surface', externalIds: {} },
    { key: '1st-edition', label: '1st Edition', kind: 'edition', externalIds: {} },
  ],
  prices: [
    { finish: 'normal',      source: 'cardmarket', listType: 'retail', currency: 'USD', market: 50 },
    { finish: '1st-edition', source: 'cardmarket', listType: 'retail', currency: 'USD', market: 800 },
  ],
  gradedPrices: [
    { grader: 'raw', grade: 'ungraded', currency: 'USD', price: 75,    salesVolume: 279, updatedAt: '2026-09-22T09:50:13Z' },
    { grader: 'any', grade: '7',        currency: 'USD', price: 166.77,salesVolume: 279, updatedAt: '2026-09-22T09:50:13Z' },
    { grader: 'any', grade: '8',        currency: 'USD', price: 265,   salesVolume: 279, updatedAt: '2026-09-22T09:50:13Z' },
    { grader: 'any', grade: '9',        currency: 'USD', price: 640,   salesVolume: 279, updatedAt: '2026-09-22T09:50:13Z' },
    { grader: 'psa', grade: '10',       currency: 'USD', price: 7000,  salesVolume: 279, updatedAt: '2026-09-22T09:50:13Z' },
  ],
}

// Modern single-printing card. Only 'normal' printing, printing-scoped
// graded rows are the right call.
const MODERN_SINGLE = {
  id: 'ygo_ras_en001',
  name: 'Whatever',
  language: 'en',
  printings: [{ key: 'normal', label: 'Normal', kind: 'surface', externalIds: {} }],
  prices: [{ finish: 'normal', source: 'cardmarket', listType: 'retail', currency: 'USD', market: 10 }],
  gradedPrices: [
    { grader: 'psa', grade: '10', currency: 'USD', price: 40, salesVolume: 5, updatedAt: '2026-09-22T09:50:13Z' },
  ],
}

// Card whose upstream gradedPrices carry a printing hint. Should stay
// printing-scoped even if there are multiple printings.
const HYPOTHETICAL_WITH_HINT = {
  id: 'ygo_hypothetical',
  name: 'HypCard',
  language: 'en',
  printings: [
    { key: 'normal',      kind: 'surface', label: 'Normal' },
    { key: '1st-edition', kind: 'edition', label: '1st Edition' },
  ],
  gradedPrices: [
    { grader: 'psa', grade: '10', currency: 'USD', price: 500, printingKey: '1st-edition', updatedAt: '2026-09-22T09:50:13Z' },
  ],
}

const NO_GRADED = {
  id: 'ygo_boring',
  name: 'Boring',
  language: 'en',
  printings: [{ key: 'normal', label: 'Normal', kind: 'surface' }],
  gradedPrices: [],
}

// Non-edition foil vs normal card (e.g. DB1-EN249 Earthbound Spirit).
// Upstream still provides no per-printing hint on graded quotes, so
// under the broader rule these must be attribution='card' too.
const YGO_FOIL_NORMAL = {
  id: 'ygo_db1_en249',
  name: 'Earthbound Spirit',
  language: 'en',
  printings: [
    { key: 'normal', label: 'Normal', kind: 'surface', externalIds: {} },
    { key: 'foil',   label: 'Foil',   kind: 'surface', externalIds: {} },
  ],
  gradedPrices: [
    { grader: 'psa', grade: '10', currency: 'USD', price: 120, salesVolume: 12, updatedAt: '2026-09-22T09:50:13Z' },
  ],
}

describe('resolveGradedAttribution', () => {
  it('classifies vintage YGO 1st+normal as card-scoped, anchored to 1st-edition', () => {
    const r = resolveGradedAttribution(YGO_LOB_001)
    expect(r.attribution).toBe('card')
    expect(r.anchorKey).toBe('1st-edition')
  })

  it('classifies modern single-printing cards as printing-scoped', () => {
    const r = resolveGradedAttribution(MODERN_SINGLE)
    expect(r.attribution).toBe('printing')
    expect(r.anchorKey).toBe('normal')
  })

  it('honours an upstream printingKey hint and stays printing-scoped', () => {
    const r = resolveGradedAttribution(HYPOTHETICAL_WITH_HINT)
    expect(r.attribution).toBe('printing')
  })

  it('falls back to normal when 1st-edition is not present', () => {
    const r = resolveGradedAttribution({
      ...YGO_LOB_001,
      printings: [
        { key: 'unlimited', label: 'Unlimited', kind: 'edition' },
        { key: 'normal',    label: 'Normal',    kind: 'surface' },
      ],
    })
    expect(r.attribution).toBe('card')
    expect(['normal', 'unlimited']).toContain(r.anchorKey)
  })

  it('foil+normal multi-printing cards are card-scoped too (no edition variant required)', () => {
    //  Regression: an earlier draft of the rule required at least one
    //  printing with kind='edition'. That predicate misses ~3,069 YGO
    //  cards (all foil+normal patterns like Earthbound Spirit) whose
    //  gradedPrices[] are still card-level upstream. See rule-delta
    //  measurement in scripts/ygo-rule-delta.mjs.
    const r = resolveGradedAttribution(YGO_FOIL_NORMAL)
    expect(r.attribution).toBe('card')
    // Anchor falls back to 'normal' since '1st-edition' is absent.
    expect(r.anchorKey).toBe('normal')
  })
})

describe('buildGradedRows', () => {
  it('writes vintage YGO graded rows to the 1st-edition anchor with attribution=card', () => {
    const rows = buildGradedRows('ygo', YGO_LOB_001, 'run-1')
    const anchor = tcgPrintingId('ygo', 'ygo_lob_001', '1st-edition', 'en')
    expect(rows.length).toBeGreaterThan(0)
    for (const r of rows) {
      expect(r.attribution).toBe('card')
      expect(r.tcg_printing_id).toBe(anchor)
      expect(r.tcg_card_id).toBe(tcgCardId('ygo', 'ygo_lob_001'))
    }
  })

  it('never emits two rows for the same (grader, grade, currency) for one card', () => {
    const rows = buildGradedRows('ygo', YGO_LOB_001, 'run-1')
    const keys = rows.map((r) => `${r.grader}|${r.grade}|${r.currency}`)
    expect(new Set(keys).size).toBe(keys.length)
  })

  it('writes modern single-printing graded rows with attribution=printing', () => {
    const rows = buildGradedRows('ygo', MODERN_SINGLE, 'run-2')
    expect(rows).toHaveLength(1)
    expect(rows[0].attribution).toBe('printing')
    expect(rows[0].tcg_printing_id).toBe(tcgPrintingId('ygo', 'ygo_ras_en001', 'normal', 'en'))
  })

  it('produces zero rows when upstream has no gradedPrices', () => {
    expect(buildGradedRows('ygo', NO_GRADED, 'run-3')).toHaveLength(0)
  })

  it('writes foil+normal YGO graded rows as card-scoped', () => {
    const rows = buildGradedRows('ygo', YGO_FOIL_NORMAL, 'run-foil')
    expect(rows).toHaveLength(1)
    expect(rows[0].attribution).toBe('card')
    expect(rows[0].tcg_card_id).toBe(tcgCardId('ygo', 'ygo_db1_en249'))
  })

  it('does not fabricate a $0 or null-price row', () => {
    const rows = buildGradedRows('ygo', YGO_LOB_001, 'run-4')
    for (const r of rows) {
      expect(r.price).not.toBeNull()
      expect(Number(r.price)).toBeGreaterThan(0)
    }
  })

  it('is idempotent under re-invocation - repeated builds produce identical row shape', () => {
    const a = buildGradedRows('ygo', YGO_LOB_001, 'run-A')
    const b = buildGradedRows('ygo', YGO_LOB_001, 'run-B')
    expect(a.length).toBe(b.length)
    // Ignore source_run_id which is expected to differ.
    for (let i = 0; i < a.length; i++) {
      const { source_run_id: _sa, ...aa } = a[i]
      const { source_run_id: _sb, ...bb } = b[i]
      expect(aa).toEqual(bb)
    }
  })
})

describe('read-model partitionRawAndGraded — attribution boundary', () => {
  const now = '2026-09-22T12:00:00.000Z'
  const mixed = [
    // A specific-printing PSA 10.
    { tcg_printing_id: 'p1', grader: 'psa', grade: '10',  currency: 'USD', price: 100, card_sales_volume: 5, updated_at: now, attribution: 'printing' as const, tcg_card_id: 'c1' },
    // Card-scoped BGS 10 — MUST NOT appear in .graded.
    { tcg_printing_id: 'p1', grader: 'bgs', grade: '10',  currency: 'USD', price: 5000, card_sales_volume: 5, updated_at: now, attribution: 'card' as const, tcg_card_id: 'c1' },
    // Raw.
    { tcg_printing_id: 'p1', grader: 'raw', grade: 'ungraded', currency: 'USD', price: 3, card_sales_volume: 5, updated_at: now, attribution: 'card' as const, tcg_card_id: 'c1' },
    // Legacy row without attribution field — must be treated as 'printing'.
    { tcg_printing_id: 'p1', grader: 'cgc', grade: '10',  currency: 'USD', price: 80, card_sales_volume: 5, updated_at: now },
  ]

  it('places attribution=card rows in cardScoped only, never in graded', () => {
    const { graded, cardScoped } = partitionRawAndGraded(mixed as any)
    for (const r of graded) expect(r.attribution).not.toBe('card')
    // The BGS-10 5000 row must be visible somewhere - just not on the
    // printing-scoped surface.
    const bgs = cardScoped.find((r) => r.grader === 'bgs')
    expect(bgs?.price).toBe(5000)
    // And it must not have been silently duplicated into graded.
    expect(graded.find((r) => r.grader === 'bgs' && r.price === 5000)).toBeUndefined()
  })

  it('legacy rows without attribution are printing-scoped (backward compatible)', () => {
    const { graded } = partitionRawAndGraded(mixed as any)
    expect(graded.find((r) => r.grader === 'cgc')).toBeDefined()
  })

  it('graded[] and cardScoped[] partition the non-raw input with no duplication', () => {
    const { graded, cardScoped } = partitionRawAndGraded(mixed as any)
    const nonRaw = mixed.filter((r) => r.grader !== 'raw')
    expect(graded.length + cardScoped.length).toBe(nonRaw.length)
    const graderPairs = [...graded, ...cardScoped].map((r) => `${r.grader}|${r.grade}`)
    // No accidental duplicate rows across the two lists.
    expect(new Set(graderPairs).size).toBe(graderPairs.length)
  })

  it('raw is picked once and never appears in either graded[] or cardScoped[]', () => {
    const { raw, graded, cardScoped } = partitionRawAndGraded(mixed as any)
    expect(raw?.price).toBe(3)
    for (const r of graded) expect(r.grader).not.toBe('raw')
    for (const r of cardScoped) expect(r.grader).not.toBe('raw')
  })
})
