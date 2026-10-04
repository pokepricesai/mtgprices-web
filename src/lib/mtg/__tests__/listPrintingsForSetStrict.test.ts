// src/lib/mtg/__tests__/listPrintingsForSetStrict.test.ts
//
// Locks in the strict variant's "do not cache an empty page on a
// transient DB error" invariant.
//
// A /set/[setCode] render that silently converts a Supabase failure
// into [] produces a legitimate-looking empty state. Under Full Route
// Cache that empty render is pinned for the entire revalidate window
// — exactly the cache-poisoning incident we hit in production on
// /set/mkm. These tests pin the hardened behaviour:
//
//   1. Successful query with rows → mapped rows.
//   2. Successful query with zero rows → [] (legitimate empty set).
//   3. Transient error on attempt 1, success on retry → mapped rows.
//   4. Persistent error across all attempts → throws (ISR will NOT
//      cache the response, so the next request retries).

import { describe, it, expect, vi, beforeEach } from 'vitest'

type RangeResult = { data: any[] | null; error: { message: string } | null }

const { serviceClientMock, rangeMock } = vi.hoisted(() => {
  const rangeMock = vi.fn<[], Promise<RangeResult>>()
  const serviceClientMock = vi.fn()
  return { serviceClientMock, rangeMock }
})

vi.mock('@/lib/supabaseService', () => ({
  getSupabaseServiceClient: serviceClientMock,
}))

// Supabase's PostgREST builder is both chainable AND thenable: you
// can continue chaining `.eq(…)` after `.range(…)` and then `await`
// the whole thing. The real `.range()` returns `this`, not a Promise.
// Modelling this correctly lets the strict function's conditional
// `.eq('digital', false)` after `.range(…)` work in tests exactly as
// it does against real Supabase.
function makeChainableBuilder() {
  const builder: any = {
    select: () => builder,
    eq: () => builder,
    order: () => builder,
    range: () => builder,
    then: (onFulfilled: any, onRejected: any) => rangeMock().then(onFulfilled, onRejected),
  }
  return builder
}

beforeEach(() => {
  rangeMock.mockReset()
  serviceClientMock.mockReset()
  serviceClientMock.mockReturnValue({
    from: () => makeChainableBuilder(),
  })
})

async function loadStrict() {
  // Dynamic import so the service-client mock applies to this import.
  const mod = await import('../cards')
  return mod.listPrintingsForSetStrict
}

function row(id: string, collector: string, name: string): any {
  return {
    id,
    oracle_card_id: `oc-${id}`,
    set_id: 'set-mkm',
    scryfall_id: `sc-${id}`,
    set_code: 'mkm',
    collector_number: collector,
    lang: 'en',
    name,
    layout: 'normal',
    rarity: 'rare',
    artist: 'Someone',
    image_uri: `https://example/${id}.jpg`,
    image_uri_small: `https://example/${id}-s.jpg`,
    art_crop_uri: null,
    released_at: '2024-02-02',
    borderless: false,
    full_art: false,
    promo: false,
    digital: false,
    scryfall_uri: null,
    reprint: false,
    textless: false,
    variation: false,
    oracle: { name, type_line: 'Creature', mana_cost: '{1}{U}', colors: ['U'] },
  }
}

describe('listPrintingsForSetStrict', () => {
  it('maps a populated set to the full MtgSetCard shape', async () => {
    rangeMock.mockResolvedValueOnce({
      data: [row('a', '001', 'Alpha'), row('b', '002', 'Beta')],
      error: null,
    })
    const listPrintingsForSetStrict = await loadStrict()
    const result = await listPrintingsForSetStrict('mkm')
    expect(result).toHaveLength(2)
    expect(result[0].id).toBe('a')
    expect(result[0].collector_number).toBe('001')
    expect(result[0].oracle_name).toBe('Alpha')
    expect(result[0].oracle_colors).toEqual(['U'])
    expect(rangeMock).toHaveBeenCalledTimes(1)
  })

  it('returns [] for a legitimate zero-row response (NOT an error)', async () => {
    rangeMock.mockResolvedValueOnce({ data: [], error: null })
    const listPrintingsForSetStrict = await loadStrict()
    const result = await listPrintingsForSetStrict('empty-set')
    expect(result).toEqual([])
    expect(rangeMock).toHaveBeenCalledTimes(1)
  })

  it('retries on a transient error and succeeds on the second attempt', async () => {
    rangeMock
      .mockResolvedValueOnce({ data: null, error: { message: 'network timeout' } })
      .mockResolvedValueOnce({ data: [row('a', '001', 'Alpha')], error: null })
    const listPrintingsForSetStrict = await loadStrict()
    const result = await listPrintingsForSetStrict('mkm')
    expect(result).toHaveLength(1)
    expect(result[0].id).toBe('a')
    expect(rangeMock).toHaveBeenCalledTimes(2)
  })

  it('throws when every retry attempt fails — does NOT return []', async () => {
    rangeMock
      .mockResolvedValueOnce({ data: null, error: { message: 'fail-1' } })
      .mockResolvedValueOnce({ data: null, error: { message: 'fail-2' } })
      .mockResolvedValueOnce({ data: null, error: { message: 'fail-3' } })
    const listPrintingsForSetStrict = await loadStrict()
    await expect(listPrintingsForSetStrict('mkm')).rejects.toThrow(/listPrintingsForSetStrict: set=mkm/)
    expect(rangeMock).toHaveBeenCalledTimes(3)
  })

  it('throws when the query itself throws persistently', async () => {
    rangeMock.mockRejectedValue(new Error('ECONNRESET'))
    const listPrintingsForSetStrict = await loadStrict()
    await expect(listPrintingsForSetStrict('mkm')).rejects.toThrow(/listPrintingsForSetStrict: set=mkm/)
    expect(rangeMock).toHaveBeenCalledTimes(3)
  })
})
