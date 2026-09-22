// src/lib/tcggraph/read-model.ts
// Server-only. Read helpers that let MTG-side code ask the network
// layer: "For this mtg_printings.id, what does TCGGraph know?"
//
// Slice 3 semantics: `raw` and `any`-grader-9.5-and-below rows are
// stored the same way in tcg_graded_prices_current for provider
// fidelity, but the CALLER never confuses them:
//   * rawPrice          -> the single grader='raw' quote (ungraded market)
//   * gradedPrices[]    -> everything ELSE (psa|bgs|cgc|sgc|any + all grades)
//     sorted in a stable, useful order:
//       PSA 10, BGS 10, CGC 10, SGC 10, any 9.5, any 9, any 8, any 7, rest
// Absent quotes stay absent. NEVER imputed to $0.

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
  /** 'printing' rows describe a specific physical printing. 'card' rows
   *  are card-level (edition-ambiguous) provider aggregates - a
   *  frontend that treats them as printing-specific IS a bug. */
  attribution?: 'printing' | 'card' | null
  tcg_card_id?: string | null
}

export type TcgRawQuote = {
  tcg_printing_id: string
  price: number
  currency: string
  card_sales_volume: number | null
  updated_at: string | null
}

export type TcgPrintingBundle = {
  mtgPrintingId: string
  tcgPrintings: Array<{
    id: string
    tcggraph_card_id: string
    tcggraph_printing_key: string
    finish: string | null
    mapping_confidence: string
  }>
  market: TcgMarketRow[]
  /** Absent-safe: null when there is genuinely no raw quote. */
  rawPrice: TcgRawQuote | null
  /** True slab / any-graded quotes for THIS specific printing only.
   *  Card-level (edition-ambiguous) quotes are separated out and only
   *  surfaced through `cardScopedGraded`. Consumers must NEVER label
   *  a `cardScopedGraded` value as an edition-specific slab. */
  gradedPrices: TcgGradedRow[]
  /** Card-level edition-ambiguous graded quotes that apply to any
   *  edition of the same tcg_card_id. Frontend must render these under
   *  a distinct "edition-ambiguous" label (never as 1st Edition or
   *  Unlimited slab values). Empty when the card has no such rows. */
  cardScopedGraded: TcgGradedRow[]
  /** Most recent updated_at observed on any TCGGraph row for this
   *  MTG printing (market or graded). */
  lastSourceUpdate: string | null
  latestObservationDate: string | null
}

const GRADER_RANK: Record<string, number> = {
  psa: 0, bgs: 1, cgc: 2, sgc: 3, any: 4,
}
const GRADE_RANK: Record<string, number> = {
  '10': 0, '9.5': 1, '9': 2, '8.5': 3, '8': 4, '7.5': 5, '7': 6,
}

function sortGraded(rows: TcgGradedRow[]): TcgGradedRow[] {
  // Slabbed first (psa/bgs/cgc/sgc grade 10), then any at 9.5/9/8/7.
  return rows.slice().sort((a, b) => {
    const ga = GRADER_RANK[a.grader.toLowerCase()] ?? 99
    const gb = GRADER_RANK[b.grader.toLowerCase()] ?? 99
    if (ga !== gb) return ga - gb
    const rda = GRADE_RANK[a.grade] ?? 99
    const rdb = GRADE_RANK[b.grade] ?? 99
    if (rda !== rdb) return rda - rdb
    return b.price - a.price
  })
}

function pickRaw(rows: TcgGradedRow[]): TcgRawQuote | null {
  const r = rows.find((row) => row.grader.toLowerCase() === 'raw')
  if (!r) return null
  return {
    tcg_printing_id: r.tcg_printing_id,
    price: r.price,
    currency: r.currency,
    card_sales_volume: r.card_sales_volume,
    updated_at: r.updated_at,
  }
}

function partitionRawAndGraded(rows: TcgGradedRow[]): {
  raw: TcgRawQuote | null
  graded: TcgGradedRow[]
  cardScoped: TcgGradedRow[]
} {
  const nonRaw = rows.filter((r) => r.grader.toLowerCase() !== 'raw')
  //  Attribution boundary: attribution='card' quotes are card-level
  //  aggregates. Never fold them into the printing-scoped list; every
  //  read path that renders a specific printing MUST exclude them from
  //  its slab display and surface them separately (or not at all).
  //  Rows written before the ambiguity migration have attribution=null
  //  or undefined - those default to 'printing' by policy.
  const printingScoped = nonRaw.filter((r) => (r.attribution ?? 'printing') === 'printing')
  const cardScoped     = nonRaw.filter((r) => r.attribution === 'card')
  return {
    raw: pickRaw(rows),
    graded: sortGraded(printingScoped),
    cardScoped: sortGraded(cardScoped),
  }
}

function newestTimestamp(rows: Array<{ updated_at: string | null }>): string | null {
  let best: string | null = null
  for (const r of rows) {
    if (!r.updated_at) continue
    if (!best || r.updated_at > best) best = r.updated_at
  }
  return best
}

/** For a single mtg_printings.id. Returns null when there is no
 *  matching tcg_printings row (mapping still pending OR truly
 *  unmapped). */
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
  const gradedRows = ((graded ?? []) as TcgGradedRow[])
  const marketRows = ((market ?? []) as TcgMarketRow[])
  const { raw, graded: slabbedAndAny, cardScoped } = partitionRawAndGraded(gradedRows)
  return {
    mtgPrintingId,
    tcgPrintings: prints as TcgPrintingBundle['tcgPrintings'],
    market: marketRows,
    rawPrice: raw,
    gradedPrices: slabbedAndAny,
    cardScopedGraded: cardScoped,
    lastSourceUpdate: newestTimestamp([...marketRows, ...gradedRows]),
    latestObservationDate: (latest?.[0] as { observed_on?: string } | undefined)?.observed_on ?? null,
  }
}

/** Batch. Same semantics as the single form. Returns a Map keyed by
 *  mtg_printings.id. Printings with no tcg row are simply absent. */
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
  const marketByTcg = new Map<string, TcgMarketRow[]>()
  const gradedByTcg = new Map<string, TcgGradedRow[]>()
  for (const m of (market ?? []) as TcgMarketRow[]) {
    const arr = marketByTcg.get(m.tcg_printing_id) ?? []; arr.push(m); marketByTcg.set(m.tcg_printing_id, arr)
  }
  for (const g of (graded ?? []) as TcgGradedRow[]) {
    const arr = gradedByTcg.get(g.tcg_printing_id) ?? []; arr.push(g); gradedByTcg.set(g.tcg_printing_id, arr)
  }
  for (const mtgId of mtgPrintingIds) {
    const prs = printsByMtg.get(mtgId) ?? []
    if (prs.length === 0) continue
    const flatMarket = prs.flatMap((p) => marketByTcg.get(p.id) ?? [])
    const flatGraded = prs.flatMap((p) => gradedByTcg.get(p.id) ?? [])
    const { raw, graded: slab, cardScoped } = partitionRawAndGraded(flatGraded)
    out.set(mtgId, {
      mtgPrintingId: mtgId,
      tcgPrintings: prs.map((p) => ({ id: p.id, tcggraph_card_id: p.tcggraph_card_id, tcggraph_printing_key: p.tcggraph_printing_key, finish: p.finish, mapping_confidence: p.mapping_confidence })),
      market: flatMarket,
      rawPrice: raw,
      gradedPrices: slab,
      cardScopedGraded: cardScoped,
      lastSourceUpdate: newestTimestamp([...flatMarket, ...flatGraded]),
      latestObservationDate: null,
    })
  }
  return out
}

/** Card-scoped graded quotes for a single tcg_cards.id. Returns rows
 *  the collector-network printing-page code can display under an
 *  explicit "edition-ambiguous" label. Never returns attribution!='card'
 *  rows and never includes raw. Safe to call from public YGO card pages. */
export async function getCardScopedGradedRows(tcgCardId: string): Promise<TcgGradedRow[]> {
  const sb = getSupabaseServiceClient()
  const { data } = await sb
    .from('tcg_graded_prices_current')
    .select('*')
    .eq('tcg_card_id', tcgCardId)
    .eq('attribution', 'card')
    .neq('grader', 'raw')
  return sortGraded((data ?? []) as TcgGradedRow[])
}

/** Lightweight: given a list of mtg_printings.id values, return the
 *  subset that carries at least one slabbed graded row (grader is NOT
 *  'raw'). Used by the card page to decorate the printing-comparison
 *  table with a "has graded data" indicator per row. Runs in two
 *  small queries; chunks input at 100 ids to stay under PostgREST URL
 *  length limits. */
export async function getSlabbedMtgPrintingSet(mtgPrintingIds: string[]): Promise<Set<string>> {
  const out = new Set<string>()
  if (mtgPrintingIds.length === 0) return out
  const sb = getSupabaseServiceClient()
  //  1. mtg_printings.id -> tcg_printings.id
  const tcgByMtg = new Map<string, string[]>()
  const uniqueMtg = Array.from(new Set(mtgPrintingIds))
  for (let i = 0; i < uniqueMtg.length; i += 100) {
    const slice = uniqueMtg.slice(i, i + 100)
    const { data, error } = await sb
      .from('tcg_printings')
      .select('id, mtg_printings_id')
      .in('mtg_printings_id', slice)
    if (error) throw new Error(`tcg_printings lookup failed: ${error.message}`)
    for (const r of data ?? []) {
      if (!r.mtg_printings_id) continue
      const arr = tcgByMtg.get(r.mtg_printings_id) ?? []
      arr.push(r.id)
      tcgByMtg.set(r.mtg_printings_id, arr)
    }
  }
  //  2. Which of those tcg_printings.id values have any non-raw graded row?
  const allTcgIds = Array.from(new Set(Array.from(tcgByMtg.values()).flat()))
  const slabbedTcgIds = new Set<string>()
  for (let i = 0; i < allTcgIds.length; i += 100) {
    const slice = allTcgIds.slice(i, i + 100)
    const { data, error } = await sb
      .from('tcg_graded_prices_current')
      .select('tcg_printing_id')
      .in('tcg_printing_id', slice)
      .not('grader', 'in', '("raw")')
      //  Attribution boundary. See read-model comments.
      .eq('attribution', 'printing')
    if (error) throw new Error(`tcg_graded_prices_current lookup failed: ${error.message}`)
    for (const r of data ?? []) slabbedTcgIds.add(r.tcg_printing_id)
  }
  //  3. Reverse: any mtg_printings_id whose tcg mapping is in the set.
  for (const [mtgId, tcgIds] of Array.from(tcgByMtg.entries())) {
    if (tcgIds.some((id) => slabbedTcgIds.has(id))) out.add(mtgId)
  }
  return out
}

// ---------------------------------------------------------------------
// Test-visible helpers. Kept exported so unit tests can hit them
// without spinning up Supabase.
// ---------------------------------------------------------------------
export const __testables = { partitionRawAndGraded, sortGraded, pickRaw, newestTimestamp }

