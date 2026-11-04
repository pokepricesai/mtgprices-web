// src/lib/tcggraph/__tests__/refresh-bounded-resume.test.ts
//
// CN-06.01-P03 / P15 — local unit tests for bounded ingestion and
// checkpoint-resume semantics. Pure in-memory mocks of Supabase and
// TCGGraph; no network, no production credentials, no provider
// credits spent.
//
// Scenarios (one top-level describe per scenario):
//   1. normal max_pages_reached → status='partial', last_page checkpointed
//   2. catalogue_exhausted → status='success'
//   3. continue=1 after a partial resumes from last_page + 1
//   4. watchdog break → status='partial' with wall_time_watchdog stopReason
//   5. exception mid-page → status='failure', last_page = last successful page
//   6. heartbeat writes last_page at 25-page boundaries, finalize always
//      overrides with the final stats.lastPage
//   7. preloadMtgPrintingsIndex row-count mismatch → returns null
//      (fallback path exercised)
//
// Note on route-level tests (continue=1 with stale timed_out
// predecessor, skipped_lock) — those live in
// src/__tests__/tcggraph-cron.test.ts and exercise the route layer.
// This file tests refresh.mjs end-to-end with a mocked Supabase.

import { describe, it, expect, vi, beforeEach } from 'vitest'

// ---------------------------------------------------------------------
// Shared in-memory Supabase mock
// ---------------------------------------------------------------------

type Row = Record<string, unknown>

interface MockSbTable {
  insertLog: Row[]
  updateLog: Array<{ patch: Row; where: Row }>
  selectResults: Map<string, Row[]>  // keyed by query shape
  countResult?: number | null
  rangeResults?: Row[][]              // one array per .range() call
  rangeIndex?: number
  selectError?: Error | null
  insertError?: Error | null
  updateError?: Error | null
  rangeError?: Error | null
}

function makeMockSb(tables: Record<string, Partial<MockSbTable>> = {}): {
  sb: any
  tables: Record<string, MockSbTable>
  rpcCalls: Array<{ fn: string; args: unknown }>
} {
  const rpcCalls: Array<{ fn: string; args: unknown }> = []
  const resolved: Record<string, MockSbTable> = {}
  for (const [name, init] of Object.entries(tables)) {
    resolved[name] = {
      insertLog: [], updateLog: [], selectResults: new Map(),
      countResult: null, rangeResults: [], rangeIndex: 0,
      selectError: null, insertError: null, updateError: null, rangeError: null,
      ...init,
    }
  }

  function from(tableName: string) {
    const t = resolved[tableName] ?? (resolved[tableName] = {
      insertLog: [], updateLog: [], selectResults: new Map(),
      countResult: null, rangeResults: [], rangeIndex: 0,
      selectError: null, insertError: null, updateError: null, rangeError: null,
    })

    // Chain state.
    const q: any = {
      _table: tableName,
      _filters: [] as Array<[string, unknown]>,
      _head: false,
      _count: null as null | 'exact',
      _wantCount: false,
      _selectFields: null as string | null,
      _orderBy: null as null | string,
      _orderDesc: false,
      _limit: null as null | number,
      _range: null as null | [number, number],

      select(fields: string, opts: Record<string, unknown> = {}) {
        q._selectFields = fields
        if (opts.count === 'exact') { q._count = 'exact'; q._wantCount = true }
        if (opts.head === true) q._head = true
        return q
      },
      insert(rows: Row | Row[]) {
        if (t.insertError) return Promise.resolve({ data: null, error: t.insertError })
        const arr = Array.isArray(rows) ? rows : [rows]
        for (const r of arr) t.insertLog.push({ ...r })
        return Promise.resolve({ data: arr, error: null })
      },
      upsert(rows: Row | Row[], _opts: unknown) {
        const arr = Array.isArray(rows) ? rows : [rows]
        for (const r of arr) t.insertLog.push({ ...r })
        if (t.insertError) return Promise.resolve({ data: null, error: t.insertError })
        return Promise.resolve({ data: arr, error: null })
      },
      update(patch: Row) {
        const where: Row = {}
        for (const [col, val] of q._filters) where[col] = val
        t.updateLog.push({ patch: { ...patch }, where })
        q._pending = 'update'
        q._updatePatch = patch
        return q
      },
      eq(col: string, val: unknown) { q._filters.push([col, val]); return q },
      neq(col: string, val: unknown) { q._filters.push([`!${col}`, val]); return q },
      in(col: string, vals: unknown[]) { q._filters.push([`${col}:in`, vals]); return q },
      is(col: string, val: unknown) { q._filters.push([`${col}:is`, val]); return q },
      gte(col: string, val: unknown) { q._filters.push([`${col}:gte`, val]); return q },
      lt(col: string, val: unknown) { q._filters.push([`${col}:lt`, val]); return q },
      gt(col: string, val: unknown) { q._filters.push([`${col}:gt`, val]); return q },
      order(col: string, opts: { ascending?: boolean } = {}) {
        q._orderBy = col
        q._orderDesc = opts.ascending === false
        return q
      },
      limit(n: number) { q._limit = n; return q },
      range(from: number, to: number) { q._range = [from, to]; return q },
      maybeSingle() { q._maybeSingle = true; return q },
      then(onFulfilled: any, onRejected: any) {
        const result = buildResult(t, q)
        return Promise.resolve(result).then(onFulfilled, onRejected)
      },
    }
    return q
  }

  function buildResult(t: MockSbTable, q: any) {
    // RANGE path — preloadMtgPrintingsIndex uses this.
    if (q._range) {
      if (t.rangeError) return { data: null, error: t.rangeError }
      const idx = t.rangeIndex ?? 0
      const chunk = (t.rangeResults ?? [])[idx] ?? []
      t.rangeIndex = idx + 1
      return { data: chunk, error: null }
    }

    // COUNT path.
    if (q._wantCount) {
      if (t.selectError) return { count: null, error: t.selectError }
      return { count: t.countResult, error: null }
    }

    // UPDATE results after chain terminators — the update log was
    // already pushed inside update(); we only need to resolve the
    // chain terminator here.
    if (q._pending === 'update') {
      if (t.updateError) return { data: null, error: t.updateError }
      return { data: null, error: null }
    }

    // SELECT — deterministic per-call lookup. Tests pre-populate
    // t.selectResults with the expected result for each query shape.
    if (t.selectError) {
      return q._maybeSingle
        ? { data: null, error: t.selectError }
        : { data: null, error: t.selectError }
    }
    const keyParts: string[] = []
    for (const [col, val] of q._filters) keyParts.push(`${col}=${JSON.stringify(val)}`)
    if (q._orderBy) keyParts.push(`order=${q._orderBy}:${q._orderDesc ? 'desc' : 'asc'}`)
    if (q._limit != null) keyParts.push(`limit=${q._limit}`)
    const key = keyParts.join('|')
    const match = t.selectResults.get(key) ?? t.selectResults.get('*') ?? []
    if (q._maybeSingle) {
      return { data: match[0] ?? null, error: null }
    }
    return { data: match, error: null }
  }

  const sb = {
    from,
    rpc(fn: string, args: unknown) {
      rpcCalls.push({ fn, args })
      return Promise.resolve({ data: null, error: null })
    },
  }

  return { sb, tables: resolved, rpcCalls }
}

// ---------------------------------------------------------------------
// Minimal TCGGraph fetch mock
// ---------------------------------------------------------------------

type FakePage = { data: unknown[]; hasMore: boolean; totalPages?: number }

function makeTcgFetch(pages: FakePage[], opts: { costPerCall?: number; perPageDelayMs?: number } = {}) {
  let call = 0
  return async (_path: string, _query: Record<string, unknown>) => {
    const i = call++
    const page = pages[i] ?? { data: [], hasMore: false }
    if (opts.perPageDelayMs) {
      await new Promise((r) => setTimeout(r, opts.perPageDelayMs))
    }
    return {
      status: 200,
      body: {
        data: page.data,
        meta: { hasMore: page.hasMore, totalPages: page.totalPages ?? null },
      },
      cost: opts.costPerCall ?? 1,
      creditsRemaining: 100_000,
      dailyRemaining: 10_000,
      dailyLimit: 10_000,
      creditsLimit: 100_000,
      retryAfter: null,
    }
  }
}

// ---------------------------------------------------------------------
// Module-level mocks (declared once; each test sets fetch behaviour)
// ---------------------------------------------------------------------

const { tcgFetchMock, acquireLockMock, releaseLockMock, invalidateMock } = vi.hoisted(() => ({
  tcgFetchMock: vi.fn(),
  acquireLockMock: vi.fn(),
  releaseLockMock: vi.fn(),
  invalidateMock: vi.fn(),
}))

vi.mock('@/lib/tcggraph/ingest-core.mjs', async () => {
  const actual = await vi.importActual<Record<string, unknown>>('@/lib/tcggraph/ingest-core.mjs')
  return {
    ...actual,
    tcgFetch: (path: string, q: Record<string, unknown>) => tcgFetchMock(path, q),
  }
})

// ---------------------------------------------------------------------
// Scenario tests
// ---------------------------------------------------------------------

import { refreshCatalogue } from '@/lib/tcggraph/refresh.mjs'
import { preloadMtgPrintingsIndex } from '@/lib/tcggraph/ingest-core.mjs'

const silentLogger = { info: () => {}, warn: () => {}, error: () => {} }

beforeEach(() => {
  tcgFetchMock.mockReset()
  acquireLockMock.mockReset()
  releaseLockMock.mockReset()
  invalidateMock.mockReset()
})

describe('CN-06.01-P03/P15 — bounded ingestion + resume (refresh.mjs)', () => {

  it('1. max_pages_reached → status=partial, last_page checkpointed', async () => {
    // 5 pages available, maxPages=3 → should stop after 3 pages with
    // status=partial. Finalize writes notes.last_page = 3.
    tcgFetchMock.mockImplementation(makeTcgFetch([
      { data: [{ id: 'p1', name: 'Card 1', game: 'disney-lorcana', set: { code: 'lor1' } }], hasMore: true },
      { data: [{ id: 'p2', name: 'Card 2', game: 'disney-lorcana', set: { code: 'lor1' } }], hasMore: true },
      { data: [{ id: 'p3', name: 'Card 3', game: 'disney-lorcana', set: { code: 'lor1' } }], hasMore: true },
      { data: [{ id: 'p4', name: 'Card 4', game: 'disney-lorcana', set: { code: 'lor1' } }], hasMore: true },
      { data: [{ id: 'p5', name: 'Card 5', game: 'disney-lorcana', set: { code: 'lor1' } }], hasMore: false },
    ]))
    const { sb } = makeMockSb({
      tcg_ingest_locks: { selectResults: new Map([['game_id="lorcana"|resource="cards.full"', []]]) },
    })
    const result = await refreshCatalogue({
      gameSlug: 'disney-lorcana', sb, source: 'test',
      fromPage: 1, maxPages: 3, dryRun: false, preflightCredits: false,
      logger: silentLogger,
    })
    expect(result.status).toBe('partial')
    expect(result.stopReason).toBe('max_pages_reached')
    expect(result.pagesCompleted).toBe(3)
    expect(result.lastPage).toBe(3)
  })

  it('2. catalogue_exhausted (hasMore=false) → status=success', async () => {
    tcgFetchMock.mockImplementation(makeTcgFetch([
      { data: [{ id: 'p1', name: 'Card 1', game: 'disney-lorcana', set: { code: 'lor1' } }], hasMore: true },
      { data: [{ id: 'p2', name: 'Card 2', game: 'disney-lorcana', set: { code: 'lor1' } }], hasMore: false },
    ]))
    const { sb } = makeMockSb()
    const result = await refreshCatalogue({
      gameSlug: 'disney-lorcana', sb, source: 'test',
      fromPage: 1, maxPages: 100, dryRun: false, preflightCredits: false,
      logger: silentLogger,
    })
    expect(result.status).toBe('success')
    expect(result.stopReason).toBe('catalogue_exhausted')
    expect(result.pagesCompleted).toBe(2)
    expect(result.lastPage).toBe(2)
  })

  it('3. fromPage=N resumes from page N (continue semantics)', async () => {
    // Simulate route.ts resuming after a partial — fromPage=4.
    // Expect first tcgFetch call to receive page=4.
    const pages: FakePage[] = []
    for (let i = 0; i < 5; i++) pages.push({ data: [{ id: `r${i}`, name: `R${i}`, game: 'disney-lorcana', set: { code: 'lor1' } }], hasMore: i < 4 })
    const seenPages: number[] = []
    tcgFetchMock.mockImplementation(async (_path, q: any) => {
      seenPages.push(Number(q.page))
      const idx = Number(q.page) - 4  // we start at page 4
      return {
        status: 200,
        body: { data: pages[idx]?.data ?? [], meta: { hasMore: pages[idx]?.hasMore ?? false } },
        cost: 1, creditsRemaining: 100_000, dailyRemaining: 10_000,
        dailyLimit: 10_000, creditsLimit: 100_000, retryAfter: null,
      }
    })
    const { sb } = makeMockSb()
    const result = await refreshCatalogue({
      gameSlug: 'disney-lorcana', sb, source: 'test',
      fromPage: 4, maxPages: 100, dryRun: false, preflightCredits: false,
      logger: silentLogger,
    })
    expect(result.status).toBe('success')
    expect(seenPages[0]).toBe(4)  // started at page 4, not 1
    expect(result.lastPage).toBe(8)
  })

  it('4. watchdog break → status=partial, stopReason contains wall_time_watchdog', async () => {
    // Set a very low synthetic budget by mocking a slow fetch; use
    // vi.useFakeTimers to control Date.now.
    vi.useFakeTimers({ shouldAdvanceTime: false, now: 0 })
    let page = 0
    tcgFetchMock.mockImplementation(async () => {
      page++
      // Each "fetch" advances the fake clock by 200 seconds. The
      // watchdog fires at 780s (780,000 ms), so after 4 pages
      // (800s elapsed) the post-page watchdog triggers.
      vi.advanceTimersByTime(200_000)
      return {
        status: 200,
        body: { data: [{ id: `p${page}`, name: `P${page}`, game: 'disney-lorcana', set: { code: 'lor1' } }], meta: { hasMore: true } },
        cost: 1, creditsRemaining: 100_000, dailyRemaining: 10_000,
        dailyLimit: 10_000, creditsLimit: 100_000, retryAfter: null,
      }
    })
    const { sb } = makeMockSb()
    const result = await refreshCatalogue({
      gameSlug: 'disney-lorcana', sb, source: 'test',
      fromPage: 1, maxPages: 100, dryRun: false, preflightCredits: false,
      logger: silentLogger,
    })
    vi.useRealTimers()
    expect(result.status).toBe('partial')
    expect(String(result.stopReason)).toMatch(/wall_time_watchdog/)
    // Should have persisted at least one page before breaking.
    expect(result.pagesCompleted).toBeGreaterThan(0)
    expect(result.lastPage).toBe(result.pagesCompleted)  // last page = last successful page
  })

  it('5. exception mid-page → status=failure, last_page = last successful page', async () => {
    let call = 0
    tcgFetchMock.mockImplementation(async () => {
      call++
      if (call <= 2) {
        return {
          status: 200,
          body: { data: [{ id: `p${call}`, name: `P${call}`, game: 'disney-lorcana', set: { code: 'lor1' } }], meta: { hasMore: true } },
          cost: 1, creditsRemaining: 100_000, dailyRemaining: 10_000,
          dailyLimit: 10_000, creditsLimit: 100_000, retryAfter: null,
        }
      }
      throw new Error('synthetic TCGGraph timeout on page 3')
    })
    const { sb } = makeMockSb()
    const result = await refreshCatalogue({
      gameSlug: 'disney-lorcana', sb, source: 'test',
      fromPage: 1, maxPages: 100, dryRun: false, preflightCredits: false,
      logger: silentLogger,
    })
    expect(result.status).toBe('failure')
    expect(String(result.stopReason)).toMatch(/exception.*synthetic TCGGraph timeout/)
    expect(result.pagesCompleted).toBe(2)
    expect(result.lastPage).toBe(2)  // page 3 never completed, so checkpoint = 2
  })

  it('6. finalize notes.last_page = stats.lastPage on every exit path', async () => {
    // 30 pages (past the every-25-page heartbeat boundary) then exit
    // via max_pages_reached. Finalize should write last_page = 30.
    tcgFetchMock.mockImplementation(makeTcgFetch(
      Array.from({ length: 30 }, (_, i) => ({
        data: [{ id: `p${i+1}`, name: `P${i+1}`, game: 'disney-lorcana', set: { code: 'lor1' } }],
        hasMore: true,
      })),
    ))
    const { sb, tables } = makeMockSb()
    const result = await refreshCatalogue({
      gameSlug: 'disney-lorcana', sb, source: 'test',
      fromPage: 1, maxPages: 30, dryRun: false, preflightCredits: false,
      logger: silentLogger,
    })
    expect(result.status).toBe('partial')
    expect(result.lastPage).toBe(30)
    // The finalize update should carry notes.last_page === 30.
    const updates = tables.tcg_ingest_runs?.updateLog ?? []
    const finalize = updates[updates.length - 1]
    expect(finalize?.patch.notes).toMatchObject({ last_page: 30 })
    expect(finalize?.patch).toMatchObject({ status: 'partial', pages_completed: 30 })
  })

  it('7. preloadMtgPrintingsIndex: row-count mismatch → returns null', async () => {
    // Expected count=100 but only return 50 rows via range → ratio
    // 0.5 < 0.95 → preload rejected (returns null).
    const { sb } = makeMockSb({
      mtg_printings: {
        countResult: 100,
        rangeResults: [
          Array.from({ length: 50 }, (_, i) => ({ set_code: 'abc', lang: 'en', collector_number: String(i+1), id: `m${i+1}`, name: `Mock ${i+1}` })),
          [],
        ],
      },
    })
    const result = await preloadMtgPrintingsIndex(sb, silentLogger)
    expect(result).toBeNull()
  })

  it('7b. preloadMtgPrintingsIndex: expected count matches collected → returns index', async () => {
    const rows = Array.from({ length: 100 }, (_, i) => ({ set_code: 'abc', lang: 'en', collector_number: String(i+1), id: `m${i+1}`, name: `Mock ${i+1}` }))
    const { sb } = makeMockSb({
      mtg_printings: {
        countResult: 100,
        // First chunk 1,000-cap returns all 100 rows (less than
        // CHUNK size → loop terminates naturally).
        rangeResults: [rows, []],
      },
    })
    const result = await preloadMtgPrintingsIndex(sb, silentLogger)
    expect(result).not.toBeNull()
    expect(result!.get('abc|en')).toBeTruthy()
    expect(result!.get('abc|en')!.size).toBe(100)
  })

  it('7c. preloadMtgPrintingsIndex: count fetch error → returns null', async () => {
    const { sb } = makeMockSb({
      mtg_printings: { selectError: new Error('synthetic count failure') },
    })
    const result = await preloadMtgPrintingsIndex(sb, silentLogger)
    expect(result).toBeNull()
  })
})
