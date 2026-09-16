// src/lib/mtg/valuation.data.ts
// Pure data — the finite set of valuation bases MTGPrices supports.
// Every basis maps to a real (provider, currency, price_type, market)
// combination present in mtg_current_prices. No silent FX between USD
// and EUR — the currency is always explicit.
//
// NO server-only import: consumed by both client controls (basis
// picker) and server-side collection.ts.

export type ValuationBasis = {
  key: string
  label: string
  provider: string
  currency: 'USD' | 'EUR'
  price_type: 'retail' | 'buylist'
  market: 'paper' | 'mtgo'
  description: string
}

export const VALUATION_BASES: ValuationBasis[] = [
  {
    key: 'tcgplayer_usd_retail',
    label: 'TCGplayer — USD retail',
    provider: 'tcgplayer',
    currency: 'USD',
    price_type: 'retail',
    market: 'paper',
    description: 'US retail baseline. Most familiar to North-American collectors.',
  },
  {
    key: 'cardkingdom_usd_retail',
    label: 'Card Kingdom — USD retail',
    provider: 'cardkingdom',
    currency: 'USD',
    price_type: 'retail',
    market: 'paper',
    description: 'Card Kingdom store prices. Slightly higher than TCGplayer as a rule.',
  },
  {
    key: 'cardkingdom_usd_buylist',
    label: 'Card Kingdom — USD buylist',
    provider: 'cardkingdom',
    currency: 'USD',
    price_type: 'buylist',
    market: 'paper',
    description: 'What a dealer will pay you. The realistic sale price.',
  },
  {
    key: 'manapool_usd_retail',
    label: 'ManaPool — USD retail',
    provider: 'manapool',
    currency: 'USD',
    price_type: 'retail',
    market: 'paper',
    description: 'US small-vendor aggregator.',
  },
  {
    key: 'cardmarket_eur_retail',
    label: 'Cardmarket — EUR retail',
    provider: 'cardmarket',
    currency: 'EUR',
    price_type: 'retail',
    market: 'paper',
    description: 'European retail baseline. Cardmarket is the largest EU marketplace.',
  },
  {
    key: 'cardhoarder_usd_retail',
    label: 'Cardhoarder — MTGO tix',
    provider: 'cardhoarder',
    currency: 'USD',
    price_type: 'retail',
    market: 'mtgo',
    description: 'Magic Online — priced in tix. Different economy to paper.',
  },
]

export const VALUATION_BY_KEY: Record<string, ValuationBasis> =
  Object.fromEntries(VALUATION_BASES.map((b) => [b.key, b]))

/** Best-effort match: reverse-lookup a basis object from four fields. */
export function findBasis(match: Partial<ValuationBasis>): ValuationBasis | null {
  return VALUATION_BASES.find((b) =>
    (!match.provider   || b.provider === match.provider) &&
    (!match.currency   || b.currency === match.currency) &&
    (!match.price_type || b.price_type === match.price_type) &&
    (!match.market     || b.market === match.market)
  ) ?? null
}

export const DEFAULT_BASIS: ValuationBasis = VALUATION_BASES[0]

/** Symbol for a currency — never mixes them. */
export function currencySymbol(cur: string): string {
  if (cur === 'USD') return '$'
  if (cur === 'EUR') return '€'
  return `${cur} `
}
