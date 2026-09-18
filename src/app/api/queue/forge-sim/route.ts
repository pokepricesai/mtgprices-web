// app/api/queue/forge-sim/route.ts
//
// Vercel Queue consumer for the `forge-sim` topic. Private route:
// Vercel's queue infrastructure is the only caller. Registered in
// vercel.json under functions.<path>.experimentalTriggers.
//
// Responsibility: bridge the durable queue message to the container
// worker's /consume endpoint over authenticated HTTP. The container
// runs Forge (up to ~205s wall for a 100-game batch) and writes the
// result to Supabase via the atomic-claim + complete RPCs.
//
// Retries + delivery guarantees come from Vercel Queue. Idempotency
// comes from mtg_simulation_claim_next(), duplicate delivery of the
// same job_id is safe (only the first claim runs; subsequent claims
// get null and this handler returns 200 no-op).

import { handleCallback } from '@vercel/queue'

export const runtime = 'nodejs'
// Must be long enough to await the worker's full response. Worker
// runs ~205s at the 100-game ceiling. 700s gives generous headroom
// under Vercel's 800s Pro maximum.
export const maxDuration = 700

type QueueMessage = { job_id?: string }

export const POST = handleCallback<QueueMessage>(async (message, metadata) => {
  const workerUrl = process.env.RULES_WORKER_URL
  const workerSecret = process.env.WORKER_TRIGGER_SECRET
  if (!workerUrl || !workerSecret) {
    console.error(`forge-sim consumer: misconfigured (RULES_WORKER_URL or WORKER_TRIGGER_SECRET unset) message=${metadata.messageId}`)
    throw new Error('consumer_misconfigured')
  }
  const jobId = message?.job_id
  const t0 = Date.now()

  let resp: Response
  try {
    resp = await fetch(`${workerUrl.replace(/\/$/, '')}/consume`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-worker-secret': workerSecret,
      },
      body: JSON.stringify({ job_id: jobId }),
      signal: AbortSignal.timeout(670_000),
    })
  } catch (err: any) {
    // Network failure or timeout, throw so the Queue retries.
    console.error(`forge-sim consumer: worker fetch failed job_id=${jobId} message=${metadata.messageId} err=${err?.message}`)
    throw new Error(`worker_unreachable: ${err?.message ?? 'unknown'}`)
  }

  const wallMs = Date.now() - t0
  const bodyText = await resp.text().catch(() => '')

  if (!resp.ok) {
    console.error(`forge-sim consumer: worker HTTP ${resp.status} job_id=${jobId} message=${metadata.messageId} wall=${wallMs}ms body=${bodyText.slice(0, 300)}`)
    throw new Error(`worker_error_${resp.status}`)
  }

  console.log(`forge-sim consumer: OK job_id=${jobId} message=${metadata.messageId} wall=${wallMs}ms`)
})
