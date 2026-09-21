// src/lib/tcggraph/read-model.ts
// Server-only helpers that let MTG-side code ask the network layer:
//   "For this mtg_printings.id, what does TCGGraph know?"
// Returns:
//   - the tcg_printings row
//   - current market rows (TCGGraph-sourced; separate from mtg_current_prices)
//   - current graded rows
//   - most recent observation date
//
// The MTG public UI is NOT changed in Slice 2. This module is the
// contract the future graded panel and Slice-3 admin surfaces will
// consume. Wire it up in a later slice.

import 'server-only'
import { getSupabaseServiceClient } from '@/lib/supabaseService'

export type TcgMarketRow = {
  tcg_printing_id: string
  source: string
  list_type: string
  region: string | null
  currency: string
  finish: string | null
  price: number | null
  price_low: number | null
  price_trend: number | null
  avg_1d: number | null
  avg_7d: number | null
  avg_30d: number | null
  updated_at: string | null
}

export type TcgGradedRow = {
  tcg_printing_id: string
  grader: string
  grade: string
  currency: string
  price: number
  card_sales_volume: number | null
  updated_at: string | null
}

export type TcgPrintingBundle = {
  mtgPrintingId: string
  tcgPrintings: Array<{ id: string; tcggraph_card_id: string; tcggraph_printing_key: string; finish: string | null; mapping_confidence: string }>
  market: TcgMarketRow[]
  graded: TcgGradedRow[]
  latestObservationDate: string | null
}

/** Look up everything TCGGraph knows about a specific
 *  mtg_printings.id. Returns null when no tcg_printings row exists
 *  (mapping not yet bootstrapped OR truly unmapped). */
export async function getTcgBundleForMtgPrinting(mtgPrintingId: string): Promise<TcgPrintingBundle | null> {
  const sb = getSupabaseServiceClient()
  const { data: prints } = await sb
    .from('tcg_printings')
    .select('id, tcggraph_card_id, tcggraph_printing_key, finish, mapping_confidence')
    .eq('mtg_printings_id', mtgPrintingId)
  if (!prints || prints.length === 0) return null
  const ids = prints.map((p) => p.id)
  const [{ data: market }, { data: graded }, { data: latest }] = await Promise.all([
    sb.from('tcg_market_prices_current').select('*').in('tcg_printing_id', ids),
    sb.from('tcg_graded_prices_current').select('*').in('tcg_printing_id', ids),
    sb.from('tcg_market_price_daily').select('observed_on').in('tcg_printing_id', ids).order('observed_on', { ascending: false }).limit(1),
  ])
  return {
    mtgPrintingId,
    tcgPrintings: prints as TcgPrintingBundle['tcgPrintings'],
    market: (market ?? []) as TcgMarketRow[],
    graded: (graded ?? []) as TcgGradedRow[],
    latestObservationDate: (latest?.[0] as { observed_on?: string } | undefined)?.observed_on ?? null,
  }
}

/** Convenience: batch version for a page of MTG printings. */
export async function getTcgBundlesForMtgPrintings(mtgPrintingIds: string[]): Promise<Map<string, TcgPrintingBundle>> {
  const out = new Map<string, TcgPrintingBundle>()
  if (mtgPrintingIds.length === 0) return out
  const sb = getSupabaseServiceClient()
  const { data: prints } = await sb
    .from('tcg_printings')
    .select('id, mtg_printings_id, tcggraph_card_id, tcggraph_printing_key, finish, mapping_confidence')
    .in('mtg_printings_id', mtgPrintingIds)
  if (!prints || prints.length === 0) return out
  const printsByMtg = new Map<string, typeof prints>()
  for (const p of prints) {
    if (!p.mtg_printings_id) continue
    const arr = printsByMtg.get(p.mtg_printings_id) ?? []
    arr.push(p)
    printsByMtg.set(p.mtg_printings_id, arr)
  }
  const allTcgIds = prints.map((p) => p.id)
  const [{ data: market }, { data: graded }] = await Promise.all([
    sb.from('tcg_market_prices_current').select('*').in('tcg_printing_id', allTcgIds),
    sb.from('tcg_graded_prices_current').select('*').in('tcg_printing_id', allTcgIds),
  ])
  const marketByTcg  = new Map<string, TcgMarketRow[]>()
  const gradedByTcg  = new Map<string, TcgGradedRow[]>()
  for (const m of (market ?? []) as TcgMarketRow[]) {
    const arr = marketByTcg.get(m.tcg_printing_id) ?? []; arr.push(m); marketByTcg.set(m.tcg_printing_id, arr)
  }
  for (const g of (graded ?? []) as TcgGradedRow[]) {
    const arr = gradedByTcg.get(g.tcg_printing_id) ?? []; arr.push(g); gradedByTcg.set(g.tcg_printing_id, arr)
  }
  for (const mtgId of mtgPrintingIds) {
    const prs = printsByMtg.get(mtgId) ?? []
    if (prs.length === 0) continue
    const m = prs.flatMap((p) => marketByTcg.get(p.id) ?? [])
    const g = prs.flatMap((p) => gradedByTcg.get(p.id) ?? [])
    out.set(mtgId, {
      mtgPrintingId: mtgId,
      tcgPrintings: prs.map((p) => ({ id: p.id, tcggraph_card_id: p.tcggraph_card_id, tcggraph_printing_key: p.tcggraph_printing_key, finish: p.finish, mapping_confidence: p.mapping_confidence })),
      market: m, graded: g,
      latestObservationDate: null,     // caller can add if needed
    })
  }
  return out
}
