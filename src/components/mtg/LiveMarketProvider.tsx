'use client'

// src/components/mtg/LiveMarketProvider.tsx
//
// Phase 1 of the MTG card-page freshness architecture: a tiny client
// provider that lets the structural card page HTML live on a long ISR
// TTL while user-visible prices refresh independently through a
// CDN-cached public endpoint.
//
// How it works
// ────────────────────────────────────────────────────────────────────
// The server page renders every price panel server-side with the data
// returned by its usual strict helpers — this HTML is the SEO snapshot
// and the fallback. This provider wraps those panels. On mount it
// fetches `/api/mtg/card/[oracleId]/live?...` once, and on success
// publishes the fresh data through React context.
//
// Consuming panels (CardMarketOverview, GradedPricesPanel,
// PrintingComparison, CardPageClient) call `useLiveMarket()` and
// prefer live data when present, otherwise fall back to their props.
// Initial context value is `null`, so first-paint and hydration both
// use the server-rendered props → no hydration mismatch, no CLS.
//
// Failure semantics
// ────────────────────────────────────────────────────────────────────
// - fetch rejects (network error, abort on nav): keep snapshot.
// - 5xx (strict helper threw): endpoint returns no-store so the CDN
//   does not pin it, and we keep the snapshot.
// - 200 with `marketSummary: null` is a legitimate factual zero and
//   is adopted (same semantics as the server render).
//
// This provider must stay side-effect-light. It does not pre-fetch,
// it does not retry, and it does not swallow errors silently in a
// way that masks real issues — a failed fetch is logged to the
// console but the UI stays correct because the snapshot is still
// visible.

import { createContext, useContext, useEffect, useState, type ReactNode } from 'react'
import type { CardMarketSummary } from '@/lib/mtg/card-market.types'
import type { TcgPrintingBundle } from '@/lib/tcggraph/read-model'
import type { CurrentPriceRow } from '@/app/set/[setCode]/card/[cardSlug]/CardPageClient'

export type LiveMarketSnapshot = {
  currentPricesByFinish: Record<string, CurrentPriceRow[]>
  marketSummary: CardMarketSummary | null
  tcgBundle: TcgPrintingBundle | null
} | null

const LiveMarketContext = createContext<LiveMarketSnapshot>(null)

export function useLiveMarket(): LiveMarketSnapshot {
  return useContext(LiveMarketContext)
}

type Props = {
  oracleId: string
  printingId: string
  finishIds: string[]
  children: ReactNode
}

export function LiveMarketProvider({ oracleId, printingId, finishIds, children }: Props) {
  const [snapshot, setSnapshot] = useState<LiveMarketSnapshot>(null)

  const finishIdsKey = finishIds.join(',')

  useEffect(() => {
    const abort = new AbortController()
    const qs = new URLSearchParams({ printingId })
    if (finishIdsKey) qs.set('finishIds', finishIdsKey)
    const url = `/api/mtg/card/${encodeURIComponent(oracleId)}/live?${qs.toString()}`

    fetch(url, { signal: abort.signal, credentials: 'omit' })
      .then((r) => {
        if (!r.ok) return null
        return r.json() as Promise<{
          currentPricesByFinish?: Record<string, CurrentPriceRow[]>
          marketSummary?: CardMarketSummary | null
          tcgBundle?: TcgPrintingBundle | null
        }>
      })
      .then((body) => {
        if (!body) return
        setSnapshot({
          currentPricesByFinish: body.currentPricesByFinish ?? {},
          marketSummary: body.marketSummary ?? null,
          tcgBundle: body.tcgBundle ?? null,
        })
      })
      .catch((err: unknown) => {
        if (err instanceof Error && err.name === 'AbortError') return
        // Keep the server snapshot visible. Logging only.
        // eslint-disable-next-line no-console
        console.warn('[LiveMarketProvider] live refresh failed, keeping snapshot:', err)
      })

    return () => abort.abort()
  }, [oracleId, printingId, finishIdsKey])

  return (
    <LiveMarketContext.Provider value={snapshot}>
      {children}
    </LiveMarketContext.Provider>
  )
}
