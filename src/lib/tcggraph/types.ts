// src/lib/tcggraph/types.ts
// Typed shapes for TCGGraph client. Kept intentionally minimal in
// Slice 0 - we expand once we've hit the real endpoints with a real
// API key and can see actual response shapes. Everything below is
// derived from TCGGraph's public documentation (games / sets / cards /
// pricing / graded pricing) and stays behind a `Partial<T>`-friendly
// pattern where field presence is uncertain.

/** Games the shared pipeline covers. Pokemon deliberately absent;
 *  PokePrices does not migrate in this slice. */
export type GameId = 'mtg' | 'ygo' | 'onepiece' | 'swu'

export type TcgGraphGame = {
  id: string
  name: string
  code?: string
}

export type TcgGraphSet = {
  id: string
  game_id: string
  code?: string | null
  name: string
  released_at?: string | null       // ISO yyyy-mm-dd
  card_count?: number | null
  image_uri?: string | null
}

export type TcgGraphCard = {
  id: string
  game_id: string
  name: string
  face_names?: string[] | null
  type_line?: string | null
  rules_text?: string | null
  /** Free-form game-specific data (attribute, level, cost, colour, etc.). */
  attributes?: Record<string, unknown>
}

export type TcgGraphPrinting = {
  id: string
  game_id: string
  card_id: string
  set_id: string
  collector_number?: string | null
  finish?: string | null            // 'nonfoil' | 'foil' | 'holo' | ...
  variant?: string | null           // 'showcase' | 'borderless' | ...
  language?: string | null
  image_uri?: string | null
  /** External identifiers this printing corresponds to on upstream
   *  data sources. This is the field we lean on heaviest for the
   *  MTG identity bridge (see docs/network/03-mtg-mapping.md). */
  external_ids?: {
    scryfall_id?: string | null
    mtgjson_uuid?: string | null
    tcgplayer_id?: string | null
    cardmarket_id?: string | null
    ygoprodeck_id?: string | null
    [source: string]: string | null | undefined
  }
}

export type TcgGraphMarketPrice = {
  printing_id: string
  provider: string                  // 'tcgplayer' | 'cardmarket' | 'ebay' | ...
  market: string                    // 'paper' | 'online'
  currency: string                  // ISO 4217, 3 chars
  price_type: string                // 'retail' | 'market' | 'buylist'
  condition?: string | null         // 'NM' | 'LP' | ...
  finish?: string | null
  language?: string | null
  price: number
  observed_on: string               // ISO date
}

export type TcgGraphGradedPrice = {
  printing_id: string
  grader: string                    // 'PSA' | 'BGS' | 'CGC' | 'SGC' | ...
  grade: string                     // '10' | '9.5' | 'Auth' | ...
  currency: string
  price: number
  sales_volume?: number | null
  confidence?: string | null        // 'thick_market' | 'thin_market' | ...
  status?: string | null
  observed_on: string
}

/** Envelope every list response is expected to share. Fields may
 *  differ upstream; the client normalises before returning. */
export type TcgGraphPage<T> = {
  data: T[]
  /** Next-cursor pagination. Prefer this over offset/limit. */
  next_cursor?: string | null
  /** Fallback for offset/limit pagination if TCGGraph uses it. */
  page?: number | null
  total?: number | null
}

/** Credit-tracking headers surfaced from every response. */
export type CreditSnapshot = {
  /** TCGGraph-specific credit ceiling (rolling). */
  creditsLimit: number | null
  /** Credits remaining in the current window. */
  creditsRemaining: number | null
  /** Reset epoch (seconds since epoch) or ISO string. */
  creditsReset: string | null
  /** How much this specific request cost. */
  requestCost: number | null
  /** Optional plain rate-limit headers (RFC-ish). */
  rateLimitLimit: number | null
  rateLimitRemaining: number | null
  /** Server-provided reason string if included in the response. */
  serverNote: string | null
}

/** Response shape returned by the client for any single call. */
export type TcgGraphResponse<T> = {
  status: number
  body: T | null
  /** 304 responses come back as { status: 304, body: null, unchanged: true }. */
  unchanged: boolean
  etag: string | null
  credits: CreditSnapshot
  /** Total wall time in ms, including retries. */
  elapsedMs: number
  /** Attempt count actually made (>=1). */
  attempts: number
}
