// src/lib/mtg/set-market.ts
// Server-only. Set-level market aggregates for the single set page.
//
// Methodology (kept transparent, printed on the page):
//
//   Set value =
//     sum over all English paper printings in this set
//     of the CHEAPEST nonfoil finish current price
//     using the caller's basis (default TCGplayer USD retail).
//
// This intentionally does NOT weight by finish (foil premium is left
// out) and does NOT pretend to price cards without any current
// observation on the chosen basis (they are counted as un-priced and
// reported separately).
//
// Also returns the top N most valuable cards, cheapest cards, and top
// movers within the set based on the last 30 days of observations.

import 'server-only'
import { getSupabaseServiceClient } from '@/lib/supabaseService'
import { slugifyCardName as slug } from './slug'
import type { MarketBasis } from './card-market'
import { DEFAULT_BASIS } from './card-market'

export type SetValueTile = {
  printing_id: string
  finish_id: string
  finish: string
  name: string
  set_code: string
  collector_number: string | null
  image_uri_small: string | null
  price: number
  card_href: string
}

export type SetMoverTile = SetValueTile & {
  pct_delta: number
  abs_delta: number
  start_price: number
  period_days: number
}

export type SetMarket = {
  basis: MarketBasis
  totalPrinted: number
  totalPriced: number
  totalUnpriced: number
  estimatedValue: number          // sum of cheapest-nonfoil prices, USD by default
  currencySymbol: string
  mostValuable: SetValueTile[]
  cheapest: SetValueTile[]
  risers: SetMoverTile[]
  fallers: SetMoverTile[]
  methodology: string
}

const CURRENCY_SYMBOL: Record<MarketBasis['currency'], string> = { USD: '$', EUR: '€' }
const IN_CHUNK = 120

export async function getSetMarket(
  setCode: string,
  basis: MarketBasis = DEFAULT_BASIS,
  opts: { topN?: number } = {},
): Promise<SetMarket | null> {
  const supabase = getSupabaseServiceClient()
  const topN = opts.topN ?? 5

  // 1) All English paper printings in the set. Filter out
  //    collector_number-less rows so the eligible population matches
  //    the /browse denominator (mtg_set_aggregates_v4) exactly.
  //    Those rows also cannot have a card page under our URL scheme.
  const { data: printsRaw, error: prErr } = await supabase
    .from('mtg_printings')
    .select('id, name, set_code, collector_number, image_uri_small')
    .eq('set_code', setCode)
    .eq('digital', false)
    .eq('lang', 'en')
    .not('collector_number', 'is', null)
    .order('collector_number', { ascending: true, nullsFirst: false })
  if (prErr || !printsRaw || printsRaw.length === 0) {
    if (prErr) console.error('getSetMarket printings error:', prErr)
    return null
  }
  const prints = printsRaw as {
    id: string; name: string; set_code: string;
    collector_number: string | null; image_uri_small: string | null;
  }[]
  const printById = new Map(prints.map((p) => [p.id, p]))

  // 2) All finishes for those printings.
  const printingIds = prints.map((p) => p.id)
  const finishChunks: string[][] = []
  for (let i = 0; i < printingIds.length; i += IN_CHUNK) finishChunks.push(printingIds.slice(i, i + IN_CHUNK))
  const finishResults = await Promise.all(finishChunks.map((chunk) =>
    supabase.from('mtg_printing_finishes').select('id, printing_id, finish').in('printing_id', chunk)
  ))
  const finishes: { id: string; printing_id: string; finish: string }[] = []
  for (const { data } of finishResults) for (const row of (data ?? []) as any[]) finishes.push(row)
  if (finishes.length === 0) return {
    basis, totalPrinted: prints.length, totalPriced: 0,
    totalUnpriced: prints.length, estimatedValue: 0,
    currencySymbol: CURRENCY_SYMBOL[basis.currency],
    mostValuable: [], cheapest: [], risers: [], fallers: [],
    methodology: methodologyLine(basis),
  }
  const finishById = new Map(finishes.map((f) => [f.id, f]))

  // 3) Current prices for the whole finish set (chunked).
  const finishIds = finishes.map((f) => f.id)
  const cpChunks: string[][] = []
  for (let i = 0; i < finishIds.length; i += IN_CHUNK) cpChunks.push(finishIds.slice(i, i + IN_CHUNK))
  const cpResults = await Promise.all(cpChunks.map((chunk) =>
    supabase.from('mtg_current_prices').select('printing_finish_id, price, observed_on')
      .eq('provider', basis.provider).eq('currency', basis.currency)
      .eq('market', basis.market).eq('price_type', basis.priceType)
      .in('printing_finish_id', chunk)
  ))
  type CurrentRow = { printing_finish_id: string; price: number; observed_on: string }
  const currents: CurrentRow[] = []
  for (const { data } of cpResults) for (const row of (data ?? []) as any[]) currents.push(row)

  // Per-printing cheapest nonfoil current price (basketed value view).
  const cheapestNonfoilByPrinting = new Map<string, { finish_id: string; finish: string; price: number }>()
  const cheapestAnyByPrinting = new Map<string, { finish_id: string; finish: string; price: number }>()
  for (const cp of currents) {
    const f = finishById.get(cp.printing_finish_id); if (!f) continue
    const price = Number(cp.price); if (!Number.isFinite(price) || price <= 0) continue
    const row = { finish_id: f.id, finish: f.finish, price }
    const anyCur = cheapestAnyByPrinting.get(f.printing_id)
    if (!anyCur || price < anyCur.price) cheapestAnyByPrinting.set(f.printing_id, row)
    if (f.finish === 'nonfoil') {
      const nfCur = cheapestNonfoilByPrinting.get(f.printing_id)
      if (!nfCur || price < nfCur.price) cheapestNonfoilByPrinting.set(f.printing_id, row)
    }
  }
  // Basketed methodology: prefer nonfoil, fall back to any finish so
  // foil-only printings still count. This is the more inclusive read.
  const basketByPrinting = new Map<string, { finish_id: string; finish: string; price: number }>()
  for (const p of prints) {
    const nf = cheapestNonfoilByPrinting.get(p.id)
    const any = cheapestAnyByPrinting.get(p.id)
    const chosen = nf ?? any
    if (chosen) basketByPrinting.set(p.id, chosen)
  }

  const totalPriced = basketByPrinting.size
  const totalUnpriced = prints.length - totalPriced
  let estimatedValue = 0
  for (const v of Array.from(basketByPrinting.values())) estimatedValue += v.price

  // 4) Most valuable and cheapest tiles.
  const tiles: SetValueTile[] = []
  for (const [pid, v] of Array.from(basketByPrinting.entries())) {
    const p = printById.get(pid); if (!p) continue
    tiles.push({
      printing_id: pid, finish_id: v.finish_id, finish: v.finish,
      name: p.name, set_code: p.set_code, collector_number: p.collector_number,
      image_uri_small: p.image_uri_small, price: round2(v.price),
      card_href: buildCardHref(p),
    })
  }
  const mostValuable = tiles.slice().sort((a, b) => b.price - a.price).slice(0, topN)
  const cheapest = tiles.slice().sort((a, b) => a.price - b.price).slice(0, topN)

  // 5) Movers within the set: 30 day window on the chosen basis for the
  // basket finishes we already know are priced (bounds this cheap).
  const moverFinishIds = Array.from(basketByPrinting.values()).map((v) => v.finish_id)
  const since = new Date(); since.setUTCDate(since.getUTCDate() - 30)
  const sinceIso = since.toISOString().slice(0, 10)
  const obsChunks: string[][] = []
  for (let i = 0; i < moverFinishIds.length; i += IN_CHUNK) obsChunks.push(moverFinishIds.slice(i, i + IN_CHUNK))
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

  const movers: SetMoverTile[] = []
  const finishToPrinting = new Map(finishes.map((f) => [f.id, f.printing_id]))
  for (const [fid, a] of Array.from(byFinish.entries())) {
    if (a.earliest.d === a.latest.d) continue
    const days = daysBetween(a.earliest.d, a.latest.d)
    if (days < 5) continue                 // require enough span within 30d
    if (a.latest.p < 1) continue           // ignore penny movers
    const abs = a.latest.p - a.earliest.p
    if (Math.abs(abs) < 0.20) continue
    const pct = abs / a.earliest.p
    const pid = finishToPrinting.get(fid); if (!pid) continue
    const p = printById.get(pid); if (!p) continue
    movers.push({
      printing_id: pid, finish_id: fid, finish: 'nonfoil',
      name: p.name, set_code: p.set_code, collector_number: p.collector_number,
      image_uri_small: p.image_uri_small,
      price: round2(a.latest.p),
      start_price: round2(a.earliest.p),
      abs_delta: round2(abs), pct_delta: pct,
      period_days: days,
      card_href: buildCardHref(p),
    })
  }
  const risers = movers.filter((m) => m.pct_delta > 0).sort((a, b) => b.pct_delta - a.pct_delta).slice(0, topN)
  const fallers = movers.filter((m) => m.pct_delta < 0).sort((a, b) => a.pct_delta - b.pct_delta).slice(0, topN)

  return {
    basis,
    totalPrinted: prints.length,
    totalPriced,
    totalUnpriced,
    estimatedValue: round2(estimatedValue),
    currencySymbol: CURRENCY_SYMBOL[basis.currency],
    mostValuable, cheapest, risers, fallers,
    methodology: methodologyLine(basis),
  }
}

function buildCardHref(p: { set_code: string; collector_number: string | null; name: string }): string {
  const seg = p.collector_number ? `${p.collector_number}-${slug(p.name)}` : slug(p.name)
  return `/set/${p.set_code}/card/${seg}`
}
function methodologyLine(basis: MarketBasis): string {
  const prov = basis.provider === 'tcgplayer' ? 'TCGplayer'
    : basis.provider === 'cardkingdom' ? 'Card Kingdom'
    : basis.provider === 'cardmarket' ? 'Cardmarket'
    : basis.provider === 'manapool' ? 'ManaPool'
    : 'Cardhoarder'
  return `Set value = sum of the cheapest nonfoil ${basis.currency} ${basis.priceType} price per English paper printing on ${prov} (fallback to cheapest foil if no nonfoil is priced).`
}
function round2(n: number): number { return Math.round(n * 100) / 100 }
function daysBetween(a: string, b: string): number {
  const ax = Date.parse(a + 'T00:00:00Z'); const bx = Date.parse(b + 'T00:00:00Z')
  if (!Number.isFinite(ax) || !Number.isFinite(bx)) return 0
  return Math.round(Math.abs(bx - ax) / 86400000)
}
