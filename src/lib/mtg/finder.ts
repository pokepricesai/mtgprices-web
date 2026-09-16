// src/lib/mtg/finder.ts
// Server-only Card Finder engine. Filters use only real DB constraints
// — capabilities, colours, colour identity, mana value, format
// legality, rarity, price. Never freely invents card recommendations.

import 'server-only'
import { getSupabaseServiceClient } from '@/lib/supabaseService'
import type { CardCapability } from './capabilities'
import { CAPABILITY_LABELS } from './capabilities'
import type { FormatKey } from './formats'
import { FORMAT_BY_KEY } from './formats'
import { buildCardSlug } from './slug'

export type FinderCurrency = 'USD' | 'EUR'
export const FINDER_CURRENCIES: FinderCurrency[] = ['USD', 'EUR']

export type FinderQuery = {
  // Play/Collecting-agnostic dimensions
  name?: string
  types?: string[]                // "Creature", "Instant", "Sorcery", "Enchantment", "Artifact", "Planeswalker", "Land", "Battle"
  caps?: CardCapability[]         // multi-cap AND
  colors?: string[]               // WUBRG — cards' colors overlap ANY of these
  colorless?: boolean             // include colourless
  colorIdentity?: string[]        // colour identity is a SUBSET of these letters
  legalIn?: FormatKey
  rarity?: 'common' | 'uncommon' | 'rare' | 'mythic'
  manaValueMax?: number
  manaValueMin?: number

  // Collecting dimensions
  setCode?: string                // "neo"
  releasedFrom?: string           // "1994-01-01"
  releasedTo?: string             // "2000-12-31"
  reservedList?: boolean
  gameChanger?: boolean
  finish?: 'nonfoil' | 'foil' | 'etched'
  artist?: string

  // Price
  currency?: FinderCurrency
  priceMax?: number
  priceMin?: number
  budgetPreference?: boolean      // "cheap"/"budget" — no hard cap, sort ascending

  // Exclusions — used by deck-context search to hide cards already in
  // the deck (or to hide a specific card when finding alternatives).
  excludeOracleIds?: string[]

  // Sort
  sort?: 'relevance' | 'mv_asc' | 'name' | 'released_desc' | 'released_asc' | 'price_asc' | 'price_desc'
}

export type FinderHit = {
  oracle_card_id: string
  name: string
  mana_cost: string | null
  mana_value: number | null
  type_line: string | null
  colors: string[] | null
  color_identity: string[] | null
  capabilities: CardCapability[]
  layout: string | null
  reserved: boolean
  game_changer: boolean
  // Freshest English printing metadata (mirrors search).
  printing: {
    id: string
    set_code: string
    collector_number: string | null
    image_uri_small: string | null
    image_uri: string | null
    rarity: string | null
    released_at: string | null
  }
  // Cheapest known price across whatever finish/currency matches.
  cheapest: {
    price: number
    currency: FinderCurrency
    provider: string
    finish: string
    printing_id: string
    printing_set_code: string
    printing_collector_number: string | null
  } | null
  // Deterministic "why this matched" list.
  reasons: string[]
}

export type FinderResult = {
  hits: FinderHit[]
  total: number
  page: number
  pageSize: number
  appliedFilters: FinderQuery
}

const PAGE_DEFAULT = 24

/** Convenience: sanitise a colour list to WUBRG letters. */
function sanColors(list: string[] | undefined): string[] {
  return (list ?? []).map((c) => c.toUpperCase()).filter((c) => 'WUBRG'.includes(c))
}

/** Convert a rarity string to a search-friendly value for filtering
 *  freshest printings. */
type PrintingRow = {
  id: string
  oracle_card_id: string
  set_code: string
  collector_number: string | null
  name: string
  image_uri: string | null
  image_uri_small: string | null
  rarity: string | null
  released_at: string | null
}

type OracleRow = {
  id: string
  name: string
  mana_cost: string | null
  mana_value: number | null
  type_line: string | null
  colors: string[] | null
  color_identity: string[] | null
  keywords: string[] | null
  capabilities: string[]
  layout: string | null
  reserved: boolean | null
  game_changer: boolean | null
}

export async function findCards(query: FinderQuery, opts: { page?: number; pageSize?: number } = {}): Promise<FinderResult> {
  const supabase = getSupabaseServiceClient()
  const page = Math.max(1, opts.page ?? 1)
  const pageSize = Math.min(60, Math.max(1, opts.pageSize ?? PAGE_DEFAULT))

  // ── STEP 1: oracle filter via the RPC ──────────────────────────
  // mtg_search_oracle_cards packs the whole Oracle-side filter
  // (capabilities/colours/CI/MV/name/type/exclusions/legality) into
  // one SECURITY-DEFINER stored function so we hit the DB once
  // instead of two PostgREST round-trips + a client-side intersect.
  // Measured 7.7s → 105ms on the commander+cap+color+MV case.
  const wantColors = sanColors(query.colors)
  const wantCI = sanColors(query.colorIdentity)
  const rpcArgs = {
    p_name: query.name && query.name.trim().length >= 2 ? query.name.trim() : null,
    p_type: query.types && query.types.length > 0 ? query.types[0] : null, // one primary type; extra types filtered client-side
    p_capabilities: query.caps && query.caps.length > 0 ? query.caps : null,
    p_colors: wantColors.length > 0 ? wantColors : null,
    p_include_colorless: Boolean(query.colorless),
    p_color_identity: wantCI.length > 0 ? wantCI : null,
    p_legal_in: query.legalIn && FORMAT_BY_KEY[query.legalIn] ? query.legalIn : null,
    p_mv_max: typeof query.manaValueMax === 'number' ? query.manaValueMax : null,
    p_mv_min: typeof query.manaValueMin === 'number' ? query.manaValueMin : null,
    p_reserved: query.reservedList ? true : null,
    p_game_changer: query.gameChanger ? true : null,
    p_exclude_oracles: query.excludeOracleIds && query.excludeOracleIds.length > 0 ? query.excludeOracleIds : null,
    p_limit: 400,
    p_offset: 0,
  }
  const { data: rpcOracles, error: rpcErr } = await supabase.rpc('mtg_search_oracle_cards', rpcArgs)
  if (rpcErr) { console.error('findCards rpc err:', rpcErr); return emptyResult(query, page, pageSize) }
  let oracleRows = (rpcOracles ?? []) as OracleRow[]

  // Client-side filter for a second/third type filter — RPC accepts a
  // single primary type substring. Rare enough that we keep it simple.
  if (query.types && query.types.length > 1) {
    const remaining = query.types.slice(1).map((t) => t.toLowerCase())
    oracleRows = oracleRows.filter((r) => {
      const t = (r.type_line ?? '').toLowerCase()
      return remaining.every((rt) => t.includes(rt))
    })
  }

  if (oracleRows.length === 0) return emptyResult(query, page, pageSize)
  let oracleIds = oracleRows.map((r) => r.id)

  const oracleById = new Map<string, OracleRow>()
  for (const r of oracleRows) oracleById.set(r.id, r)

  // ── STEP 3: freshest printing per oracle ─────────────────────
  // Chunk the .in(oracle_ids, [...]) — PostgREST has a URL-size
  // header cap around ~16KB. 200 UUIDs (36 chars each) blows it
  // out. Chunk to 60 IDs per request. Each chunk is a separate
  // round-trip; run them in parallel.
  const IN_ORACLE_CHUNK = 60
  const buildPrintingsQuery = (chunk: string[]) => {
    let q = supabase
      .from('mtg_printings')
      .select('id, oracle_card_id, set_code, collector_number, name, image_uri, image_uri_small, rarity, released_at')
      .in('oracle_card_id', chunk)
      .eq('lang', 'en')
      .eq('digital', false)
      .order('released_at', { ascending: false, nullsFirst: false })
    if (query.rarity) q = q.eq('rarity', query.rarity)
    if (query.setCode) q = q.eq('set_code', query.setCode.toLowerCase())
    if (query.releasedFrom) q = q.gte('released_at', query.releasedFrom)
    if (query.releasedTo)   q = q.lte('released_at', query.releasedTo)
    if (query.artist && query.artist.length >= 2) q = q.ilike('artist', `%${query.artist.trim()}%`)
    return q
  }
  const printingChunks: string[][] = []
  for (let i = 0; i < oracleIds.length; i += IN_ORACLE_CHUNK) printingChunks.push(oracleIds.slice(i, i + IN_ORACLE_CHUNK))
  const printingResults = await Promise.all(printingChunks.map(buildPrintingsQuery))
  const printings: PrintingRow[] = []
  for (const { data, error } of printingResults) {
    if (error) { console.error('findCards printings err:', error); return emptyResult(query, page, pageSize) }
    for (const p of (data ?? []) as PrintingRow[]) printings.push(p)
  }

  // Freshest per oracle_card_id.
  const seen = new Set<string>()
  const freshest = new Map<string, PrintingRow>()
  for (const p of (printings ?? []) as PrintingRow[]) {
    if (seen.has(p.oracle_card_id)) continue
    seen.add(p.oracle_card_id)
    freshest.set(p.oracle_card_id, p)
  }
  // Keep only oracles that survived the printing filter.
  const filteredOracleIds = oracleIds.filter((id) => freshest.has(id))
  if (filteredOracleIds.length === 0) return emptyResult(query, page, pageSize)

  // ── STEP 4: prices (finish + currency-aware) ─────────────────
  const printingIds = filteredOracleIds.map((id) => freshest.get(id)!.id)
  const cheapestByPrinting = await getCheapestByPrinting(printingIds, {
    currency: query.currency,
    finish: query.finish,
  })

  // ── STEP 5: price filters + sort + paginate ──────────────────
  let assembled: FinderHit[] = filteredOracleIds.map((id) => {
    const o = oracleById.get(id)!
    const p = freshest.get(id)!
    const cheapest = cheapestByPrinting.get(p.id) ?? null
    return buildHit(o, p, cheapest, query)
  })

  // Hard price constraints — currency-aware. Only cards that HAVE a
  // matching-currency price survive when a price filter is set.
  const hasPriceFilter =
    typeof query.priceMax === 'number' || typeof query.priceMin === 'number' || Boolean(query.finish)
  if (hasPriceFilter) {
    assembled = assembled.filter((h) => {
      if (!h.cheapest) return false
      if (query.currency && h.cheapest.currency !== query.currency) return false
      if (typeof query.priceMax === 'number' && h.cheapest.price > query.priceMax) return false
      if (typeof query.priceMin === 'number' && h.cheapest.price < query.priceMin) return false
      return true
    })
  }

  // Sort.
  assembled = sortHits(assembled, query)

  const total = assembled.length
  const start = (page - 1) * pageSize
  const hits = assembled.slice(start, start + pageSize)

  return {
    hits,
    total,
    page,
    pageSize,
    appliedFilters: query,
  }
}

function emptyResult(query: FinderQuery, page: number, pageSize: number): FinderResult {
  return { hits: [], total: 0, page, pageSize, appliedFilters: query }
}

function sortHits(hits: FinderHit[], q: FinderQuery): FinderHit[] {
  const arr = [...hits]
  const sort = q.sort ?? (q.budgetPreference ? 'price_asc' : 'relevance')
  switch (sort) {
    case 'name':
      return arr.sort((a, b) => a.name.localeCompare(b.name))
    case 'mv_asc':
      return arr.sort((a, b) => (a.mana_value ?? 999) - (b.mana_value ?? 999) || a.name.localeCompare(b.name))
    case 'released_desc':
      return arr.sort((a, b) => (b.printing.released_at ?? '').localeCompare(a.printing.released_at ?? ''))
    case 'released_asc':
      return arr.sort((a, b) => (a.printing.released_at ?? '9999').localeCompare(b.printing.released_at ?? '9999'))
    case 'price_asc':
      return arr.sort((a, b) => {
        const ap = a.cheapest?.price ?? Number.POSITIVE_INFINITY
        const bp = b.cheapest?.price ?? Number.POSITIVE_INFINITY
        if (ap !== bp) return ap - bp
        return a.name.localeCompare(b.name)
      })
    case 'price_desc':
      return arr.sort((a, b) => {
        const ap = a.cheapest?.price ?? -1
        const bp = b.cheapest?.price ?? -1
        if (ap !== bp) return bp - ap
        return a.name.localeCompare(b.name)
      })
    case 'relevance':
    default:
      // Default: budget-preference boosts cheapest; otherwise mv asc + name asc.
      return arr.sort((a, b) => {
        if (q.budgetPreference) {
          const ap = a.cheapest?.price ?? Number.POSITIVE_INFINITY
          const bp = b.cheapest?.price ?? Number.POSITIVE_INFINITY
          if (ap !== bp) return ap - bp
        }
        const amv = a.mana_value ?? 999
        const bmv = b.mana_value ?? 999
        if (amv !== bmv) return amv - bmv
        return a.name.localeCompare(b.name)
      })
  }
}

function buildHit(o: OracleRow, p: PrintingRow, cheapest: FinderHit['cheapest'], q: FinderQuery): FinderHit {
  const capabilities = (o.capabilities ?? []) as CardCapability[]
  return {
    oracle_card_id: o.id,
    name: o.name,
    mana_cost: o.mana_cost,
    mana_value: o.mana_value,
    type_line: o.type_line,
    colors: o.colors,
    color_identity: o.color_identity,
    capabilities,
    layout: o.layout,
    reserved: Boolean(o.reserved),
    game_changer: Boolean(o.game_changer),
    printing: {
      id: p.id,
      set_code: p.set_code,
      collector_number: p.collector_number,
      image_uri_small: p.image_uri_small,
      image_uri: p.image_uri,
      rarity: p.rarity,
      released_at: p.released_at,
    },
    cheapest,
    reasons: buildReasons(o, p, capabilities, cheapest, q),
  }
}

function buildReasons(
  o: OracleRow, p: PrintingRow, caps: CardCapability[],
  cheapest: FinderHit['cheapest'], q: FinderQuery,
): string[] {
  const reasons: string[] = []
  if (q.legalIn) reasons.push(`Legal in ${FORMAT_BY_KEY[q.legalIn]?.label ?? q.legalIn}`)
  if (q.colors && q.colors.length > 0) {
    const overlap = (o.colors ?? []).filter((c) => q.colors!.includes(c))
    if (overlap.length) reasons.push(`Colour ${overlap.join('/')}`)
  }
  if (q.colorless && (o.colors ?? []).length === 0) reasons.push('Colourless')
  if (q.colorIdentity && q.colorIdentity.length > 0) {
    const ci = (o.color_identity ?? []).join('') || 'C'
    reasons.push(`Colour identity ${ci}`)
  }
  if (typeof q.manaValueMax === 'number' && o.mana_value != null) {
    reasons.push(`MV ${o.mana_value} ≤ ${q.manaValueMax}`)
  }
  if (typeof q.manaValueMin === 'number' && o.mana_value != null && q.manaValueMax == null) {
    reasons.push(`MV ${o.mana_value} ≥ ${q.manaValueMin}`)
  }
  if (q.caps && q.caps.length > 0) {
    for (const c of q.caps) {
      if (caps.includes(c)) reasons.push(CAPABILITY_LABELS[c])
    }
  }
  if (q.types && q.types.length > 0 && o.type_line) {
    const hit = q.types.find((t) => o.type_line!.toLowerCase().includes(t.toLowerCase()))
    if (hit) reasons.push(hit[0].toUpperCase() + hit.slice(1))
  }
  if (q.rarity && p.rarity === q.rarity) reasons.push(`${q.rarity[0].toUpperCase() + q.rarity.slice(1)} rarity`)
  if (q.setCode && p.set_code === q.setCode.toLowerCase()) reasons.push(`In set ${p.set_code.toUpperCase()}`)
  if (q.reservedList && o.reserved) reasons.push('Reserved List')
  if (q.gameChanger && o.game_changer) reasons.push('Game Changer')
  if (cheapest && (typeof q.priceMax === 'number' || q.budgetPreference)) {
    reasons.push(`${cheapest.currency === 'USD' ? '$' : '€'}${cheapest.price.toFixed(2)} at ${cheapest.provider}`)
  }
  if (q.finish && cheapest?.finish === q.finish) reasons.push(`${q.finish} available`)
  return reasons
}

// ── Cheapest-per-printing helper ─────────────────────────────────────

const IN_CHUNK = 100

type CheapestValue = NonNullable<FinderHit['cheapest']>

/** For each printing_id, return the cheapest paper-retail row that
 *  respects the requested currency and finish. */
async function getCheapestByPrinting(
  printingIds: string[],
  { currency, finish }: { currency?: FinderCurrency; finish?: string },
): Promise<Map<string, CheapestValue>> {
  const out = new Map<string, CheapestValue>()
  if (printingIds.length === 0) return out
  const supabase = getSupabaseServiceClient()

  // Load finishes for these printings.
  const finishChunks: string[][] = []
  for (let i = 0; i < printingIds.length; i += IN_CHUNK) finishChunks.push(printingIds.slice(i, i + IN_CHUNK))
  const finishesResults = await Promise.all(finishChunks.map((chunk) =>
    supabase.from('mtg_printing_finishes').select('id, printing_id, finish').in('printing_id', chunk),
  ))
  const finishRows: { id: string; printing_id: string; finish: string }[] = []
  for (const { data, error } of finishesResults) {
    if (error) { console.error('cheapest: finish chunk err', error); continue }
    for (const r of (data ?? []) as any[]) finishRows.push(r)
  }
  if (finishRows.length === 0) return out

  const finishById = new Map<string, { printing_id: string; finish: string }>()
  const filteredFinishRows = finish ? finishRows.filter((f) => f.finish === finish) : finishRows
  for (const f of filteredFinishRows) finishById.set(f.id, { printing_id: f.printing_id, finish: f.finish })

  const finishIds = Array.from(finishById.keys())
  if (finishIds.length === 0) return out

  // Fetch current prices for those finishes, currency-aware.
  const priceChunks: string[][] = []
  for (let i = 0; i < finishIds.length; i += IN_CHUNK) priceChunks.push(finishIds.slice(i, i + IN_CHUNK))
  const priceResults = await Promise.all(priceChunks.map((chunk) => {
    let q = supabase
      .from('mtg_current_prices')
      .select('printing_finish_id, provider, price, currency, market, price_type')
      .in('printing_finish_id', chunk)
      .eq('market', 'paper')
      .eq('price_type', 'retail')
    if (currency) q = q.eq('currency', currency)
    return q
  }))
  const priceRows: any[] = []
  for (const { data, error } of priceResults) {
    if (error) { console.error('cheapest: price chunk err', error); continue }
    for (const r of data ?? []) priceRows.push(r)
  }

  // Build cheapest-per-printing (respecting finish filter).
  for (const r of priceRows) {
    const meta = finishById.get(r.printing_finish_id)
    if (!meta) continue
    const price = Number(r.price)
    if (!Number.isFinite(price)) continue
    const prev = out.get(meta.printing_id)
    if (!prev || price < prev.price) {
      out.set(meta.printing_id, {
        price,
        currency: r.currency as FinderCurrency,
        provider: r.provider,
        finish: meta.finish,
        printing_id: meta.printing_id,
        printing_set_code: '',   // hydrated by caller from printing meta
        printing_collector_number: null,
      })
    }
  }
  return out
}

// ── Similar-card foundation ──────────────────────────────────────────

export type SimilarHit = {
  oracle_card_id: string
  name: string
  score: number
  reasons: string[]
  printing: {
    set_code: string
    collector_number: string | null
    image_uri_small: string | null
  }
}

/** Deterministic similarity. We do NOT call cards strategically
 *  equivalent — we only report the factual dimensions that overlap:
 *  shared capabilities, colour-identity overlap, matching type family,
 *  mana-value proximity, keyword overlap. */
export async function findSimilar(oracleId: string, limit = 12): Promise<SimilarHit[]> {
  const supabase = getSupabaseServiceClient()
  const { data: baseRow } = await supabase
    .from('mtg_oracle_cards')
    .select('id, name, type_line, colors, color_identity, mana_value, capabilities, keywords')
    .eq('id', oracleId)
    .maybeSingle()
  const base = baseRow as (OracleRow & { keywords: string[] | null }) | null
  if (!base) return []

  const baseCaps = base.capabilities ?? []
  const baseKw = new Set((base.keywords ?? []).map((k) => k.toLowerCase()))
  const baseCI = new Set(base.color_identity ?? [])
  const baseMV = base.mana_value ?? null
  const baseType = (base.type_line ?? '').toLowerCase()
  const primaryType = ['creature', 'instant', 'sorcery', 'enchantment', 'artifact', 'planeswalker', 'battle', 'land']
    .find((t) => baseType.includes(t)) ?? null

  // Candidate pool: match at least one capability OR primary type.
  let candQ = supabase
    .from('mtg_oracle_cards')
    .select('id, name, type_line, colors, color_identity, mana_value, capabilities, keywords')
    .neq('id', oracleId)
    .limit(400)
  if (baseCaps.length > 0) candQ = candQ.overlaps('capabilities', baseCaps)
  else if (primaryType) candQ = candQ.ilike('type_line', `%${primaryType}%`)
  const { data: candidates } = await candQ
  if (!candidates || candidates.length === 0) return []

  const scored: SimilarHit[] = []
  for (const cand of candidates as OracleRow[]) {
    const cCaps = cand.capabilities ?? []
    const capOverlap = cCaps.filter((c) => baseCaps.includes(c as CardCapability))
    const cKw = new Set((cand.keywords ?? []).map((k) => k.toLowerCase()))
    let kwOverlap = 0
    for (const k of Array.from(cKw)) if (baseKw.has(k)) kwOverlap++
    const ciOverlap = (cand.color_identity ?? []).filter((c) => baseCI.has(c)).length
    const ciExact = baseCI.size === (cand.color_identity ?? []).length && ciOverlap === baseCI.size
    const mvDelta = baseMV != null && cand.mana_value != null ? Math.abs(baseMV - cand.mana_value) : 999
    const typeMatch = primaryType && (cand.type_line ?? '').toLowerCase().includes(primaryType) ? 1 : 0

    // Score: capabilities weigh most, then CI, then MV proximity + type + keywords.
    const score =
      capOverlap.length * 4 +
      (ciExact ? 3 : ciOverlap) +
      (mvDelta <= 1 ? 2 : mvDelta <= 2 ? 1 : 0) +
      typeMatch * 2 +
      kwOverlap

    if (score <= 0) continue

    const reasons: string[] = []
    if (capOverlap.length > 0) reasons.push(`Shares ${capOverlap.slice(0, 3).map((c) => CAPABILITY_LABELS[c as CardCapability] ?? c).join(', ')}`)
    if (ciExact) reasons.push('Same colour identity')
    else if (ciOverlap > 0) reasons.push(`Overlapping colour identity`)
    if (mvDelta <= 1 && baseMV != null && cand.mana_value != null) reasons.push(`MV ${cand.mana_value} vs ${baseMV}`)
    if (typeMatch && primaryType) reasons.push(`Both ${primaryType}s`)
    if (kwOverlap > 0) reasons.push(`Shared keyword`)

    scored.push({
      oracle_card_id: cand.id,
      name: cand.name,
      score,
      reasons,
      printing: { set_code: '', collector_number: null, image_uri_small: null }, // hydrated below
    })
  }

  scored.sort((a, b) => b.score - a.score || a.name.localeCompare(b.name))
  const top = scored.slice(0, limit)

  // Hydrate freshest English printing for each hit.
  const ids = top.map((h) => h.oracle_card_id)
  if (ids.length > 0) {
    const { data: prints } = await supabase
      .from('mtg_printings')
      .select('oracle_card_id, set_code, collector_number, image_uri_small, released_at, name')
      .in('oracle_card_id', ids)
      .eq('lang', 'en')
      .eq('digital', false)
      .order('released_at', { ascending: false, nullsFirst: false })
    const seen = new Set<string>()
    const bestByOracle = new Map<string, any>()
    for (const p of prints ?? []) {
      if (seen.has((p as any).oracle_card_id)) continue
      seen.add((p as any).oracle_card_id)
      bestByOracle.set((p as any).oracle_card_id, p)
    }
    for (const h of top) {
      const p = bestByOracle.get(h.oracle_card_id)
      if (p) {
        h.printing = {
          set_code: p.set_code,
          collector_number: p.collector_number,
          image_uri_small: p.image_uri_small,
        }
      }
    }
  }
  return top.filter((h) => h.printing.set_code)
}

/** Convenience: build the /card/ URL slug for a hit. */
export function hitHref(h: FinderHit | SimilarHit): string {
  const p = 'printing' in h ? h.printing : null
  if (!p || !p.set_code || !p.collector_number) return '#'
  return `/set/${p.set_code}/card/${buildCardSlug(p.collector_number, h.name)}`
}
