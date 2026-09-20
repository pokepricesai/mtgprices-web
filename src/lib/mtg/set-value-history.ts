// src/lib/mtg/set-value-history.ts
// Server-only. Set-level value trend series over 7 / 30 / 90 days,
// sourced from the precomputed mtg_set_value_daily aggregate.
//
// Methodology (single source of truth for /browse and /set/[setCode]):
//   For each eligible printing in the set, pick a CANONICAL FINISH
//   from mtg_canonical_finish (nonfoil > foil > etched, then any
//   other finish deterministically). That canonical finish is fixed
//   across all dates so the basket is like-for-like at every
//   endpoint. Missing observation = the printing is unpriced for
//   that date. No silent finish substitution. No zero-imputation.
//
// This replaces the previous implementation, which walked
// mtg_price_observations directly and carried the last-known price
// forward. That was correct but slow (multi-second cold path per
// set) and it did NOT match the /browse 30D chip because it used a
// different basket rule.

import 'server-only'
import { getSupabaseServiceClient } from '@/lib/supabaseService'
import type { MarketBasis } from './card-market.types'
import { DEFAULT_BASIS } from './card-market'
import { computeCoverage, HISTORY_COVERAGE_THRESHOLD } from './set-aggregate'

export type SetValuePoint = {
  date: string
  value: number
  covered: number
  total: number
}

export type SetValueHistory = {
  basis: MarketBasis
  windowDays: number
  points: SetValuePoint[]
  currency: MarketBasis['currency']
  methodology: string
  basketSize: number
}

export async function getSetValueHistory(
  setCode: string,
  windowDays: 7 | 30 | 90 = 30,
  basis: MarketBasis = DEFAULT_BASIS,
): Promise<SetValueHistory | null> {
  const supabase = getSupabaseServiceClient()

  // Anchor to the most recent day in the daily table on this basis
  // AND for this set. Using the whole-table max would flat-line the
  // curve if the ingest for this set is late.
  const { data: anchorRow } = await supabase
    .from('mtg_set_value_daily')
    .select('observed_on')
    .eq('set_code', setCode)
    .eq('provider', basis.provider).eq('currency', basis.currency)
    .eq('market', basis.market).eq('price_type', basis.priceType)
    .order('observed_on', { ascending: false })
    .limit(1)
  const anchor = (anchorRow?.[0] as { observed_on: string } | undefined)?.observed_on
  if (!anchor) return null

  const since = new Date(anchor + 'T00:00:00Z')
  since.setUTCDate(since.getUTCDate() - windowDays)
  const sinceIso = since.toISOString().slice(0, 10)

  const { data: rows, error } = await supabase
    .from('mtg_set_value_daily')
    .select('observed_on, eligible_count, priced_count, basket_value')
    .eq('set_code', setCode)
    .eq('provider', basis.provider).eq('currency', basis.currency)
    .eq('market', basis.market).eq('price_type', basis.priceType)
    .gte('observed_on', sinceIso).lte('observed_on', anchor)
    .order('observed_on', { ascending: true })
  if (error) {
    console.error('getSetValueHistory read failed:', error.message)
    return null
  }
  const raw = (rows ?? []) as Array<{
    observed_on: string; eligible_count: number; priced_count: number; basket_value: number | string
  }>
  if (raw.length === 0) return null

  const basketSize = Math.max(...raw.map((r) => Number(r.eligible_count) || 0))
  const points: SetValuePoint[] = raw.map((r) => ({
    date: r.observed_on,
    value: Number(r.basket_value) || 0,
    covered: Number(r.priced_count) || 0,
    total: Number(r.eligible_count) || 0,
  }))

  // Prune the leading days where coverage was thin. Sets that did
  // not exist 90 days ago should show a shorter series, not a
  // straight zero line stretching back to the window start.
  const minCovered = Math.max(1, Math.ceil(basketSize * HISTORY_COVERAGE_THRESHOLD))
  const firstUsable = points.findIndex((p) => p.covered >= minCovered)
  const trimmed = firstUsable >= 0 ? points.slice(firstUsable) : []

  return {
    basis,
    windowDays,
    points: trimmed,
    currency: basis.currency,
    methodology:
      `Basket = one canonical finish per eligible English paper printing in the set ` +
      `(nonfoil > foil > etched hierarchy, structural not price-driven). ` +
      `Missing daily observation = the printing is unpriced for that date; no substitution. ` +
      `Source: mtg_set_value_daily on ${basis.provider} ${basis.currency} ${basis.priceType}.`,
    basketSize,
  }
}
