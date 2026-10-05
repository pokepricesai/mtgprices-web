// src/lib/mtg/__tests__/getMarketMoversStrict.test.ts
//
// Locks in the strict variant's "do not cache a plausible-looking
// wrong answer on a transient DB error" invariant for /market.
//
// Risk the strict path guards against:
//   * getMarketMovers coerces candidate-query errors to `null` → the
//     page renders "No movers cleared the filters…" EmptyPanel, which
//     Full Route Cache would then pin for 24h.
//   * getMarketMovers silently `continue`s on an observation-chunk
//     error → the ranking is built from partial data, missing ~10% of
//     its inputs with no visible signal.
//
// Both failure modes become hard throws in the strict variant. These
// tests pin the behaviour at every retried stage.

import { describe, it, expect, vi, beforeEach } from 'vitest'

type ListResult<T = any> = { data: T[] | null; error: { message: string } | null }

const { serviceClientMock, candidatesMock, obsMock, finishesMock, printingsMock, setsMock } = vi.hoisted(() => ({
  serviceClientMock: vi.fn(),
  candidatesMock: vi.fn<[], Promise<ListResult>>(),
  obsMock: vi.fn<[], Promise<ListResult>>(),
  finishesMock: vi.fn<[], Promise<ListResult>>(),
  printingsMock: vi.fn<[], Promise<ListResult>>(),
  setsMock: vi.fn<[], Promise<ListResult>>(),
}))

vi.mock('@/lib/supabaseService', () => ({
  getSupabaseServiceClient: serviceClientMock,
}))

// Chainable + thenable Supabase stub. Dispatches to the right terminal
// mock based on table + which columns were requested — candidates and
// observations both query the pricing tables but with different select
// shapes, so we fingerprint on the select arg.
function makeBuilder(table: string) {
  let selectCols = ''
  const builder: any = {
    select: (cols: string) => { selectCols = cols; return builder },
    eq: () => builder,
    in: () => builder,
    gte: () => builder,
    or: () => builder,
    order: () => builder,
    limit: () => builder,
    then: (onFulfilled: any, onRejected: any) => {
      const terminal =
        table === 'mtg_current_prices' ? candidatesMock()
        : table === 'mtg_price_observations' ? obsMock()
        : table === 'mtg_printing_finishes' ? finishesMock()
        : table === 'mtg_printings' ? printingsMock()
        : table === 'mtg_sets' ? setsMock()
        : Promise.reject(new Error(`unexpected table in test: ${table} select=${selectCols}`))
      return terminal.then(onFulfilled, onRejected)
    },
  }
  return builder
}

beforeEach(() => {
  candidatesMock.mockReset()
  obsMock.mockReset()
  finishesMock.mockReset()
  printingsMock.mockReset()
  setsMock.mockReset()
  serviceClientMock.mockReset()
  serviceClientMock.mockReturnValue({ from: (table: string) => makeBuilder(table) })
})

async function loadStrict() {
  const mod = await import('../movers')
  return mod.getMarketMoversStrict
}

/** Build a happy-path mock sequence that returns a single moving card
 *  so the full strict pipeline (candidates → obs → finishes →
 *  printings → sets → hydrate) succeeds. The caller supplies the
 *  windowDays and the dates that should be considered earliest/latest
 *  for the window. */
function seedPopulatedHappyPath(windowDays: 7 | 30 | 90) {
  const earliest = new Date()
  earliest.setUTCDate(earliest.getUTCDate() - windowDays + 1)
  const latest = new Date()
  const earliestIso = earliest.toISOString().slice(0, 10)
  const latestIso = latest.toISOString().slice(0, 10)

  candidatesMock.mockResolvedValueOnce({
    data: [{ printing_finish_id: 'f1', price: 50, observed_on: latestIso }],
    error: null,
  })
  obsMock.mockResolvedValueOnce({
    data: [
      { printing_finish_id: 'f1', observed_on: earliestIso, price: 20 },
      { printing_finish_id: 'f1', observed_on: latestIso, price: 50 },
    ],
    error: null,
  })
  finishesMock.mockResolvedValueOnce({
    data: [{ id: 'f1', printing_id: 'p1', finish: 'nonfoil' }],
    error: null,
  })
  printingsMock.mockResolvedValueOnce({
    data: [{ id: 'p1', oracle_card_id: 'o1', set_code: 'mkm', collector_number: '001', image_uri_small: null, name: 'Test Card', digital: false, lang: 'en' }],
    error: null,
  })
  setsMock.mockResolvedValueOnce({
    data: [{ code: 'mkm', name: 'Murders at Karlov Manor' }],
    error: null,
  })
}

describe('getMarketMoversStrict', () => {
  it('returns a populated MarketMovers payload on the happy path', async () => {
    seedPopulatedHappyPath(30)
    const getMarketMoversStrict = await loadStrict()
    const result = await getMarketMoversStrict({ windowDays: 30, topN: 10 })
    expect(result).not.toBeNull()
    expect(result!.risers).toHaveLength(1)
    expect(result!.risers[0].name).toBe('Test Card')
    expect(result!.risers[0].set_name).toBe('Murders at Karlov Manor')
    expect(result!.windowDays).toBe(30)
    expect(result!.candidatesScanned).toBe(1)
    expect(result!.candidatesWithMovement).toBe(1)
  })

  it('returns null for a legitimate zero-candidates response (NOT an error)', async () => {
    candidatesMock.mockResolvedValueOnce({ data: [], error: null })
    const getMarketMoversStrict = await loadStrict()
    const result = await getMarketMoversStrict({ windowDays: 30, topN: 10 })
    expect(result).toBeNull()
    // Zero candidates must short-circuit without hitting downstream stages.
    expect(obsMock).not.toHaveBeenCalled()
    expect(finishesMock).not.toHaveBeenCalled()
    expect(printingsMock).not.toHaveBeenCalled()
  })

  it('retries a transient candidate failure and succeeds on second attempt', async () => {
    const earliest = new Date()
    earliest.setUTCDate(earliest.getUTCDate() - 29)
    const latest = new Date()
    const earliestIso = earliest.toISOString().slice(0, 10)
    const latestIso = latest.toISOString().slice(0, 10)
    candidatesMock
      .mockResolvedValueOnce({ data: null, error: { message: 'transient-network' } })
      .mockResolvedValueOnce({
        data: [{ printing_finish_id: 'f1', price: 50, observed_on: latestIso }],
        error: null,
      })
    obsMock.mockResolvedValueOnce({
      data: [
        { printing_finish_id: 'f1', observed_on: earliestIso, price: 20 },
        { printing_finish_id: 'f1', observed_on: latestIso, price: 50 },
      ],
      error: null,
    })
    finishesMock.mockResolvedValueOnce({
      data: [{ id: 'f1', printing_id: 'p1', finish: 'nonfoil' }],
      error: null,
    })
    printingsMock.mockResolvedValueOnce({
      data: [{ id: 'p1', oracle_card_id: 'o1', set_code: 'mkm', collector_number: '001', image_uri_small: null, name: 'Test Card', digital: false, lang: 'en' }],
      error: null,
    })
    setsMock.mockResolvedValueOnce({ data: [], error: null })

    const getMarketMoversStrict = await loadStrict()
    const result = await getMarketMoversStrict({ windowDays: 30, topN: 10 })
    expect(result).not.toBeNull()
    expect(result!.risers).toHaveLength(1)
    expect(candidatesMock).toHaveBeenCalledTimes(2)
  })

  it('throws when the candidate query persistently fails — never returns null', async () => {
    candidatesMock
      .mockResolvedValueOnce({ data: null, error: { message: 'fail-1' } })
      .mockResolvedValueOnce({ data: null, error: { message: 'fail-2' } })
      .mockResolvedValueOnce({ data: null, error: { message: 'fail-3' } })
    const getMarketMoversStrict = await loadStrict()
    await expect(getMarketMoversStrict({ windowDays: 30, topN: 10 })).rejects.toThrow(/stage=candidates/)
  })

  it('retries a transient observation-chunk failure and succeeds on retry', async () => {
    const earliest = new Date()
    earliest.setUTCDate(earliest.getUTCDate() - 29)
    const latest = new Date()
    const earliestIso = earliest.toISOString().slice(0, 10)
    const latestIso = latest.toISOString().slice(0, 10)
    candidatesMock.mockResolvedValueOnce({
      data: [{ printing_finish_id: 'f1', price: 50, observed_on: latestIso }],
      error: null,
    })
    obsMock
      .mockResolvedValueOnce({ data: null, error: { message: 'chunk-network-blip' } })
      .mockResolvedValueOnce({
        data: [
          { printing_finish_id: 'f1', observed_on: earliestIso, price: 20 },
          { printing_finish_id: 'f1', observed_on: latestIso, price: 50 },
        ],
        error: null,
      })
    finishesMock.mockResolvedValueOnce({
      data: [{ id: 'f1', printing_id: 'p1', finish: 'nonfoil' }],
      error: null,
    })
    printingsMock.mockResolvedValueOnce({
      data: [{ id: 'p1', oracle_card_id: 'o1', set_code: 'mkm', collector_number: '001', image_uri_small: null, name: 'Test Card', digital: false, lang: 'en' }],
      error: null,
    })
    setsMock.mockResolvedValueOnce({ data: [], error: null })

    const getMarketMoversStrict = await loadStrict()
    const result = await getMarketMoversStrict({ windowDays: 30, topN: 10 })
    expect(result).not.toBeNull()
    expect(obsMock).toHaveBeenCalledTimes(2)
  })

  it('throws when an observation chunk persistently fails — never silently drops it', async () => {
    const latest = new Date().toISOString().slice(0, 10)
    candidatesMock.mockResolvedValueOnce({
      data: [{ printing_finish_id: 'f1', price: 50, observed_on: latest }],
      error: null,
    })
    obsMock
      .mockResolvedValueOnce({ data: null, error: { message: 'chunk-fail-1' } })
      .mockResolvedValueOnce({ data: null, error: { message: 'chunk-fail-2' } })
      .mockResolvedValueOnce({ data: null, error: { message: 'chunk-fail-3' } })
    const getMarketMoversStrict = await loadStrict()
    await expect(getMarketMoversStrict({ windowDays: 30, topN: 10 })).rejects.toThrow(/stage=observations-chunk/)
  })

  it('throws when the printing-finishes lookup persistently fails', async () => {
    const earliest = new Date()
    earliest.setUTCDate(earliest.getUTCDate() - 29)
    const latest = new Date()
    const earliestIso = earliest.toISOString().slice(0, 10)
    const latestIso = latest.toISOString().slice(0, 10)
    candidatesMock.mockResolvedValueOnce({
      data: [{ printing_finish_id: 'f1', price: 50, observed_on: latestIso }],
      error: null,
    })
    obsMock.mockResolvedValueOnce({
      data: [
        { printing_finish_id: 'f1', observed_on: earliestIso, price: 20 },
        { printing_finish_id: 'f1', observed_on: latestIso, price: 50 },
      ],
      error: null,
    })
    finishesMock
      .mockResolvedValueOnce({ data: null, error: { message: 'f-fail-1' } })
      .mockResolvedValueOnce({ data: null, error: { message: 'f-fail-2' } })
      .mockResolvedValueOnce({ data: null, error: { message: 'f-fail-3' } })
    const getMarketMoversStrict = await loadStrict()
    await expect(getMarketMoversStrict({ windowDays: 30, topN: 10 })).rejects.toThrow(/stage=printing-finishes/)
  })

  it('throws when the printings lookup persistently fails', async () => {
    const earliest = new Date()
    earliest.setUTCDate(earliest.getUTCDate() - 29)
    const latest = new Date()
    const earliestIso = earliest.toISOString().slice(0, 10)
    const latestIso = latest.toISOString().slice(0, 10)
    candidatesMock.mockResolvedValueOnce({
      data: [{ printing_finish_id: 'f1', price: 50, observed_on: latestIso }],
      error: null,
    })
    obsMock.mockResolvedValueOnce({
      data: [
        { printing_finish_id: 'f1', observed_on: earliestIso, price: 20 },
        { printing_finish_id: 'f1', observed_on: latestIso, price: 50 },
      ],
      error: null,
    })
    finishesMock.mockResolvedValueOnce({
      data: [{ id: 'f1', printing_id: 'p1', finish: 'nonfoil' }],
      error: null,
    })
    printingsMock
      .mockResolvedValueOnce({ data: null, error: { message: 'p-fail-1' } })
      .mockResolvedValueOnce({ data: null, error: { message: 'p-fail-2' } })
      .mockResolvedValueOnce({ data: null, error: { message: 'p-fail-3' } })
    const getMarketMoversStrict = await loadStrict()
    await expect(getMarketMoversStrict({ windowDays: 30, topN: 10 })).rejects.toThrow(/stage=printings/)
  })
})
