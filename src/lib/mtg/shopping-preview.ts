// src/lib/mtg/shopping-preview.ts
//
// Lightweight shopping-layer wrapper for AI surfaces. Given a set of
// oracle_id+quantity pairs (from an AI Build proposal or Improve
// suggestion list) computes:
//   - copies missing after subtracting the user's collection
//   - estimated cost at a chosen basis
//   - price per Oracle
//
// This runs the DETERMINISTIC pricing layer on the caller's session
// (RLS-scoped collection) and never accepts pricing from the model.

import 'server-only'
import { getSupabaseServiceClient } from '@/lib/supabaseService'
import { getSupabaseServerClient } from '@/lib/supabase/server'
import type { ValuationBasis } from './valuation.data'
import { VALUATION_BASES } from './valuation.data'

export type ShoppingPreviewLine = {
  oracle_card_id: string
  name: string
  needed: number
  owned: number
  missing: number
  price: number | null
  currency: string | null
  provider: string | null
}

export type ShoppingPreview = {
  basis: { provider: string; currency: string; price_type: string; market: string; label: string }
  lines: ShoppingPreviewLine[]
  totals: {
    distinctMissing: number
    totalCopiesMissing: number
    estimatedCost: number
    linesWithoutPrice: number
    currency: string
  }
}

const IN_CHUNK = 100

/** Build a shopping preview for a set of {oracle_id, quantity} pairs.
 *  When basisKey is undefined the caller's default TCGplayer USD retail
 *  is used. */
export async function buildShoppingPreview(
  entries: Array<{ oracle_card_id: string; quantity: number; name?: string }>,
  basis?: ValuationBasis,
): Promise<ShoppingPreview> {
  const b = basis ?? VALUATION_BASES.find((v) => v.provider === 'tcgplayer' && v.currency === 'USD' && v.market === 'paper' && v.price_type === 'retail') ?? VALUATION_BASES[0]

  const need = new Map<string, { name: string; qty: number }>()
  for (const e of entries) {
    const cur = need.get(e.oracle_card_id)
    if (cur) cur.qty += e.quantity
    else need.set(e.oracle_card_id, { name: e.name ?? '', qty: e.quantity })
  }
  if (need.size === 0) {
    return {
      basis: b,
      lines: [],
      totals: { distinctMissing: 0, totalCopiesMissing: 0, estimatedCost: 0, linesWithoutPrice: 0, currency: b.currency },
    }
  }

  const oracleIds = Array.from(need.keys())
  const s = getSupabaseServiceClient()

  // Hydrate names when caller didn't provide them.
  const missingNames = oracleIds.filter((id) => !need.get(id)!.name)
  if (missingNames.length > 0) {
    const { data } = await s.from('mtg_oracle_cards').select('id, name').in('id', missingNames)
    for (const r of (data ?? []) as any[]) {
      const cur = need.get(r.id)
      if (cur) cur.name = r.name
    }
  }

  // Ownership from caller session (RLS-scoped).
  const owned = await callerOwnedTotals(oracleIds)

  // Batch price at the chosen basis — cheapest per Oracle.
  const price = await batchCheapestPriceAtBasis(oracleIds, b)

  const lines: ShoppingPreviewLine[] = oracleIds.map((id) => {
    const entry = need.get(id)!
    const ownedQty = owned.get(id) ?? 0
    const missing = Math.max(0, entry.qty - ownedQty)
    const p = price.get(id) ?? null
    return {
      oracle_card_id: id,
      name: entry.name,
      needed: entry.qty,
      owned: ownedQty,
      missing,
      price: p ? p.price : null,
      currency: p ? p.currency : null,
      provider: p ? p.provider : null,
    }
  }).filter((l) => l.missing > 0)

  const estimatedCost = lines.reduce((n, l) => n + ((l.price ?? 0) * l.missing), 0)
  const totalCopiesMissing = lines.reduce((n, l) => n + l.missing, 0)
  const linesWithoutPrice = lines.filter((l) => l.price == null).length

  return {
    basis: b,
    lines,
    totals: {
      distinctMissing: lines.length,
      totalCopiesMissing,
      estimatedCost,
      linesWithoutPrice,
      currency: b.currency,
    },
  }
}

async function callerOwnedTotals(oracleIds: string[]): Promise<Map<string, number>> {
  const out = new Map<string, number>()
  if (oracleIds.length === 0) return out
  const s = getSupabaseServiceClient()

  const printingToOracle = new Map<string, string>()
  const printingIds: string[] = []
  for (let i = 0; i < oracleIds.length; i += IN_CHUNK) {
    const chunk = oracleIds.slice(i, i + IN_CHUNK)
    const { data } = await s.from('mtg_printings').select('id, oracle_card_id').in('oracle_card_id', chunk).eq('lang', 'en').eq('digital', false)
    for (const p of (data ?? []) as any[]) {
      printingIds.push(p.id)
      printingToOracle.set(p.id, p.oracle_card_id)
    }
  }
  if (printingIds.length === 0) return out
  const finishToOracle = new Map<string, string>()
  for (let i = 0; i < printingIds.length; i += IN_CHUNK) {
    const chunk = printingIds.slice(i, i + IN_CHUNK)
    const { data } = await s.from('mtg_printing_finishes').select('id, printing_id').in('printing_id', chunk)
    for (const f of (data ?? []) as any[]) {
      const oracle = printingToOracle.get(f.printing_id)
      if (oracle) finishToOracle.set(f.id, oracle)
    }
  }
  const finishIds = Array.from(finishToOracle.keys())
  if (finishIds.length === 0) return out

  let supabase: any
  try { supabase = await getSupabaseServerClient() } catch { return out }
  for (let i = 0; i < finishIds.length; i += IN_CHUNK) {
    const chunk = finishIds.slice(i, i + IN_CHUNK)
    const { data } = await supabase.from('mtg_collection_items')
      .select('printing_finish_id, quantity')
      .in('printing_finish_id', chunk)
    for (const it of (data ?? []) as any[]) {
      const oracle = finishToOracle.get(it.printing_finish_id)
      if (!oracle) continue
      out.set(oracle, (out.get(oracle) ?? 0) + Number(it.quantity))
    }
  }
  return out
}

async function batchCheapestPriceAtBasis(
  oracleIds: string[],
  basis: ValuationBasis,
): Promise<Map<string, { price: number; currency: string; provider: string }>> {
  const out = new Map<string, { price: number; currency: string; provider: string }>()
  if (oracleIds.length === 0) return out
  const s = getSupabaseServiceClient()

  const printingIds: string[] = []
  const printingToOracle = new Map<string, string>()
  for (let i = 0; i < oracleIds.length; i += IN_CHUNK) {
    const chunk = oracleIds.slice(i, i + IN_CHUNK)
    const { data } = await s.from('mtg_printings').select('id, oracle_card_id').in('oracle_card_id', chunk).eq('lang', 'en').eq('digital', false)
    for (const p of (data ?? []) as any[]) {
      printingIds.push(p.id)
      printingToOracle.set(p.id, p.oracle_card_id)
    }
  }
  if (printingIds.length === 0) return out

  const finishToOracle = new Map<string, string>()
  for (let i = 0; i < printingIds.length; i += IN_CHUNK) {
    const chunk = printingIds.slice(i, i + IN_CHUNK)
    const { data } = await s.from('mtg_printing_finishes').select('id, printing_id').in('printing_id', chunk)
    for (const f of (data ?? []) as any[]) {
      const oracle = printingToOracle.get(f.printing_id)
      if (oracle) finishToOracle.set(f.id, oracle)
    }
  }
  const finishIds = Array.from(finishToOracle.keys())
  if (finishIds.length === 0) return out

  for (let i = 0; i < finishIds.length; i += IN_CHUNK) {
    const chunk = finishIds.slice(i, i + IN_CHUNK)
    const { data } = await s.from('mtg_current_prices')
      .select('printing_finish_id, provider, price, currency, price_type, market')
      .in('printing_finish_id', chunk)
      .eq('provider', basis.provider)
      .eq('currency', basis.currency)
      .eq('price_type', basis.price_type)
      .eq('market', basis.market)
    for (const p of (data ?? []) as any[]) {
      const oracle = finishToOracle.get(p.printing_finish_id)
      if (!oracle) continue
      const price = Number(p.price)
      const cur = out.get(oracle)
      if (!cur || price < cur.price) {
        out.set(oracle, { price, currency: p.currency, provider: p.provider })
      }
    }
  }
  return out
}
