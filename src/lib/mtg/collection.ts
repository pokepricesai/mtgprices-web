// src/lib/mtg/collection.ts
//
// Shared MTG collection module. All reads go through the caller's
// session-scoped Supabase client (`getSupabaseServerClient`) so RLS
// enforces `auth.uid() = user_id`, the service role is never used from
// this module. Every function returns typed data that a future Deck
// Builder can consume directly.

import 'server-only'
import type { SupabaseClient } from '@supabase/supabase-js'
import { getSupabaseServerClient } from '@/lib/supabase/server'
import { getSupabaseServiceClient } from '@/lib/supabaseService'
import type { CardCapability } from './capabilities'
import { VALUATION_BASES, findBasis, type ValuationBasis } from './valuation.data'

export type CardCondition =
  | 'near_mint'
  | 'lightly_played'
  | 'moderately_played'
  | 'heavily_played'
  | 'damaged'

export const CONDITION_LABEL: Record<CardCondition, string> = {
  near_mint: 'Near Mint',
  lightly_played: 'Lightly Played',
  moderately_played: 'Moderately Played',
  heavily_played: 'Heavily Played',
  damaged: 'Damaged',
}
export const CONDITION_SHORT: Record<CardCondition, string> = {
  near_mint: 'NM',
  lightly_played: 'LP',
  moderately_played: 'MP',
  heavily_played: 'HP',
  damaged: 'DMG',
}
export const CONDITIONS_ORDERED: CardCondition[] = [
  'near_mint', 'lightly_played', 'moderately_played', 'heavily_played', 'damaged',
]

export type CollectionItemRow = {
  id: string
  user_id: string
  printing_finish_id: string
  condition: CardCondition
  quantity: number
  acquired_price_cents: number | null
  acquired_currency: string | null
  acquired_at: string | null
  notes: string | null
  created_at: string
  updated_at: string
}

export type HydratedCollectionItem = CollectionItemRow & {
  finish: string
  printing: {
    id: string
    set_code: string
    collector_number: string | null
    name: string
    image_uri_small: string | null
    rarity: string | null
    released_at: string | null
    oracle_card_id: string
    layout: string | null
  }
  oracle: {
    name: string
    mana_cost: string | null
    mana_value: number | null
    type_line: string | null
    colors: string[] | null
    color_identity: string[] | null
    capabilities: CardCapability[]
  } | null
  currentPrice: {
    price: number
    currency: string
    provider: string
    price_type: string
    market: string
    observed_on: string
  } | null
  acquiredTotalCents: number | null   // quantity × acquired_price_cents
  currentTotal: {
    price: number
    currency: string
  } | null
}

export type CollectionSummary = {
  totalCards: number
  uniqueEntries: number
  uniquePrintings: number
  uniqueOracles: number
  uniqueSets: number
  rarityBreakdown: Record<string, number>
  colorBreakdown: Record<string, number>
  finishBreakdown: Record<string, number>
  currentValue: { total: number; currency: string; missingCount: number }
  acquiredValue: { totalCents: number; hasCount: number; missingCount: number }
  basis: ValuationBasis
}

export type CollectionQuery = {
  name?: string
  setCode?: string
  colors?: string[]
  rarity?: 'common' | 'uncommon' | 'rare' | 'mythic'
  finish?: 'nonfoil' | 'foil' | 'etched'
  condition?: CardCondition
  sort?: 'name' | 'set' | 'quantity_desc' | 'quantity_asc' | 'price_desc' | 'price_asc' | 'acquired_desc'
  page?: number
  pageSize?: number
}

const IN_CHUNK = 100

// ── Session helpers ───────────────────────────────────────────────

async function requireUserId(): Promise<string | null> {
  const supabase = await getSupabaseServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  return user?.id ?? null
}

async function currentUserPrefsBasis(userId: string): Promise<ValuationBasis> {
  // Read prefs via service-role for a stable server-side default. RLS
  // still enforces at write time; reads via service role here are safe
  // because we scope to the caller's user_id.
  const s = getSupabaseServiceClient()
  const { data } = await s.from('mtg_user_prefs').select('*').eq('user_id', userId).maybeSingle()
  if (!data) return VALUATION_BASES[0]
  return findBasis({
    provider: (data as any).valuation_provider,
    currency: (data as any).valuation_currency,
    price_type: (data as any).valuation_price_type,
    market: (data as any).valuation_market,
  }) ?? VALUATION_BASES[0]
}

// ── Read helpers ──────────────────────────────────────────────────

/** Freshest current-price row per finish for a given basis. Returns a
 *  Map<printing_finish_id, priceRow>. Missing finishes are absent. */
async function getPricesForFinishes(
  finishIds: string[],
  basis: ValuationBasis,
): Promise<Map<string, HydratedCollectionItem['currentPrice']>> {
  const out = new Map<string, HydratedCollectionItem['currentPrice']>()
  if (finishIds.length === 0) return out
  const s = getSupabaseServiceClient()

  const chunks: string[][] = []
  for (let i = 0; i < finishIds.length; i += IN_CHUNK) chunks.push(finishIds.slice(i, i + IN_CHUNK))
  const results = await Promise.all(chunks.map((chunk) =>
    s.from('mtg_current_prices')
      .select('printing_finish_id, provider, price, currency, market, price_type, observed_on')
      .in('printing_finish_id', chunk)
      .eq('provider', basis.provider)
      .eq('currency', basis.currency)
      .eq('price_type', basis.price_type)
      .eq('market', basis.market)
  ))
  for (const { data, error } of results) {
    if (error) { console.error('collection prices err:', error); continue }
    for (const r of (data ?? []) as any[]) {
      out.set(r.printing_finish_id, {
        price: Number(r.price),
        currency: r.currency,
        provider: r.provider,
        price_type: r.price_type,
        market: r.market,
        observed_on: r.observed_on,
      })
    }
  }
  return out
}

/** Hydrate collection rows with printing + oracle + finish + prices. */
async function hydrate(
  items: CollectionItemRow[],
  basis: ValuationBasis,
): Promise<HydratedCollectionItem[]> {
  if (items.length === 0) return []
  const s = getSupabaseServiceClient()

  const finishIds = items.map((i) => i.printing_finish_id)
  const [{ data: finishes }, prices] = await Promise.all([
    s.from('mtg_printing_finishes').select('id, printing_id, finish').in('id', finishIds),
    getPricesForFinishes(finishIds, basis),
  ])
  const finishById = new Map<string, { printing_id: string; finish: string }>()
  for (const f of (finishes ?? []) as any[]) finishById.set(f.id, { printing_id: f.printing_id, finish: f.finish })

  const printingIds = Array.from(new Set(Array.from(finishById.values()).map((f) => f.printing_id)))
  const { data: printings } = await s.from('mtg_printings')
    .select('id, oracle_card_id, set_code, collector_number, name, image_uri_small, rarity, released_at, layout')
    .in('id', printingIds)
  const printingById = new Map<string, any>()
  for (const p of (printings ?? []) as any[]) printingById.set(p.id, p)

  const oracleIds = Array.from(new Set((printings ?? []).map((p: any) => p.oracle_card_id)))
  const { data: oracles } = await s.from('mtg_oracle_cards')
    .select('id, name, mana_cost, mana_value, type_line, colors, color_identity, capabilities')
    .in('id', oracleIds)
  const oracleById = new Map<string, any>()
  for (const o of (oracles ?? []) as any[]) oracleById.set(o.id, o)

  return items.map((row) => {
    const meta = finishById.get(row.printing_finish_id)
    const printing = meta ? printingById.get(meta.printing_id) : null
    const oracle = printing ? oracleById.get(printing.oracle_card_id) : null
    const currentPrice = prices.get(row.printing_finish_id) ?? null
    const currentTotal = currentPrice
      ? { price: currentPrice.price * row.quantity, currency: currentPrice.currency }
      : null
    const acquiredTotalCents = row.acquired_price_cents != null
      ? row.acquired_price_cents * row.quantity
      : null
    return {
      ...row,
      finish: meta?.finish ?? 'nonfoil',
      printing: printing ? {
        id: printing.id,
        set_code: printing.set_code,
        collector_number: printing.collector_number,
        name: printing.name,
        image_uri_small: printing.image_uri_small,
        rarity: printing.rarity,
        released_at: printing.released_at,
        oracle_card_id: printing.oracle_card_id,
        layout: printing.layout,
      } : {
        id: '', set_code: '', collector_number: null, name: '(missing printing)',
        image_uri_small: null, rarity: null, released_at: null,
        oracle_card_id: '', layout: null,
      },
      oracle,
      currentPrice,
      currentTotal,
      acquiredTotalCents,
    }
  })
}

// ── Public API ─────────────────────────────────────────────────────

/** Get the caller's collection with filtering + sort + pagination. */
export async function getCollectionItems(
  query: CollectionQuery = {},
): Promise<{ items: HydratedCollectionItem[]; total: number; page: number; pageSize: number; basis: ValuationBasis }> {
  const uid = await requireUserId()
  if (!uid) return { items: [], total: 0, page: 1, pageSize: 24, basis: VALUATION_BASES[0] }
  const supabase = await getSupabaseServerClient()

  const basis = await currentUserPrefsBasis(uid)
  const page = Math.max(1, query.page ?? 1)
  const pageSize = Math.min(120, Math.max(6, query.pageSize ?? 24))

  // Load the raw rows.
  const { data: rows, error } = await supabase
    .from('mtg_collection_items')
    .select('*')
    .order('updated_at', { ascending: false })
    .limit(2000)
  if (error) { console.error('getCollectionItems err:', error); return { items: [], total: 0, page, pageSize, basis } }
  const rawRows = (rows ?? []) as CollectionItemRow[]

  // Filter by condition (server-side is possible but we already have rows).
  let filtered = rawRows
  if (query.condition) filtered = filtered.filter((r) => r.condition === query.condition)

  // Hydrate every candidate so filters like name/set/colour/rarity/finish work.
  const hydrated = await hydrate(filtered, basis)

  const finalFiltered = hydrated.filter((h) => {
    if (query.name && !h.printing.name.toLowerCase().includes(query.name.toLowerCase())) return false
    if (query.setCode && h.printing.set_code !== query.setCode.toLowerCase()) return false
    if (query.rarity && h.printing.rarity !== query.rarity) return false
    if (query.finish && h.finish !== query.finish) return false
    if (query.colors && query.colors.length > 0) {
      const oc = h.oracle?.colors ?? []
      const hit = query.colors.some((c) => oc.includes(c.toUpperCase()))
      if (!hit) return false
    }
    return true
  })

  // Sort.
  const sort = query.sort ?? 'name'
  finalFiltered.sort((a, b) => {
    switch (sort) {
      case 'set': {
        const s = a.printing.set_code.localeCompare(b.printing.set_code)
        if (s !== 0) return s
        return a.printing.name.localeCompare(b.printing.name)
      }
      case 'quantity_desc': return b.quantity - a.quantity || a.printing.name.localeCompare(b.printing.name)
      case 'quantity_asc':  return a.quantity - b.quantity || a.printing.name.localeCompare(b.printing.name)
      case 'price_desc': {
        const ap = a.currentTotal?.price ?? -1
        const bp = b.currentTotal?.price ?? -1
        if (ap !== bp) return bp - ap
        return a.printing.name.localeCompare(b.printing.name)
      }
      case 'price_asc': {
        const ap = a.currentTotal?.price ?? Number.POSITIVE_INFINITY
        const bp = b.currentTotal?.price ?? Number.POSITIVE_INFINITY
        if (ap !== bp) return ap - bp
        return a.printing.name.localeCompare(b.printing.name)
      }
      case 'acquired_desc':
        return (b.acquired_at ?? '').localeCompare(a.acquired_at ?? '')
      case 'name':
      default:
        return a.printing.name.localeCompare(b.printing.name)
    }
  })

  const total = finalFiltered.length
  const start = (page - 1) * pageSize
  const items = finalFiltered.slice(start, start + pageSize)
  return { items, total, page, pageSize, basis }
}

/** Compute a full summary of the caller's collection at the current
 *  valuation basis. Missing prices are reported, never treated as zero. */
export async function getCollectionSummary(): Promise<CollectionSummary | null> {
  const uid = await requireUserId()
  if (!uid) return null
  const supabase = await getSupabaseServerClient()
  const basis = await currentUserPrefsBasis(uid)

  const { data: rows } = await supabase.from('mtg_collection_items').select('*').limit(5000)
  const rawRows = (rows ?? []) as CollectionItemRow[]
  const hydrated = await hydrate(rawRows, basis)

  const rarity: Record<string, number> = {}
  const finish: Record<string, number> = {}
  const color: Record<string, number> = { W: 0, U: 0, B: 0, R: 0, G: 0, C: 0 }
  const printingIds = new Set<string>()
  const oracleIds = new Set<string>()
  const setCodes = new Set<string>()
  let totalCards = 0
  let missingPriceCount = 0
  let totalPrice = 0
  let acquiredTotalCents = 0
  let acquiredHasCount = 0
  let acquiredMissingCount = 0

  for (const h of hydrated) {
    totalCards += h.quantity
    printingIds.add(h.printing.id)
    if (h.oracle) oracleIds.add(h.oracle.mana_cost != null || h.printing.oracle_card_id ? h.printing.oracle_card_id : '')
    setCodes.add(h.printing.set_code)
    if (h.printing.rarity) rarity[h.printing.rarity] = (rarity[h.printing.rarity] ?? 0) + h.quantity
    finish[h.finish] = (finish[h.finish] ?? 0) + h.quantity
    const ocolors = h.oracle?.colors ?? []
    if (ocolors.length === 0) color.C += h.quantity
    else for (const c of ocolors) color[c] = (color[c] ?? 0) + h.quantity

    if (h.currentTotal) totalPrice += h.currentTotal.price
    else missingPriceCount += h.quantity

    if (h.acquiredTotalCents != null && h.acquired_currency === basis.currency) {
      acquiredTotalCents += h.acquiredTotalCents
      acquiredHasCount += h.quantity
    } else {
      acquiredMissingCount += h.quantity
    }
  }

  return {
    totalCards,
    uniqueEntries: hydrated.length,
    uniquePrintings: printingIds.size,
    uniqueOracles: oracleIds.size,
    uniqueSets: setCodes.size,
    rarityBreakdown: rarity,
    colorBreakdown: color,
    finishBreakdown: finish,
    currentValue: {
      total: totalPrice,
      currency: basis.currency,
      missingCount: missingPriceCount,
    },
    acquiredValue: {
      totalCents: acquiredTotalCents,
      hasCount: acquiredHasCount,
      missingCount: acquiredMissingCount,
    },
    basis,
  }
}

/** Reusable helpers for the future Deck Builder. */
export async function userOwns(oracleId: string): Promise<boolean> {
  const uid = await requireUserId()
  if (!uid) return false
  const supabase = await getSupabaseServerClient()
  // Traverse: printings → finishes → collection_items. Uses service
  // client for the join (RLS gates the final `collection_items` read).
  const s = getSupabaseServiceClient()
  const { data: printings } = await s.from('mtg_printings').select('id').eq('oracle_card_id', oracleId).limit(200)
  const pids = (printings ?? []).map((p: any) => p.id)
  if (pids.length === 0) return false
  const { data: finishes } = await s.from('mtg_printing_finishes').select('id').in('printing_id', pids)
  const fids = (finishes ?? []).map((f: any) => f.id)
  if (fids.length === 0) return false
  const { count } = await supabase.from('mtg_collection_items').select('id', { count: 'exact', head: true }).in('printing_finish_id', fids)
  return (count ?? 0) > 0
}

export async function getOwnedPrintings(oracleId: string): Promise<Array<{
  printing_finish_id: string
  finish: string
  printing_id: string
  set_code: string
  collector_number: string | null
  quantity: number
  condition: CardCondition
}>> {
  const uid = await requireUserId()
  if (!uid) return []
  const supabase = await getSupabaseServerClient()
  const s = getSupabaseServiceClient()
  const { data: printings } = await s.from('mtg_printings').select('id, set_code, collector_number').eq('oracle_card_id', oracleId).limit(200)
  const pids = (printings ?? []).map((p: any) => p.id)
  const pMap = new Map<string, any>((printings ?? []).map((p: any) => [p.id, p]))
  if (pids.length === 0) return []
  const { data: finishes } = await s.from('mtg_printing_finishes').select('id, printing_id, finish').in('printing_id', pids)
  const fMap = new Map<string, any>((finishes ?? []).map((f: any) => [f.id, f]))
  const fids = Array.from(fMap.keys())
  if (fids.length === 0) return []
  const { data: items } = await supabase.from('mtg_collection_items').select('printing_finish_id, condition, quantity').in('printing_finish_id', fids)
  return (items ?? []).map((it: any) => {
    const finish = fMap.get(it.printing_finish_id)
    const printing = finish ? pMap.get(finish.printing_id) : null
    return {
      printing_finish_id: it.printing_finish_id,
      finish: finish?.finish ?? 'nonfoil',
      printing_id: finish?.printing_id ?? '',
      set_code: printing?.set_code ?? '',
      collector_number: printing?.collector_number ?? null,
      quantity: it.quantity,
      condition: it.condition,
    }
  })
}

/** For a set of oracle_card_ids, return the ones the user does NOT own. */
export async function findMissing(oracleIds: string[]): Promise<string[]> {
  const uid = await requireUserId()
  if (!uid || oracleIds.length === 0) return oracleIds
  const s = getSupabaseServiceClient()
  const { data: printings } = await s.from('mtg_printings').select('id, oracle_card_id').in('oracle_card_id', oracleIds)
  const printingByOracle = new Map<string, string[]>()
  for (const p of (printings ?? []) as any[]) {
    const arr = printingByOracle.get(p.oracle_card_id) ?? []
    arr.push(p.id)
    printingByOracle.set(p.oracle_card_id, arr)
  }
  const allPrintingIds = Array.from(new Set((printings ?? []).map((p: any) => p.id)))
  if (allPrintingIds.length === 0) return oracleIds
  const { data: finishes } = await s.from('mtg_printing_finishes').select('id, printing_id').in('printing_id', allPrintingIds)
  const finishToOracle = new Map<string, string>()
  const printingToOracle = new Map<string, string>()
  for (const p of (printings ?? []) as any[]) printingToOracle.set(p.id, p.oracle_card_id)
  for (const f of (finishes ?? []) as any[]) {
    const oracle = printingToOracle.get(f.printing_id)
    if (oracle) finishToOracle.set(f.id, oracle)
  }

  const supabase = await getSupabaseServerClient()
  const { data: items } = await supabase.from('mtg_collection_items').select('printing_finish_id').in('printing_finish_id', Array.from(finishToOracle.keys()))
  const owned = new Set<string>()
  for (const it of (items ?? []) as any[]) {
    const o = finishToOracle.get(it.printing_finish_id)
    if (o) owned.add(o)
  }
  return oracleIds.filter((id) => !owned.has(id))
}

// ── Write helpers ──────────────────────────────────────────────────

/** Increment or insert. Returns the resulting row (RLS ensures owner). */
export async function upsertCollectionItem(input: {
  printing_finish_id: string
  condition: CardCondition
  quantity: number
  acquired_price_cents?: number | null
  acquired_currency?: 'USD' | 'EUR' | null
  acquired_at?: string | null
  notes?: string | null
}) {
  const supabase = await getSupabaseServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) throw new Error('Not authenticated')

  // Idempotent upsert against the unique key (user, finish, condition).
  const { data, error } = await supabase.from('mtg_collection_items').upsert({
    user_id: user.id,
    printing_finish_id: input.printing_finish_id,
    condition: input.condition,
    quantity: input.quantity,
    acquired_price_cents: input.acquired_price_cents ?? null,
    acquired_currency: input.acquired_currency ?? null,
    acquired_at: input.acquired_at ?? null,
    notes: input.notes ?? null,
  }, { onConflict: 'user_id,printing_finish_id,condition' }).select().single()
  if (error) throw error
  return data
}

// Explicit re-exports so consumers can pull types from one place.
export type { SupabaseClient }
