// src/app/api/cron/tcggraph-refresh/route.ts
//
// TCGGraph refresh cron endpoint. Targeted refresh only. The
// Network Admin will drive game/set/kind selection via query params.
// This route stays IDLE unless BOTH:
//   TCGGRAPH_CRON_ENABLED=true
//   Authorization: Bearer <CRON_SECRET>
// are set. Default is disabled; Vercel Cron gets HTTP 202
// {reason:'cron_disabled'} until an operator explicitly enables it.
//
// Query params (all optional):
//   ?game=mtg|yugioh|one-piece|star-wars-unlimited
//   ?set=<code>                   // scoped-set refresh
//   ?kind=full|new-sets|set       // 'set' requires ?set=
//   ?max-pages=N                  // safety cap; default 5 000 (very generous)
//
// Never activates the actual TCGGraph API call from this handler in
// Slice 3. That is intentional: this endpoint EXISTS as production
// infrastructure but the ingest is invoked via the same reusable
// scripts/lib/tcggraph-ingest.mjs library the bootstrap uses. When
// operator wiring is ready in Slice 4+, this handler will delegate
// to a server-side worker (Vercel Function w/ maxDuration).

import { NextResponse } from 'next/server'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 60

function unauthorized() {
  return NextResponse.json({ ok: false, reason: 'unauthorized' }, { status: 401 })
}

export async function GET(req: Request) {
  // Cron auth: shared secret matches CRON_SECRET.
  const cronSecret = (process.env.CRON_SECRET ?? '').trim()
  if (!cronSecret) return NextResponse.json({ ok: false, reason: 'cron_secret_not_set' }, { status: 500 })
  const auth = req.headers.get('authorization')
  if (auth !== `Bearer ${cronSecret}`) return unauthorized()

  // Feature flag: cron must be explicitly enabled AFTER Slice 3 review.
  const enabled = (process.env.TCGGRAPH_CRON_ENABLED ?? 'false').trim() === 'true'
  if (!enabled) {
    return NextResponse.json({
      ok: false,
      reason: 'cron_disabled',
      note: 'set TCGGRAPH_CRON_ENABLED=true in Vercel Production to enable',
    }, { status: 202 })
  }

  // Once enabled, this handler will fan out to a server-side worker.
  // Left as an explicit acknowledgement here so nothing runs
  // accidentally on the current invocation.
  const url = new URL(req.url)
  const game = url.searchParams.get('game')
  const set = url.searchParams.get('set')
  const kind = url.searchParams.get('kind') ?? 'full'
  return NextResponse.json({
    ok: true,
    accepted: true,
    scheduled: false,
    note: 'cron_enabled_but_worker_not_yet_wired',
    game, set, kind,
  }, { status: 202 })
}
