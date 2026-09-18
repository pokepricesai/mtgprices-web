// src/lib/mtg/card-market.ts
// Server-only. Deterministic market analytics for a single MTG card
// page. Takes an oracle_card_id, returns a fully joined summary that
// the card page can render as a market overview + a list of factual
// insights (no AI, no invention).
//
// All figures are locked to a single basis so nothing mixes across
// currencies or providers. Basis defaults are the same "headline"
// choice used across the rest of the app: paper / USD / retail /
// tcgplayer, with a lightweight failover to any priced row when the
// preferred provider is missing.

import 'server-only'
import { getSupabaseServiceClient } from '@/lib/supabaseService'
// Types and small constants live in card-market.types.ts so client
// components can import them without pulling in the server-only barrel.
import type { MarketBasis, PrintingPriceRow, WindowStat, CardMarketSummary } from './card-market.types'
import { CURRENCY_SYMBOL } from './card-market.types'
export type { MarketBasis, PrintingPriceRow, WindowStat, CardMarketSummary } from './card-market.types'
export { CURRENCY_SYMBOL } from './card-market.types'

export const DEFAULT_BASIS: MarketBasis = {
  provider: 'tcgplayer',
  currency: 'USD',
  market: 'paper',
  priceType: 'retail',
}

type PrintingRow = {
  id: string
  oracle_card_id: string
  set_code: string
  collector_number: string | null
  name: string
  released_at: string | null
  image_uri_small: string | null
  digital: boolean | null
  lang: string | null
}

/** Convenience wrapper the card page can call. Takes the oracle id and
 *  optionally the specific printing_id the user is looking at. Returns
 *  null if we have literally no priced data for this card. */
export async function getCardMarketSummary(
  oracleCardId: string,
  currentPrintingId: string | null,
  basis: MarketBasis = DEFAULT_BASIS,
): Promise<CardMarketSummary | null> {
  const supabase = getSupabaseServiceClient()

  // 1) Every English paper printing for this oracle.
  const { data: printsRaw } = await supabase
    .from('mtg_printings')
    .select('id, oracle_card_id, set_code, collector_number, name, released_at, image_uri_small, digital, lang')
    .eq('oracle_card_id', oracleCardId)
    .eq('digital', false)
    .eq('lang', 'en')
  const prints = ((printsRaw ?? []) as PrintingRow[]).filter((p) => !p.digital)
  if (prints.length === 0) return null

  // 2) All finishes across those printings.
  const printingIds = prints.map((p) => p.id)
  const { data: finRaw } = await supabase
    .from('mtg_printing_finishes')
    .select('id, printing_id, finish')
    .in('printing_id', printingIds)
  const finishes = (finRaw ?? []) as { id: string; printing_id: string; finish: string }[]
  if (finishes.length === 0) return null

  // 3) Current prices for every finish (basis-locked).
  const finishIds = finishes.map((f) => f.id)
  const { data: cpRaw } = await supabase
    .from('mtg_current_prices')
    .select('printing_finish_id, price, observed_on')
    .in('printing_finish_id', finishIds)
    .eq('provider', basis.provider)
    .eq('currency', basis.currency)
    .eq('market', basis.market)
    .eq('price_type', basis.priceType)
  const currents = (cpRaw ?? []) as { printing_finish_id: string; price: number; observed_on: string }[]

  if (currents.length === 0) {
    // Nothing priced on this basis. Return a mostly-empty summary so
    // the UI can render a graceful placeholder rather than a broken
    // section.
    return emptySummary(basis)
  }

  // 4) Set names for pretty display.
  const setCodes = Array.from(new Set(prints.map((p) => p.set_code)))
  const { data: setsRaw } = await supabase
    .from('mtg_sets')
    .select('code, name')
    .in('code', setCodes)
  const setNameByCode = new Map<string, string>(
    ((setsRaw ?? []) as { code: string; name: string }[]).map((s) => [s.code, s.name]),
  )

  // Join the current-price rows against finish + printing metadata.
  const printingById = new Map(prints.map((p) => [p.id, p]))
  const finishById = new Map(finishes.map((f) => [f.id, f]))

  // A single card can have multiple finishes on the same printing
  // (nonfoil + foil). We keep the cheapest finish per printing for the
  // cross-printing comparison view.
  const cheapestPerPrinting = new Map<string, PrintingPriceRow>()
  const allPricedFinishRows: (PrintingPriceRow & { finish_id: string })[] = []
  for (const cp of currents) {
    const f = finishById.get(cp.printing_finish_id)
    if (!f) continue
    const p = printingById.get(f.printing_id)
    if (!p) continue
    const row: PrintingPriceRow = {
      printing_id: p.id,
      finish_id: f.id,
      finish: f.finish,
      set_code: p.set_code,
      set_name: setNameByCode.get(p.set_code) ?? p.set_code.toUpperCase(),
      collector_number: p.collector_number,
      released_at: p.released_at,
      image_uri_small: p.image_uri_small,
      price: Number(cp.price),
    }
    allPricedFinishRows.push(row)
    const existing = cheapestPerPrinting.get(p.id)
    if (!existing || row.price < existing.price) cheapestPerPrinting.set(p.id, row)
  }
  const pricedPrintings = Array.from(cheapestPerPrinting.values()).sort((a, b) => a.price - b.price)
  const cheapest = pricedPrintings[0] ?? null
  const mostExpensive = pricedPrintings.length > 0
    ? pricedPrintings.reduce((max, r) => r.price > max.price ? r : max, pricedPrintings[0])
    : null

  // 5) Determine the "primary" printing to base deltas on.
  // Preference:  the printing_id the user is looking at, if priced.
  //              otherwise the cheapest priced nonfoil.
  //              otherwise the cheapest priced anything.
  const pickPrimary = (): (PrintingPriceRow & { finish_id: string }) | null => {
    if (currentPrintingId) {
      const nonfoil = allPricedFinishRows.find((r) => r.printing_id === currentPrintingId && r.finish === 'nonfoil')
      if (nonfoil) return nonfoil
      const anyFinish = allPricedFinishRows.find((r) => r.printing_id === currentPrintingId)
      if (anyFinish) return anyFinish
    }
    const nf = allPricedFinishRows.filter((r) => r.finish === 'nonfoil')
    if (nf.length) return nf.reduce((min, r) => r.price < min.price ? r : min, nf[0])
    return allPricedFinishRows.reduce((min, r) => r.price < min.price ? r : min, allPricedFinishRows[0])
  }
  const primary = pickPrimary()

  // 6) Pull 90 days of history for the primary finish so we can derive
  // 7d/30d/90d deltas in one pass.
  let d7: WindowStat = emptyStat(7)
  let d30: WindowStat = emptyStat(30)
  let d90: WindowStat = emptyStat(90)
  let currentObservedOn: string | null = null

  if (primary) {
    const since90 = new Date(); since90.setUTCDate(since90.getUTCDate() - 90)
    const sinceIso = since90.toISOString().slice(0, 10)
    const { data: hist } = await supabase
      .from('mtg_price_observations')
      .select('observed_on, price')
      .eq('printing_finish_id', primary.finish_id)
      .eq('provider', basis.provider)
      .eq('currency', basis.currency)
      .eq('market', basis.market)
      .eq('price_type', basis.priceType)
      .or('is_anomalous.is.null,is_anomalous.eq.false')
      .gte('observed_on', sinceIso)
      .order('observed_on', { ascending: true })
    const points = ((hist ?? []) as { observed_on: string; price: number }[])
      .map((p) => ({ observed_on: p.observed_on, price: Number(p.price) }))
      .filter((p) => Number.isFinite(p.price) && p.price > 0)
    if (points.length > 0) {
      currentObservedOn = points[points.length - 1].observed_on
      d7 = statForWindow(points, 7)
      d30 = statForWindow(points, 30)
      d90 = statForWindow(points, 90)
    }
  }

  // 7) Rank of the current printing among cheapest paper printings.
  let currentRank: number | null = null
  if (primary) {
    const idx = pricedPrintings.findIndex((r) => r.printing_id === primary.printing_id)
    if (idx >= 0) currentRank = idx + 1
  }

  // 8) Foil premium (if both nonfoil AND foil are currently priced on
  // this printing).
  let foilPremium: CardMarketSummary['foilPremium'] = null
  if (primary) {
    const nonfoil = allPricedFinishRows.find((r) => r.printing_id === primary.printing_id && r.finish === 'nonfoil')
    const foil    = allPricedFinishRows.find((r) => r.printing_id === primary.printing_id && r.finish === 'foil')
    if (nonfoil && foil && nonfoil.price > 0) {
      foilPremium = {
        nonfoil: nonfoil.price,
        foil: foil.price,
        diff: foil.price - nonfoil.price,
        pct: (foil.price - nonfoil.price) / nonfoil.price,
      }
    }
  }

  // 9) Build 3, 4 factual insight sentences the UI can list.
  const insights = buildInsights({
    d7, d30, d90,
    pricedPrintingsCount: pricedPrintings.length,
    cheapest, mostExpensive,
    currentRank, primary, foilPremium,
    basis,
  })

  return {
    basis,
    currencySymbol: CURRENCY_SYMBOL[basis.currency],
    currentPrice: primary?.price ?? null,
    currentObservedOn,
    currentPrintingId: primary?.printing_id ?? null,
    currentFinishId: primary?.finish_id ?? null,
    currentFinish: primary?.finish ?? null,
    d7, d30, d90,
    pricedPrintings,
    cheapest,
    mostExpensive,
    currentRank,
    foilPremium,
    insights,
  }
}

// ────────────────────────────────────────────────────────────────────

function emptyStat(windowDays: number): WindowStat {
  return {
    windowDays,
    start_price: null, latest_price: null,
    abs_delta: null, pct_delta: null,
    high: null, low: null,
    points: 0, spanDays: 0,
  }
}

function emptySummary(basis: MarketBasis): CardMarketSummary {
  return {
    basis,
    currencySymbol: CURRENCY_SYMBOL[basis.currency],
    currentPrice: null, currentObservedOn: null,
    currentPrintingId: null, currentFinishId: null, currentFinish: null,
    d7: emptyStat(7), d30: emptyStat(30), d90: emptyStat(90),
    pricedPrintings: [],
    cheapest: null, mostExpensive: null, currentRank: null,
    foilPremium: null,
    insights: [],
  }
}

function statForWindow(
  points: { observed_on: string; price: number }[],
  windowDays: number,
): WindowStat {
  if (points.length === 0) return emptyStat(windowDays)
  const latest = points[points.length - 1]
  const cutoff = new Date(latest.observed_on + 'T00:00:00Z')
  cutoff.setUTCDate(cutoff.getUTCDate() - windowDays)
  const cutoffIso = cutoff.toISOString().slice(0, 10)
  const inWindow = points.filter((p) => p.observed_on >= cutoffIso)
  if (inWindow.length === 0) return emptyStat(windowDays)
  const first = inWindow[0]
  let high = inWindow[0].price
  let low = inWindow[0].price
  for (const p of inWindow) {
    if (p.price > high) high = p.price
    if (p.price < low) low = p.price
  }
  const abs = latest.price - first.price
  const pct = first.price > 0 ? abs / first.price : null
  const spanDays = daysBetween(first.observed_on, latest.observed_on)
  return {
    windowDays,
    start_price: round2(first.price),
    latest_price: round2(latest.price),
    abs_delta: round2(abs),
    pct_delta: pct !== null ? round4(pct) : null,
    high: round2(high),
    low: round2(low),
    points: inWindow.length,
    spanDays,
  }
}

function buildInsights(ctx: {
  d7: WindowStat; d30: WindowStat; d90: WindowStat
  pricedPrintingsCount: number
  cheapest: PrintingPriceRow | null
  mostExpensive: PrintingPriceRow | null
  currentRank: number | null
  primary: (PrintingPriceRow & { finish_id: string }) | null
  foilPremium: CardMarketSummary['foilPremium']
  basis: MarketBasis
}): string[] {
  const sym = CURRENCY_SYMBOL[ctx.basis.currency]
  const out: string[] = []

  // Deltas. Prefer 30 day where present, else fall back.
  const preferred = pickPreferredDelta([ctx.d30, ctx.d90, ctx.d7])
  if (preferred && preferred.pct_delta !== null) {
    const dir = preferred.pct_delta >= 0 ? 'up' : 'down'
    out.push(
      `${cap(dir)} ${Math.abs(preferred.pct_delta * 100).toFixed(1)}% over the last ${preferred.spanDays} days on ${providerLabel(ctx.basis.provider)}.`,
    )
  }

  // Distance from 90 day high.
  if (ctx.d90.latest_price !== null && ctx.d90.high !== null && ctx.d90.high > 0) {
    const belowHigh = 1 - ctx.d90.latest_price / ctx.d90.high
    if (belowHigh > 0.02) {
      out.push(`Currently ${Math.round(belowHigh * 100)}% below its 90 day high of ${sym}${ctx.d90.high.toFixed(2)}.`)
    } else if (belowHigh <= 0.01) {
      out.push(`Trading at or near its 90 day high of ${sym}${ctx.d90.high.toFixed(2)}.`)
    }
  }

  // Rank among priced printings.
  if (ctx.currentRank !== null && ctx.pricedPrintingsCount > 1) {
    const total = ctx.pricedPrintingsCount
    const cheaperCount = ctx.currentRank - 1
    const pricierCount = total - ctx.currentRank
    if (cheaperCount === 0) {
      out.push(`This is the cheapest paper printing of the card currently priced (${total} priced in total).`)
    } else if (pricierCount === 0) {
      out.push(`This is the most expensive paper printing currently priced (${total} priced in total).`)
    } else {
      out.push(`This printing is the ${ordinal(ctx.currentRank)} cheapest paper printing currently priced (${total} priced in total).`)
    }
  }

  // Foil premium.
  if (ctx.foilPremium) {
    const pct = ctx.foilPremium.pct
    if (pct > 0.05) {
      out.push(`Foil copies of this printing carry a ${Math.round(pct * 100)}% premium over nonfoil.`)
    } else if (pct < -0.05) {
      out.push(`Foil copies of this printing are trading ${Math.round(Math.abs(pct) * 100)}% below nonfoil.`)
    }
  }

  return out
}

function pickPreferredDelta(candidates: WindowStat[]): WindowStat | null {
  for (const c of candidates) {
    if (c.pct_delta !== null && c.points >= 2 && c.spanDays >= 2) return c
  }
  return null
}

function cap(s: string) { return s.charAt(0).toUpperCase() + s.slice(1) }
function round2(n: number): number { return Math.round(n * 100) / 100 }
function round4(n: number): number { return Math.round(n * 10000) / 10000 }
function daysBetween(a: string, b: string): number {
  const ax = Date.parse(a + 'T00:00:00Z'); const bx = Date.parse(b + 'T00:00:00Z')
  if (!Number.isFinite(ax) || !Number.isFinite(bx)) return 0
  return Math.round(Math.abs(bx - ax) / 86400000)
}
function providerLabel(p: MarketBasis['provider']): string {
  switch (p) {
    case 'tcgplayer': return 'TCGplayer'
    case 'cardkingdom': return 'Card Kingdom'
    case 'cardmarket': return 'Cardmarket'
    case 'manapool': return 'ManaPool'
    case 'cardhoarder': return 'Cardhoarder'
  }
}
function ordinal(n: number): string {
  const j = n % 10, k = n % 100
  if (k >= 11 && k <= 13) return `${n}th`
  if (j === 1) return `${n}st`
  if (j === 2) return `${n}nd`
  if (j === 3) return `${n}rd`
  return `${n}th`
}
