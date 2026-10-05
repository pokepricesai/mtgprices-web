// src/lib/mtg/__tests__/formatsStrict.test.ts
//
// Locks in the strict variants' "do not cache a plausible-looking
// wrong answer on a transient DB error" invariant for /formats/[key].
//
// Risk the strict path guards against:
//   * getFormatCounts fail-closed to 0 → tiles show "0 Banned" for
//     Vintage/Legacy/Modern/… and that lie gets ISR-cached for 24h.
//   * getFormatSpotlight fail-closed to [] → page renders "No cards
//     are currently banned in {Format}" and ISR caches a factual lie
//     about MTG rules.
//
// These tests pin the hardened behaviour at every stage: legalities,
// oracle lookup, printing lookup.

import { describe, it, expect, vi, beforeEach } from 'vitest'

type CountResult = { count: number | null; error: { message: string } | null }
type ListResult<T = any> = { data: T[] | null; error: { message: string } | null }

const { serviceClientMock, headMock, legalsMock, oraclesMock, printsMock } = vi.hoisted(() => ({
  serviceClientMock: vi.fn(),
  // head-count terminal response (used by getFormatCountsStrict).
  // Keyed per legality bucket via mockResolvedValueOnce.
  headMock: vi.fn<[], Promise<CountResult>>(),
  // list terminal responses (used by getFormatSpotlightStrict).
  legalsMock: vi.fn<[], Promise<ListResult>>(),
  oraclesMock: vi.fn<[], Promise<ListResult>>(),
  printsMock: vi.fn<[], Promise<ListResult>>(),
}))

vi.mock('@/lib/supabaseService', () => ({
  getSupabaseServiceClient: serviceClientMock,
}))

// Build a chainable + thenable Supabase stub. The strict helpers chain
// `.from(table).select(...).eq(...).eq(...)` (and some have `.limit()`
// / `.in()` / `.order()` on top). We dispatch to the right terminal
// mock based on the table name AND the shape of the `.select()`
// invocation — count queries use `select('*', { count: 'exact', head: true })`
// so we flag the builder "isHead" when that signature is seen.
function makeBuilder(table: string) {
  let isHead = false
  const builder: any = {
    select: (_cols: string, opts?: any) => {
      if (opts && opts.head === true) isHead = true
      return builder
    },
    eq: () => builder,
    in: () => builder,
    order: () => builder,
    limit: () => builder,
    then: (onFulfilled: any, onRejected: any) => {
      const terminal = isHead
        ? headMock()
        : table === 'mtg_oracle_legalities' ? legalsMock()
        : table === 'mtg_oracle_cards' ? oraclesMock()
        : table === 'mtg_printings' ? printsMock()
        : Promise.reject(new Error(`unexpected table in test: ${table}`))
      return terminal.then(onFulfilled, onRejected)
    },
  }
  return builder
}

beforeEach(() => {
  headMock.mockReset()
  legalsMock.mockReset()
  oraclesMock.mockReset()
  printsMock.mockReset()
  serviceClientMock.mockReset()
  serviceClientMock.mockReturnValue({
    from: (table: string) => makeBuilder(table),
  })
})

async function loadStrict() {
  const mod = await import('../formats')
  return { getFormatCountsStrict: mod.getFormatCountsStrict, getFormatSpotlightStrict: mod.getFormatSpotlightStrict }
}

// ─── getFormatCountsStrict ─────────────────────────────────────────

describe('getFormatCountsStrict', () => {
  it('returns real counts when all three head-count queries succeed', async () => {
    headMock
      .mockResolvedValueOnce({ count: 25000, error: null }) // legal
      .mockResolvedValueOnce({ count: 42, error: null })    // banned
      .mockResolvedValueOnce({ count: 0, error: null })     // restricted (legitimate zero)
    const { getFormatCountsStrict } = await loadStrict()
    const result = await getFormatCountsStrict('modern')
    expect(result).toEqual({ legal: 25000, banned: 42, restricted: 0 })
    expect(headMock).toHaveBeenCalledTimes(3)
  })

  it('preserves a legitimate zero banned count (format has no bans)', async () => {
    headMock
      .mockResolvedValueOnce({ count: 10000, error: null })
      .mockResolvedValueOnce({ count: 0, error: null })  // genuinely zero banned
      .mockResolvedValueOnce({ count: 0, error: null })
    const { getFormatCountsStrict } = await loadStrict()
    const result = await getFormatCountsStrict('oathbreaker')
    expect(result.banned).toBe(0)
    expect(result.legal).toBe(10000)
  })

  it('retries a transient error on one bucket and succeeds on the second attempt', async () => {
    // All three counts fire in parallel via Promise.all → the three
    // first-attempt calls are consumed in order (legal, banned,
    // restricted), then the retry of whichever bucket failed. So the
    // mock queue is: legal#1, banned#1 (fail), restricted#1, banned#2.
    headMock
      .mockResolvedValueOnce({ count: 25000, error: null })                 // legal attempt 1
      .mockResolvedValueOnce({ count: null, error: { message: 'timeout' } }) // banned attempt 1 (transient)
      .mockResolvedValueOnce({ count: 0, error: null })                     // restricted attempt 1
      .mockResolvedValueOnce({ count: 42, error: null })                    // banned attempt 2 (ok)
    const { getFormatCountsStrict } = await loadStrict()
    const result = await getFormatCountsStrict('modern')
    expect(result).toEqual({ legal: 25000, banned: 42, restricted: 0 })
    expect(headMock).toHaveBeenCalledTimes(4)
  })

  it('throws when the banned-count query persistently fails — never returns 0', async () => {
    headMock
      .mockResolvedValueOnce({ count: 25000, error: null })
      .mockResolvedValueOnce({ count: null, error: { message: 'fail-1' } })
      .mockResolvedValueOnce({ count: null, error: { message: 'fail-2' } })
      .mockResolvedValueOnce({ count: null, error: { message: 'fail-3' } })
      .mockResolvedValueOnce({ count: 0, error: null })
    const { getFormatCountsStrict } = await loadStrict()
    await expect(getFormatCountsStrict('modern')).rejects.toThrow(/legality=banned/)
  })

  it('throws when head-count returns null count AND null error (ambiguous success)', async () => {
    // Treat ambiguous null count as a retryable failure rather than
    // silently coercing to 0. Three nulls in a row → throw.
    headMock
      .mockResolvedValueOnce({ count: null, error: null })
      .mockResolvedValueOnce({ count: null, error: null })
      .mockResolvedValueOnce({ count: null, error: null })
    const { getFormatCountsStrict } = await loadStrict()
    await expect(getFormatCountsStrict('modern')).rejects.toThrow(/legality=legal/)
  })
})

// ─── getFormatSpotlightStrict ─────────────────────────────────────

describe('getFormatSpotlightStrict', () => {
  it('returns [] on a legitimate zero legalities response, without firing stage 2/3', async () => {
    legalsMock.mockResolvedValueOnce({ data: [], error: null })
    const { getFormatSpotlightStrict } = await loadStrict()
    const result = await getFormatSpotlightStrict('oathbreaker', 'banned')
    expect(result).toEqual([])
    expect(legalsMock).toHaveBeenCalledTimes(1)
    expect(oraclesMock).not.toHaveBeenCalled()
    expect(printsMock).not.toHaveBeenCalled()
  })

  it('returns a populated hit list when every stage succeeds', async () => {
    legalsMock.mockResolvedValueOnce({
      data: [
        { oracle_card_id: 'o1', legality: 'banned' },
        { oracle_card_id: 'o2', legality: 'banned' },
      ],
      error: null,
    })
    oraclesMock.mockResolvedValueOnce({
      data: [
        { id: 'o1', name: 'Black Lotus', type_line: 'Artifact', mana_cost: '{0}', colors: [] },
        { id: 'o2', name: 'Ancestral Recall', type_line: 'Instant', mana_cost: '{U}', colors: ['U'] },
      ],
      error: null,
    })
    printsMock.mockResolvedValueOnce({
      data: [
        { oracle_card_id: 'o1', set_code: 'lea', collector_number: '232', image_uri_small: 'x', released_at: '1993-08-05' },
        { oracle_card_id: 'o2', set_code: 'lea', collector_number: '048', image_uri_small: 'y', released_at: '1993-08-05' },
      ],
      error: null,
    })
    const { getFormatSpotlightStrict } = await loadStrict()
    const result = await getFormatSpotlightStrict('vintage', 'banned')
    expect(result).toHaveLength(2)
    expect(result[0].name).toBe('Black Lotus')
    expect(result[0].freshest_printing?.set_code).toBe('lea')
  })

  it('retries legalities stage on transient error, then succeeds', async () => {
    legalsMock
      .mockResolvedValueOnce({ data: null, error: { message: 'network blip' } })
      .mockResolvedValueOnce({ data: [{ oracle_card_id: 'o1', legality: 'banned' }], error: null })
    oraclesMock.mockResolvedValueOnce({
      data: [{ id: 'o1', name: 'Black Lotus', type_line: 'Artifact', mana_cost: '{0}', colors: [] }],
      error: null,
    })
    printsMock.mockResolvedValueOnce({
      data: [{ oracle_card_id: 'o1', set_code: 'lea', collector_number: '232', image_uri_small: 'x', released_at: '1993-08-05' }],
      error: null,
    })
    const { getFormatSpotlightStrict } = await loadStrict()
    const result = await getFormatSpotlightStrict('vintage', 'banned')
    expect(result).toHaveLength(1)
    expect(legalsMock).toHaveBeenCalledTimes(2)
  })

  it('throws when legalities stage persistently fails — does NOT return []', async () => {
    legalsMock
      .mockResolvedValueOnce({ data: null, error: { message: 'fail-1' } })
      .mockResolvedValueOnce({ data: null, error: { message: 'fail-2' } })
      .mockResolvedValueOnce({ data: null, error: { message: 'fail-3' } })
    const { getFormatSpotlightStrict } = await loadStrict()
    await expect(getFormatSpotlightStrict('vintage', 'banned')).rejects.toThrow(/stage=legalities/)
    expect(oraclesMock).not.toHaveBeenCalled()
    expect(printsMock).not.toHaveBeenCalled()
  })

  it('throws when oracle lookup persistently fails', async () => {
    legalsMock.mockResolvedValueOnce({
      data: [{ oracle_card_id: 'o1', legality: 'banned' }],
      error: null,
    })
    oraclesMock
      .mockResolvedValueOnce({ data: null, error: { message: 'oracle-fail-1' } })
      .mockResolvedValueOnce({ data: null, error: { message: 'oracle-fail-2' } })
      .mockResolvedValueOnce({ data: null, error: { message: 'oracle-fail-3' } })
    printsMock.mockResolvedValueOnce({
      data: [{ oracle_card_id: 'o1', set_code: 'lea', collector_number: '232', image_uri_small: 'x', released_at: '1993-08-05' }],
      error: null,
    })
    const { getFormatSpotlightStrict } = await loadStrict()
    await expect(getFormatSpotlightStrict('vintage', 'banned')).rejects.toThrow(/stage=oracles/)
  })

  it('throws when printing lookup persistently fails', async () => {
    legalsMock.mockResolvedValueOnce({
      data: [{ oracle_card_id: 'o1', legality: 'banned' }],
      error: null,
    })
    oraclesMock.mockResolvedValueOnce({
      data: [{ id: 'o1', name: 'Black Lotus', type_line: 'Artifact', mana_cost: '{0}', colors: [] }],
      error: null,
    })
    printsMock
      .mockResolvedValueOnce({ data: null, error: { message: 'print-fail-1' } })
      .mockResolvedValueOnce({ data: null, error: { message: 'print-fail-2' } })
      .mockResolvedValueOnce({ data: null, error: { message: 'print-fail-3' } })
    const { getFormatSpotlightStrict } = await loadStrict()
    await expect(getFormatSpotlightStrict('vintage', 'banned')).rejects.toThrow(/stage=prints/)
  })
})
