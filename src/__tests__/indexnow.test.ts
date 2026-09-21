// indexnow.test.ts
// Locks the IndexNow helper contract:
//   - off-domain URLs are rejected before submission
//   - duplicates are removed
//   - URLs are split at exactly the 10,000 boundary
//   - disabled mode makes ZERO external requests
//   - correct payload shape (host / key / keyLocation / urlList)
//   - 429 (transient) is retried
//   - 400 / 403 / 422 (permanent) are not retried

import { describe, it, expect } from 'vitest'
import {
  canonicaliseUrls,
  batchUrls,
  submitIndexNowUrls,
} from '@/lib/indexnow'

const ORIGIN = 'https://mtgprices.io'

function withEnv<T>(env: Record<string, string | undefined>, fn: () => Promise<T> | T): Promise<T> | T {
  const before: Record<string, string | undefined> = {}
  for (const k of Object.keys(env)) {
    before[k] = process.env[k]
    if (env[k] === undefined) delete process.env[k]
    else process.env[k] = env[k]
  }
  const restore = () => {
    for (const k of Object.keys(before)) {
      if (before[k] === undefined) delete process.env[k]
      else process.env[k] = before[k]
    }
  }
  try {
    const r = fn()
    if (r instanceof Promise) return r.finally(restore) as Promise<T>
    restore(); return r
  } catch (err) { restore(); throw err }
}

function mockFetch(handlers: Array<(url: string, init: any) => Response | Promise<Response>>) {
  let i = 0
  const calls: Array<{ url: string; init: any }> = []
  const fn: any = async (url: string, init: any) => {
    calls.push({ url, init })
    const h = handlers[Math.min(i, handlers.length - 1)]; i += 1
    return h(url, init)
  }
  fn.calls = calls
  return fn as typeof fetch & { calls: typeof calls }
}

describe('indexnow canonicaliseUrls', () => {
  it('rejects off-domain URLs', () => {
    const { urls, rejected } = canonicaliseUrls([
      `${ORIGIN}/set/lea`,
      'https://example.com/foo',
      'http://mtgprices.io/set/lea',    // wrong protocol
      'https://sub.mtgprices.io/set/lea',
    ])
    expect(urls).toEqual([`${ORIGIN}/set/lea`])
    expect(rejected).toBe(3)
  })

  it('removes duplicates and strips query/hash + trailing slash', () => {
    const { urls } = canonicaliseUrls([
      `${ORIGIN}/browse`,
      `${ORIGIN}/browse`,
      `${ORIGIN}/browse/`,
      `${ORIGIN}/browse?q=1`,
      `${ORIGIN}/browse#top`,
      `${ORIGIN}/market`,
    ])
    expect(urls).toEqual([`${ORIGIN}/browse`, `${ORIGIN}/market`])
  })

  it('drops empties, whitespace, and malformed inputs safely', () => {
    const { urls, rejected } = canonicaliseUrls(['', '   ', 'not a url', `${ORIGIN}/foo`])
    expect(urls).toEqual([`${ORIGIN}/foo`])
    expect(rejected).toBeGreaterThanOrEqual(3)
  })
})

describe('indexnow batchUrls', () => {
  it('splits at exactly the 10 000 boundary', () => {
    const urls = Array.from({ length: 20_000 }, (_, i) => `${ORIGIN}/x/${i}`)
    const batches = batchUrls(urls)
    expect(batches).toHaveLength(2)
    expect(batches[0]).toHaveLength(10_000)
    expect(batches[1]).toHaveLength(10_000)
  })
  it('handles a partial final batch', () => {
    const urls = Array.from({ length: 25_050 }, (_, i) => `${ORIGIN}/x/${i}`)
    const batches = batchUrls(urls)
    expect(batches).toHaveLength(3)
    expect(batches[0]).toHaveLength(10_000)
    expect(batches[1]).toHaveLength(10_000)
    expect(batches[2]).toHaveLength(5_050)
  })
  it('boundary case: exactly 10 000 URLs is one batch', () => {
    const urls = Array.from({ length: 10_000 }, (_, i) => `${ORIGIN}/x/${i}`)
    const batches = batchUrls(urls)
    expect(batches).toHaveLength(1)
    expect(batches[0]).toHaveLength(10_000)
  })
})

describe('indexnow submitIndexNowUrls', () => {
  it('makes zero requests when INDEXNOW_ENABLED is off', async () => {
    const fetchImpl = mockFetch([() => new Response('should not be called', { status: 500 })])
    const res = await withEnv({ INDEXNOW_ENABLED: 'false', INDEXNOW_KEY: 'abc123' }, () =>
      submitIndexNowUrls([`${ORIGIN}/foo`], { fetchImpl }),
    ) as any
    expect(fetchImpl.calls).toHaveLength(0)
    expect(res.disabled).toBe(true)
    expect(res.totalSubmitted).toBe(0)
  })

  it('makes zero requests when INDEXNOW_KEY is unset', async () => {
    const fetchImpl = mockFetch([() => new Response('should not be called', { status: 500 })])
    const res = await withEnv({ INDEXNOW_ENABLED: 'true', INDEXNOW_KEY: undefined }, () =>
      submitIndexNowUrls([`${ORIGIN}/foo`], { fetchImpl }),
    ) as any
    expect(fetchImpl.calls).toHaveLength(0)
    expect(res.disabled).toBe(true)
  })

  it('posts one batch with the correct payload shape', async () => {
    const fetchImpl = mockFetch([() => new Response('', { status: 200 })])
    const res = await withEnv({ INDEXNOW_ENABLED: 'true', INDEXNOW_KEY: 'abc123' }, () =>
      submitIndexNowUrls([`${ORIGIN}/a`, `${ORIGIN}/b`], { fetchImpl, betweenBatchMs: 0 }),
    ) as any
    expect(fetchImpl.calls).toHaveLength(1)
    const call = fetchImpl.calls[0]
    expect(call.url).toBe('https://api.indexnow.org/indexnow')
    expect(call.init.method).toBe('POST')
    const body = JSON.parse(call.init.body)
    expect(body.host).toBe('mtgprices.io')
    expect(body.key).toBe('abc123')
    expect(body.keyLocation).toBe(`${ORIGIN}/abc123.txt`)
    expect(body.urlList).toEqual([`${ORIGIN}/a`, `${ORIGIN}/b`])
    expect(res.totalSubmitted).toBe(2)
  })

  it('retries transient 429 and eventually succeeds', async () => {
    const fetchImpl = mockFetch([
      () => new Response('', { status: 429 }),
      () => new Response('', { status: 429 }),
      () => new Response('', { status: 200 }),
    ])
    const res = await withEnv({ INDEXNOW_ENABLED: 'true', INDEXNOW_KEY: 'abc123' }, () =>
      submitIndexNowUrls([`${ORIGIN}/x`], { fetchImpl, betweenBatchMs: 0, maxAttempts: 3 }),
    ) as any
    expect(fetchImpl.calls).toHaveLength(3)
    expect(res.batches[0].ok).toBe(true)
    expect(res.batches[0].attempts).toBe(3)
    expect(res.totalSubmitted).toBe(1)
  })

  it('does not retry permanent 4xx (400/403/422)', async () => {
    for (const status of [400, 403, 422]) {
      const fetchImpl = mockFetch([() => new Response('', { status })])
      const res = await withEnv({ INDEXNOW_ENABLED: 'true', INDEXNOW_KEY: 'abc123' }, () =>
        submitIndexNowUrls([`${ORIGIN}/y`], { fetchImpl, betweenBatchMs: 0, maxAttempts: 3 }),
      ) as any
      expect(fetchImpl.calls, `status ${status}`).toHaveLength(1)
      expect(res.batches[0].ok, `status ${status}`).toBe(false)
      expect(res.batches[0].attempts, `status ${status}`).toBe(1)
      expect(res.totalSubmitted).toBe(0)
    }
  })

  it('rejects off-domain URLs before hitting the wire', async () => {
    const fetchImpl = mockFetch([() => new Response('', { status: 200 })])
    const res = await withEnv({ INDEXNOW_ENABLED: 'true', INDEXNOW_KEY: 'abc123' }, () =>
      submitIndexNowUrls([`${ORIGIN}/x`, 'https://example.com/y'], { fetchImpl, betweenBatchMs: 0 }),
    ) as any
    expect(res.totalRejected).toBe(1)
    const body = JSON.parse(fetchImpl.calls[0].init.body)
    expect(body.urlList).toEqual([`${ORIGIN}/x`])
  })

  it('splits a > 10 000 URL list into multiple sequential batches', async () => {
    const urls = Array.from({ length: 22_500 }, (_, i) => `${ORIGIN}/x/${i}`)
    const fetchImpl = mockFetch([
      () => new Response('', { status: 200 }),
      () => new Response('', { status: 200 }),
      () => new Response('', { status: 200 }),
    ])
    const res = await withEnv({ INDEXNOW_ENABLED: 'true', INDEXNOW_KEY: 'abc123' }, () =>
      submitIndexNowUrls(urls, { fetchImpl, betweenBatchMs: 0 }),
    ) as any
    expect(fetchImpl.calls).toHaveLength(3)
    expect(res.batches[0].size).toBe(10_000)
    expect(res.batches[1].size).toBe(10_000)
    expect(res.batches[2].size).toBe(2_500)
    expect(res.totalSubmitted).toBe(22_500)
  })
})
