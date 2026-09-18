// src/lib/mtg/simulation/queue-producer.ts
//
// Publishes a job_id onto the Vercel Queue "forge-sim" for durable
// delivery to the consumer Function. The consumer lives in the same
// project (mtgprices-web) at `src/app/api/queue/forge-sim/route.ts`
// and is registered as a private trigger in vercel.json's
// `experimentalTriggers`.
//
// Vercel Queues are at-least-once. Idempotency is handled at the
// worker side by mtg_simulation_claim_next(), if the same job_id
// is delivered twice, only the first claim succeeds; the second
// gets `null` and returns 204 no-op.

import 'server-only'
import { send } from '@vercel/queue'

const QUEUE_TOPIC = 'forge-sim'

export type QueueSendResult =
  | { ok: true; messageId: string }
  | { ok: false; error: string }

/** Publish a simulation-job trigger to the queue. Returns { ok: false }
 *  cleanly when Vercel Queues are unavailable (e.g. local dev, or
 *  during a feature-flag-off window) so the caller can decide whether
 *  to fall back to `waitUntil`. Never throws, the enqueue endpoint
 *  must not fail solely because Queues aren't up. */
export async function publishSimulationJob(jobId: string): Promise<QueueSendResult> {
  try {
    const result = await send(QUEUE_TOPIC, { job_id: jobId }, {
      // Idempotency key uses the job_id, if mtgprices-web accidentally
      // publishes twice within the message TTL, the queue dedupes.
      idempotencyKey: `job-${jobId}`,
    })
    const messageId = (result as any)?.messageId ?? 'unknown'
    return { ok: true, messageId }
  } catch (err: any) {
    return { ok: false, error: err?.message ?? String(err) }
  }
}
