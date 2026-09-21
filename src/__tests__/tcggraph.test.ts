// tcggraph.test.ts
// Locks the TCGGraph client contract with a mocked fetch. No real
// API calls. When the real API key arrives we do an integration
// run separately - these tests protect the client wrapper itself.

import { describe, it, expect } from 'vitest'
import {
  TcgGraphClient,
  TcgGraphError,
  TcgGraphAuthError,
  TcgGraphRateLimitError,
  TcgGraphCreditBudgetError,
  TcgGraphRequestBudgetError,
  parseCredits,
} from '@/lib/tcggraph'

function res(status: number, body: unknown, headers: Record<string, string> = {}): Response {
  return new Response(status === 304 ? null : JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', ...headers },
  })
}

type MockFetch = typeof fetch & { calls: Array<{ url: string; init: RequestInit }> }

function seqFetch(responses: Array<(() => Response) | Response>): MockFetch {
  const calls: Array<{ url: string; init: RequestInit }> = []
  let i = 0
  const impl = (async (url: unknown, init?: RequestInit) => {
    calls.push({ url: String(url), init: init ?? {} })
    const r = responses[Math.min(i, responses.length - 1)]
    i += 1
    return typeof r === 'function' ? r() : r
  }) as unknown as typeof fetch
  return Object.assign(impl, { calls }) as MockFetch
}

const silentLogger = {
  info:  () => {},
  warn:  () => {},
  error: () => {},
}

const BASE = 'https://api.tcggraph.example'

function mk(overrides: Partial<ConstructorParameters<typeof TcgGraphClient>[0]> = {}) {
  return new TcgGraphClient({
    apiKey: 'test-key',
    baseUrl: BASE,
    logger: silentLogger,
    backoffBaseMs: 1,
    backoffMaxMs: 1,
    ...overrides,
  })
}

describe('TcgGraph parseCredits', () => {
  it('reads all documented credit headers', () => {
    const h = new Headers({
      'TCGGraph-Credits-Limit':     '150000',
      'TCGGraph-Credits-Remaining': '149993',
      'TCGGraph-Credits-Reset':     '2026-10-01T00:00:00Z',
      'TCGGraph-Cost':              '2',
      'X-RateLimit-Limit':          '100',
      'X-RateLimit-Remaining':      '87',
    })
    const c = parseCredits(h)
    expect(c.creditsLimit).toBe(150_000)
    expect(c.creditsRemaining).toBe(149_993)
    expect(c.creditsReset).toBe('2026-10-01T00:00:00Z')
    expect(c.requestCost).toBe(2)
    expect(c.rateLimitLimit).toBe(100)
    expect(c.rateLimitRemaining).toBe(87)
  })
  it('is null-safe when headers are absent', () => {
    const c = parseCredits(new Headers())
    expect(c.creditsLimit).toBeNull()
    expect(c.creditsRemaining).toBeNull()
    expect(c.requestCost).toBeNull()
    expect(c.serverNote).toBeNull()
  })
})

describe('TcgGraphClient basic success', () => {
  it('returns typed body + parses credit headers + persists ETag', async () => {
    const fetchImpl = seqFetch([res(200, { data: [{ id: 'g:mtg', name: 'Magic: The Gathering' }] }, {
      'etag': '"v1"',
      'TCGGraph-Credits-Limit': '150000',
      'TCGGraph-Credits-Remaining': '149998',
      'TCGGraph-Cost': '2',
    })])
    const client = mk({ fetchImpl })
    const r = await client.getGames()
    expect(r.status).toBe(200)
    expect(r.body?.data?.[0]?.id).toBe('g:mtg')
    expect(r.etag).toBe('"v1"')
    expect(r.credits.creditsRemaining).toBe(149_998)
    expect(r.credits.requestCost).toBe(2)
    expect(r.unchanged).toBe(false)
    expect(client.creditsSpent).toBe(2)
    expect(client.requestCount).toBe(1)
  })
})

describe('TcgGraphClient ETag + 304', () => {
  it('sends If-None-Match on the second call and short-circuits on 304', async () => {
    const fetchImpl = seqFetch([
      res(200, { data: [{ id: 'g:mtg', name: 'MTG' }] }, { 'etag': '"v1"', 'TCGGraph-Cost': '2' }),
      res(304, null, { 'TCGGraph-Cost': '0' }),
    ])
    const client = mk({ fetchImpl })
    const first = await client.getGames()
    expect(first.status).toBe(200)
    const second = await client.getGames()
    expect(second.status).toBe(304)
    expect(second.unchanged).toBe(true)
    expect(second.body?.data?.[0]?.id).toBe('g:mtg')
    // Second call must have sent If-None-Match.
    const sentHeaders = fetchImpl.calls[1].init.headers as Record<string, string> | undefined
    expect(sentHeaders?.['if-none-match']).toBe('"v1"')
    // 304 is free - creditsUsed should be unchanged after the 304
    // (in our accounting: only counts cost header when > 0; 304 gets
    // zero increment when TCGGraph-Cost = 0).
    expect(client.creditsSpent).toBe(2)
  })
})

describe('TcgGraphClient retry semantics', () => {
  it('retries 429 with Retry-After honoured, then succeeds', async () => {
    const fetchImpl = seqFetch([
      res(429, null, { 'retry-after': '0' }),
      res(200, { data: [{ id: 'g:mtg', name: 'MTG' }] }, { 'TCGGraph-Cost': '1' }),
    ])
    const client = mk({ fetchImpl, maxAttempts: 3 })
    const r = await client.getGames()
    expect(r.status).toBe(200)
    expect(r.attempts).toBe(2)
    expect(fetchImpl.calls).toHaveLength(2)
  })

  it('throws TcgGraphRateLimitError after exhausting attempts on 429', async () => {
    const fetchImpl = seqFetch([res(429, null, { 'retry-after': '0' })])
    const client = mk({ fetchImpl, maxAttempts: 2 })
    await expect(client.getGames()).rejects.toBeInstanceOf(TcgGraphRateLimitError)
    expect(fetchImpl.calls).toHaveLength(2)
  })

  it('retries 5xx and gives up with TcgGraphError after maxAttempts', async () => {
    const fetchImpl = seqFetch([
      res(503, null),
      res(503, null),
      res(503, null),
    ])
    const client = mk({ fetchImpl, maxAttempts: 3 })
    await expect(client.getGames()).rejects.toBeInstanceOf(TcgGraphError)
    expect(fetchImpl.calls).toHaveLength(3)
  })

  it('does NOT retry 4xx (except 429). Auth errors surface immediately', async () => {
    const fetchImpl = seqFetch([res(401, { error: 'bad key' })])
    const client = mk({ fetchImpl, maxAttempts: 4 })
    await expect(client.getGames()).rejects.toBeInstanceOf(TcgGraphAuthError)
    expect(fetchImpl.calls).toHaveLength(1)
  })

  it('does NOT retry 400', async () => {
    const fetchImpl = seqFetch([res(400, { error: 'bad request' })])
    const client = mk({ fetchImpl, maxAttempts: 4 })
    await expect(client.getGames()).rejects.toBeInstanceOf(TcgGraphError)
    expect(fetchImpl.calls).toHaveLength(1)
  })
})

describe('TcgGraphClient safety budgets', () => {
  it('short-circuits once credit budget is exhausted', async () => {
    const fetchImpl = seqFetch([res(200, { data: [] }, { 'TCGGraph-Cost': '100' })])
    const client = mk({ fetchImpl, creditBudget: 50 })
    await client.getGames()
    // Next call must refuse.
    await expect(client.listSets('mtg')).rejects.toBeInstanceOf(TcgGraphCreditBudgetError)
    expect(fetchImpl.calls).toHaveLength(1)
  })
  it('short-circuits once request budget is exhausted', async () => {
    const fetchImpl = seqFetch([res(200, { data: [] }, { 'TCGGraph-Cost': '1' })])
    const client = mk({ fetchImpl, requestBudget: 1 })
    await client.getGames()
    await expect(client.listSets('mtg')).rejects.toBeInstanceOf(TcgGraphRequestBudgetError)
    expect(fetchImpl.calls).toHaveLength(1)
  })
})

describe('TcgGraphClient URL building', () => {
  it('composes base + path + query params correctly', async () => {
    const fetchImpl = seqFetch([res(200, { data: [] }, { 'TCGGraph-Cost': '1' })])
    const client = mk({ fetchImpl })
    await client.listPrintings('ygo', { setId: 'lob', limit: 100 })
    const url = new URL(fetchImpl.calls[0].url)
    expect(url.origin + url.pathname).toBe(`${BASE}/printings`)
    expect(url.searchParams.get('game')).toBe('ygo')
    expect(url.searchParams.get('set')).toBe('lob')
    expect(url.searchParams.get('limit')).toBe('100')
    expect(url.searchParams.get('cursor')).toBeNull()   // undefined -> omitted
  })
  it('always sends Authorization: Bearer <key>', async () => {
    const fetchImpl = seqFetch([res(200, { data: [] }, { 'TCGGraph-Cost': '1' })])
    const client = mk({ fetchImpl })
    await client.getGames()
    const h = fetchImpl.calls[0].init.headers as Record<string, string> | undefined
    expect(h?.['authorization']).toBe('Bearer test-key')
  })
})
