// tcggraph-bootstrap-reserves.test.ts
//
// Guardrail test for the CLI bootstrap credit-reserve defaults.
//
// Background: pre-fix, the CLI bootstrap ran with dailyReserve=100 and
// monthlyReserve=0 (BOOTSTRAP_DAILY_RESERVE plus a hard-coded zero).
// That let a bootstrap drain credits below the production cron's own
// 500/5,000 guardrail, blocking the next scheduled MTG/OP/Lorcana
// refresh. Fix: default the CLI to PRODUCTION_DAILY_RESERVE (500) and
// PRODUCTION_MONTHLY_RESERVE (5,000), and turn preflightCredits on.
//
// This suite locks:
//   (a) the constants themselves so a future edit that lowers them
//       trips a test rather than silently ships;
//   (b) that refreshCatalogue's preflight refuses to start when the
//       provided reserves are not met.

import { describe, it, expect, vi } from 'vitest'

//  Use vi.hoisted so the mock factory can grab a handle on the fetch
//  mock before the SUT is imported.
const { tcgFetchMock } = vi.hoisted(() => ({ tcgFetchMock: vi.fn() }))

vi.mock('@/lib/tcggraph/ingest-core.mjs', async () => {
  const actual = await vi.importActual<Record<string, unknown>>('@/lib/tcggraph/ingest-core.mjs')
  return { ...actual, tcgFetch: tcgFetchMock }
})

import { refreshCatalogue } from '@/lib/tcggraph/refresh.mjs'
import {
  PRODUCTION_DAILY_RESERVE, PRODUCTION_MONTHLY_RESERVE, BOOTSTRAP_DAILY_RESERVE,
} from '@/lib/tcggraph/ingest-core.mjs'

const silentLogger = { info: () => {}, warn: () => {}, error: () => {} }

describe('bootstrap credit-reserve constants', () => {
  it('PRODUCTION_DAILY_RESERVE is the intended 500', () => {
    expect(PRODUCTION_DAILY_RESERVE).toBe(500)
  })
  it('PRODUCTION_MONTHLY_RESERVE is the intended 5,000', () => {
    expect(PRODUCTION_MONTHLY_RESERVE).toBe(5_000)
  })
  it('BOOTSTRAP_DAILY_RESERVE stays available (100) for opt-in aggressive spend', () => {
    // Kept for callers that intentionally want a lower daily floor.
    // The CLI no longer uses it by default; it is opt-in via
    // --daily-reserve.
    expect(BOOTSTRAP_DAILY_RESERVE).toBe(100)
  })
})

describe('refreshCatalogue preflight enforces production reserves', () => {
  const fakeSb = {} as unknown as Parameters<typeof refreshCatalogue>[0]['sb']

  it('refuses to start when dailyRemaining < dailyReserve', async () => {
    tcgFetchMock.mockResolvedValueOnce({
      status: 200, body: {},
      cost: 1,
      creditsRemaining: 20_000,   // monthly OK
      dailyRemaining: 400,        // below the 500 daily reserve
      dailyLimit: 2000, creditsLimit: 25_000, retryAfter: null,
    })
    const res = await refreshCatalogue({
      gameSlug: 'yugioh',
      sb: fakeSb,
      source: 'bootstrap-test',
      dryRun: true,
      dailyReserve:   PRODUCTION_DAILY_RESERVE,
      monthlyReserve: PRODUCTION_MONTHLY_RESERVE,
      preflightCredits: true,
      logger: silentLogger,
    })
    expect(res.status).toBe('skipped_credit')
    expect(res.reason).toBe('insufficient_daily_credits')
    expect(res.credits.dailyRemaining).toBe(400)
    expect(res.credits.dailyReserve).toBe(500)
    // Only the preflight /games call should have fired; no page loop.
    expect(tcgFetchMock).toHaveBeenCalledTimes(1)
  })

  it('refuses to start when monthlyRemaining < monthlyReserve', async () => {
    tcgFetchMock.mockReset()
    tcgFetchMock.mockResolvedValueOnce({
      status: 200, body: {},
      cost: 1,
      creditsRemaining: 4_500,    // below the 5,000 monthly reserve
      dailyRemaining: 1500,       // daily OK
      dailyLimit: 2000, creditsLimit: 25_000, retryAfter: null,
    })
    const res = await refreshCatalogue({
      gameSlug: 'yugioh',
      sb: fakeSb,
      source: 'bootstrap-test',
      dryRun: true,
      dailyReserve:   PRODUCTION_DAILY_RESERVE,
      monthlyReserve: PRODUCTION_MONTHLY_RESERVE,
      preflightCredits: true,
      logger: silentLogger,
    })
    expect(res.status).toBe('skipped_credit')
    expect(res.reason).toBe('insufficient_monthly_credits')
    expect(res.credits.monthlyRemaining).toBe(4_500)
    expect(res.credits.monthlyReserve).toBe(5_000)
  })

  it('proceeds when both reserves are satisfied', async () => {
    tcgFetchMock.mockReset()
    //  Preflight OK; second call returns an empty catalogue so the
    //  page loop stops cleanly on the first iteration.
    tcgFetchMock
      .mockResolvedValueOnce({
        status: 200, body: {}, cost: 1,
        creditsRemaining: 20_000, dailyRemaining: 1500,
        dailyLimit: 2000, creditsLimit: 25_000, retryAfter: null,
      })
      .mockResolvedValueOnce({
        status: 200, body: { data: [], meta: { hasMore: false } }, cost: 1,
        creditsRemaining: 19_999, dailyRemaining: 1499,
        dailyLimit: 2000, creditsLimit: 25_000, retryAfter: null,
      })
    const res = await refreshCatalogue({
      gameSlug: 'yugioh',
      sb: fakeSb,
      source: 'bootstrap-test',
      dryRun: true,
      dailyReserve:   PRODUCTION_DAILY_RESERVE,
      monthlyReserve: PRODUCTION_MONTHLY_RESERVE,
      preflightCredits: true,
      logger: silentLogger,
    })
    expect(res.status).toBe('success')
    expect(res.reason).toBeNull()
  })
})
