// src/app/api/cron/tcggraph-refresh/route.ts
//
// Production TCGGraph refresh cron endpoint.
//
// Contract:
//   * Requires Authorization: Bearer <CRON_SECRET>. Fails closed if
//     CRON_SECRET is not set on the server (HTTP 500).
//   * TCGGRAPH_CRON_ENABLED is a kill-switch. Defaults to enabled;
//     explicit 'false' returns HTTP 202 { reason: 'cron_disabled' }.
//   * Requires ?game=<slug> matching SCHEDULED_ALLOWLIST.
//   * Optional ?maxPages=N caps the per-invocation page count so the
//     refresh fits inside Vercel's function ceiling. MTG's ~1 060-page
//     catalogue does not fit in a single invocation; the every-other-
//     day schedule burst-fires 3-4 staggered crons per day, each
//     lock-serialised, so a full sweep completes within the 48h window.
//   * Optional ?continue=1 tells the endpoint to look up the most
//     recent 'partial' run for this game_id and resume from its
//     last_page+1. If the last run was 'success' (catalogue_exhausted)
//     the invocation is a no-op returning HTTP 202 skipped_up_to_date -
//     idempotent, no duplicate work.
//   * Invokes the shared refresh implementation at
//     src/lib/tcggraph/refresh.mjs (same one the CLI uses).
//   * Returns telemetry: status, run id, credits used / remaining,
//     pages, rows, stop reason, fromPage/maxPages actually used.
//
// runtime = 'nodejs' because @supabase/supabase-js writes need the
// full Node runtime and the refresh reads .mjs helpers. maxDuration
// 900 (Vercel Pro ceiling) gives large catalogues (MTG) real headroom;
// Lorcana / One Piece still finish in <60 s.

import 'server-only'
import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'
import { getSupabase, SCHEDULED_ALLOWLIST, SUPPORTED_GAMES } from '@/lib/tcggraph/ingest-core.mjs'
import { refreshCatalogue } from '@/lib/tcggraph/refresh.mjs'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 900

//  Freshness gate for ?continue=1. A 'success' run within the last
//  FRESH_HOURS is considered still-current and continue-mode returns a
//  no-op. Older successes mean it is time to start a new sweep.
const CONTINUE_FRESH_HOURS = 40

function unauthorized() { return NextResponse.json({ ok: false, reason: 'unauthorized' }, { status: 401 }) }

export async function GET(req: NextRequest | Request) {
  const cronSecret = (process.env.CRON_SECRET ?? '').trim()
  if (!cronSecret) return NextResponse.json({ ok: false, reason: 'cron_secret_not_set' }, { status: 500 })
  const auth = req.headers.get('authorization')
  if (auth !== `Bearer ${cronSecret}`) return unauthorized()

  //  Kill-switch. Defaults to enabled (post-Slice 5). Set
  //  TCGGRAPH_CRON_ENABLED='false' explicitly if the pipeline needs to
  //  be paused without a redeploy.
  const disabled = (process.env.TCGGRAPH_CRON_ENABLED ?? '').trim().toLowerCase() === 'false'
  if (disabled) {
    return NextResponse.json({
      ok: false, reason: 'cron_disabled',
      note: 'TCGGRAPH_CRON_ENABLED=false is set in the environment - unset it to resume',
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
      hint: 'Add the slug to SCHEDULED_ALLOWLIST in src/lib/tcggraph/ingest-core.mjs to enable it.',
    }, { status: 400 })
  }

  //  Chunk + resume plumbing. maxPages caps this invocation. continue=1
  //  turns this invocation into a "resume from last partial" shard.
  const maxPagesRaw = url.searchParams.get('maxPages')
  const maxPages = maxPagesRaw && /^\d+$/.test(maxPagesRaw) ? Math.max(1, Math.min(2000, Number(maxPagesRaw))) : Infinity
  const continueMode = url.searchParams.get('continue') === '1'
  let fromPage = 1
  let resumeInfo: { last_page: number | null; run_id: string | null; status: string | null; finished_at: string | null } | null = null
  const sb = getSupabase()
  if (continueMode) {
    const gameId = (SUPPORTED_GAMES as Record<string, string>)[gameSlug]
    if (gameId) {
      const { data } = await sb.from('tcg_ingest_runs')
        .select('id, status, finished_at, notes')
        .eq('game_id', gameId).eq('resource', 'cards.full')
        .order('started_at', { ascending: false }).limit(1).maybeSingle()
      if (data) {
        const notes = (data.notes ?? {}) as { last_page?: number; stop_reason?: string }
        resumeInfo = {
          last_page: typeof notes.last_page === 'number' ? notes.last_page : null,
          run_id: data.id,
          status: data.status,
          finished_at: data.finished_at,
        }
        //  If the last run was a successful full sweep within the fresh
        //  window, do nothing. Idempotent no-op.
        const finishedAt = data.finished_at ? Date.parse(data.finished_at) : NaN
        const freshEnough = Number.isFinite(finishedAt) && (Date.now() - finishedAt) < CONTINUE_FRESH_HOURS * 3600_000
        const wasComplete = data.status === 'success' && (notes.stop_reason === 'catalogue_exhausted' || notes.stop_reason === 'no_more_data')
        if (wasComplete && freshEnough) {
          return NextResponse.json({
            ok: true, reason: 'skipped_up_to_date',
            game: gameSlug, resumeInfo,
            note: `most recent success finished at ${data.finished_at}; nothing to resume`,
          }, { status: 202 })
        }
        //  Partial or stale success -> pick up from last_page+1 (or from
        //  page 1 if we do not have a checkpoint).
        if (data.status === 'partial' && typeof notes.last_page === 'number' && notes.last_page > 0) {
          fromPage = notes.last_page + 1
        }
      }
    }
  }

  // Actual refresh. All heavy lifting lives in the shared library.
  let result
  try {
    result = await refreshCatalogue({
      gameSlug, sb, source: 'cron',
      fromPage,
      maxPages,
      // Cron always uses production reserves. CLI bootstraps override
      // to smaller values.
      preflightCredits: true,
    })
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    return NextResponse.json({ ok: false, reason: 'exception', game: gameSlug, error: message, fromPage, maxPages: maxPages === Infinity ? null : maxPages }, { status: 500 })
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
    fromPage,
    maxPagesRequested: maxPages === Infinity ? null : maxPages,
    resumeInfo,
    ...result,
  }, { status: httpStatus })
}
