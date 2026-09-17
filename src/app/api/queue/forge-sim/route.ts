// app/api/queue/forge-sim/route.ts
//
// Vercel Queue consumer for the `forge-sim` topic. Private route:
// Vercel's queue infrastructure is the only caller. Configured in
// vercel.json under `experimentalTriggers`.
//
// Responsibility: bridge the durable queue message to the container
// worker's /consume endpoint over authenticated HTTP. The container
// runs Forge (up to ~205s wall for a 100-game batch) and writes the
// result to Supabase via the atomic-claim + complete RPCs.
//
// Retries + delivery guarantees come from Vercel Queue. Idempotency
// comes from mtg_simulation_claim_next() — duplicate delivery of the
// same job_id is safe (only the first claim runs; subsequent claims
// get null and this handler returns 200 no-op).

import { NextResponse, type NextRequest } from 'next/server'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'
// Must be long enough to await the worker's full response. Worker
// runs ~205s at the 100-game ceiling. 700s gives generous headroom
// and stays under Vercel's 800s Pro maximum.
export const maxDuration = 700

export async function POST(req: NextRequest) {
  const workerUrl = process.env.RULES_WORKER_URL
  const workerSecret = process.env.WORKER_TRIGGER_SECRET
  if (!workerUrl || !workerSecret) {
    console.error('forge-sim consumer: RULES_WORKER_URL or WORKER_TRIGGER_SECRET unset')
    return NextResponse.json({ error: 'consumer_misconfigured' }, { status: 500 })
  }

  // Vercel Queue payload format: JSON body { job_id: string }.
  let body: { job_id?: string } = {}
  try { body = await req.json() } catch { /* empty body ⇒ delegated claim */ }
  const jobId = body?.job_id

  const t0 = Date.now()
  let resp: Response
  try {
    resp = await fetch(`${workerUrl.replace(/\/$/, '')}/consume`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-worker-secret': workerSecret },
      body: JSON.stringify({ job_id: jobId }),
      // Cap slightly under the Function maxDuration.
      signal: AbortSignal.timeout(670_000),
    })
  } catch (err: any) {
    // Any network failure or timeout — return non-2xx so the queue retries.
    console.error(`forge-sim consumer: worker fetch failed job_id=${jobId} err=${err?.message}`)
    return NextResponse.json({ error: 'worker_unreachable', jobId, reason: err?.message }, { status: 502 })
  }

  const wallMs = Date.now() - t0
  const workerBody = await resp.text().catch(() => '')

  if (!resp.ok) {
    // Worker returned an explicit error — surface for queue retry.
    console.error(`forge-sim consumer: worker HTTP ${resp.status} job_id=${jobId} wall=${wallMs}ms body=${workerBody.slice(0, 300)}`)
    return NextResponse.json({
      error: 'worker_error', jobId, status: resp.status,
      body_head: workerBody.slice(0, 500),
    }, { status: 502 })
  }

  // Worker completed (may be "no_jobs" if the queue delivered after
  // another instance already picked it up — still 200 OK, done).
  console.log(`forge-sim consumer: OK job_id=${jobId} wall=${wallMs}ms`)
  return NextResponse.json({ ok: true, jobId, workerWallMs: wallMs })
}
