// tcggraph-cron.test.ts
// Lock the /api/cron/tcggraph-refresh security posture:
//   - CRON_SECRET must match (unauthorized otherwise)
//   - TCGGRAPH_CRON_ENABLED must be 'true' (else HTTP 202 disabled)
//   - No ingest actually runs from the endpoint in Slice 3

import { describe, it, expect } from 'vitest'
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

describe('tcggraph-refresh cron endpoint', () => {
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

  it('returns 500 when CRON_SECRET is not set on the server', async () => {
    await withEnv({ CRON_SECRET: '', TCGGRAPH_CRON_ENABLED: 'true' }, async () => {
      const res = await GET(req({ authorization: 'Bearer anything' }))
      expect(res.status).toBe(500)
      const body = await res.json()
      expect(body.reason).toBe('cron_secret_not_set')
    })
  })

  it('returns 202 { reason: "cron_disabled" } when TCGGRAPH_CRON_ENABLED is not "true"', async () => {
    await withEnv({ CRON_SECRET: 'sekret', TCGGRAPH_CRON_ENABLED: 'false' }, async () => {
      const res = await GET(req({ authorization: 'Bearer sekret' }))
      expect(res.status).toBe(202)
      const body = await res.json()
      expect(body.reason).toBe('cron_disabled')
    })
  })

  it('default (env var unset) is disabled', async () => {
    await withEnv({ CRON_SECRET: 'sekret', TCGGRAPH_CRON_ENABLED: undefined }, async () => {
      const res = await GET(req({ authorization: 'Bearer sekret' }))
      expect(res.status).toBe(202)
      const body = await res.json()
      expect(body.reason).toBe('cron_disabled')
    })
  })

  it('when enabled + authorised, echoes accepted job params without running the ingest', async () => {
    await withEnv({ CRON_SECRET: 'sekret', TCGGRAPH_CRON_ENABLED: 'true' }, async () => {
      const res = await GET(req({ authorization: 'Bearer sekret' }, 'https://mtgprices.io/api/cron/tcggraph-refresh?game=mtg&kind=new-sets'))
      expect(res.status).toBe(202)
      const body = await res.json()
      expect(body.accepted).toBe(true)
      expect(body.scheduled).toBe(false)   // NEVER runs the ingest from the request path
      expect(body.game).toBe('mtg')
      expect(body.kind).toBe('new-sets')
    })
  })
})
