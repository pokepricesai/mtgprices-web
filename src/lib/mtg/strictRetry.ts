// src/lib/mtg/strictRetry.ts
//
// Shared retry primitive for the MTG strict data helpers that back
// cacheable routes (/set/[setCode], /formats/[key], /market,
// /set/[setCode]/card/[cardSlug]). The non-strict helpers continue
// to fail-closed to null/[]/0 for tolerant callers (homepage,
// AI tools) — the strict variants wrap each required Supabase stage
// through runStrictQueryWithRetry so a transient infra blip cannot
// be memorialised in the Full Route Cache as "no data" / 404 /
// partial pricing / empty history.
//
// Older strict helpers (listPrintingsForSetStrict in cards.ts,
// getFormat*Strict in formats.ts, getMarketMoversStrict in movers.ts)
// predate this shared module and keep their local retry loops
// unchanged. Deliberately not refactoring them in this ticket to
// keep the Phase 2 diff scoped to the card-page work.

import 'server-only'

export const STRICT_MAX_ATTEMPTS = 3
export const STRICT_BACKOFF_MS = [100, 200, 400] as const

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms))

export type StrictAttempt<T> = { ok: true; value: T } | { ok: false; error: unknown }

export function strictErrorMessage(e: unknown): string {
  if (e instanceof Error) return e.message
  if (typeof e === 'object' && e !== null && 'message' in e) {
    return String((e as { message: unknown }).message)
  }
  return String(e)
}

/** Run `runQuery` up to STRICT_MAX_ATTEMPTS times with bounded
 *  backoff between attempts. `runQuery` must resolve to
 *  `{ ok: true, value }` on success or `{ ok: false, error }` on a
 *  retryable failure. A thrown exception also counts as a retryable
 *  failure. After the last attempt the function throws with the
 *  provided label + last error message. */
export async function runStrictQueryWithRetry<T>(
  label: string,
  runQuery: () => Promise<StrictAttempt<T>>,
): Promise<T> {
  let lastError: unknown = null
  for (let attempt = 1; attempt <= STRICT_MAX_ATTEMPTS; attempt++) {
    try {
      const r = await runQuery()
      if (r.ok) return r.value
      lastError = (r as { ok: false; error: unknown }).error
      console.warn(`[${label}] attempt=${attempt}/${STRICT_MAX_ATTEMPTS} error: ${strictErrorMessage(lastError)}`)
    } catch (e) {
      lastError = e
      console.warn(`[${label}] attempt=${attempt}/${STRICT_MAX_ATTEMPTS} threw: ${strictErrorMessage(e)}`)
    }
    if (attempt < STRICT_MAX_ATTEMPTS) await sleep(STRICT_BACKOFF_MS[attempt - 1])
  }
  throw new Error(`${label}: failed after ${STRICT_MAX_ATTEMPTS} attempts: ${strictErrorMessage(lastError)}`)
}
