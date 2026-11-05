// src/lib/mtg/__tests__/getCardMarketSummaryStrict.test.ts
//
// Prevents the "No live paper price on file for this exact printing
// yet" cache-poisoning class on the card page's Market Overview panel.
// All required stages (printings, finishes, current prices, 30d
// observations, 90d history) must retry + throw on persistent
// failure. Set-name lookup intentionally stays fail-open (cosmetic).

import { describe, it, expect, vi, beforeEach } from 'vitest'

type ListResult<T = any> = { data: T[] | null; error: { message: string } | null }

const {
  serviceClientMock,
  printingsMock,
  finishesMock,
  currentPricesMock,
  setsMock,
  observations30Mock,
  observations90Mock,
} = vi.hoisted(() => ({
  serviceClientMock: vi.fn(),
  printingsMock: vi.fn<[], Promise<ListResult>>(),
  finishesMock: vi.fn<[], Promise<ListResult>>(),
  currentPricesMock: vi.fn<[], Promise<ListResult>>(),
  setsMock: vi.fn<[], Promise<ListResult>>(),
  observations30Mock: vi.fn<[], Promise<ListResult>>(),
  observations90Mock: vi.fn<[], Promise<ListResult>>(),
}))

vi.mock('@/lib/supabaseService', () => ({
  getSupabaseServiceClient: serviceClientMock,
}))

// Dispatch observations queries by whether `.order()` was called —
// the 30d chunked query doesn't call order(), the 90d history query
// does.
function makeBuilder(table: string) {
  let isOrdered = false
  const builder: any = {
    select: () => builder,
    eq: () => builder,
    in: () => builder,
    gte: () => builder,
    or: () => builder,
    order: () => { isOrdered = true; return builder },
    limit: () => builder,
    then: (onFulfilled: any, onRejected: any) => {
      const terminal =
        table === 'mtg_printings' ? printingsMock()
        : table === 'mtg_printing_finishes' ? finishesMock()
        : table === 'mtg_current_prices' ? currentPricesMock()
        : table === 'mtg_sets' ? setsMock()
        : table === 'mtg_price_observations' ? (isOrdered ? observations90Mock() : observations30Mock())
        : Promise.reject(new Error(`unexpected table: ${table}`))
      return terminal.then(onFulfilled, onRejected)
    },
  }
  return builder
}

beforeEach(() => {
  printingsMock.mockReset()
  finishesMock.mockReset()
  currentPricesMock.mockReset()
  setsMock.mockReset()
  observations30Mock.mockReset()
  observations90Mock.mockReset()
  serviceClientMock.mockReset()
  serviceClientMock.mockReturnValue({ from: (t: string) => makeBuilder(t) })
})

async function loadStrict() {
  const mod = await import('../card-market')
  return mod.getCardMarketSummaryStrict
}

/** Build a happy-path mock set that produces a non-null summary. */
function seedHappyPath() {
  printingsMock.mockResolvedValueOnce({
    data: [{ id: 'p1', oracle_card_id: 'o1', set_code: 'lea', collector_number: '232', name: 'Black Lotus', released_at: '1993-08-05', image_uri_small: null, digital: false, lang: 'en', rarity: 'rare' }],
    error: null,
  })
  finishesMock.mockResolvedValueOnce({
    data: [{ id: 'f1', printing_id: 'p1', finish: 'nonfoil' }],
    error: null,
  })
  currentPricesMock.mockResolvedValueOnce({
    data: [{ printing_finish_id: 'f1', price: 25000, observed_on: '2025-01-10' }],
    error: null,
  })
  setsMock.mockResolvedValueOnce({ data: [{ code: 'lea', name: 'Limited Edition Alpha' }], error: null })
  observations30Mock.mockResolvedValueOnce({ data: [], error: null })
  observations90Mock.mockResolvedValueOnce({ data: [], error: null })
}

describe('getCardMarketSummaryStrict', () => {
  it('returns a populated summary on the happy path', async () => {
    seedHappyPath()
    const getCardMarketSummaryStrict = await loadStrict()
    const result = await getCardMarketSummaryStrict('o1', 'p1')
    expect(result).not.toBeNull()
    expect(result!.currentPrice).toBe(25000)
    expect(result!.pricedPrintings).toHaveLength(1)
    expect(result!.pricedPrintings[0].set_name).toBe('Limited Edition Alpha')
  })

  it('returns null for a legitimate zero English-paper-printings result', async () => {
    printingsMock.mockResolvedValueOnce({ data: [], error: null })
    const getCardMarketSummaryStrict = await loadStrict()
    const result = await getCardMarketSummaryStrict('o-nonexistent', null)
    expect(result).toBeNull()
    // Downstream stages must not fire for a legitimate zero.
    expect(finishesMock).not.toHaveBeenCalled()
  })

  it('returns emptySummary when the oracle has printings but no priced finishes on this basis', async () => {
    printingsMock.mockResolvedValueOnce({
      data: [{ id: 'p1', oracle_card_id: 'o1', set_code: 'lea', collector_number: '232', name: 'Black Lotus', released_at: '1993-08-05', image_uri_small: null, digital: false, lang: 'en', rarity: 'rare' }],
      error: null,
    })
    finishesMock.mockResolvedValueOnce({
      data: [{ id: 'f1', printing_id: 'p1', finish: 'nonfoil' }],
      error: null,
    })
    currentPricesMock.mockResolvedValueOnce({ data: [], error: null })  // legitimate: nothing priced on this basis
    const getCardMarketSummaryStrict = await loadStrict()
    const result = await getCardMarketSummaryStrict('o1', 'p1')
    expect(result).not.toBeNull()
    expect(result!.currentPrice).toBeNull()
    expect(result!.pricedPrintings).toHaveLength(0)
  })

  it('throws when the printings stage persistently fails — never cached as null-summary', async () => {
    printingsMock
      .mockResolvedValueOnce({ data: null, error: { message: 'fail-1' } })
      .mockResolvedValueOnce({ data: null, error: { message: 'fail-2' } })
      .mockResolvedValueOnce({ data: null, error: { message: 'fail-3' } })
    const getCardMarketSummaryStrict = await loadStrict()
    await expect(getCardMarketSummaryStrict('o1', null)).rejects.toThrow(/stage=printings/)
  })

  it('throws when the current-prices stage persistently fails', async () => {
    printingsMock.mockResolvedValueOnce({
      data: [{ id: 'p1', oracle_card_id: 'o1', set_code: 'lea', collector_number: '232', name: 'Black Lotus', released_at: null, image_uri_small: null, digital: false, lang: 'en', rarity: 'rare' }],
      error: null,
    })
    finishesMock.mockResolvedValueOnce({
      data: [{ id: 'f1', printing_id: 'p1', finish: 'nonfoil' }],
      error: null,
    })
    currentPricesMock
      .mockResolvedValueOnce({ data: null, error: { message: 'fail-1' } })
      .mockResolvedValueOnce({ data: null, error: { message: 'fail-2' } })
      .mockResolvedValueOnce({ data: null, error: { message: 'fail-3' } })
    const getCardMarketSummaryStrict = await loadStrict()
    await expect(getCardMarketSummaryStrict('o1', 'p1')).rejects.toThrow(/stage=current-prices/)
  })

  it('throws when a 30d observations chunk persistently fails — does NOT silently drop it', async () => {
    printingsMock.mockResolvedValueOnce({
      data: [{ id: 'p1', oracle_card_id: 'o1', set_code: 'lea', collector_number: '232', name: 'Black Lotus', released_at: null, image_uri_small: null, digital: false, lang: 'en', rarity: 'rare' }],
      error: null,
    })
    finishesMock.mockResolvedValueOnce({
      data: [{ id: 'f1', printing_id: 'p1', finish: 'nonfoil' }],
      error: null,
    })
    currentPricesMock.mockResolvedValueOnce({
      data: [{ printing_finish_id: 'f1', price: 25000, observed_on: '2025-01-10' }],
      error: null,
    })
    setsMock.mockResolvedValueOnce({ data: [], error: null })
    observations30Mock
      .mockResolvedValueOnce({ data: null, error: { message: 'fail-1' } })
      .mockResolvedValueOnce({ data: null, error: { message: 'fail-2' } })
      .mockResolvedValueOnce({ data: null, error: { message: 'fail-3' } })
    const getCardMarketSummaryStrict = await loadStrict()
    await expect(getCardMarketSummaryStrict('o1', 'p1')).rejects.toThrow(/observations-30d-chunk/)
  })

  it('chunks the finishes + current-prices lookups when a card has 300+ printings — no single oversized .in() request', async () => {
    // Mountain / Lightning Bolt class: 300+ English paper printings.
    // Must split into bounded chunks so the request URL stays under
    // the PostgREST header budget, and must concatenate chunk results
    // so the final summary still reflects every printing.
    const PRINTING_COUNT = 345
    const printingsData = Array.from({ length: PRINTING_COUNT }, (_, i) => ({
      id: `p${i}`,
      oracle_card_id: 'o-mountain',
      set_code: 'parl',
      collector_number: String(i + 1),
      name: 'Mountain',
      released_at: '2024-01-01',
      image_uri_small: null,
      digital: false,
      lang: 'en',
      rarity: 'common',
    }))
    const finishesData = printingsData.map((p, i) => ({
      id: `f${i}`,
      printing_id: p.id,
      finish: 'nonfoil',
    }))
    const currentPricesData = finishesData.map((f) => ({
      printing_finish_id: f.id,
      price: 100,
      observed_on: '2025-01-10',
    }))

    printingsMock.mockResolvedValueOnce({ data: printingsData, error: null })
    // Every finishes-chunk-N/M builder call drains one `mockResolvedValueOnce`.
    // The real splitter is in the implementation; tests verify the call
    // count matches ceil(count / IN_CHUNK) and that results concatenate.
    const IN_CHUNK = 100
    const expectedFinishChunks = Math.ceil(PRINTING_COUNT / IN_CHUNK)   // 345 → 4
    for (let i = 0; i < expectedFinishChunks; i++) {
      const slice = finishesData.slice(i * IN_CHUNK, (i + 1) * IN_CHUNK)
      finishesMock.mockResolvedValueOnce({ data: slice, error: null })
    }
    const expectedCurrentChunks = Math.ceil(PRINTING_COUNT / IN_CHUNK)  // same as finishes here (1 finish per printing)
    for (let i = 0; i < expectedCurrentChunks; i++) {
      const slice = currentPricesData.slice(i * IN_CHUNK, (i + 1) * IN_CHUNK)
      currentPricesMock.mockResolvedValueOnce({ data: slice, error: null })
    }
    setsMock.mockResolvedValueOnce({ data: [{ code: 'parl', name: 'Mountain Showcase' }], error: null })
    // Observation chunks: CN-06.02 reduced IN_CHUNK from 120 → 40
    // (see card-market.ts) so that basic-land pages like Plains
    // (1,000+ finishes) stay under Postgres's statement_timeout on
    // ISR regeneration. 345 priced finishes → ceil(345/40) = 9 obs
    // chunks under the new policy. Keep them empty — the test only
    // cares that chunking + concatenation works for the
    // printing/current-price stages.
    const expectedObsChunks = Math.ceil(PRINTING_COUNT / 40)  // 345/40 = 9
    for (let i = 0; i < expectedObsChunks; i++) {
      observations30Mock.mockResolvedValueOnce({ data: [], error: null })
    }
    observations90Mock.mockResolvedValueOnce({ data: [], error: null })

    const getCardMarketSummaryStrict = await loadStrict()
    const result = await getCardMarketSummaryStrict('o-mountain', 'p0')

    // Chunked calls, not a single oversized request:
    expect(finishesMock).toHaveBeenCalledTimes(expectedFinishChunks)
    expect(currentPricesMock).toHaveBeenCalledTimes(expectedCurrentChunks)

    // Concatenation: all 345 printings surface in the final summary.
    expect(result).not.toBeNull()
    expect(result!.pricedPrintings).toHaveLength(PRINTING_COUNT)
    expect(result!.pricedPrintings.every((r) => r.set_name === 'Mountain Showcase')).toBe(true)
  })

  it('surfaces the chunked stage label when a finishes chunk persistently fails', async () => {
    // Guards the strict-helper contract: a per-chunk 400 Bad Request
    // on a high-printing card must throw with a label that carries
    // the chunk index so prod log triage can find the offending
    // request. Single-chunk here keeps the test free of leaked
    // sibling retries from Promise.all's fast-reject behaviour.
    printingsMock.mockResolvedValueOnce({
      data: [{ id: 'p1', oracle_card_id: 'o1', set_code: 'lea', collector_number: '232', name: 'Black Lotus', released_at: null, image_uri_small: null, digital: false, lang: 'en', rarity: 'rare' }],
      error: null,
    })
    finishesMock
      .mockResolvedValueOnce({ data: null, error: { message: 'bad-request' } })
      .mockResolvedValueOnce({ data: null, error: { message: 'bad-request' } })
      .mockResolvedValueOnce({ data: null, error: { message: 'bad-request' } })
    const getCardMarketSummaryStrict = await loadStrict()
    await expect(getCardMarketSummaryStrict('o1', null)).rejects.toThrow(/stage=finishes-chunk-\d+\/\d+/)
  })

  it('retries transient printings failure and succeeds on retry', async () => {
    printingsMock
      .mockResolvedValueOnce({ data: null, error: { message: 'transient' } })
      .mockResolvedValueOnce({
        data: [{ id: 'p1', oracle_card_id: 'o1', set_code: 'lea', collector_number: '232', name: 'Black Lotus', released_at: null, image_uri_small: null, digital: false, lang: 'en', rarity: 'rare' }],
        error: null,
      })
    finishesMock.mockResolvedValueOnce({
      data: [{ id: 'f1', printing_id: 'p1', finish: 'nonfoil' }],
      error: null,
    })
    currentPricesMock.mockResolvedValueOnce({
      data: [{ printing_finish_id: 'f1', price: 25000, observed_on: '2025-01-10' }],
      error: null,
    })
    setsMock.mockResolvedValueOnce({ data: [], error: null })
    observations30Mock.mockResolvedValueOnce({ data: [], error: null })
    observations90Mock.mockResolvedValueOnce({ data: [], error: null })
    const getCardMarketSummaryStrict = await loadStrict()
    const result = await getCardMarketSummaryStrict('o1', 'p1')
    expect(result).not.toBeNull()
    expect(printingsMock).toHaveBeenCalledTimes(2)
  })

  it('CN-06.02 basic-land regression: 1000+ finishes chunk into IN_CHUNK=40 observation calls under bounded concurrency', async () => {
    // Plains in BLB/WOE etc. has 1000+ priced finishes network-wide.
    // Production error logs (Vercel 2026-11-04) showed:
    //   "stage=observations-30d-chunk-6/9: failed after 3 attempts:
    //    canceling statement due to statement timeout"
    // with 9 chunks of 120. Reducing IN_CHUNK to 40 produces 25 chunks
    // for 1000 finishes, each small enough to fit in Postgres's
    // statement_timeout. MAX_IN_FLIGHT=4 caps concurrent queries so we
    // never fan out 25 simultaneous read-heavy queries on
    // mtg_price_observations.
    const PRINTING_COUNT = 1000
    const printingsData = Array.from({ length: PRINTING_COUNT }, (_, i) => ({
      id: `p${i}`, oracle_card_id: 'o-plains', set_code: 'blb',
      collector_number: String(262 + i), name: 'Plains',
      released_at: null, image_uri_small: null, digital: false, lang: 'en', rarity: 'common',
    }))
    const finishesData = printingsData.map((p, i) => ({
      id: `f${i}`, printing_id: p.id, finish: 'nonfoil',
    }))
    const currentPricesData = finishesData.map((f, i) => ({
      printing_finish_id: f.id, price: 100 + i, observed_on: '2026-10-01',
    }))

    printingsMock.mockResolvedValueOnce({ data: printingsData, error: null })
    // Finishes chunks: FINISHES_IN_CHUNK=100 (unchanged by this PR).
    const FINISHES_IN_CHUNK = 100
    for (let i = 0; i < Math.ceil(PRINTING_COUNT / FINISHES_IN_CHUNK); i++) {
      finishesMock.mockResolvedValueOnce({
        data: finishesData.slice(i * FINISHES_IN_CHUNK, (i + 1) * FINISHES_IN_CHUNK),
        error: null,
      })
    }
    // Current-prices chunks: CURRENT_PRICES_IN_CHUNK=100 (unchanged).
    const CURRENT_PRICES_IN_CHUNK = 100
    for (let i = 0; i < Math.ceil(PRINTING_COUNT / CURRENT_PRICES_IN_CHUNK); i++) {
      currentPricesMock.mockResolvedValueOnce({
        data: currentPricesData.slice(i * CURRENT_PRICES_IN_CHUNK, (i + 1) * CURRENT_PRICES_IN_CHUNK),
        error: null,
      })
    }
    setsMock.mockResolvedValueOnce({ data: [{ code: 'blb', name: 'Bloomburrow' }], error: null })

    // Observations: NEW IN_CHUNK=40 → ceil(1000/40) = 25 observation
    // chunks. Bounded concurrency MAX_IN_FLIGHT=4 means at any moment
    // at most 4 observations-chunk queries should be in flight.
    //
    // To verify bounded concurrency we wrap the observations mock in a
    // concurrency tracker: increment inFlight on call, decrement after
    // the (deferred) resolve. The assertion checks that maxConcurrent
    // never exceeded 4 across all 25 chunk calls.
    const OBS_IN_CHUNK = 40
    const expectedObsChunks = Math.ceil(PRINTING_COUNT / OBS_IN_CHUNK)
    expect(expectedObsChunks).toBe(25)

    let inFlight = 0
    let maxConcurrent = 0
    observations30Mock.mockImplementation(() => {
      inFlight++
      if (inFlight > maxConcurrent) maxConcurrent = inFlight
      // Resolve on the microtask queue so concurrent calls can stack
      // observably before the first resolves.
      return new Promise((resolve) => {
        setTimeout(() => {
          inFlight--
          resolve({ data: [], error: null })
        }, 1)
      })
    })
    observations90Mock.mockResolvedValueOnce({ data: [], error: null })

    const getCardMarketSummaryStrict = await loadStrict()
    const result = await getCardMarketSummaryStrict('o-plains', 'p0')

    // Structural assertions:
    expect(result).not.toBeNull()
    expect(result!.pricedPrintings).toHaveLength(PRINTING_COUNT)
    // The observation stage fired once per chunk, no chunk skipped.
    expect(observations30Mock).toHaveBeenCalledTimes(expectedObsChunks)
    // Bounded concurrency: at no point were more than MAX_IN_FLIGHT=4
    // observations-chunk queries running simultaneously. This is the
    // key regression — previous Promise.all(obsChunks) would have
    // produced maxConcurrent=25 here.
    expect(maxConcurrent).toBeLessThanOrEqual(4)
    expect(maxConcurrent).toBeGreaterThan(1)  // at least some parallelism
  })
})
