// app/api/decks/[id]/simulate/rules-aware/route.ts
//
// Owner-only enqueue endpoint. Creates a mtg_simulation_jobs row and
// returns its id. A separate worker (the Forge Simulation Mode
// container) is expected to poll the queue and populate `result`.
//
// Feature-gated: 503 unless RULES_ENGINE_ENDPOINT is set. This
// mirrors the AI_BUILD_ENABLED pattern from earlier phases.

import { NextResponse, type NextRequest } from 'next/server'
import { getCurrentUser } from '@/lib/supabase/server'
import { getSupabaseServiceClient } from '@/lib/supabaseService'
import { getDeckById, getDeckCards } from '@/lib/mtg/decks'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

// Initial pre-launch limits per Luke's directive.
const MAX_ITERATIONS_PER_JOB = Number(process.env.RULES_MAX_ITERATIONS_PER_JOB ?? 100)
const MAX_JOBS_PER_USER_PER_DAY = Number(process.env.RULES_MAX_JOBS_PER_USER_PER_DAY ?? 3)

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  if (!process.env.RULES_ENGINE_ENDPOINT) {
    return NextResponse.json({ error: 'rules_engine_disabled' }, { status: 503 })
  }
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
  const timeoutSec = Math.max(30, Math.min(600, Number(body.timeout_sec ?? 120) | 0))

  // Load the opponent deck (must also be owned by this user for now —
  // opposing-archetype decks come later).
  const deckB = await getDeckById(opponentDeckId)
  if (!deckB || deckB.user_id !== user.id) return NextResponse.json({ error: 'opponent_not_found' }, { status: 404 })
  if (deckB.format !== deckA.format) return NextResponse.json({ error: 'format_mismatch' }, { status: 400 })

  // Rate limit — count non-cancelled jobs in the last 24h.
  const s = getSupabaseServiceClient()
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString()
  const { count } = await s.from('mtg_simulation_jobs')
    .select('id', { count: 'exact', head: true })
    .eq('user_id', user.id)
    .neq('status', 'cancelled')
    .gte('created_at', since)
  if ((count ?? 0) >= MAX_JOBS_PER_USER_PER_DAY) {
    return NextResponse.json({ error: 'rate_limited', reason: 'daily_job_cap', used: count, cap: MAX_JOBS_PER_USER_PER_DAY }, { status: 429 })
  }

  // Snapshot both decks so the job survives edits.
  const [cardsA, cardsB] = await Promise.all([getDeckCards(deckA.id), getDeckCards(deckB.id)])
  const deckSnap = (deck: any, cards: any[]) => ({
    id: deck.id, name: deck.name, format: deck.format,
    commanders: cards.filter((c) => c.zone === 'commander').map((c) => ({ oracle_card_id: c.oracle_card_id, quantity: c.quantity })),
    main: cards.filter((c) => c.zone === 'main').map((c) => ({ oracle_card_id: c.oracle_card_id, quantity: c.quantity })),
  })

  const { data: job, error } = await s.from('mtg_simulation_jobs').insert({
    user_id: user.id,
    deck_a_id: deckA.id,
    deck_a_snapshot: deckSnap(deckA, cardsA),
    deck_b_snapshot: deckSnap(deckB, cardsB),
    format: deckA.format,
    engine: 'forge',
    engine_version: process.env.RULES_ENGINE_VERSION ?? 'forge-2.0.14',
    seed,
    requested_iterations: iterations,
    timeout_sec: timeoutSec,
    status: 'queued',
  }).select().single()
  if (error || !job) return NextResponse.json({ error: 'enqueue_failed', reason: error?.message }, { status: 500 })

  return NextResponse.json({ job }, { status: 202 })
}
