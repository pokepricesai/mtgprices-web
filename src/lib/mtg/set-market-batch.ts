// src/lib/mtg/set-market-batch.ts
// Server-only. Batched set-level pricing for the /browse directory.
// Returns per-set aggregates so tiles can show estimated value, priced
// coverage, 30D change and the most valuable card without N per-set
// round-trips.
//
// Methodology matches src/lib/mtg/set-market.ts exactly:
//   set_value = sum over English paper printings in the set of
//               the cheapest nonfoil basis price (fallback: any finish).
//
// The implementation trades one query per major table (printings,
// finishes, current prices, sets, 30D observations) instead of one per
// set. On the current DB this fits well under a second even for the
// full 800-set list.

import 'server-only'
import { getSupabaseServiceClient } from '@/lib/supabaseService'
import type { MarketBasis } from './card-market.types'
import { DEFAULT_BASIS } from './card-market'

export type SetAggregate = {
  set_code: string
  totalPrinted: number
  totalPriced: number
  estimatedValue: number
  pct30d: number | null           // 30D change of estimated value (null when history is too sparse)
  abs30d: number | null
  topCardName: string | null
  topCardPrice: number | null
}

// Bound the number of set codes we score per call so a rogue query
// cannot degrade the whole page. The /browse route already caps sets
// at 800.
const MAX_SETS = 1200
const IN_CHUNK = 200

export async function getSetAggregates(
  setCodes: string[],
  basis: MarketBasis = DEFAULT_BASIS,
): Promise<Map<string, SetAggregate>> {
  const out = new Map<string, SetAggregate>()
  if (!setCodes.length) return out
  const codes = setCodes.slice(0, MAX_SETS)
  const supabase = getSupabaseServiceClient()

  // Fast path: single Postgres RPC that computes everything server-side.
  // Falls back to the batched pipeline below if the RPC is not deployed
  // yet (see migrations/2026-09-18-mtg-set-aggregates-rpc.sql).
  try {
    const { data: rpcRows, error: rpcErr } = await supabase.rpc('mtg_set_aggregates', {
      p_set_codes: codes,
      p_provider: basis.provider,
      p_currency: basis.currency,
      p_market: basis.market,
      p_price_type: basis.priceType,
    })
    if (!rpcErr && Array.isArray(rpcRows)) {
      for (const row of rpcRows as any[]) {
        out.set(row.set_code, {
          set_code: row.set_code,
          totalPrinted: Number(row.total_printed) || 0,
          totalPriced: Number(row.total_priced) || 0,
          estimatedValue: Number(row.estimated_value) || 0,
          pct30d: row.pct_30d === null || row.pct_30d === undefined ? null : Number(row.pct_30d),
          abs30d: row.abs_30d === null || row.abs_30d === undefined ? null : Number(row.abs_30d),
          topCardName: row.top_card_name ?? null,
          topCardPrice: row.top_card_price === null || row.top_card_price === undefined ? null : Number(row.top_card_price),
        })
      }
      for (const code of codes) if (!out.has(code)) out.set(code, emptyAggregate(code))
      return out
    }
    // Silently fall through when the RPC is not present. `PGRST202`
    // is PostgREST's "function not found" code; anything else we log so
    // we can spot a broken migration.
    if (rpcErr && rpcErr.code && rpcErr.code !== 'PGRST202') {
      console.warn('mtg_set_aggregates RPC error, falling back to batched impl:', rpcErr.code, rpcErr.message)
    }
  } catch (err) {
    console.warn('mtg_set_aggregates RPC threw, falling back to batched impl:', err)
  }

  // 1) All English paper printings across the set codes.
  const codeChunks: string[][] = []
  for (let i = 0; i < codes.length; i += IN_CHUNK) codeChunks.push(codes.slice(i, i + IN_CHUNK))
  const printingResults = await Promise.all(codeChunks.map((chunk) =>
    supabase
      .from('mtg_printings')
      .select('id, name, set_code')
      .in('set_code', chunk)
      .eq('digital', false)
      .eq('lang', 'en')
  ))
  type PrintRow = { id: string; name: string; set_code: string }
  const prints: PrintRow[] = []
  for (const { data } of printingResults) for (const row of (data ?? []) as any[]) prints.push(row)
  if (prints.length === 0) {
    for (const code of codes) out.set(code, emptyAggregate(code))
    return out
  }
  const printById = new Map<string, PrintRow>(prints.map((p) => [p.id, p]))
  const printedBySet = new Map<string, number>()
  for (const p of prints) printedBySet.set(p.set_code, (printedBySet.get(p.set_code) ?? 0) + 1)

  // 2) Finishes for those printings.
  const printingIds = prints.map((p) => p.id)
  const finishChunks: string[][] = []
  for (let i = 0; i < printingIds.length; i += IN_CHUNK) finishChunks.push(printingIds.slice(i, i + IN_CHUNK))
  const finishResults = await Promise.all(finishChunks.map((chunk) =>
    supabase.from('mtg_printing_finishes').select('id, printing_id, finish').in('printing_id', chunk)
  ))
  type FinishRow = { id: string; printing_id: string; finish: string }
  const finishes: FinishRow[] = []
  for (const { data } of finishResults) for (const row of (data ?? []) as any[]) finishes.push(row)
  if (finishes.length === 0) {
    for (const code of codes) out.set(code, { ...emptyAggregate(code), totalPrinted: printedBySet.get(code) ?? 0 })
    return out
  }
  const finishById = new Map<string, FinishRow>(finishes.map((f) => [f.id, f]))

  // 3) Current prices for all finishes on the basis.
  const finishIds = finishes.map((f) => f.id)
  const cpChunks: string[][] = []
  for (let i = 0; i < finishIds.length; i += IN_CHUNK) cpChunks.push(finishIds.slice(i, i + IN_CHUNK))
  const cpResults = await Promise.all(cpChunks.map((chunk) =>
    supabase.from('mtg_current_prices').select('printing_finish_id, price')
      .eq('provider', basis.provider).eq('currency', basis.currency)
      .eq('market', basis.market).eq('price_type', basis.priceType)
      .in('printing_finish_id', chunk)
  ))
  type CurrentRow = { printing_finish_id: string; price: number }
  type BasketEntry = { finish_id: string; finish: string; price: number }
  const cheapestNonfoilByPrinting = new Map<string, BasketEntry>()
  const cheapestAnyByPrinting = new Map<string, BasketEntry>()
  for (const { data } of cpResults) for (const row of (data ?? []) as any[]) {
    const cp = row as CurrentRow
    const f = finishById.get(cp.printing_finish_id); if (!f) continue
    const p = Number(cp.price); if (!Number.isFinite(p) || p <= 0) continue
    const entry: BasketEntry = { finish_id: f.id, finish: f.finish, price: p }
    const anyCur = cheapestAnyByPrinting.get(f.printing_id)
    if (!anyCur || p < anyCur.price) cheapestAnyByPrinting.set(f.printing_id, entry)
    if (f.finish === 'nonfoil') {
      const nfCur = cheapestNonfoilByPrinting.get(f.printing_id)
      if (!nfCur || p < nfCur.price) cheapestNonfoilByPrinting.set(f.printing_id, entry)
    }
  }
  // Basket: cheapest nonfoil, fall back to any finish.
  const basketByPrinting = new Map<string, BasketEntry>()
  for (const p of prints) {
    const chosen = cheapestNonfoilByPrinting.get(p.id) ?? cheapestAnyByPrinting.get(p.id)
    if (chosen) basketByPrinting.set(p.id, chosen)
  }

  // 4) 30D observations for exactly the basket finishes so we can
  // compute an estimated value 30 days ago (same basket composition).
  const basketFinishIds = Array.from(new Set(Array.from(basketByPrinting.values()).map((v) => v.finish_id)))
  const since = new Date(); since.setUTCDate(since.getUTCDate() - 30)
  const sinceIso = since.toISOString().slice(0, 10)
  const obsChunks: string[][] = []
  for (let i = 0; i < basketFinishIds.length; i += IN_CHUNK) obsChunks.push(basketFinishIds.slice(i, i + IN_CHUNK))
  const obsResults = await Promise.all(obsChunks.map((chunk) =>
    supabase.from('mtg_price_observations')
      .select('printing_finish_id, observed_on, price')
      .eq('provider', basis.provider).eq('currency', basis.currency)
      .eq('market', basis.market).eq('price_type', basis.priceType)
      .or('is_anomalous.is.null,is_anomalous.eq.false')
      .gte('observed_on', sinceIso).in('printing_finish_id', chunk)
  ))
  type Agg = { earliest: { d: string; p: number }; latest: { d: string; p: number } }
  const byFinish = new Map<string, Agg>()
  for (const { data } of obsResults) for (const row of (data ?? []) as any[]) {
    const id = row.printing_finish_id as string
    const d = row.observed_on as string
    const p = Number(row.price); if (!Number.isFinite(p) || p <= 0) continue
    const cur = byFinish.get(id)
    if (!cur) { byFinish.set(id, { earliest: { d, p }, latest: { d, p } }); continue }
    if (d < cur.earliest.d) cur.earliest = { d, p }
    if (d > cur.latest.d)   cur.latest   = { d, p }
  }

  // 5) Fold everything back per set.
  type SetBucket = {
    total: number
    priced: number
    value: number
    basketWithHistory: number      // count of basket finishes for which we have both earliest and latest 30D observations
    valueNow: number               // sum of latest observed prices for basket finishes with history
    valueThen: number              // sum of earliest observed prices for basket finishes with history
    top: { name: string; price: number } | null
  }
  const buckets = new Map<string, SetBucket>()
  for (const code of codes) buckets.set(code, {
    total: printedBySet.get(code) ?? 0,
    priced: 0, value: 0,
    basketWithHistory: 0, valueNow: 0, valueThen: 0,
    top: null,
  })

  for (const [printingId, basket] of Array.from(basketByPrinting.entries())) {
    const p = printById.get(printingId); if (!p) continue
    const b = buckets.get(p.set_code); if (!b) continue
    b.priced += 1
    b.value += basket.price
    if (!b.top || basket.price > b.top.price) b.top = { name: p.name, price: basket.price }
    const hist = byFinish.get(basket.finish_id)
    if (hist && hist.earliest.d !== hist.latest.d) {
      // Same basket composition. earliest and latest are on the same
      // printing_finish, so the basketed value comparison is like for
      // like.
      b.basketWithHistory += 1
      b.valueNow += hist.latest.p
      b.valueThen += hist.earliest.p
    }
  }

  for (const [code, b] of Array.from(buckets.entries())) {
    // Only surface a set-level 30D pct if a substantial share of the
    // basket has usable history. Otherwise the ratio would be dominated
    // by a handful of movers rather than describing the set.
    const coverage = b.priced > 0 ? b.basketWithHistory / b.priced : 0
    const enoughHistory = b.basketWithHistory >= 5 && coverage >= 0.4
    const pct30d = enoughHistory && b.valueThen > 0 ? (b.valueNow - b.valueThen) / b.valueThen : null
    const abs30d = enoughHistory ? round2(b.valueNow - b.valueThen) : null
    out.set(code, {
      set_code: code,
      totalPrinted: b.total,
      totalPriced: b.priced,
      estimatedValue: round2(b.value),
      pct30d,
      abs30d,
      topCardName: b.top?.name ?? null,
      topCardPrice: b.top ? round2(b.top.price) : null,
    })
  }

  // Make sure we returned an entry for every input, even if empty.
  for (const code of codes) if (!out.has(code)) out.set(code, emptyAggregate(code))
  return out
}

function emptyAggregate(code: string): SetAggregate {
  return {
    set_code: code, totalPrinted: 0, totalPriced: 0, estimatedValue: 0,
    pct30d: null, abs30d: null, topCardName: null, topCardPrice: null,
  }
}
function round2(n: number): number { return Math.round(n * 100) / 100 }
