// app/api/decks/[id]/simulate/rules-aware/route.ts
//
// Owner-only enqueue endpoint for rules-aware Forge simulations.
//
// Architecture note (Phase 4B.3): this endpoint's ONLY job is to
// INSERT a mtg_simulation_jobs row. It does NOT call any HTTP
// service. A separate Node worker (mtgprices-rules-worker repo)
// atomically claims queued rows via `mtg_simulation_claim_next()`
// and writes back the structured result.
//
// Feature availability is controlled by RULES_ENGINE_ENABLED (a
// boolean flag), independently of worker HTTP transport.

import { NextResponse, type NextRequest } from 'next/server'
import { getCurrentUser } from '@/lib/supabase/server'
import { getSupabaseServiceClient } from '@/lib/supabaseService'
import { getDeckById, getDeckCards } from '@/lib/mtg/decks'
import { findUnsupportedCards, FORGE_RELEASE } from '@/lib/mtg/simulation/forge-coverage'
import { publishSimulationJob } from '@/lib/mtg/simulation/queue-producer'
import { waitUntil } from '@vercel/functions'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

// Configurable pre-launch limits (per Luke's directive).
const MAX_ITERATIONS_PER_JOB = Number(process.env.RULES_MAX_ITERATIONS_PER_JOB ?? 100)
const MAX_JOBS_PER_USER_PER_DAY = Number(process.env.RULES_MAX_JOBS_PER_USER_PER_DAY ?? 3)

function isEnabled(): boolean {
  return process.env.RULES_ENGINE_ENABLED === 'true'
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  if (!isEnabled()) return NextResponse.json({ error: 'rules_engine_disabled' }, { status: 503 })

  const user = await getCurrentUser()
  if (!user) return NextResponse.json({ error: 'unauthorised' }, { status: 401 })
  const { id: deckAId } = await params

  const deckA = await getDeckById(deckAId)
  if (!deckA || deckA.user_id !== user.id) return NextResponse.json({ error: 'not_found' }, { status: 404 })

  const body = await req.json().catch(() => ({} as any)) ?? {}
  const opponentDeckId: string | undefined = typeof body.opponent_deck_id === 'string' ? body.opponent_deck_id : undefined
  if (!opponentDeckId) return NextResponse.json({ error: 'opponent_deck_id required' }, { status: 400 })
  const iterations = Math.max(1, Math.min(MAX_ITERATIONS_PER_JOB, Number(body.iterations ?? 10) | 0))
  const seed = typeof body.seed === 'number' ? (body.seed | 0) : Date.now() & 0x7fffffff
  const timeoutSec = Math.max(30, Math.min(600, Number(body.timeout_sec ?? 180) | 0))

  const deckB = await getDeckById(opponentDeckId)
  if (!deckB || deckB.user_id !== user.id) return NextResponse.json({ error: 'opponent_not_found' }, { status: 404 })
  if (deckB.format !== deckA.format) return NextResponse.json({ error: 'format_mismatch' }, { status: 400 })

  // Rate limit.
  const s = getSupabaseServiceClient()
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString()
  const { count } = await s.from('mtg_simulation_jobs')
    .select('id', { count: 'exact', head: true })
    .eq('user_id', user.id)
    .neq('status', 'cancelled')
    .gte('created_at', since)
  if ((count ?? 0) >= MAX_JOBS_PER_USER_PER_DAY) {
    return NextResponse.json({
      error: 'rate_limited', reason: 'daily_job_cap',
      used: count, cap: MAX_JOBS_PER_USER_PER_DAY,
    }, { status: 429 })
  }

  // Snapshot deck contents.
  const [cardsA, cardsB] = await Promise.all([getDeckCards(deckA.id), getDeckCards(deckB.id)])
  const allOracleIds = Array.from(new Set(
    [...cardsA, ...cardsB].map((c) => c.oracle_card_id)
  ))
  const { data: oracles } = allOracleIds.length > 0
    ? await s.from('mtg_oracle_cards').select('id, name').in('id', allOracleIds)
    : { data: [] as any[] }
  const nameById = new Map<string, string>()
  for (const o of (oracles ?? []) as any[]) nameById.set(o.id, o.name)

  // Card-mapping validation. Refuse the job if any card is missing
  // from the pinned Forge corpus. Surface the full list to the UI
  // so the user knows why.
  const unsupportedA = findUnsupportedCards(cardsA.map((c) => ({
    oracle_card_id: c.oracle_card_id, name: nameById.get(c.oracle_card_id), quantity: c.quantity,
  })))
  const unsupportedB = findUnsupportedCards(cardsB.map((c) => ({
    oracle_card_id: c.oracle_card_id, name: nameById.get(c.oracle_card_id), quantity: c.quantity,
  })))
  const dedup = new Map<string, { oracle_card_id: string; name: string }>()
  for (const u of [...unsupportedA, ...unsupportedB]) if (!dedup.has(u.oracle_card_id)) dedup.set(u.oracle_card_id, u)
  const unsupported: Array<{ oracle_card_id: string; name: string }> = []
  dedup.forEach((v) => unsupported.push(v))
  if (unsupported.length > 0) {
    return NextResponse.json({
      error: 'unsupported_cards',
      forge_release: FORGE_RELEASE,
      unsupported_cards: unsupported,
    }, { status: 422 })
  }

  // Snapshot with names, worker needs them to export .dck.
  const [printA, printB] = await Promise.all([
    printingsFor(cardsA.map((c) => c.oracle_card_id)),
    printingsFor(cardsB.map((c) => c.oracle_card_id)),
  ])
  function deckSnap(deck: any, cards: any[], printings: Map<string, any>) {
    return {
      id: deck.id, name: deck.name, format: deck.format,
      commanders: cards.filter((c) => c.zone === 'commander').map((c) => ({
        oracle_card_id: c.oracle_card_id, quantity: c.quantity,
        name: nameById.get(c.oracle_card_id) ?? null,
        set_code: printings.get(c.oracle_card_id)?.set_code ?? null,
        collector_number: printings.get(c.oracle_card_id)?.collector_number ?? null,
      })),
      main: cards.filter((c) => c.zone === 'main').map((c) => ({
        oracle_card_id: c.oracle_card_id, quantity: c.quantity,
        name: nameById.get(c.oracle_card_id) ?? null,
        set_code: printings.get(c.oracle_card_id)?.set_code ?? null,
        collector_number: printings.get(c.oracle_card_id)?.collector_number ?? null,
      })),
    }
  }

  const { data: job, error } = await s.from('mtg_simulation_jobs').insert({
    user_id: user.id,
    deck_a_id: deckA.id,
    deck_a_snapshot: deckSnap(deckA, cardsA, printA),
    deck_b_snapshot: deckSnap(deckB, cardsB, printB),
    format: deckA.format,
    engine: 'forge',
    engine_version: FORGE_RELEASE,
    seed,
    requested_iterations: iterations,
    timeout_sec: timeoutSec,
    status: 'queued',
  }).select().single()
  if (error || !job) return NextResponse.json({ error: 'enqueue_failed', reason: error?.message }, { status: 500 })

  // Publish a durable trigger. Vercel Queue is the preferred path
  // (retries + at-least-once delivery). If the queue send fails
  // (SDK error, project not yet queue-enabled), fall back to
  // waitUntil() which fires-and-forgets the worker HTTP call within
  // the Function's lifetime. In both cases the atomic-claim RPC on
  // the worker side is idempotent so duplicate delivery is safe.
  const queueResult = await publishSimulationJob(job.id)
  if (queueResult.ok !== true) {
    console.warn('rules-aware queue publish failed, using waitUntil fallback:', (queueResult as any).error)
    const workerUrl = process.env.RULES_WORKER_URL
    const workerSecret = process.env.WORKER_TRIGGER_SECRET
    if (workerUrl && workerSecret) {
      waitUntil(
        fetch(`${workerUrl.replace(/\/$/, '')}/consume`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'x-worker-secret': workerSecret },
          body: JSON.stringify({ job_id: job.id }),
          signal: AbortSignal.timeout(250_000),
        }).catch((err) => console.error('waitUntil fetch to worker failed:', err?.message))
      )
    } else {
      console.error('waitUntil fallback disabled, RULES_WORKER_URL or WORKER_TRIGGER_SECRET not set')
    }
  }

  return NextResponse.json({
    job,
    transport: queueResult.ok ? { via: 'queue', messageId: queueResult.messageId } : { via: 'wait_until_fallback' },
  }, { status: 202 })
}

async function printingsFor(oracleIds: string[]): Promise<Map<string, any>> {
  const out = new Map<string, any>()
  if (oracleIds.length === 0) return out
  const s = getSupabaseServiceClient()
  const IN_CHUNK = 60
  for (let i = 0; i < oracleIds.length; i += IN_CHUNK) {
    const chunk = oracleIds.slice(i, i + IN_CHUNK)
    const { data } = await s.from('mtg_printings')
      .select('oracle_card_id, set_code, collector_number, released_at')
      .in('oracle_card_id', chunk)
      .eq('lang', 'en')
      .eq('digital', false)
      .order('released_at', { ascending: false, nullsFirst: false })
    for (const p of (data ?? []) as any[]) if (!out.has(p.oracle_card_id)) out.set(p.oracle_card_id, p)
  }
  return out
}
