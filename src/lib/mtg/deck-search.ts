// src/lib/mtg/deck-search.ts
//
// Deck-aware card search primitives. These are the exact functions
// Phase 3C AI will call — no separate AI-only retrieval layer. Every
// filter still resolves into a real DB constraint. Never invents
// strategic recommendations.

import 'server-only'
import { getSupabaseServerClient } from '@/lib/supabase/server'
import { getSupabaseServiceClient } from '@/lib/supabaseService'
import { findCards, findSimilar, type FinderQuery, type FinderHit, type SimilarHit, type FinderResult } from './finder'
import type { DeckContext } from './deck-context'
import type { CardCapability } from './capabilities'
import { getFormatRule } from './format-rules'

export type DeckSearchOptions = {
  /** Extra request the user layered on top of deck context. */
  request?: Partial<FinderQuery>
  /** Only include cards the caller already owns any printing of. */
  ownedOnly?: boolean
  /** Only include cards the caller does NOT already own. */
  missingOnly?: boolean
  /** Skip cards that are already anywhere in the deck. */
  excludeInDeck?: boolean
  page?: number
  pageSize?: number
}

export type DeckSearchHit = FinderHit & {
  ownedTotal: number      // total owned across all printings
  copiesInDeck: number    // total quantity across all zones of this deck
}

export type DeckSearchResult = FinderResult & {
  hits: DeckSearchHit[]
  filters: {
    format: string
    commanderColorIdentity: string[] | null
    ownedOnly: boolean
    missingOnly: boolean
    excludeInDeck: boolean
  }
}

/** Compose a FinderQuery from the deck context plus a user request.
 *  Commander CI is auto-applied when the deck has a commander; the
 *  user's own request can still add capabilities/mana-value/etc. */
export function composeDeckQuery(deck: DeckContext, request: Partial<FinderQuery> = {}): FinderQuery {
  const rule = getFormatRule(deck.deck.format)
  const commanderCI = rule?.enforceColorIdentity && deck.commanders.length > 0
    ? Array.from(new Set(deck.commanders.flatMap((c) => c.color_identity)))
    : undefined

  return {
    ...request,
    legalIn: deck.deck.format as any,
    colorIdentity: commanderCI ?? request.colorIdentity,
  }
}

// ── searchLegalCards ────────────────────────────────────────────────

/** Deck-aware search. Automatically enforces format legality + (for
 *  Commander formats) commander colour identity. Layered filters
 *  (ownedOnly / missingOnly / excludeInDeck) are applied server-side
 *  by first pulling the caller's collection + deck contents into an
 *  ID set. */
export async function searchLegalCards(deck: DeckContext, opts: DeckSearchOptions = {}): Promise<DeckSearchResult> {
  // getSupabaseServerClient() intentionally NOT called at top level —
  // it requires Next's request scope. Only getOwnedTotalsForOracles()
  // needs the caller session, and it self-scopes.
  const query = composeDeckQuery(deck, opts.request)
  const page = Math.max(1, opts.page ?? 1)
  const pageSize = Math.min(60, Math.max(1, opts.pageSize ?? 30))

  // Exclusions: card in this deck.
  const inDeckIds = opts.excludeInDeck
    ? Array.from(new Set(
        deck.commanders.concat(deck.main, deck.sideboard, deck.companion, deck.maybeboard)
          .map((c) => c.oracle_card_id)
      ))
    : []
  query.excludeOracleIds = [...(query.excludeOracleIds ?? []), ...inDeckIds]

  // Pull a bigger candidate set — we may filter by ownership after the
  // fact and want enough to fill a page.
  const inner = await findCards(query, { page: 1, pageSize: 200 })

  // Owned / missing intersection — compute in one round-trip against
  // the caller's collection (RLS-scoped).
  let ownedByOracle = new Map<string, number>()
  if (opts.ownedOnly || opts.missingOnly) {
    ownedByOracle = await getOwnedTotalsForOracles(inner.hits.map((h) => h.oracle_card_id))
  }
  const inDeckCount = new Map<string, number>()
  for (const c of deck.commanders.concat(deck.main, deck.sideboard, deck.companion, deck.maybeboard)) {
    inDeckCount.set(c.oracle_card_id, (inDeckCount.get(c.oracle_card_id) ?? 0) + c.quantity)
  }

  const filtered = inner.hits.filter((h) => {
    const owned = ownedByOracle.get(h.oracle_card_id) ?? 0
    if (opts.ownedOnly && owned <= 0) return false
    if (opts.missingOnly && owned > 0) return false
    return true
  })

  const start = (page - 1) * pageSize
  const paged = filtered.slice(start, start + pageSize)

  const hits: DeckSearchHit[] = paged.map((h) => ({
    ...h,
    ownedTotal: ownedByOracle.get(h.oracle_card_id) ?? 0,
    copiesInDeck: inDeckCount.get(h.oracle_card_id) ?? 0,
  }))

  const rule = getFormatRule(deck.deck.format)
  const commanderCI = rule?.enforceColorIdentity && deck.commanders.length > 0
    ? Array.from(new Set(deck.commanders.flatMap((c) => c.color_identity)))
    : null

  return {
    hits,
    total: filtered.length,
    page,
    pageSize,
    appliedFilters: query,
    filters: {
      format: deck.deck.format,
      commanderColorIdentity: commanderCI,
      ownedOnly: Boolean(opts.ownedOnly),
      missingOnly: Boolean(opts.missingOnly),
      excludeInDeck: Boolean(opts.excludeInDeck),
    },
  }
}

// ── findSimilarInDeck / findCheaperAlternatives ─────────────────────

export type DeckAlternativesHit = SimilarHit & {
  currentPrice: FinderHit['cheapest']
  copiesInDeck: number
}

/** "Find alternatives" — deterministic similarity, restricted to the
 *  deck's format and commander CI where applicable. Excludes the card
 *  itself from results. */
export async function findAlternativesInDeck(
  deck: DeckContext,
  oracleId: string,
  limit = 12,
): Promise<DeckAlternativesHit[]> {
  const rule = getFormatRule(deck.deck.format)
  const commanderCI = rule?.enforceColorIdentity && deck.commanders.length > 0
    ? new Set(deck.commanders.flatMap((c) => c.color_identity))
    : null

  const similar = await findSimilar(oracleId, limit * 3)
  const filtered: SimilarHit[] = []
  const s = getSupabaseServiceClient()

  // Filter by format legality (single fast lookup batch).
  const oracleIds = similar.map((h) => h.oracle_card_id)
  const { data: legalRows } = oracleIds.length === 0 ? { data: [] } as any :
    await s.from('mtg_oracle_legalities')
      .select('oracle_card_id')
      .in('oracle_card_id', oracleIds)
      .eq('format', deck.deck.format)
      .eq('legality', 'legal')
  const legalSet = new Set<string>((legalRows ?? []).map((r: any) => r.oracle_card_id))

  // Filter by commander CI.
  for (const h of similar) {
    if (!legalSet.has(h.oracle_card_id)) continue
    if (commanderCI) {
      // Look up the card's colour identity to check subset. Batched below.
      filtered.push(h)
    } else {
      filtered.push(h)
    }
  }

  if (commanderCI && filtered.length > 0) {
    const ciIds = filtered.map((h) => h.oracle_card_id)
    const { data: rows } = await s.from('mtg_oracle_cards').select('id, color_identity').in('id', ciIds)
    const ciByOracle = new Map<string, string[]>()
    for (const r of (rows ?? []) as any[]) ciByOracle.set(r.id, r.color_identity ?? [])
    for (let i = filtered.length - 1; i >= 0; i--) {
      const ci = ciByOracle.get(filtered[i].oracle_card_id) ?? []
      const inside = ci.every((c) => commanderCI.has(c))
      if (!inside) filtered.splice(i, 1)
    }
  }

  const top = filtered.slice(0, limit)

  // Deck-copy counts.
  const inDeckCount = new Map<string, number>()
  for (const c of deck.commanders.concat(deck.main, deck.sideboard, deck.companion, deck.maybeboard)) {
    inDeckCount.set(c.oracle_card_id, (inDeckCount.get(c.oracle_card_id) ?? 0) + c.quantity)
  }

  // Prices at the deck's basis for each alternative.
  const prices = await getCheapestAtBasis(top.map((h) => h.oracle_card_id), deck.pricing.basis)
  return top.map((h) => ({
    ...h,
    currentPrice: prices.get(h.oracle_card_id) ?? null,
    copiesInDeck: inDeckCount.get(h.oracle_card_id) ?? 0,
  }))
}

/** "Find cheaper alternatives" — the target's current price under the
 *  deck's basis is the ceiling. Uses shared capabilities + primary
 *  type + mana-value ± 1 as the similarity filter, plus deck format
 *  legality + commander CI. */
export async function findCheaperAlternatives(
  deck: DeckContext,
  oracleId: string,
  limit = 12,
): Promise<{
  target: { oracle_card_id: string; name: string; currentPrice: FinderHit['cheapest'] } | null
  alternatives: DeckAlternativesHit[]
  reason: string | null
}> {
  const s = getSupabaseServiceClient()
  const { data: baseRow } = await s.from('mtg_oracle_cards')
    .select('id, name, type_line, mana_value, colors, color_identity, keywords, capabilities')
    .eq('id', oracleId)
    .maybeSingle()
  const base = baseRow as any
  if (!base) return { target: null, alternatives: [], reason: 'Card not found in catalogue.' }

  const basis = deck.pricing.basis
  const targetPriceMap = await getCheapestAtBasis([base.id], basis)
  const targetPrice = targetPriceMap.get(base.id) ?? null
  const target = { oracle_card_id: base.id, name: base.name, currentPrice: targetPrice }
  if (!targetPrice) {
    return {
      target,
      alternatives: [],
      reason: `${base.name} has no price under ${basis.provider} ${basis.currency}. Cannot compare cheaper alternatives without a ceiling.`,
    }
  }
  const ceiling = targetPrice.price

  const alts = await findAlternativesInDeck(deck, oracleId, limit * 3)
  const cheaper = alts
    .filter((h) => h.currentPrice && h.currentPrice.price < ceiling && h.currentPrice.currency === basis.currency)
    .slice(0, limit)

  return { target, alternatives: cheaper, reason: null }
}

// ── Helpers ──────────────────────────────────────────────────────────

const IN_CHUNK = 100

/** For each oracle_card_id, sum owned quantities across ALL printings.
 *  RLS enforces owner scope. */
async function getOwnedTotalsForOracles(oracleIds: string[]): Promise<Map<string, number>> {
  const out = new Map<string, number>()
  if (oracleIds.length === 0) return out
  const s = getSupabaseServiceClient()
  // 1) printings → 2) finishes → 3) collection totals for the caller.
  const { data: printings } = await s.from('mtg_printings')
    .select('id, oracle_card_id')
    .in('oracle_card_id', oracleIds)
    .eq('lang', 'en')
    .eq('digital', false)
  const printingToOracle = new Map<string, string>()
  const printingIds: string[] = []
  for (const p of (printings ?? []) as any[]) {
    printingToOracle.set(p.id, p.oracle_card_id)
    printingIds.push(p.id)
  }
  if (printingIds.length === 0) return out

  const finishToOracle = new Map<string, string>()
  for (let i = 0; i < printingIds.length; i += IN_CHUNK) {
    const chunk = printingIds.slice(i, i + IN_CHUNK)
    const { data: finishes } = await s.from('mtg_printing_finishes')
      .select('id, printing_id')
      .in('printing_id', chunk)
    for (const f of (finishes ?? []) as any[]) {
      const oracle = printingToOracle.get(f.printing_id)
      if (oracle) finishToOracle.set(f.id, oracle)
    }
  }
  const finishIds = Array.from(finishToOracle.keys())
  if (finishIds.length === 0) return out

  // Read the caller's collection via the user-scoped client.
  const supabase = await getSupabaseServerClient()
  for (let i = 0; i < finishIds.length; i += IN_CHUNK) {
    const chunk = finishIds.slice(i, i + IN_CHUNK)
    const { data: items } = await supabase.from('mtg_collection_items')
      .select('printing_finish_id, quantity')
      .in('printing_finish_id', chunk)
    for (const it of (items ?? []) as any[]) {
      const oracle = finishToOracle.get(it.printing_finish_id)
      if (!oracle) continue
      out.set(oracle, (out.get(oracle) ?? 0) + Number(it.quantity))
    }
  }
  return out
}

/** Cheapest available paper printing at basis for each Oracle. */
async function getCheapestAtBasis(oracleIds: string[], basis: DeckContext['pricing']['basis']): Promise<Map<string, FinderHit['cheapest']>> {
  const out = new Map<string, FinderHit['cheapest']>()
  if (oracleIds.length === 0) return out
  const s = getSupabaseServiceClient()

  const { data: printings } = await s.from('mtg_printings')
    .select('id, oracle_card_id, set_code, collector_number')
    .in('oracle_card_id', oracleIds)
  const printingsByOracle = new Map<string, any[]>()
  const printingToOracle = new Map<string, string>()
  const allPrintingIds: string[] = []
  for (const p of (printings ?? []) as any[]) {
    const arr = printingsByOracle.get(p.oracle_card_id) ?? []
    arr.push(p)
    printingsByOracle.set(p.oracle_card_id, arr)
    printingToOracle.set(p.id, p.oracle_card_id)
    allPrintingIds.push(p.id)
  }
  if (allPrintingIds.length === 0) return out

  const finishToPrinting = new Map<string, { printing_id: string; finish: string }>()
  for (let i = 0; i < allPrintingIds.length; i += IN_CHUNK) {
    const chunk = allPrintingIds.slice(i, i + IN_CHUNK)
    const { data: finishes } = await s.from('mtg_printing_finishes').select('id, printing_id, finish').in('printing_id', chunk)
    for (const f of (finishes ?? []) as any[]) finishToPrinting.set(f.id, { printing_id: f.printing_id, finish: f.finish })
  }
  const finishIds = Array.from(finishToPrinting.keys())
  if (finishIds.length === 0) return out

  for (let i = 0; i < finishIds.length; i += IN_CHUNK) {
    const chunk = finishIds.slice(i, i + IN_CHUNK)
    const { data: prices } = await s.from('mtg_current_prices')
      .select('printing_finish_id, provider, price, currency, market, price_type')
      .in('printing_finish_id', chunk)
      .eq('provider', basis.provider)
      .eq('currency', basis.currency)
      .eq('price_type', basis.price_type)
      .eq('market', basis.market)
    for (const p of (prices ?? []) as any[]) {
      const meta = finishToPrinting.get(p.printing_finish_id)
      if (!meta) continue
      const oracle = printingToOracle.get(meta.printing_id)
      if (!oracle) continue
      const printing = (printingsByOracle.get(oracle) ?? []).find((x) => x.id === meta.printing_id)
      const cur = out.get(oracle)
      const newVal = {
        price: Number(p.price),
        currency: p.currency,
        provider: p.provider,
        finish: meta.finish,
        printing_id: meta.printing_id,
        printing_set_code: printing?.set_code ?? '',
        printing_collector_number: printing?.collector_number ?? null,
      }
      if (!cur || newVal.price < cur.price) out.set(oracle, newVal)
    }
  }
  return out
}
