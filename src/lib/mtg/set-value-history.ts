// src/lib/mtg/set-value-history.ts
// Server-only. Set-level value trend series over 7 / 30 / 90 days.
//
// Methodology (kept transparent):
//   basket = for each English paper printing in the set, pick the
//            printing_finish that is currently the cheapest nonfoil
//            (fallback: any finish) on the caller's basis.
//   value(day) = sum over the basket of the earliest observation on or
//                after that day, up to the specified window. This keeps
//                the basket composition constant across the window so a
//                like-for-like comparison is possible.
//
// Missing observations are NOT treated as zero. When a basket entry has
// no observation on a given day the previous observed price is carried
// forward (step function). This is standard for illiquid daily prices.

import 'server-only'
import { getSupabaseServiceClient } from '@/lib/supabaseService'
import type { MarketBasis } from './card-market.types'
import { DEFAULT_BASIS } from './card-market'

const IN_CHUNK = 120
const MAX_DAYS = 90
const MIN_COVERAGE = 0.35        // require at least 35% of basket priced

export type SetValuePoint = { date: string; value: number; covered: number; total: number }

export type SetValueHistory = {
  basis: MarketBasis
  windowDays: number
  points: SetValuePoint[]
  currency: MarketBasis['currency']
  methodology: string
  basketSize: number
}

export async function getSetValueHistory(
  setCode: string,
  windowDays: 7 | 30 | 90 = 30,
  basis: MarketBasis = DEFAULT_BASIS,
): Promise<SetValueHistory | null> {
  const supabase = getSupabaseServiceClient()

  // 1) All printings in the set.
  const { data: printsRaw } = await supabase
    .from('mtg_printings')
    .select('id')
    .eq('set_code', setCode)
    .eq('digital', false)
    .eq('lang', 'en')
  const printingIds = ((printsRaw ?? []) as { id: string }[]).map((p) => p.id)
  if (printingIds.length === 0) return null

  // 2) Finishes for those printings.
  const finChunks: string[][] = []
  for (let i = 0; i < printingIds.length; i += IN_CHUNK) finChunks.push(printingIds.slice(i, i + IN_CHUNK))
  const finResults = await Promise.all(finChunks.map((chunk) =>
    supabase.from('mtg_printing_finishes').select('id, printing_id, finish').in('printing_id', chunk)
  ))
  type FinishRow = { id: string; printing_id: string; finish: string }
  const finishes: FinishRow[] = []
  for (const { data } of finResults) for (const row of (data ?? []) as any[]) finishes.push(row)
  if (finishes.length === 0) return null
  const finishById = new Map(finishes.map((f) => [f.id, f]))

  // 3) Current prices on the basis, per finish.
  const finishIds = finishes.map((f) => f.id)
  const cpChunks: string[][] = []
  for (let i = 0; i < finishIds.length; i += IN_CHUNK) cpChunks.push(finishIds.slice(i, i + IN_CHUNK))
  const cpResults = await Promise.all(cpChunks.map((chunk) =>
    supabase.from('mtg_current_prices').select('printing_finish_id, price')
      .eq('provider', basis.provider).eq('currency', basis.currency)
      .eq('market', basis.market).eq('price_type', basis.priceType)
      .in('printing_finish_id', chunk)
  ))
  type BasketEntry = { finish_id: string; finish: string; price: number }
  const cheapestNonfoilByPrinting = new Map<string, BasketEntry>()
  const cheapestAnyByPrinting = new Map<string, BasketEntry>()
  for (const { data } of cpResults) for (const row of (data ?? []) as any[]) {
    const f = finishById.get(row.printing_finish_id as string); if (!f) continue
    const p = Number(row.price); if (!Number.isFinite(p) || p <= 0) continue
    const entry: BasketEntry = { finish_id: f.id, finish: f.finish, price: p }
    const anyCur = cheapestAnyByPrinting.get(f.printing_id)
    if (!anyCur || p < anyCur.price) cheapestAnyByPrinting.set(f.printing_id, entry)
    if (f.finish === 'nonfoil') {
      const nfCur = cheapestNonfoilByPrinting.get(f.printing_id)
      if (!nfCur || p < nfCur.price) cheapestNonfoilByPrinting.set(f.printing_id, entry)
    }
  }
  const basketFinishIds: string[] = []
  for (const pid of printingIds) {
    const chosen = cheapestNonfoilByPrinting.get(pid) ?? cheapestAnyByPrinting.get(pid)
    if (chosen) basketFinishIds.push(chosen.finish_id)
  }
  if (basketFinishIds.length === 0) return null

  // 4) Observations for exactly those finishes over the window.
  const clamped = Math.min(windowDays, MAX_DAYS)
  const since = new Date(); since.setUTCDate(since.getUTCDate() - clamped - 1)
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

  // Group by finish, sort each series ascending.
  const seriesByFinish = new Map<string, { date: string; price: number }[]>()
  for (const { data } of obsResults) for (const row of (data ?? []) as any[]) {
    const id = row.printing_finish_id as string
    const p = Number(row.price); if (!Number.isFinite(p) || p <= 0) continue
    const arr = seriesByFinish.get(id) ?? []
    arr.push({ date: row.observed_on as string, price: p })
    seriesByFinish.set(id, arr)
  }
  for (const arr of Array.from(seriesByFinish.values())) arr.sort((a, b) => a.date.localeCompare(b.date))

  // 5) Build day timeline anchored on the latest observation date.
  let latestDate = ''
  for (const [, arr] of Array.from(seriesByFinish.entries())) {
    const last = arr[arr.length - 1]
    if (last && last.date > latestDate) latestDate = last.date
  }
  if (!latestDate) return null

  const daysBack = clamped
  const timeline: string[] = []
  for (let i = daysBack; i >= 0; i--) {
    const d = new Date(latestDate + 'T00:00:00Z'); d.setUTCDate(d.getUTCDate() - i)
    timeline.push(d.toISOString().slice(0, 10))
  }

  // 6) Fold: for each day, sum the last-known price of each basket
  // finish that has any observation on or before that day.
  const perFinishLastKnown = new Map<string, { date: string; price: number } | null>()
  for (const fid of basketFinishIds) perFinishLastKnown.set(fid, null)
  // For each finish we keep a pointer to advance through its sorted
  // observation list as we walk the timeline.
  const pointers = new Map<string, number>()
  for (const fid of basketFinishIds) pointers.set(fid, 0)

  const points: SetValuePoint[] = []
  for (const day of timeline) {
    // Advance each pointer forward until observations exceed the day.
    for (const fid of basketFinishIds) {
      const series = seriesByFinish.get(fid)
      if (!series || series.length === 0) continue
      let idx = pointers.get(fid) ?? 0
      while (idx < series.length && series[idx].date <= day) {
        perFinishLastKnown.set(fid, series[idx])
        idx += 1
      }
      pointers.set(fid, idx)
    }
    let sum = 0
    let covered = 0
    for (const fid of basketFinishIds) {
      const last = perFinishLastKnown.get(fid)
      if (last) { sum += last.price; covered += 1 }
    }
    points.push({
      date: day,
      value: Math.round(sum * 100) / 100,
      covered,
      total: basketFinishIds.length,
    })
  }

  // Prune the leading days where coverage was too thin. This avoids a
  // misleading flat line at the start of the window when observations
  // do not yet exist for most of the basket.
  const minCoverage = Math.max(1, Math.floor(basketFinishIds.length * MIN_COVERAGE))
  const firstUsable = points.findIndex((p) => p.covered >= minCoverage)
  const trimmed = firstUsable >= 0 ? points.slice(firstUsable) : []

  return {
    basis,
    windowDays: clamped,
    points: trimmed,
    currency: basis.currency,
    methodology:
      `Basket = cheapest nonfoil ${basis.currency} ${basis.priceType} price per English paper printing on ${basis.provider} ` +
      `(fallback to cheapest foil). Composition is fixed. Missing daily observations carry forward the last known price.`,
    basketSize: basketFinishIds.length,
  }
}
