// refresh-set-value-daily-cron.test.ts
// CN-06.01-P13 — lock the behaviour of the refresh-set-value-daily
// cron endpoint after it was repointed from today's UTC date to the
// most-recent-complete mtgjson only_date. The regression this covers
// is the 2026-11-02 → 2026-11-04 silent halt where mtg_set_value_daily
// froze at 2026-11-01 because MTGJSON's upstream completion drifted
// past the 21:00 UTC cron window and the handler returned HTTP 202
// on every fire.

import { describe, it, expect, vi, beforeEach } from 'vitest'

// Mock the Supabase service client. Each test replaces its behaviour.
type MockRun = {
  id: string
  provider: string
  parser_version: string
  status: string
  completed_at: string | null
  notes: unknown
  started_at: string
}

const { sbMock, rpcMock } = vi.hoisted(() => ({
  sbMock: {
    runs: [] as Array<{
      id: string; provider: string; parser_version: string;
      status: string; completed_at: string | null; notes: unknown; started_at: string
    }>,
    obsCountByDate: new Map<string, number>(),
    rpcResult: { data: 42, error: null as Error | null },
    rpcCalls: [] as Array<{ fn: string; args: Record<string, unknown> }>,
  },
  rpcMock: vi.fn(),
}))

function makeRun(partial: Partial<MockRun> & { id: string; status: string; completed_at: string | null; notes: unknown; started_at: string }): MockRun {
  return {
    provider: 'mtgjson',
    parser_version: 'mtgjson_all_prices@v1',
    ...partial,
  }
}

vi.mock('@/lib/supabaseService', () => ({
  getSupabaseServiceClient: () => makeMockSupabase(),
}))

function makeMockSupabase() {
  function from(table: string) {
    const q: any = {
      _table: table,
      _filters: [] as Array<[string, unknown]>,
      _head: false,
      _wantCount: false,
      _orderBy: null as string | null,
      _orderAsc: true,
      _limit: null as number | null,
      select(_fields: string, opts: Record<string, unknown> = {}) {
        if (opts.count === 'exact') q._wantCount = true
        if (opts.head === true) q._head = true
        return q
      },
      eq(col: string, val: unknown) { q._filters.push([col, val]); return q },
      order(col: string, opts: { ascending?: boolean } = {}) {
        q._orderBy = col
        q._orderAsc = opts.ascending !== false
        return q
      },
      limit(n: number) { q._limit = n; return q },
      then(onFulfilled: any, onRejected: any) {
        return Promise.resolve(buildResult(q)).then(onFulfilled, onRejected)
      },
    }
    return q
  }
  function buildResult(q: any) {
    if (q._table === 'market_import_runs') {
      let rows = sbMock.runs.slice()
      for (const [col, val] of q._filters) {
        rows = rows.filter((r: any) => r[col] === val)
      }
      if (q._orderBy) {
        rows.sort((a: any, b: any) => (a[q._orderBy] > b[q._orderBy] ? 1 : -1) * (q._orderAsc ? 1 : -1))
      }
      if (q._limit) rows = rows.slice(0, q._limit)
      return { data: rows, error: null }
    }
    if (q._table === 'mtg_price_observations') {
      const observedOn = q._filters.find((f: any) => f[0] === 'observed_on')?.[1] as string | undefined
      if (!observedOn) return { count: 0, error: null }
      return { count: sbMock.obsCountByDate.get(observedOn) ?? 0, error: null }
    }
    return { data: [], error: null }
  }
  return {
    from,
    rpc: (fn: string, args: Record<string, unknown>) => {
      sbMock.rpcCalls.push({ fn, args })
      rpcMock(fn, args)
      return Promise.resolve(sbMock.rpcResult)
    },
  }
}

// Import AFTER the mock is registered.
import { GET } from '@/app/api/cron/refresh-set-value-daily/route'

function withEnv<T>(env: Record<string, string | undefined>, fn: () => Promise<T>): Promise<T> {
  const before: Record<string, string | undefined> = {}
  for (const k of Object.keys(env)) {
    before[k] = process.env[k]
    if (env[k] === undefined) delete process.env[k]
    else process.env[k] = env[k]
  }
  const restore = () => { for (const k of Object.keys(before)) { if (before[k] === undefined) delete process.env[k]; else process.env[k] = before[k] } }
  return fn().finally(restore) as Promise<T>
}

function req(headers: Record<string, string>) {
  return new Request('https://mtgprices.io/api/cron/refresh-set-value-daily', { headers })
}

beforeEach(() => {
  sbMock.runs = []
  sbMock.obsCountByDate = new Map()
  sbMock.rpcResult = { data: 42, error: null }
  sbMock.rpcCalls = []
  rpcMock.mockReset()
})

describe('refresh-set-value-daily cron — security', () => {
  it('returns 401 when Authorization does not match CRON_SECRET', async () => {
    await withEnv({ CRON_SECRET: 'sekret' }, async () => {
      const res = await GET(req({ authorization: 'Bearer wrong' }))
      expect(res.status).toBe(401)
    })
  })
  it('returns 401 when Authorization is missing', async () => {
    await withEnv({ CRON_SECRET: 'sekret' }, async () => {
      const res = await GET(req({}))
      expect(res.status).toBe(401)
    })
  })
  it('fails closed (500) when CRON_SECRET is not set', async () => {
    await withEnv({ CRON_SECRET: '' }, async () => {
      const res = await GET(req({ authorization: 'Bearer anything' }))
      expect(res.status).toBe(500)
    })
  })
})

describe('refresh-set-value-daily cron — target-date semantics (CN-06.01-P13)', () => {
  it('returns 202 ingest_not_available when no successful mtgjson run exists', async () => {
    sbMock.runs = []
    await withEnv({ CRON_SECRET: 'sekret' }, async () => {
      const res = await GET(req({ authorization: 'Bearer sekret' }))
      expect(res.status).toBe(202)
      const body = await res.json()
      expect(body.reason).toBe('ingest_not_available')
      expect(sbMock.rpcCalls.length).toBe(0)
    })
  })

  it('returns 202 ingest_sanity_check_failed when obs count < OBS_SANITY_MIN', async () => {
    sbMock.runs = [makeRun({
      id: 'r1', status: 'success', completed_at: '2026-11-03T21:11:00Z',
      notes: JSON.stringify({ only_date: '2026-11-03' }),
      started_at: '2026-11-03T21:01:00Z',
    })]
    sbMock.obsCountByDate.set('2026-11-03', 500)  // below 10k
    await withEnv({ CRON_SECRET: 'sekret' }, async () => {
      const res = await GET(req({ authorization: 'Bearer sekret' }))
      expect(res.status).toBe(202)
      const body = await res.json()
      expect(body.reason).toBe('ingest_sanity_check_failed')
      expect(body.observed_on).toBe('2026-11-03')
      expect(body.observations).toBe(500)
      expect(sbMock.rpcCalls.length).toBe(0)
    })
  })

  it('writes mtg_set_value_daily for the most-recent-complete only_date, NOT today\'s UTC date', async () => {
    // Pin "today" to Nov 4 by freezing Date.now to a Nov 4 instant.
    // The most recent mtgjson run has only_date = 2026-11-03.
    // Pre-fix behaviour would have failed trying to find only_date=2026-11-04.
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-11-04T03:00:00Z'))
    sbMock.runs = [
      makeRun({ id: 'r2', status: 'success', completed_at: '2026-11-03T23:35:00Z', notes: JSON.stringify({ only_date: '2026-11-03' }), started_at: '2026-11-03T23:26:00Z' }),
      makeRun({ id: 'r1', status: 'success', completed_at: '2026-11-01T22:07:00Z', notes: JSON.stringify({ only_date: '2026-11-01' }), started_at: '2026-11-01T21:58:00Z' }),
    ]
    sbMock.obsCountByDate.set('2026-11-03', 148_750)
    await withEnv({ CRON_SECRET: 'sekret' }, async () => {
      const res = await GET(req({ authorization: 'Bearer sekret' }))
      expect(res.status).toBe(200)
      const body = await res.json()
      expect(body.ok).toBe(true)
      expect(body.observed_on).toBe('2026-11-03')
      expect(sbMock.rpcCalls.length).toBe(1)
      expect(sbMock.rpcCalls[0].fn).toBe('mtg_set_value_daily_upsert')
      expect(sbMock.rpcCalls[0].args.p_observed_on).toBe('2026-11-03')
      expect(sbMock.rpcCalls[0].args.p_provider).toBe('tcgplayer')
    })
    vi.useRealTimers()
  })

  it('tolerates string-encoded notes (market_import_runs.notes is text, not jsonb)', async () => {
    sbMock.runs = [makeRun({
      id: 'r1', status: 'success', completed_at: '2026-11-03T21:11:00Z',
      notes: '{"only_date":"2026-11-03","other":"junk"}',  // text column stringified
      started_at: '2026-11-03T21:01:00Z',
    })]
    sbMock.obsCountByDate.set('2026-11-03', 148_000)
    await withEnv({ CRON_SECRET: 'sekret' }, async () => {
      const res = await GET(req({ authorization: 'Bearer sekret' }))
      expect(res.status).toBe(200)
      const body = await res.json()
      expect(body.observed_on).toBe('2026-11-03')
    })
  })

  it('skips malformed/non-YYYY-MM-DD only_date values and falls back to older rows', async () => {
    sbMock.runs = [
      makeRun({ id: 'r3', status: 'success', completed_at: '2026-11-04T01:00:00Z', notes: JSON.stringify({ only_date: 'not-a-date' }), started_at: '2026-11-04T00:00:00Z' }),
      makeRun({ id: 'r2', status: 'success', completed_at: '2026-11-03T23:35:00Z', notes: JSON.stringify({ only_date: '2026-11-03' }), started_at: '2026-11-03T23:26:00Z' }),
    ]
    sbMock.obsCountByDate.set('2026-11-03', 148_750)
    await withEnv({ CRON_SECRET: 'sekret' }, async () => {
      const res = await GET(req({ authorization: 'Bearer sekret' }))
      expect(res.status).toBe(200)
      const body = await res.json()
      expect(body.observed_on).toBe('2026-11-03')
    })
  })

  it('returns 500 and does not swallow the RPC error', async () => {
    sbMock.runs = [makeRun({
      id: 'r1', status: 'success', completed_at: '2026-11-03T21:11:00Z',
      notes: JSON.stringify({ only_date: '2026-11-03' }),
      started_at: '2026-11-03T21:01:00Z',
    })]
    sbMock.obsCountByDate.set('2026-11-03', 148_000)
    sbMock.rpcResult = { data: null, error: new Error('synthetic rpc failure') as any }
    await withEnv({ CRON_SECRET: 'sekret' }, async () => {
      const res = await GET(req({ authorization: 'Bearer sekret' }))
      expect(res.status).toBe(500)
      const body = await res.json()
      expect(String(body.error)).toMatch(/synthetic rpc failure/)
    })
  })
})
