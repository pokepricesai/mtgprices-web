// src/lib/tcggraph/__tests__/getTcgBundleForMtgPrintingStrict.test.ts
//
// Strict variant for the Graded Prices panel data. A persistent
// Supabase failure must throw so the card page cannot cache a
// response that silently drops graded data.

import { describe, it, expect, vi, beforeEach } from 'vitest'

type ListResult<T = any> = { data: T[] | null; error: { message: string } | null }

const { serviceClientMock, tcgPrintingsMock, marketCurrentMock, gradedCurrentMock, marketDailyMock } = vi.hoisted(() => ({
  serviceClientMock: vi.fn(),
  tcgPrintingsMock: vi.fn<[], Promise<ListResult>>(),
  marketCurrentMock: vi.fn<[], Promise<ListResult>>(),
  gradedCurrentMock: vi.fn<[], Promise<ListResult>>(),
  marketDailyMock: vi.fn<[], Promise<ListResult>>(),
}))

vi.mock('@/lib/supabaseService', () => ({
  getSupabaseServiceClient: serviceClientMock,
}))

function makeBuilder(table: string) {
  const builder: any = {
    select: () => builder,
    eq: () => builder,
    in: () => builder,
    order: () => builder,
    limit: () => builder,
    then: (onFulfilled: any, onRejected: any) => {
      const terminal =
        table === 'tcg_printings' ? tcgPrintingsMock()
        : table === 'tcg_market_prices_current' ? marketCurrentMock()
        : table === 'tcg_graded_prices_current' ? gradedCurrentMock()
        : table === 'tcg_market_price_daily' ? marketDailyMock()
        : Promise.reject(new Error(`unexpected table: ${table}`))
      return terminal.then(onFulfilled, onRejected)
    },
  }
  return builder
}

beforeEach(() => {
  tcgPrintingsMock.mockReset()
  marketCurrentMock.mockReset()
  gradedCurrentMock.mockReset()
  marketDailyMock.mockReset()
  serviceClientMock.mockReset()
  serviceClientMock.mockReturnValue({ from: (t: string) => makeBuilder(t) })
})

async function loadStrict() {
  const mod = await import('../read-model')
  return mod.getTcgBundleForMtgPrintingStrict
}

describe('getTcgBundleForMtgPrintingStrict', () => {
  it('returns null for a legitimate unmapped mtg_printings.id (zero tcg_printings)', async () => {
    tcgPrintingsMock.mockResolvedValueOnce({ data: [], error: null })
    const getTcgBundleForMtgPrintingStrict = await loadStrict()
    const result = await getTcgBundleForMtgPrintingStrict('unmapped-id')
    expect(result).toBeNull()
    expect(marketCurrentMock).not.toHaveBeenCalled()
    expect(gradedCurrentMock).not.toHaveBeenCalled()
  })

  it('returns a populated bundle when all stages succeed', async () => {
    tcgPrintingsMock.mockResolvedValueOnce({
      data: [{ id: 't1', tcggraph_card_id: 'c1', tcggraph_printing_key: 'k1', finish: 'nonfoil', mapping_confidence: 'high' }],
      error: null,
    })
    marketCurrentMock.mockResolvedValueOnce({ data: [], error: null })
    gradedCurrentMock.mockResolvedValueOnce({ data: [], error: null })
    marketDailyMock.mockResolvedValueOnce({ data: [{ observed_on: '2025-01-10' }], error: null })

    const getTcgBundleForMtgPrintingStrict = await loadStrict()
    const result = await getTcgBundleForMtgPrintingStrict('p1')
    expect(result).not.toBeNull()
    expect(result!.tcgPrintings).toHaveLength(1)
    expect(result!.latestObservationDate).toBe('2025-01-10')
  })

  it('throws when tcg_printings lookup persistently fails', async () => {
    tcgPrintingsMock
      .mockResolvedValueOnce({ data: null, error: { message: 'fail-1' } })
      .mockResolvedValueOnce({ data: null, error: { message: 'fail-2' } })
      .mockResolvedValueOnce({ data: null, error: { message: 'fail-3' } })
    const getTcgBundleForMtgPrintingStrict = await loadStrict()
    await expect(getTcgBundleForMtgPrintingStrict('p1')).rejects.toThrow(/stage=tcg-printings/)
  })

  it('throws when the market-current stage persistently fails', async () => {
    tcgPrintingsMock.mockResolvedValueOnce({
      data: [{ id: 't1', tcggraph_card_id: 'c1', tcggraph_printing_key: 'k1', finish: 'nonfoil', mapping_confidence: 'high' }],
      error: null,
    })
    marketCurrentMock
      .mockResolvedValueOnce({ data: null, error: { message: 'fail-1' } })
      .mockResolvedValueOnce({ data: null, error: { message: 'fail-2' } })
      .mockResolvedValueOnce({ data: null, error: { message: 'fail-3' } })
    gradedCurrentMock.mockResolvedValueOnce({ data: [], error: null })
    marketDailyMock.mockResolvedValueOnce({ data: [], error: null })
    const getTcgBundleForMtgPrintingStrict = await loadStrict()
    await expect(getTcgBundleForMtgPrintingStrict('p1')).rejects.toThrow(/stage=market-current/)
  })

  it('throws when the graded-current stage persistently fails — never silently drops graded data', async () => {
    tcgPrintingsMock.mockResolvedValueOnce({
      data: [{ id: 't1', tcggraph_card_id: 'c1', tcggraph_printing_key: 'k1', finish: 'nonfoil', mapping_confidence: 'high' }],
      error: null,
    })
    marketCurrentMock.mockResolvedValueOnce({ data: [], error: null })
    gradedCurrentMock
      .mockResolvedValueOnce({ data: null, error: { message: 'fail-1' } })
      .mockResolvedValueOnce({ data: null, error: { message: 'fail-2' } })
      .mockResolvedValueOnce({ data: null, error: { message: 'fail-3' } })
    marketDailyMock.mockResolvedValueOnce({ data: [], error: null })
    const getTcgBundleForMtgPrintingStrict = await loadStrict()
    await expect(getTcgBundleForMtgPrintingStrict('p1')).rejects.toThrow(/stage=graded-current/)
  })

  it('retries transient tcg-printings failure and succeeds on retry', async () => {
    tcgPrintingsMock
      .mockResolvedValueOnce({ data: null, error: { message: 'transient' } })
      .mockResolvedValueOnce({
        data: [{ id: 't1', tcggraph_card_id: 'c1', tcggraph_printing_key: 'k1', finish: 'nonfoil', mapping_confidence: 'high' }],
        error: null,
      })
    marketCurrentMock.mockResolvedValueOnce({ data: [], error: null })
    gradedCurrentMock.mockResolvedValueOnce({ data: [], error: null })
    marketDailyMock.mockResolvedValueOnce({ data: [], error: null })
    const getTcgBundleForMtgPrintingStrict = await loadStrict()
    const result = await getTcgBundleForMtgPrintingStrict('p1')
    expect(result).not.toBeNull()
    expect(tcgPrintingsMock).toHaveBeenCalledTimes(2)
  })
})
