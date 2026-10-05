// src/lib/mtg/__tests__/pricesStrict.test.ts
//
// Strict pricing helpers used by the cacheable card page.
// getCurrentPricesForFinishesStrict and getHeadlinePricesByPrintingStrict
// chunk their IN queries; a chunk that persistently errors must throw
// rather than silently drop ~1/n of the pricing — otherwise the Full
// Route Cache would pin a card page with holes in its market panel.
//
// getPriceHistoryStrict is single-query but equally critical: a null
// chart on a transient Supabase blip would get cached for 24h.

import { describe, it, expect, vi, beforeEach } from 'vitest'

type ListResult<T = any> = { data: T[] | null; error: { message: string } | null }

const { serviceClientMock, currentPricesMock, observationsMock, finishesByPrintingMock } = vi.hoisted(() => ({
  serviceClientMock: vi.fn(),
  currentPricesMock: vi.fn<[], Promise<ListResult>>(),
  observationsMock: vi.fn<[], Promise<ListResult>>(),
  finishesByPrintingMock: vi.fn<[], Promise<ListResult>>(),
}))

vi.mock('@/lib/supabaseService', () => ({
  getSupabaseServiceClient: serviceClientMock,
}))

function makeBuilder(table: string) {
  const builder: any = {
    select: () => builder,
    eq: () => builder,
    in: () => builder,
    gte: () => builder,
    or: () => builder,
    order: () => builder,
    limit: () => builder,
    then: (onFulfilled: any, onRejected: any) => {
      const terminal =
        table === 'mtg_current_prices' ? currentPricesMock()
        : table === 'mtg_price_observations' ? observationsMock()
        : table === 'mtg_printing_finishes' ? finishesByPrintingMock()
        : Promise.reject(new Error(`unexpected table: ${table}`))
      return terminal.then(onFulfilled, onRejected)
    },
  }
  return builder
}

beforeEach(() => {
  currentPricesMock.mockReset()
  observationsMock.mockReset()
  finishesByPrintingMock.mockReset()
  serviceClientMock.mockReset()
  serviceClientMock.mockReturnValue({ from: (t: string) => makeBuilder(t) })
})

async function loadStrict() {
  const mod = await import('../prices')
  return {
    getCurrentPricesForFinishesStrict: mod.getCurrentPricesForFinishesStrict,
    getPriceHistoryStrict: mod.getPriceHistoryStrict,
    getHeadlinePricesByPrintingStrict: mod.getHeadlinePricesByPrintingStrict,
  }
}

function priceRow(finishId: string, price: number): any {
  return {
    printing_finish_id: finishId, provider: 'tcgplayer', market: 'paper',
    currency: 'USD', price_type: 'retail', condition: 'nm',
    price, observed_on: '2025-01-01', ingestion_source: 'test',
  }
}

// ─── getCurrentPricesForFinishesStrict ────────────────────────────

describe('getCurrentPricesForFinishesStrict', () => {
  it('returns empty Map immediately for empty input (no DB call)', async () => {
    const { getCurrentPricesForFinishesStrict } = await loadStrict()
    const result = await getCurrentPricesForFinishesStrict([])
    expect(result.size).toBe(0)
    expect(currentPricesMock).not.toHaveBeenCalled()
  })

  it('returns populated Map keyed by printing_finish_id', async () => {
    currentPricesMock.mockResolvedValueOnce({
      data: [priceRow('f1', 10), priceRow('f2', 20)],
      error: null,
    })
    const { getCurrentPricesForFinishesStrict } = await loadStrict()
    const result = await getCurrentPricesForFinishesStrict(['f1', 'f2'])
    expect(result.get('f1')).toHaveLength(1)
    expect(result.get('f1')?.[0].price).toBe(10)
    expect(result.get('f2')?.[0].price).toBe(20)
  })

  it('throws when a chunk persistently fails — does NOT silently drop it', async () => {
    currentPricesMock
      .mockResolvedValueOnce({ data: null, error: { message: 'fail-1' } })
      .mockResolvedValueOnce({ data: null, error: { message: 'fail-2' } })
      .mockResolvedValueOnce({ data: null, error: { message: 'fail-3' } })
    const { getCurrentPricesForFinishesStrict } = await loadStrict()
    await expect(getCurrentPricesForFinishesStrict(['f1'])).rejects.toThrow(/getCurrentPricesForFinishesStrict/)
  })

  it('retries a transient chunk failure and succeeds on retry', async () => {
    currentPricesMock
      .mockResolvedValueOnce({ data: null, error: { message: 'network blip' } })
      .mockResolvedValueOnce({ data: [priceRow('f1', 10)], error: null })
    const { getCurrentPricesForFinishesStrict } = await loadStrict()
    const result = await getCurrentPricesForFinishesStrict(['f1'])
    expect(result.get('f1')?.[0].price).toBe(10)
    expect(currentPricesMock).toHaveBeenCalledTimes(2)
  })
})

// ─── getPriceHistoryStrict ────────────────────────────────────────

describe('getPriceHistoryStrict', () => {
  it('returns [] on a legitimate empty history', async () => {
    observationsMock.mockResolvedValueOnce({ data: [], error: null })
    const { getPriceHistoryStrict } = await loadStrict()
    const result = await getPriceHistoryStrict({ printingFinishId: 'f1' })
    expect(result).toEqual([])
  })

  it('returns grouped series on populated history', async () => {
    observationsMock.mockResolvedValueOnce({
      data: [
        { provider: 'tcgplayer', market: 'paper', currency: 'USD', price_type: 'retail', observed_on: '2025-01-01', price: 10 },
        { provider: 'tcgplayer', market: 'paper', currency: 'USD', price_type: 'retail', observed_on: '2025-01-02', price: 12 },
      ],
      error: null,
    })
    const { getPriceHistoryStrict } = await loadStrict()
    const result = await getPriceHistoryStrict({ printingFinishId: 'f1' })
    expect(result).toHaveLength(1)
    expect(result[0].points).toHaveLength(2)
  })

  it('throws when the observations query persistently fails', async () => {
    observationsMock
      .mockResolvedValueOnce({ data: null, error: { message: 'fail-1' } })
      .mockResolvedValueOnce({ data: null, error: { message: 'fail-2' } })
      .mockResolvedValueOnce({ data: null, error: { message: 'fail-3' } })
    const { getPriceHistoryStrict } = await loadStrict()
    await expect(getPriceHistoryStrict({ printingFinishId: 'f1' })).rejects.toThrow(/getPriceHistoryStrict/)
  })
})

// ─── getHeadlinePricesByPrintingStrict ────────────────────────────

describe('getHeadlinePricesByPrintingStrict', () => {
  it('returns empty Map immediately for empty input', async () => {
    const { getHeadlinePricesByPrintingStrict } = await loadStrict()
    const result = await getHeadlinePricesByPrintingStrict([])
    expect(result.size).toBe(0)
  })

  it('throws when the finishes-by-printing stage persistently fails', async () => {
    finishesByPrintingMock
      .mockResolvedValueOnce({ data: null, error: { message: 'fail-1' } })
      .mockResolvedValueOnce({ data: null, error: { message: 'fail-2' } })
      .mockResolvedValueOnce({ data: null, error: { message: 'fail-3' } })
    const { getHeadlinePricesByPrintingStrict } = await loadStrict()
    await expect(getHeadlinePricesByPrintingStrict(['p1'])).rejects.toThrow(/finish-chunk/)
  })

  it('throws when the downstream current-prices stage persistently fails', async () => {
    finishesByPrintingMock.mockResolvedValueOnce({
      data: [{ id: 'f1', printing_id: 'p1', finish: 'nonfoil' }],
      error: null,
    })
    currentPricesMock
      .mockResolvedValueOnce({ data: null, error: { message: 'fail-1' } })
      .mockResolvedValueOnce({ data: null, error: { message: 'fail-2' } })
      .mockResolvedValueOnce({ data: null, error: { message: 'fail-3' } })
    const { getHeadlinePricesByPrintingStrict } = await loadStrict()
    await expect(getHeadlinePricesByPrintingStrict(['p1'])).rejects.toThrow(/getCurrentPricesForFinishesStrict/)
  })
})
