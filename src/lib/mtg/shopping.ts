// src/lib/mtg/shopping.ts
//
// Deterministic shopping-list layer.
//
// Given a DeckContext (which already has the owner's collection
// resolved via RLS), compute:
//   - missing quantity per Oracle card (deck qty - owned qty)
//   - "cheapest playable" printing/finish and its current price at a
//     chosen basis
//   - "preferred" printing/finish (from mtg_deck_cards.printing_finish_id)
//     with its current price at basis
//   - a provider comparison rowset — real (provider, currency,
//     price_type, market) combinations from mtg_current_prices for
//     each missing Oracle. Never blend currencies.
//   - a purchase URL when we can construct one deterministically from
//     stored identifiers (never guessed).
//
// This module does NOT call the AI, does NOT talk to affiliate
// networks, and is safe to call from any owner-scoped route.

import 'server-only'
import { getSupabaseServiceClient } from '@/lib/supabaseService'
import type { DeckContext, DeckCardContext } from './deck-context'
import type { ValuationBasis } from './valuation.data'
import { buildPurchaseLinksForOracle, type PurchaseLink } from './purchase-links'

export type ShoppingMode = 'cheapest_playable' | 'preferred'

export type MissingLine = {
  oracle_card_id: string
  name: string
  needed: number
  owned: number
  missing: number
  /** The chosen printing to buy, given the mode. */
  chosen: {
    printing_finish_id: string | null
    set_code: string | null
    collector_number: string | null
    finish: string | null
    image_uri_small: string | null
  }
  /** Price at the chosen printing/finish at the deck's basis. */
  price: {
    provider: string
    currency: string
    price: number
    price_type: string
    market: string
    observed_on: string | null
  } | null
  /** Real (provider, currency, price_type, market) combinations that
   *  MTGPrices has priced for this Oracle. Sorted by (currency,
   *  provider). Currencies remain separate — do NOT cross-rank. */
  providerRows: Array<{
    provider: string
    currency: string
    price: number
    price_type: string
    market: string
    finish: string
    set_code: string
    collector_number: string | null
    printing_finish_id: string
  }>
  /** Deterministically constructed purchase URLs. `null` when we
   *  cannot verify a URL from stored data — never guessed. */
  purchaseLinks: PurchaseLink[]
}

export type ShoppingList = {
  mode: ShoppingMode
  basis: {
    provider: string
    currency: string
    price_type: string
    market: string
    label: string
    key: string
  }
  lines: MissingLine[]
  totals: {
    distinctMissing: number      // number of distinct oracle_card_ids missing
    totalCopiesMissing: number   // sum of missing qty
    estimatedCost: number        // sum of missing * price at basis where present
    linesWithoutPrice: number    // count of lines where price is null
    currency: string
  }
}

/** Compute the shopping list for a DeckContext. Uses the caller's
 *  session-scoped ownership data — RLS is enforced upstream. */
export async function buildShoppingList(
  deck: DeckContext,
  mode: ShoppingMode = 'cheapest_playable',
): Promise<ShoppingList> {
  const basis = deck.pricing.basis
  // Aggregate all deck entries (commanders + main + sideboard +
  // companion + maybeboard) by oracle_card_id. Different zones for the
  // same Oracle collapse into a single shopping row — you don't buy
  // two copies of a legendary because it's in both main + commander;
  // for singleton formats it's already qty 1.
  //
  // For non-singleton formats the same card in main + sideboard adds
  // up: buying two total is correct.
  const need = new Map<string, { name: string; qty: number; preferredFinishId: string | null; card: DeckCardContext }>()
  for (const c of deck.commanders.concat(deck.main, deck.sideboard, deck.companion, deck.maybeboard)) {
    const cur = need.get(c.oracle_card_id)
    if (cur) {
      cur.qty += c.quantity
      if (!cur.preferredFinishId && c.preferredPrinting?.printing_finish_id) {
        cur.preferredFinishId = c.preferredPrinting.printing_finish_id
      }
    } else {
      need.set(c.oracle_card_id, {
        name: c.name, qty: c.quantity,
        preferredFinishId: c.preferredPrinting?.printing_finish_id ?? null,
        card: c,
      })
    }
  }

  const missing: Array<{ oracle_card_id: string; name: string; needed: number; owned: number; preferredFinishId: string | null; card: DeckCardContext }> = []
  need.forEach((entry, oracleId) => {
    const owned = entry.card.owned.ownedQuantityAcrossPrintings
    const gap = Math.max(0, entry.qty - owned)
    if (gap === 0) return
    missing.push({
      oracle_card_id: oracleId, name: entry.name,
      needed: entry.qty, owned, preferredFinishId: entry.preferredFinishId,
      card: entry.card,
    })
  })

  if (missing.length === 0) {
    return {
      mode,
      basis: { provider: basis.provider, currency: basis.currency, price_type: basis.price_type, market: basis.market, label: basis.label, key: basis.key },
      lines: [],
      totals: { distinctMissing: 0, totalCopiesMissing: 0, estimatedCost: 0, linesWithoutPrice: 0, currency: basis.currency },
    }
  }

  const oracleIds = missing.map((m) => m.oracle_card_id)

  // Batch-fetch every printing + finish + current price for missing
  // oracles. One trip per join edge, chunked at 60 to stay under the
  // PostgREST URL header limit.
  const s = getSupabaseServiceClient()

  // Printings for these oracles.
  const IN_CHUNK = 60
  const printingRows: any[] = []
  for (let i = 0; i < oracleIds.length; i += IN_CHUNK) {
    const chunk = oracleIds.slice(i, i + IN_CHUNK)
    const { data } = await s.from('mtg_printings')
      .select('id, oracle_card_id, set_code, collector_number, image_uri_small, released_at, scryfall_id')
      .in('oracle_card_id', chunk)
      .eq('lang', 'en')
      .eq('digital', false)
      .order('released_at', { ascending: false, nullsFirst: false })
    for (const p of (data ?? []) as any[]) printingRows.push(p)
  }
  const printingsByOracle = new Map<string, any[]>()
  const printingById = new Map<string, any>()
  const oracleByPrintingId = new Map<string, string>()
  for (const p of printingRows) {
    const arr = printingsByOracle.get(p.oracle_card_id) ?? []
    arr.push(p)
    printingsByOracle.set(p.oracle_card_id, arr)
    printingById.set(p.id, p)
    oracleByPrintingId.set(p.id, p.oracle_card_id)
  }

  // Finishes for these printings.
  const allPrintingIds = printingRows.map((p) => p.id)
  const finishRows: any[] = []
  for (let i = 0; i < allPrintingIds.length; i += IN_CHUNK) {
    const chunk = allPrintingIds.slice(i, i + IN_CHUNK)
    const { data } = await s.from('mtg_printing_finishes').select('id, printing_id, finish').in('printing_id', chunk)
    for (const f of (data ?? []) as any[]) finishRows.push(f)
  }
  const finishById = new Map<string, any>()
  for (const f of finishRows) finishById.set(f.id, f)
  const finishesByOracle = new Map<string, Array<{ finishId: string; printingId: string; finish: string }>>()
  for (const f of finishRows) {
    const p = printingById.get(f.printing_id)
    if (!p) continue
    const arr = finishesByOracle.get(p.oracle_card_id) ?? []
    arr.push({ finishId: f.id, printingId: f.printing_id, finish: f.finish })
    finishesByOracle.set(p.oracle_card_id, arr)
  }

  // Current prices for every relevant finish. We keep ALL rows so we
  // can build the provider comparison and the basis-scoped chosen
  // price in a single query.
  const allFinishIds = finishRows.map((f) => f.id)
  const priceRows: any[] = []
  for (let i = 0; i < allFinishIds.length; i += IN_CHUNK) {
    const chunk = allFinishIds.slice(i, i + IN_CHUNK)
    const { data } = await s.from('mtg_current_prices')
      .select('printing_finish_id, provider, price, currency, price_type, market, observed_on')
      .in('printing_finish_id', chunk)
    for (const p of (data ?? []) as any[]) priceRows.push(p)
  }
  const pricesByFinishId = new Map<string, any[]>()
  for (const p of priceRows) {
    const arr = pricesByFinishId.get(p.printing_finish_id) ?? []
    arr.push(p)
    pricesByFinishId.set(p.printing_finish_id, arr)
  }

  // Purchase links (best-effort deterministic construction).
  const purchaseLinksByOracle = await buildPurchaseLinksForOracle(oracleIds)

  const lines: MissingLine[] = missing.map((m) => {
    const oracleFinishes = finishesByOracle.get(m.oracle_card_id) ?? []

    // ── Provider comparison (all real rows for this oracle). ─────
    const providerRows: MissingLine['providerRows'] = []
    for (const of of oracleFinishes) {
      const printing = printingById.get(of.printingId)
      const prices = pricesByFinishId.get(of.finishId) ?? []
      for (const price of prices) {
        providerRows.push({
          provider: price.provider,
          currency: price.currency,
          price: Number(price.price),
          price_type: price.price_type,
          market: price.market,
          finish: of.finish,
          set_code: printing?.set_code ?? '(?)',
          collector_number: printing?.collector_number ?? null,
          printing_finish_id: of.finishId,
        })
      }
    }
    // Sort: within same currency ascending price; different currencies grouped.
    providerRows.sort((a, b) => {
      if (a.currency !== b.currency) return a.currency.localeCompare(b.currency)
      return a.price - b.price
    })

    // ── Choose printing/price by mode. ────────────────────────────
    let chosenFinishId: string | null = null
    let chosenPrice: MissingLine['price'] = null

    if (mode === 'preferred' && m.preferredFinishId) {
      chosenFinishId = m.preferredFinishId
      const prices = pricesByFinishId.get(m.preferredFinishId) ?? []
      const match = prices.find((p) => p.provider === basis.provider && p.currency === basis.currency && p.price_type === basis.price_type && p.market === basis.market)
      if (match) {
        chosenPrice = {
          provider: match.provider, currency: match.currency,
          price: Number(match.price), price_type: match.price_type,
          market: match.market, observed_on: match.observed_on ?? null,
        }
      }
    }

    if (!chosenPrice) {
      // Cheapest playable at the deck basis, across ALL printings/finishes of this oracle.
      let cheapest: { finishId: string; price: any } | null = null
      for (const of of oracleFinishes) {
        const prices = pricesByFinishId.get(of.finishId) ?? []
        for (const p of prices) {
          if (p.provider !== basis.provider) continue
          if (p.currency !== basis.currency) continue
          if (p.price_type !== basis.price_type) continue
          if (p.market !== basis.market) continue
          const price = Number(p.price)
          if (!cheapest || price < Number(cheapest.price.price)) {
            cheapest = { finishId: of.finishId, price: p }
          }
        }
      }
      if (cheapest) {
        chosenFinishId = cheapest.finishId
        chosenPrice = {
          provider: cheapest.price.provider, currency: cheapest.price.currency,
          price: Number(cheapest.price.price), price_type: cheapest.price.price_type,
          market: cheapest.price.market, observed_on: cheapest.price.observed_on ?? null,
        }
      } else if (mode === 'preferred' && m.preferredFinishId) {
        chosenFinishId = m.preferredFinishId
      }
    }

    // Resolve chosen printing details.
    let chosen: MissingLine['chosen'] = { printing_finish_id: null, set_code: null, collector_number: null, finish: null, image_uri_small: null }
    if (chosenFinishId) {
      const f = finishById.get(chosenFinishId)
      const p = f ? printingById.get(f.printing_id) : null
      chosen = {
        printing_finish_id: chosenFinishId,
        set_code: p?.set_code ?? null,
        collector_number: p?.collector_number ?? null,
        finish: f?.finish ?? null,
        image_uri_small: p?.image_uri_small ?? null,
      }
    }

    return {
      oracle_card_id: m.oracle_card_id,
      name: m.name,
      needed: m.needed,
      owned: m.owned,
      missing: m.needed - m.owned,
      chosen,
      price: chosenPrice,
      providerRows,
      purchaseLinks: purchaseLinksByOracle.get(m.oracle_card_id) ?? [],
    }
  })

  const estimatedCost = lines.reduce((n, l) => n + (l.price ? l.price.price * l.missing : 0), 0)
  const totalCopiesMissing = lines.reduce((n, l) => n + l.missing, 0)
  const linesWithoutPrice = lines.filter((l) => !l.price).length

  return {
    mode,
    basis: { provider: basis.provider, currency: basis.currency, price_type: basis.price_type, market: basis.market, label: basis.label, key: basis.key },
    lines,
    totals: {
      distinctMissing: lines.length,
      totalCopiesMissing,
      estimatedCost,
      linesWithoutPrice,
      currency: basis.currency,
    },
  }
}
