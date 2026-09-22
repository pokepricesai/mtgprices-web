// src/app/api/cron/tcggraph-refresh/route.ts
//
// Production TCGGraph refresh cron endpoint. Slice 5.
//
// Contract:
//   * Requires Authorization: Bearer <CRON_SECRET>. Fails closed if
//     CRON_SECRET is not set on the server (HTTP 500).
//   * Requires TCGGRAPH_CRON_ENABLED=true. Default returns HTTP 202
//     { reason: 'cron_disabled' } so operators can wire the cron in
//     Vercel and flip it on later without a redeploy.
//   * Requires ?game=<slug> matching SCHEDULED_ALLOWLIST. Currently
//     Slice 5 launch scope = { 'one-piece', 'disney-lorcana' }. MTG
//     and YGO are deliberately rejected here; they are refreshed by
//     manual CLI runs until a future slice adds them.
//   * Invokes the shared refresh implementation at
//     src/lib/tcggraph/refresh.mjs (same one the CLI uses).
//   * Returns telemetry: status, run id, credits used / remaining,
//     pages, rows, stop reason.
//
// runtime = 'nodejs' because @supabase/supabase-js writes need the
// full Node runtime and the refresh reads .mjs helpers. maxDuration
// 300 covers the 30-40s each of Lorcana / One Piece takes with
// generous safety margin.

import 'server-only'
import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'
import { getSupabase, SCHEDULED_ALLOWLIST } from '@/lib/tcggraph/ingest-core.mjs'
import { refreshCatalogue } from '@/lib/tcggraph/refresh.mjs'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 300

function unauthorized() { return NextResponse.json({ ok: false, reason: 'unauthorized' }, { status: 401 }) }

export async function GET(req: NextRequest | Request) {
  const cronSecret = (process.env.CRON_SECRET ?? '').trim()
  if (!cronSecret) return NextResponse.json({ ok: false, reason: 'cron_secret_not_set' }, { status: 500 })
  const auth = req.headers.get('authorization')
  if (auth !== `Bearer ${cronSecret}`) return unauthorized()

  const enabled = (process.env.TCGGRAPH_CRON_ENABLED ?? 'false').trim() === 'true'
  if (!enabled) {
    return NextResponse.json({
      ok: false, reason: 'cron_disabled',
      note: 'set TCGGRAPH_CRON_ENABLED=true in Vercel Production to enable',
    }, { status: 202 })
  }

  const url = new URL(req.url)
  const gameSlug = (url.searchParams.get('game') ?? '').trim()
  if (!gameSlug) {
    return NextResponse.json({
      ok: false, reason: 'missing_game_param',
      allowed: Object.keys(SCHEDULED_ALLOWLIST),
    }, { status: 400 })
  }
  const allowed = Object.prototype.hasOwnProperty.call(SCHEDULED_ALLOWLIST, gameSlug)
  if (!allowed) {
    return NextResponse.json({
      ok: false, reason: 'game_not_scheduled',
      game: gameSlug,
      allowed: Object.keys(SCHEDULED_ALLOWLIST),
      hint: 'MTG and YGO are refreshed manually in Slice 5 - bump SCHEDULED_ALLOWLIST when ready',
    }, { status: 400 })
  }

  // Actual refresh. All heavy lifting lives in the shared library.
  let result
  try {
    const sb = getSupabase()
    result = await refreshCatalogue({
      gameSlug, sb, source: 'cron',
      // Cron always uses production reserves. CLI bootstraps override
      // to smaller values.
      preflightCredits: true,
    })
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    return NextResponse.json({ ok: false, reason: 'exception', game: gameSlug, error: message }, { status: 500 })
  }

  const httpStatus =
    result.status === 'success'         ? 200
    : result.status === 'partial'        ? 200
    : result.status === 'aborted_credit' ? 202
    : result.status === 'skipped_credit' ? 202
    : result.status === 'skipped_lock'   ? 202
    : 500

  return NextResponse.json({
    ok: result.status === 'success' || result.status === 'partial' || result.status === 'aborted_credit' || result.status === 'skipped_credit' || result.status === 'skipped_lock',
    ...result,
  }, { status: httpStatus })
}
