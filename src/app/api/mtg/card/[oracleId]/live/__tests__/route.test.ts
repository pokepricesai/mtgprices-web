// src/app/api/mtg/card/[oracleId]/live/__tests__/route.test.ts
//
// Validates the live card-market endpoint contract that Phase 1
// relies on:
//   - Valid card → 200 with cacheable Cache-Control.
//   - High-printing card (basic land / Mountain class) → composes the
//     strict helpers without an oversized request.
//   - Legitimate no-priced-data → 200 (cacheable "factual zero").
//   - Backend failure → 500 + no-store, so the CDN cannot pin a
//     transient Supabase blip as a confident empty payload.
//   - Invalid URL params → 400 + no-store (no CDN fan-out).
//   - No cookies read — the request handler is deterministic from
//     URL params and must stay cookie-free so public caching is safe.

import { describe, it, expect, vi, beforeEach } from 'vitest'

const {
  getCurrentPricesForFinishesStrictMock,
  getCardMarketSummaryStrictMock,
  getTcgBundleForMtgPrintingStrictMock,
  serviceClientMock,
  finishesLookupMock,
} = vi.hoisted(() => ({
  getCurrentPricesForFinishesStrictMock: vi.fn(),
  getCardMarketSummaryStrictMock: vi.fn(),
  getTcgBundleForMtgPrintingStrictMock: vi.fn(),
  serviceClientMock: vi.fn(),
  finishesLookupMock: vi.fn<[], Promise<{ data: Array<{ id: string }> | null; error: { message: string } | null }>>(),
}))

vi.mock('@/lib/mtg/prices', () => ({
  getCurrentPricesForFinishesStrict: getCurrentPricesForFinishesStrictMock,
}))
vi.mock('@/lib/mtg/card-market', () => ({
  getCardMarketSummaryStrict: getCardMarketSummaryStrictMock,
}))
vi.mock('@/lib/tcggraph/read-model', () => ({
  getTcgBundleForMtgPrintingStrict: getTcgBundleForMtgPrintingStrictMock,
}))
vi.mock('@/lib/supabaseService', () => ({
  getSupabaseServiceClient: serviceClientMock,
}))

function makeFinishesBuilder() {
  const builder: any = {
    select: () => builder,
    eq: () => builder,
    then: (onFulfilled: any, onRejected: any) => finishesLookupMock().then(onFulfilled, onRejected),
  }
  return builder
}

beforeEach(() => {
  getCurrentPricesForFinishesStrictMock.mockReset()
  getCardMarketSummaryStrictMock.mockReset()
  getTcgBundleForMtgPrintingStrictMock.mockReset()
  finishesLookupMock.mockReset()
  serviceClientMock.mockReset()
  serviceClientMock.mockReturnValue({ from: () => makeFinishesBuilder() })
})

const ORACLE = '11111111-1111-1111-1111-111111111111'
const PRINTING = '22222222-2222-2222-2222-222222222222'
const F1 = '33333333-3333-3333-3333-333333333333'
const F2 = '44444444-4444-4444-4444-444444444444'

async function callRoute(path: string) {
  const mod = await import('../route')
  const url = `http://localhost${path}`
  return mod.GET(new Request(url), { params: Promise.resolve({ oracleId: ORACLE }) })
}

function priceRow(finishId: string, price: number) {
  return {
    printing_finish_id: finishId, provider: 'tcgplayer', market: 'paper',
    currency: 'USD', price_type: 'retail', condition: 'nm',
    price, observed_on: '2025-01-01', ingestion_source: 'test',
  }
}

describe('/api/mtg/card/[oracleId]/live', () => {
  it('returns 200 + cacheable headers for a valid ordinary card', async () => {
    const priceMap = new Map([[F1, [priceRow(F1, 10)]]])
    getCurrentPricesForFinishesStrictMock.mockResolvedValueOnce(priceMap)
    getCardMarketSummaryStrictMock.mockResolvedValueOnce({
      basis: { provider: 'tcgplayer', currency: 'USD', market: 'paper', priceType: 'retail' },
      currencySymbol: '$', currentPrice: 10, currentObservedOn: '2025-01-01',
      currentPrintingId: PRINTING, currentFinishId: F1, currentFinish: 'nonfoil',
      d7: {} as any, d30: {} as any, d90: {} as any,
      pricedPrintings: [], cheapest: null, mostExpensive: null, currentRank: 1,
      foilPremium: null, insights: [],
    })
    getTcgBundleForMtgPrintingStrictMock.mockResolvedValueOnce(null)

    const resp = await callRoute(`/api/mtg/card/${ORACLE}/live?printingId=${PRINTING}&finishIds=${F1}`)
    expect(resp.status).toBe(200)
    expect(resp.headers.get('Cache-Control')).toMatch(/public.*s-maxage=21600.*stale-while-revalidate=604800/)
    const body = await resp.json()
    expect(body.oracleId).toBe(ORACLE)
    expect(body.printingId).toBe(PRINTING)
    expect(body.currentPricesByFinish[F1]).toHaveLength(1)
    expect(body.marketSummary).not.toBeNull()
    expect(body.tcgBundle).toBeNull()
    // Strict helpers must be called with the exact composition the
    // page uses — no partial pricing / no silent subset.
    expect(getCurrentPricesForFinishesStrictMock).toHaveBeenCalledWith([F1])
    expect(getCardMarketSummaryStrictMock).toHaveBeenCalledWith(ORACLE, PRINTING)
    expect(getTcgBundleForMtgPrintingStrictMock).toHaveBeenCalledWith(PRINTING)
  })

  it('handles a high-printing card (basic land Mountain class) via chunked helpers', async () => {
    // Simulate Mountain: hundreds of priced finishes return as one Map.
    const bigMap = new Map<string, any[]>()
    const finishIdList = Array.from({ length: 8 }, (_, i) => `55555555-5555-5555-5555-5555555555${i.toString().padStart(2, '0')}`)
    for (const f of finishIdList) bigMap.set(f, [priceRow(f, 0.25)])
    getCurrentPricesForFinishesStrictMock.mockResolvedValueOnce(bigMap)
    getCardMarketSummaryStrictMock.mockResolvedValueOnce({
      basis: { provider: 'tcgplayer', currency: 'USD', market: 'paper', priceType: 'retail' },
      currencySymbol: '$', currentPrice: 0.25, currentObservedOn: '2025-01-01',
      currentPrintingId: PRINTING, currentFinishId: finishIdList[0], currentFinish: 'nonfoil',
      d7: {} as any, d30: {} as any, d90: {} as any,
      pricedPrintings: Array.from({ length: 345 }, () => ({} as any)),
      cheapest: {} as any, mostExpensive: {} as any, currentRank: 1,
      foilPremium: null, insights: [],
    })
    getTcgBundleForMtgPrintingStrictMock.mockResolvedValueOnce(null)

    // Hitting the endpoint without finishIds — must look them up itself.
    finishesLookupMock.mockResolvedValueOnce({
      data: finishIdList.map((id) => ({ id })),
      error: null,
    })
    const resp = await callRoute(`/api/mtg/card/${ORACLE}/live?printingId=${PRINTING}`)

    expect(resp.status).toBe(200)
    const body = await resp.json()
    expect(body.marketSummary.pricedPrintings).toHaveLength(345)
    expect(Object.keys(body.currentPricesByFinish)).toHaveLength(finishIdList.length)
    expect(getCurrentPricesForFinishesStrictMock).toHaveBeenCalledWith(finishIdList)
  })

  it('returns 200 with cacheable headers for a legitimate zero-priced-data card', async () => {
    getCurrentPricesForFinishesStrictMock.mockResolvedValueOnce(new Map())
    // Summary helper legitimately returns null for an oracle with no English paper printings.
    getCardMarketSummaryStrictMock.mockResolvedValueOnce(null)
    getTcgBundleForMtgPrintingStrictMock.mockResolvedValueOnce(null)

    const resp = await callRoute(`/api/mtg/card/${ORACLE}/live?printingId=${PRINTING}&finishIds=${F1}`)
    expect(resp.status).toBe(200)
    expect(resp.headers.get('Cache-Control')).toMatch(/s-maxage=21600/)
    const body = await resp.json()
    expect(body.marketSummary).toBeNull()
    expect(body.tcgBundle).toBeNull()
    expect(body.currentPricesByFinish).toEqual({})
  })

  it('returns 500 + no-store when any strict helper persistently fails', async () => {
    getCurrentPricesForFinishesStrictMock.mockRejectedValueOnce(new Error('bad-request'))
    // Other two still mocked so the Promise.all does not stall on them.
    getCardMarketSummaryStrictMock.mockResolvedValueOnce(null)
    getTcgBundleForMtgPrintingStrictMock.mockResolvedValueOnce(null)

    const resp = await callRoute(`/api/mtg/card/${ORACLE}/live?printingId=${PRINTING}&finishIds=${F1}`)
    expect(resp.status).toBe(500)
    expect(resp.headers.get('Cache-Control')).toBe('no-store')
    const body = await resp.json()
    expect(body.error).toBe('internal')
  })

  it('rejects an invalid oracleId with 400 + no-store (no CDN fan-out)', async () => {
    const mod = await import('../route')
    const resp = await mod.GET(
      new Request(`http://localhost/api/mtg/card/not-a-uuid/live?printingId=${PRINTING}`),
      { params: Promise.resolve({ oracleId: 'not-a-uuid' }) },
    )
    expect(resp.status).toBe(400)
    expect(resp.headers.get('Cache-Control')).toBe('no-store')
  })

  it('rejects an invalid printingId with 400 + no-store', async () => {
    const resp = await callRoute(`/api/mtg/card/${ORACLE}/live?printingId=not-a-uuid`)
    expect(resp.status).toBe(400)
    expect(resp.headers.get('Cache-Control')).toBe('no-store')
  })

  it('rejects an oversized finishIds list with 400 + no-store (cache-fan-out defence)', async () => {
    const tooMany = Array.from({ length: 20 }, (_, i) =>
      `66666666-6666-6666-6666-6666666666${i.toString().padStart(2, '0')}`
    ).join(',')
    const resp = await callRoute(`/api/mtg/card/${ORACLE}/live?printingId=${PRINTING}&finishIds=${tooMany}`)
    expect(resp.status).toBe(400)
    expect(resp.headers.get('Cache-Control')).toBe('no-store')
  })

  it('does not read cookies — handler is deterministic from URL params', async () => {
    // Supply a request with cookies and verify the handler ignores
    // them entirely (the strict helpers are called with URL-param
    // inputs only; there is no cookies() call on this path).
    getCurrentPricesForFinishesStrictMock.mockResolvedValueOnce(new Map())
    getCardMarketSummaryStrictMock.mockResolvedValueOnce(null)
    getTcgBundleForMtgPrintingStrictMock.mockResolvedValueOnce(null)

    const mod = await import('../route')
    const resp = await mod.GET(
      new Request(`http://localhost/api/mtg/card/${ORACLE}/live?printingId=${PRINTING}&finishIds=${F1},${F2}`, {
        headers: { cookie: 'sb-access-token=whatever; sb-refresh-token=whatever' },
      }),
      { params: Promise.resolve({ oracleId: ORACLE }) },
    )
    expect(resp.status).toBe(200)
    // Response caching must be public, not private — proves the
    // handler did not treat the request as user-scoped.
    expect(resp.headers.get('Cache-Control')).toMatch(/^public/)
  })
})
