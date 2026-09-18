// src/lib/mtg/card-market.types.ts
// Client-safe types + shared constants for card-market. Split out of
// card-market.ts because that file uses `import 'server-only'` and can
// therefore never be pulled into a client component even for types.

export type MarketBasis = {
  provider: 'tcgplayer' | 'cardkingdom' | 'cardmarket' | 'manapool' | 'cardhoarder'
  currency: 'USD' | 'EUR'
  market: 'paper' | 'mtgo' | 'arena'
  priceType: 'retail' | 'buylist'
}

export const CURRENCY_SYMBOL: Record<MarketBasis['currency'], string> = {
  USD: '$',
  EUR: '€',
}

export type PrintingPriceRow = {
  printing_id: string
  finish_id: string
  finish: 'nonfoil' | 'foil' | 'etched' | string
  set_code: string
  set_name: string
  collector_number: string | null
  released_at: string | null
  image_uri_small: string | null
  price: number
}

export type WindowStat = {
  windowDays: number
  start_price: number | null
  latest_price: number | null
  abs_delta: number | null
  pct_delta: number | null
  high: number | null
  low: number | null
  points: number
  spanDays: number
}

export type CardMarketSummary = {
  basis: MarketBasis
  currencySymbol: string
  currentPrice: number | null
  currentObservedOn: string | null
  currentPrintingId: string | null
  currentFinishId: string | null
  currentFinish: string | null
  d7: WindowStat
  d30: WindowStat
  d90: WindowStat
  pricedPrintings: PrintingPriceRow[]
  cheapest: PrintingPriceRow | null
  mostExpensive: PrintingPriceRow | null
  currentRank: number | null
  foilPremium: {
    nonfoil: number
    foil: number
    diff: number
    pct: number
  } | null
  insights: string[]
}
