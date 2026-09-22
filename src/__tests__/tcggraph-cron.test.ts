// tcggraph-cron.test.ts
// Slice 5. Lock the /api/cron/tcggraph-refresh security + allowlist
// posture. The tests only touch the parts of the route that happen
// BEFORE the actual TCGGraph call - unauth, missing secret, disabled,
// bad game, allowlisted-but-cron-disabled, etc. The refresh pipeline
// itself is exercised by the CLI dry-run.

import { describe, it, expect, vi } from 'vitest'

// vi.hoisted() runs before ANY imports, letting the mock factories
// reference this shared mock function safely.
const { refreshMock } = vi.hoisted(() => ({
  refreshMock: vi.fn(),
}))

vi.mock('@/lib/tcggraph/refresh.mjs', () => ({
  refreshCatalogue: refreshMock,
  BOOTSTRAP_DAILY_RESERVE: 100,
  PRODUCTION_DAILY_RESERVE: 500,
  PRODUCTION_MONTHLY_RESERVE: 5000,
}))
vi.mock('@/lib/tcggraph/ingest-core.mjs', async () => {
  const actual = await vi.importActual<Record<string, unknown>>('@/lib/tcggraph/ingest-core.mjs')
  return {
    ...actual,
    getSupabase: () => ({} as unknown),
  }
})

const successResult = (gameSlug: string) => ({
  status: 'success',
  gameSlug,
  gameId: gameSlug === 'one-piece' ? 'onepiece' : 'lorcana',
  stopReason: 'catalogue_exhausted',
  runId: 'test-run-id',
  startedAt: new Date().toISOString(),
  finishedAt: new Date().toISOString(),
  pagesCompleted: 1, rowsFetched: 1, creditsUsed: 2,
  marketRowsUpserted: 0, gradedRowsUpserted: 0,
  mappingCounts: {}, lastPage: 1,
  credits: { monthlyRemaining: 20000, dailyRemaining: 2000 },
  errors: 0,
})
// Default implementation - each test can override.
refreshMock.mockImplementation(async ({ gameSlug }: { gameSlug: string }) => successResult(gameSlug))

// Import AFTER the mocks are registered.
import { GET } from '@/app/api/cron/tcggraph-refresh/route'

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

function req(headers: Record<string, string>, url = 'https://mtgprices.io/api/cron/tcggraph-refresh') {
  return new Request(url, { headers })
}

describe('tcggraph-refresh cron endpoint - security', () => {
  it('returns 401 when Authorization header does not match CRON_SECRET', async () => {
    await withEnv({ CRON_SECRET: 'sekret', TCGGRAPH_CRON_ENABLED: 'true' }, async () => {
      const res = await GET(req({ authorization: 'Bearer wrong' }))
      expect(res.status).toBe(401)
      const body = await res.json()
      expect(body.reason).toBe('unauthorized')
    })
  })

  it('returns 401 when Authorization header is missing entirely', async () => {
    await withEnv({ CRON_SECRET: 'sekret', TCGGRAPH_CRON_ENABLED: 'true' }, async () => {
      const res = await GET(req({}))
      expect(res.status).toBe(401)
    })
  })

  it('fails closed (500) when CRON_SECRET is not set on the server', async () => {
    await withEnv({ CRON_SECRET: '', TCGGRAPH_CRON_ENABLED: 'true' }, async () => {
      const res = await GET(req({ authorization: 'Bearer anything' }))
      expect(res.status).toBe(500)
      const body = await res.json()
      expect(body.reason).toBe('cron_secret_not_set')
    })
  })
})

describe('tcggraph-refresh cron endpoint - env gate', () => {
  it('returns 202 { reason: "cron_disabled" } when TCGGRAPH_CRON_ENABLED is "false"', async () => {
    await withEnv({ CRON_SECRET: 'sekret', TCGGRAPH_CRON_ENABLED: 'false' }, async () => {
      const res = await GET(req({ authorization: 'Bearer sekret' }, 'https://mtgprices.io/api/cron/tcggraph-refresh?game=one-piece'))
      expect(res.status).toBe(202)
      const body = await res.json()
      expect(body.reason).toBe('cron_disabled')
    })
  })

  it('default (env var unset) is disabled', async () => {
    await withEnv({ CRON_SECRET: 'sekret', TCGGRAPH_CRON_ENABLED: undefined }, async () => {
      const res = await GET(req({ authorization: 'Bearer sekret' }, 'https://mtgprices.io/api/cron/tcggraph-refresh?game=disney-lorcana'))
      expect(res.status).toBe(202)
      const body = await res.json()
      expect(body.reason).toBe('cron_disabled')
    })
  })
})

describe('tcggraph-refresh cron endpoint - allowlist', () => {
  it('rejects a missing ?game param with 400 missing_game_param', async () => {
    await withEnv({ CRON_SECRET: 'sekret', TCGGRAPH_CRON_ENABLED: 'true' }, async () => {
      refreshMock.mockClear()
      const res = await GET(req({ authorization: 'Bearer sekret' }))
      expect(res.status).toBe(400)
      const body = await res.json()
      expect(body.reason).toBe('missing_game_param')
      expect(body.allowed).toEqual(expect.arrayContaining(['one-piece', 'disney-lorcana']))
      expect(refreshMock).not.toHaveBeenCalled()
    })
  })

  it('rejects MTG with 400 game_not_scheduled', async () => {
    await withEnv({ CRON_SECRET: 'sekret', TCGGRAPH_CRON_ENABLED: 'true' }, async () => {
      refreshMock.mockClear()
      const res = await GET(req({ authorization: 'Bearer sekret' }, 'https://mtgprices.io/api/cron/tcggraph-refresh?game=magic-the-gathering'))
      expect(res.status).toBe(400)
      const body = await res.json()
      expect(body.reason).toBe('game_not_scheduled')
      expect(body.game).toBe('magic-the-gathering')
      expect(refreshMock).not.toHaveBeenCalled()
    })
  })

  it('rejects YGO with 400 game_not_scheduled', async () => {
    await withEnv({ CRON_SECRET: 'sekret', TCGGRAPH_CRON_ENABLED: 'true' }, async () => {
      refreshMock.mockClear()
      const res = await GET(req({ authorization: 'Bearer sekret' }, 'https://mtgprices.io/api/cron/tcggraph-refresh?game=yugioh'))
      expect(res.status).toBe(400)
      const body = await res.json()
      expect(body.reason).toBe('game_not_scheduled')
      expect(body.game).toBe('yugioh')
      expect(refreshMock).not.toHaveBeenCalled()
    })
  })

  it('rejects an arbitrary string with 400 game_not_scheduled', async () => {
    await withEnv({ CRON_SECRET: 'sekret', TCGGRAPH_CRON_ENABLED: 'true' }, async () => {
      refreshMock.mockClear()
      const res = await GET(req({ authorization: 'Bearer sekret' }, 'https://mtgprices.io/api/cron/tcggraph-refresh?game=%3B%20drop%20tables'))
      expect(res.status).toBe(400)
      const body = await res.json()
      expect(body.reason).toBe('game_not_scheduled')
      expect(refreshMock).not.toHaveBeenCalled()
    })
  })

  it('rejects Star Wars Unlimited with 400 game_not_scheduled', async () => {
    await withEnv({ CRON_SECRET: 'sekret', TCGGRAPH_CRON_ENABLED: 'true' }, async () => {
      refreshMock.mockClear()
      const res = await GET(req({ authorization: 'Bearer sekret' }, 'https://mtgprices.io/api/cron/tcggraph-refresh?game=star-wars-unlimited'))
      expect(res.status).toBe(400)
      const body = await res.json()
      expect(body.reason).toBe('game_not_scheduled')
      expect(refreshMock).not.toHaveBeenCalled()
    })
  })
})

describe('tcggraph-refresh cron endpoint - allowed games', () => {
  it('runs Lorcana when authorised + enabled + game=disney-lorcana', async () => {
    await withEnv({ CRON_SECRET: 'sekret', TCGGRAPH_CRON_ENABLED: 'true' }, async () => {
      refreshMock.mockClear()
      const res = await GET(req({ authorization: 'Bearer sekret' }, 'https://mtgprices.io/api/cron/tcggraph-refresh?game=disney-lorcana'))
      expect(res.status).toBe(200)
      const body = await res.json()
      expect(body.ok).toBe(true)
      expect(body.gameSlug).toBe('disney-lorcana')
      expect(refreshMock).toHaveBeenCalledTimes(1)
      expect(refreshMock).toHaveBeenCalledWith(expect.objectContaining({ gameSlug: 'disney-lorcana', source: 'cron', preflightCredits: true }))
    })
  })

  it('runs One Piece when authorised + enabled + game=one-piece', async () => {
    await withEnv({ CRON_SECRET: 'sekret', TCGGRAPH_CRON_ENABLED: 'true' }, async () => {
      refreshMock.mockClear()
      const res = await GET(req({ authorization: 'Bearer sekret' }, 'https://mtgprices.io/api/cron/tcggraph-refresh?game=one-piece'))
      expect(res.status).toBe(200)
      const body = await res.json()
      expect(body.ok).toBe(true)
      expect(body.gameSlug).toBe('one-piece')
      expect(refreshMock).toHaveBeenCalledTimes(1)
    })
  })

  it('one game failure does not affect the other - independent invocations', async () => {
    await withEnv({ CRON_SECRET: 'sekret', TCGGRAPH_CRON_ENABLED: 'true' }, async () => {
      refreshMock.mockClear()
      refreshMock.mockImplementationOnce(async () => ({ status: 'failure', stopReason: 'simulated', errors: 1, credits: {} }))
      const lorRes = await GET(req({ authorization: 'Bearer sekret' }, 'https://mtgprices.io/api/cron/tcggraph-refresh?game=disney-lorcana'))
      const lorBody = await lorRes.json()
      expect(lorBody.status).toBe('failure')
      const opRes = await GET(req({ authorization: 'Bearer sekret' }, 'https://mtgprices.io/api/cron/tcggraph-refresh?game=one-piece'))
      expect(opRes.status).toBe(200)
      const opBody = await opRes.json()
      expect(opBody.status).toBe('success')
    })
  })

  it('propagates skipped_credit as 202 without pretending success', async () => {
    await withEnv({ CRON_SECRET: 'sekret', TCGGRAPH_CRON_ENABLED: 'true' }, async () => {
      refreshMock.mockClear()
      refreshMock.mockImplementationOnce(async () => ({ status: 'skipped_credit', reason: 'insufficient_daily_credits', stopReason: 'insufficient_daily_credits', credits: { dailyRemaining: 100 } }))
      const res = await GET(req({ authorization: 'Bearer sekret' }, 'https://mtgprices.io/api/cron/tcggraph-refresh?game=disney-lorcana'))
      expect(res.status).toBe(202)
      const body = await res.json()
      expect(body.reason).toBe('insufficient_daily_credits')
    })
  })

  it('propagates skipped_lock as 202', async () => {
    await withEnv({ CRON_SECRET: 'sekret', TCGGRAPH_CRON_ENABLED: 'true' }, async () => {
      refreshMock.mockClear()
      refreshMock.mockImplementationOnce(async () => ({ status: 'skipped_lock', reason: 'lock_held', stopReason: 'lock_held' }))
      const res = await GET(req({ authorization: 'Bearer sekret' }, 'https://mtgprices.io/api/cron/tcggraph-refresh?game=one-piece'))
      expect(res.status).toBe(202)
      const body = await res.json()
      expect(body.reason).toBe('lock_held')
    })
  })
})
