'use client'
// src/lib/mtg/useOwnedForOracle.ts
//
// Client-side hook that returns the signed-in viewer's owned
// printings for a given oracle card, via /api/collection/owned.
//
// Why a shared module-level cache: the card detail page renders both
// CardActionsStrip and PrintingComparison, and both need the same
// ownership payload. Without dedup each would fire its own request
// on every card view. The in-flight-promise + resolved-value Map
// keyed by oracleId ensures a single HTTP round-trip per oracle id
// per browser session (until navigation to another oracle resets
// which keys are hot).
//
// The API endpoint responds `Cache-Control: private, no-store` so the
// browser's HTTP cache does not share across viewers either way — the
// JS cache below only lives inside the current tab's memory.

import { useEffect, useState } from 'react'

export type OwnedItem = {
  printing_finish_id: string
  finish: string
  printing_id: string
  set_code: string
  collector_number: string | null
  quantity: number
  condition: string
}

export type OwnedForOracleState =
  | { status: 'loading'; items: OwnedItem[] }
  | { status: 'ready';   items: OwnedItem[] }
  | { status: 'error';   items: OwnedItem[] }

const inflight = new Map<string, Promise<OwnedItem[]>>()
const resolved = new Map<string, OwnedItem[]>()

function fetchOwned(oracleId: string): Promise<OwnedItem[]> {
  const cached = resolved.get(oracleId)
  if (cached) return Promise.resolve(cached)
  const pending = inflight.get(oracleId)
  if (pending) return pending
  const run = fetch(`/api/collection/owned?oracleId=${encodeURIComponent(oracleId)}`, {
    credentials: 'same-origin',
  })
    .then(async (r) => {
      if (!r.ok) throw new Error(`owned fetch status ${r.status}`)
      const payload = (await r.json()) as { items?: OwnedItem[] }
      const items = Array.isArray(payload.items) ? payload.items : []
      resolved.set(oracleId, items)
      return items
    })
    .finally(() => {
      // Drop the in-flight entry regardless of success/failure so a
      // future call can retry after a failure.
      inflight.delete(oracleId)
    })
  inflight.set(oracleId, run)
  return run
}

/** React hook: returns the viewer's owned printings for an oracle id.
 *  The initial render for a signed-out viewer resolves to an empty
 *  `items` array within one microtask (empty response from the API).
 *  Signed-in viewers' owned counts hydrate in once the fetch
 *  resolves (sub-second on a warm connection).
 *
 *  `oracleId=null` disables the hook (useful when the caller does
 *  not yet have the id). */
export function useOwnedForOracle(oracleId: string | null | undefined): OwnedForOracleState {
  const [state, setState] = useState<OwnedForOracleState>(() => {
    if (!oracleId) return { status: 'ready', items: [] }
    const cached = resolved.get(oracleId)
    return cached ? { status: 'ready', items: cached } : { status: 'loading', items: [] }
  })

  useEffect(() => {
    if (!oracleId) {
      setState({ status: 'ready', items: [] })
      return
    }
    const cached = resolved.get(oracleId)
    if (cached) {
      setState({ status: 'ready', items: cached })
      return
    }
    let cancelled = false
    setState({ status: 'loading', items: [] })
    fetchOwned(oracleId)
      .then((items) => { if (!cancelled) setState({ status: 'ready', items }) })
      .catch(() => { if (!cancelled) setState({ status: 'error', items: [] }) })
    return () => { cancelled = true }
  }, [oracleId])

  return state
}

/** Pure helpers so callers can derive the same shapes the server
 *  used to compute inline. Keeping these next to the hook so a
 *  future PrintingComparison or badge consumer has a single source
 *  of truth for the roll-up logic. */
export function sumOwnedByPrintingId(items: OwnedItem[]): Record<string, number> {
  const by: Record<string, number> = {}
  for (const row of items) {
    if (!row.printing_id) continue
    by[row.printing_id] = (by[row.printing_id] ?? 0) + (row.quantity ?? 0)
  }
  return by
}

export function sumOwnedTotal(items: OwnedItem[]): number {
  let total = 0
  for (const row of items) total += row.quantity ?? 0
  return total
}
