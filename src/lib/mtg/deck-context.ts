// src/lib/mtg/deck-context.ts
//
// Assembles a factual, structured description of a deck. Consumed by:
//   - The Deck Builder UI (stats panel, validation panel).
//   - Later Phase 3C AI, which must reason over this grounded object
//     rather than inventing deck contents.
//
// No LLM here. No inference. Every field maps to a specific DB row.

import 'server-only'
import { getSupabaseServerClient } from '@/lib/supabase/server'
import { getSupabaseServiceClient } from '@/lib/supabaseService'
import type { FormatKey } from './formats.data'
import type { CardCapability } from './capabilities'
import type { DeckZone, DeckCardForValidation, ValidationResult } from './deck-rules'
import { validateDeck, typeBreakdown, manaCurve, capabilityBreakdown, unionColorIdentity, parseCardTypes } from './deck-rules'
import { getFormatRule } from './format-rules'
import { VALUATION_BASES, findBasis, type ValuationBasis } from './valuation.data'
import type { DeckRow, DeckCardRow } from './decks'

export type DeckCardContext = {
  deck_card_id: string
  oracle_card_id: string
  name: string
  quantity: number
  zone: DeckZone
  mana_cost: string | null
  mana_value: number | null
  colors: string[]
  color_identity: string[]
  type_line: string | null
  types: string[]                    // parsed primary types
  keywords: string[]
  capabilities: CardCapability[]
  oracle_text: string | null
  layout: string | null
  legality: string | null            // legal / not_legal / banned / restricted
  preferredPrinting: {
    printing_id: string
    printing_finish_id: string
    set_code: string
    collector_number: string | null
    finish: string
    image_uri_small: string | null
  } | null
  owned: {
    ownedQuantityAcrossPrintings: number  // over ALL printings of this Oracle
    ownedThisPrinting: number             // for the preferred printing if set
    printings: Array<{ printing_finish_id: string; finish: string; quantity: number; set_code: string; collector_number: string | null }>
  }
  currentPrice: {
    price: number
    currency: string
    provider: string
    price_type: string
    market: string
    observed_on: string
    // "preferred" when we priced the chosen printing/finish; "cheapest"
    // when we fell back to the cheapest available printing.
    source: 'preferred' | 'cheapest'
  } | null
}

export type DeckContext = {
  deck: {
    id: string
    name: string
    format: FormatKey
    description: string | null
    createdAt: string
    updatedAt: string
  }
  commanders: DeckCardContext[]
  main: DeckCardContext[]
  sideboard: DeckCardContext[]
  companion: DeckCardContext[]
  maybeboard: DeckCardContext[]
  totals: {
    main: number
    sideboard: number
    commander: number
    companion: number
    maybeboard: number
  }
  curve: number[]                                          // 0..7+ non-land main
  colorIdentity: string[]                                   // across commanders (or main if no commander)
  typeBreakdown: Record<string, number>
  capabilityBreakdown: Partial<Record<CardCapability, number>>
  ownership: {
    ownedCards: number      // total quantity fully owned in the appropriate finish
    missingCards: number    // total quantity we could not confirm ownership for
    fullyOwnedEntries: number
    partiallyOwnedEntries: number
    missingEntries: number
  }
  pricing: {
    basis: ValuationBasis
    deckValue: number
    deckValueMissingEntries: number     // count of entries without a price on basis
    missingCardsValue: number           // sum of "not-owned" values
  }
  validation: ValidationResult
}

const IN_CHUNK = 100

async function chunked<T, R>(arr: T[], sz: number, fn: (chunk: T[]) => Promise<R[]>): Promise<R[]> {
  if (arr.length === 0) return []
  const out: R[] = []
  for (let i = 0; i < arr.length; i += sz) {
    const res = await fn(arr.slice(i, i + sz))
    out.push(...res)
  }
  return out
}

export async function buildDeckContext(deck: DeckRow, cards: DeckCardRow[]): Promise<DeckContext> {
  const supabase = await getSupabaseServerClient()  // user-scoped, for ownership
  const s = getSupabaseServiceClient()              // catalogue, RLS not needed

  // ── 1. Hydrate oracle_cards (one query batch) ───────────────
  const oracleIds = Array.from(new Set(cards.map((c) => c.oracle_card_id)))
  const oracleRowsPromise = chunked(oracleIds, IN_CHUNK, async (chunk) => {
    const { data } = await s.from('mtg_oracle_cards')
      .select('id, name, mana_cost, mana_value, type_line, oracle_text, colors, color_identity, keywords, capabilities, layout')
      .in('id', chunk)
    return (data ?? []) as any[]
  })

  // Legality for the deck's format.
  const legalityPromise = chunked(oracleIds, IN_CHUNK, async (chunk) => {
    const { data } = await s.from('mtg_oracle_legalities')
      .select('oracle_card_id, legality')
      .in('oracle_card_id', chunk)
      .eq('format', deck.format)
    return (data ?? []) as any[]
  })

  // ── 2. Preferred printings (only where set on the deck row) ─
  const preferredFinishIds = Array.from(new Set(cards.filter((c) => c.printing_finish_id).map((c) => c.printing_finish_id!)))
  const preferredMetaPromise = preferredFinishIds.length === 0 ? Promise.resolve([] as any[]) : chunked(preferredFinishIds, IN_CHUNK, async (chunk) => {
    const { data } = await s.from('mtg_printing_finishes')
      .select('id, printing_id, finish, printings:mtg_printings ( id, set_code, collector_number, image_uri_small )')
      .in('id', chunk)
    return (data ?? []) as any[]
  })

  // ── 3. User's valuation basis (server-scope reads own prefs) ─
  const { data: prefsRow } = await supabase.from('mtg_user_prefs').select('*').maybeSingle()
  const basis: ValuationBasis =
    prefsRow ? (findBasis({
      provider: (prefsRow as any).valuation_provider,
      currency: (prefsRow as any).valuation_currency,
      price_type: (prefsRow as any).valuation_price_type,
      market: (prefsRow as any).valuation_market,
    }) ?? VALUATION_BASES[0]) : VALUATION_BASES[0]

  const [oracleRows, legalityRows, preferredMeta] = await Promise.all([oracleRowsPromise, legalityPromise, preferredMetaPromise])

  const oracleById = new Map<string, any>()
  for (const o of oracleRows) oracleById.set(o.id, o)
  const legalByOracle = new Map<string, string>()
  for (const l of legalityRows) legalByOracle.set(l.oracle_card_id, l.legality)
  const preferredByFinishId = new Map<string, any>()
  for (const m of preferredMeta) preferredByFinishId.set(m.id, m)

  // ── 4. Ownership (RLS-safe: uses caller session) ────────────
  //     For every oracle card in the deck, fetch all its printings +
  //     finishes, then look up the user's owned quantities.
  const { data: printingsForOracles } = await s.from('mtg_printings')
    .select('id, oracle_card_id, set_code, collector_number, name')
    .in('oracle_card_id', oracleIds)
  const printingsByOracle = new Map<string, Array<{ id: string; set_code: string; collector_number: string | null }>>()
  const printingsById = new Map<string, any>()
  for (const p of (printingsForOracles ?? []) as any[]) {
    const arr = printingsByOracle.get(p.oracle_card_id) ?? []
    arr.push({ id: p.id, set_code: p.set_code, collector_number: p.collector_number })
    printingsByOracle.set(p.oracle_card_id, arr)
    printingsById.set(p.id, p)
  }
  const allPrintingIds = Array.from(printingsById.keys())
  const { data: finishesForPrintings } = allPrintingIds.length === 0 ? { data: [] } as any :
    await s.from('mtg_printing_finishes').select('id, printing_id, finish').in('printing_id', allPrintingIds)
  const finishToPrinting = new Map<string, { printing_id: string; finish: string }>()
  const finishByOracle = new Map<string, Array<{ finish_id: string; finish: string; printing_id: string }>>()
  for (const f of (finishesForPrintings ?? []) as any[]) {
    const p = printingsById.get(f.printing_id)
    if (!p) continue
    finishToPrinting.set(f.id, { printing_id: f.printing_id, finish: f.finish })
    const arr = finishByOracle.get(p.oracle_card_id) ?? []
    arr.push({ finish_id: f.id, finish: f.finish, printing_id: f.printing_id })
    finishByOracle.set(p.oracle_card_id, arr)
  }
  const allFinishIds = Array.from(finishToPrinting.keys())

  // Owned by finish (per user, RLS-enforced).
  const { data: ownedRows } = allFinishIds.length === 0 ? { data: [] } as any :
    await supabase.from('mtg_collection_items').select('printing_finish_id, quantity').in('printing_finish_id', allFinishIds)
  const ownedByFinish = new Map<string, number>()
  for (const r of (ownedRows ?? []) as any[]) {
    ownedByFinish.set(r.printing_finish_id, (ownedByFinish.get(r.printing_finish_id) ?? 0) + r.quantity)
  }

  // ── 5. Pricing (basis-aware) ────────────────────────────────
  //  a) For every "preferred" printing_finish_id, get its price at basis.
  //  b) For entries without a preferred printing, take the cheapest
  //     paper printing at basis across all finishes of the oracle.
  const preferredPriceMap = new Map<string, any>()
  if (preferredFinishIds.length > 0) {
    const prices = await chunked(preferredFinishIds, IN_CHUNK, async (chunk) => {
      const { data } = await s.from('mtg_current_prices')
        .select('printing_finish_id, provider, price, currency, market, price_type, observed_on')
        .in('printing_finish_id', chunk)
        .eq('provider', basis.provider)
        .eq('currency', basis.currency)
        .eq('price_type', basis.price_type)
        .eq('market', basis.market)
      return (data ?? []) as any[]
    })
    for (const p of prices) preferredPriceMap.set(p.printing_finish_id, p)
  }

  // Cheapest per oracle at basis.
  const cheapestByOracle = new Map<string, any>()
  if (allFinishIds.length > 0) {
    const prices = await chunked(allFinishIds, IN_CHUNK, async (chunk) => {
      const { data } = await s.from('mtg_current_prices')
        .select('printing_finish_id, provider, price, currency, market, price_type, observed_on')
        .in('printing_finish_id', chunk)
        .eq('provider', basis.provider)
        .eq('currency', basis.currency)
        .eq('price_type', basis.price_type)
        .eq('market', basis.market)
      return (data ?? []) as any[]
    })
    for (const p of prices) {
      const meta = finishToPrinting.get(p.printing_finish_id)
      if (!meta) continue
      const oracle = printingsById.get(meta.printing_id)?.oracle_card_id
      if (!oracle) continue
      const prev = cheapestByOracle.get(oracle)
      if (!prev || Number(p.price) < Number(prev.price)) {
        cheapestByOracle.set(oracle, { ...p, printing_id: meta.printing_id, finish: meta.finish })
      }
    }
  }

  // ── 6. Assemble per-card contexts ────────────────────────────
  const context: DeckCardContext[] = cards.map((c) => {
    const o = oracleById.get(c.oracle_card_id) ?? { name: '(unknown)', capabilities: [] }
    const preferredMeta = c.printing_finish_id ? preferredByFinishId.get(c.printing_finish_id) : null
    const preferredPrice = c.printing_finish_id ? preferredPriceMap.get(c.printing_finish_id) : null

    let currentPrice: DeckCardContext['currentPrice'] = null
    if (preferredPrice) {
      currentPrice = {
        price: Number(preferredPrice.price),
        currency: preferredPrice.currency,
        provider: preferredPrice.provider,
        price_type: preferredPrice.price_type,
        market: preferredPrice.market,
        observed_on: preferredPrice.observed_on,
        source: 'preferred',
      }
    } else {
      const cheapest = cheapestByOracle.get(c.oracle_card_id)
      if (cheapest) {
        currentPrice = {
          price: Number(cheapest.price),
          currency: cheapest.currency,
          provider: cheapest.provider,
          price_type: cheapest.price_type,
          market: cheapest.market,
          observed_on: cheapest.observed_on,
          source: 'cheapest',
        }
      }
    }

    const finishes = finishByOracle.get(c.oracle_card_id) ?? []
    const ownedAcross = finishes.reduce((n, f) => n + (ownedByFinish.get(f.finish_id) ?? 0), 0)
    const ownedThis = c.printing_finish_id ? (ownedByFinish.get(c.printing_finish_id) ?? 0) : 0

    return {
      deck_card_id: c.id,
      oracle_card_id: c.oracle_card_id,
      name: o.name,
      quantity: c.quantity,
      zone: c.zone,
      mana_cost: o.mana_cost ?? null,
      mana_value: o.mana_value ?? null,
      colors: o.colors ?? [],
      color_identity: o.color_identity ?? [],
      type_line: o.type_line ?? null,
      types: parseCardTypes(o.type_line ?? null),
      keywords: o.keywords ?? [],
      capabilities: (o.capabilities ?? []) as CardCapability[],
      oracle_text: o.oracle_text ?? null,
      layout: o.layout ?? null,
      legality: legalByOracle.get(c.oracle_card_id) ?? null,
      preferredPrinting: preferredMeta ? {
        printing_id: preferredMeta.printing_id,
        printing_finish_id: preferredMeta.id,
        set_code: preferredMeta.printings?.set_code,
        collector_number: preferredMeta.printings?.collector_number ?? null,
        finish: preferredMeta.finish,
        image_uri_small: preferredMeta.printings?.image_uri_small ?? null,
      } : null,
      owned: {
        ownedQuantityAcrossPrintings: ownedAcross,
        ownedThisPrinting: ownedThis,
        printings: finishes
          .map((f) => ({
            printing_finish_id: f.finish_id,
            finish: f.finish,
            quantity: ownedByFinish.get(f.finish_id) ?? 0,
            set_code: (printingsById.get(f.printing_id) ?? {}).set_code ?? '',
            collector_number: (printingsById.get(f.printing_id) ?? {}).collector_number ?? null,
          }))
          .filter((f) => f.quantity > 0),
      },
      currentPrice,
    }
  })

  const commanders = context.filter((c) => c.zone === 'commander')
  const main = context.filter((c) => c.zone === 'main')
  const sideboard = context.filter((c) => c.zone === 'sideboard')
  const companion = context.filter((c) => c.zone === 'companion')
  const maybeboard = context.filter((c) => c.zone === 'maybeboard')

  const validationInput: DeckCardForValidation[] = context.map((c) => ({
    oracle_card_id: c.oracle_card_id,
    name: c.name,
    quantity: c.quantity,
    zone: c.zone,
    type_line: c.type_line,
    color_identity: c.color_identity,
    keywords: c.keywords,
    oracle_text: c.oracle_text,
    legality: c.legality,
  }))
  const validation = validateDeck({ format: deck.format, cards: validationInput })

  // Deck value.
  let deckValue = 0
  let missingEntries = 0
  let missingCardsValue = 0
  let fullyOwnedEntries = 0
  let partiallyOwnedEntries = 0
  let missingEntriesCount = 0
  let ownedCards = 0
  let missingCards = 0

  for (const c of context) {
    if (c.zone === 'maybeboard') continue
    if (c.currentPrice) {
      deckValue += c.currentPrice.price * c.quantity
    } else {
      missingEntries += 1
    }
    const ownedRelevant = c.preferredPrinting ? c.owned.ownedThisPrinting : c.owned.ownedQuantityAcrossPrintings
    if (ownedRelevant >= c.quantity) {
      fullyOwnedEntries += 1
      ownedCards += c.quantity
    } else if (ownedRelevant > 0) {
      partiallyOwnedEntries += 1
      ownedCards += ownedRelevant
      missingCards += c.quantity - ownedRelevant
      if (c.currentPrice) missingCardsValue += c.currentPrice.price * (c.quantity - ownedRelevant)
    } else {
      missingEntriesCount += 1
      missingCards += c.quantity
      if (c.currentPrice) missingCardsValue += c.currentPrice.price * c.quantity
    }
  }

  const curve = manaCurve(main.map((c) => ({ ...c, mana_value: c.mana_value })))
  const types = typeBreakdown(main)
  const caps = capabilityBreakdown(main.map((c) => ({ ...c, capabilities: c.capabilities })))

  const colorIdentity = commanders.length > 0
    ? unionColorIdentity(commanders.map((c) => ({ color_identity: c.color_identity })))
    : unionColorIdentity(main.map((c) => ({ color_identity: c.color_identity })))

  return {
    deck: {
      id: deck.id,
      name: deck.name,
      format: deck.format,
      description: deck.description,
      createdAt: deck.created_at,
      updatedAt: deck.updated_at,
    },
    commanders, main, sideboard, companion, maybeboard,
    totals: {
      main: main.reduce((n, c) => n + c.quantity, 0),
      sideboard: sideboard.reduce((n, c) => n + c.quantity, 0),
      commander: commanders.reduce((n, c) => n + c.quantity, 0),
      companion: companion.reduce((n, c) => n + c.quantity, 0),
      maybeboard: maybeboard.reduce((n, c) => n + c.quantity, 0),
    },
    curve, colorIdentity,
    typeBreakdown: types,
    capabilityBreakdown: caps,
    ownership: {
      ownedCards, missingCards,
      fullyOwnedEntries, partiallyOwnedEntries,
      missingEntries: missingEntriesCount,
    },
    pricing: {
      basis,
      deckValue,
      deckValueMissingEntries: missingEntries,
      missingCardsValue,
    },
    validation,
  }
}
