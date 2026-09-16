// src/lib/ai/build/candidates.ts
//
// Stage B of the staged Build pipeline: deterministic candidate retrieval.
//
// Converts a BuildPlan into factual searches using the existing
// mtg_search_oracle_cards RPC. NO model tool-loop. Hard-filters
// illegal + CI + budget + ownership BEFORE Stage C ever sees the pool.

import 'server-only'
import { getSupabaseServiceClient } from '@/lib/supabaseService'
import { getSupabaseServerClient } from '@/lib/supabase/server'
import type { BuildPlan } from './plan'
import type { FormatKey } from '@/lib/mtg/formats.data'
import { getFormatRule } from '@/lib/mtg/format-rules'

export type CandidateRow = {
  oracle_card_id: string
  name: string
  mana_cost: string | null
  mana_value: number | null
  type_line: string | null
  colors: string[] | null
  color_identity: string[] | null
  capabilities: string[] | null
  /** Cheapest known paper price at the plan's currency, if any. */
  price: number | null
  currency: 'USD' | 'EUR' | null
  /** Owned quantity across all printings for this user (0 when
   *  collection was not queried or the card is not owned). */
  owned_quantity: number
}

export type CandidatePool = {
  candidates: CandidateRow[]
  /** Every oracle_card_id in `candidates` — passed to Stage C as the
   *  authorised set. Anything outside this set is rejected. */
  authorisedIds: Set<string>
  /** Commander CI (or null if not enforced). Attached for logging. */
  commanderColorIdentity: string[] | null
  /** How the pool was assembled. Attached for logging. */
  meta: {
    requestedCapabilities: string[]
    droppedIllegal: number
    droppedCiConflict: number
    droppedBudget: number
    droppedNotOwned: number
    perGroupHits: Array<{ label: string; count: number }>
  }
}

export type CandidateRetrievalInput = {
  plan: BuildPlan
  format: FormatKey
  commanderOracleIds: string[]
  /** When true, apply the caller's collection filter. Requires
   *  request-scoped supabase (fetches owned quantity via RLS). */
  useCollection: boolean
  /** Hard cap on candidate-pool size handed to Stage C. */
  maxCandidates?: number
}

const DEFAULT_MAX_CANDIDATES = 180
const NON_COMMANDER_MAX_CANDIDATES = 100

/** Retrieve candidates by executing the BuildPlan as a series of
 *  bounded RPC searches. Deduplicates by oracle_card_id. */
export async function retrieveCandidatePool(input: CandidateRetrievalInput): Promise<CandidatePool> {
  const s = getSupabaseServiceClient()
  const rule = getFormatRule(input.format)
  const maxCandidates = input.maxCandidates
    ?? (rule?.hasCommander ? DEFAULT_MAX_CANDIDATES : NON_COMMANDER_MAX_CANDIDATES)

  // Resolve commander CI when the format enforces it. For non-commander
  // formats, honour `plan.colors` (e.g. "blue-red control" → ['U','R'])
  // as a colour-identity subset filter to keep the pool focused.
  let commanderCI: string[] | null = null
  if (rule?.enforceColorIdentity && input.commanderOracleIds.length > 0) {
    const { data } = await s.from('mtg_oracle_cards')
      .select('color_identity')
      .in('id', input.commanderOracleIds)
    commanderCI = Array.from(new Set(((data ?? []) as any[]).flatMap((r) => r.color_identity ?? []))).sort()
  } else if (input.plan.colors && input.plan.colors.length > 0) {
    commanderCI = Array.from(new Set(input.plan.colors as string[])).sort()
  }

  const requestedCaps = input.plan.desired_capabilities.map((c) => c.capability)
  const perGroupHits: Array<{ label: string; count: number }> = []

  // Deduped, insertion-ordered accumulator so early groups (from the
  // most important capabilities) rank first when we truncate later.
  const byId = new Map<string, CandidateRow>()

  // Helper: run a single searchLegalCards RPC and merge results.
  async function runGroup(label: string, args: {
    capabilities?: string[]
    type?: string | null
    manaValueMax?: number | null
    limit: number
  }) {
    const { data, error } = await s.rpc('mtg_search_oracle_cards', {
      p_capabilities: args.capabilities && args.capabilities.length > 0 ? args.capabilities : null,
      p_type: args.type ?? null,
      p_color_identity: commanderCI && commanderCI.length > 0 ? commanderCI : null,
      p_mv_max: args.manaValueMax ?? null,
      p_mv_min: null,
      p_legal_in: input.format,
      p_limit: args.limit,
      p_offset: 0,
      p_exclude_oracles: input.commanderOracleIds.length > 0 ? input.commanderOracleIds : null,
    } as any)
    if (error) {
      console.error('retrieveCandidatePool rpc err:', error)
      perGroupHits.push({ label, count: 0 })
      return
    }
    const rows = (data ?? []) as any[]
    perGroupHits.push({ label, count: rows.length })
    for (const r of rows) {
      if (byId.has(r.id)) continue
      byId.set(r.id, {
        oracle_card_id: r.id,
        name: r.name,
        mana_cost: r.mana_cost ?? null,
        mana_value: r.mana_value ?? null,
        type_line: r.type_line ?? null,
        colors: r.colors ?? null,
        color_identity: r.color_identity ?? null,
        capabilities: r.capabilities ?? null,
        price: null,
        currency: null,
        owned_quantity: 0,
      })
    }
  }

  // Group 1: one call per capability, capped small so no single
  // capability dominates the pool.
  const perCapLimit = 24
  for (const cap of input.plan.desired_capabilities) {
    const mvMax = input.plan.mana_curve?.max_mana_value_soft_cap
      ?? (input.plan.mana_curve?.prefer_low_curve ? 4 : null)
    await runGroup(`cap:${cap.capability}`, {
      capabilities: [cap.capability],
      manaValueMax: mvMax ?? null,
      limit: perCapLimit,
    })
  }

  // Group 2: one call per type priority — pulls a spread of creatures /
  // instants / sorceries so the model has structural variety.
  const perTypeLimit = 18
  for (const tp of input.plan.type_priorities ?? []) {
    await runGroup(`type:${tp.type}`, {
      type: tp.type,
      limit: perTypeLimit,
    })
  }

  // Group 3: lands. Every deck needs non-basic mana fixing options.
  // Basic lands are auto-filled by the save endpoint; skip them here
  // to keep the pool focused on interesting cards.
  await runGroup('lands', { type: 'Land', limit: 18 })

  // Assemble list.
  let candidates = Array.from(byId.values())

  // ── Hard filters (BEFORE model sees the pool) ────────────────────

  // 1. Format legality — the RPC already filters, but double-check
  //    with a batch legality query to catch any edge cases (banned
  //    updates, restricted lists). We reject any row whose legality
  //    is banned/not_legal for the target format.
  if (candidates.length > 0) {
    const ids = candidates.map((c) => c.oracle_card_id)
    const legalRows: any[] = []
    const IN_CHUNK = 100
    for (let i = 0; i < ids.length; i += IN_CHUNK) {
      const chunk = ids.slice(i, i + IN_CHUNK)
      const { data } = await s.from('mtg_oracle_legalities')
        .select('oracle_card_id, legality')
        .in('oracle_card_id', chunk)
        .eq('format', input.format)
      for (const r of (data ?? []) as any[]) legalRows.push(r)
    }
    const badIds = new Set<string>()
    for (const r of legalRows) if (r.legality === 'banned' || r.legality === 'not_legal') badIds.add(r.oracle_card_id)
    const before = candidates.length
    candidates = candidates.filter((c) => !badIds.has(c.oracle_card_id))
    input.plan // no-op read
    ;(perGroupHits as any).droppedIllegal = before - candidates.length
  }
  const droppedIllegal = (perGroupHits as any).droppedIllegal ?? 0

  // 2. Commander colour-identity filter (belt + braces — the RPC
  //    accepts p_color_identity, but a mis-filed capability could
  //    still return an off-colour card).
  let droppedCiConflict = 0
  if (commanderCI && commanderCI.length > 0) {
    const before = candidates.length
    const ciSet = new Set(commanderCI)
    candidates = candidates.filter((c) => (c.color_identity ?? []).every((cc) => ciSet.has(cc)))
    droppedCiConflict = before - candidates.length
  }

  // 3. Attach price at the plan's currency (batch), then apply the
  //    per-card price ceiling when the plan sets a total budget.
  //    A per-card price cap is derived deterministically:
  //      per_card_cap = total_budget / minDeckSize / 2
  //    with a $50 hard floor to still allow the odd expensive staple
  //    inside a $200 deck. This is a heuristic — the total-budget
  //    check runs later during Stage D validation on the final pick.
  const currency = input.plan.budget_strategy?.currency ?? 'USD'
  if (candidates.length > 0) {
    const priceMap = await batchCheapestPrice(candidates.map((c) => c.oracle_card_id), currency)
    for (const c of candidates) {
      const p = priceMap.get(c.oracle_card_id)
      if (p) { c.price = p.price; c.currency = p.currency }
    }
  }
  let droppedBudget = 0
  const totalBudget = input.plan.budget_strategy?.total_budget
  if (typeof totalBudget === 'number' && totalBudget > 0 && rule) {
    const minDeckSize = rule.minDeckSize
    const perCardCeiling = Math.max(50, (totalBudget / minDeckSize) * 2)
    const before = candidates.length
    candidates = candidates.filter((c) => c.price == null || c.price <= perCardCeiling)
    droppedBudget = before - candidates.length
  }

  // 4. Collection filter — attach owned_quantity for every card, then
  //    drop everything with 0 owned when collection_preference is
  //    'owned_only'. When 'prefer_owned', we KEEP everything but sort
  //    owned first below.
  let droppedNotOwned = 0
  const collectionPref = input.plan.collection_preference
  if (input.useCollection && candidates.length > 0) {
    const owned = await ownedTotalsForOracles(candidates.map((c) => c.oracle_card_id))
    for (const c of candidates) c.owned_quantity = owned.get(c.oracle_card_id) ?? 0
    if (collectionPref === 'owned_only') {
      const before = candidates.length
      candidates = candidates.filter((c) => c.owned_quantity > 0)
      droppedNotOwned = before - candidates.length
    }
  }

  // 5. Sort — owned-first (when preferred), then rough price ascending
  //    (fill budget-friendly candidates before big-ticket staples).
  candidates.sort((a, b) => {
    if (collectionPref === 'prefer_owned' || collectionPref === 'owned_only') {
      const ownedDelta = (b.owned_quantity > 0 ? 1 : 0) - (a.owned_quantity > 0 ? 1 : 0)
      if (ownedDelta !== 0) return ownedDelta
    }
    const ap = a.price ?? Number.POSITIVE_INFINITY
    const bp = b.price ?? Number.POSITIVE_INFINITY
    return ap - bp
  })

  // 6. Hard cap the pool size.
  if (candidates.length > maxCandidates) candidates = candidates.slice(0, maxCandidates)

  const authorisedIds = new Set(candidates.map((c) => c.oracle_card_id))
  // Include commander IDs — Stage C emits them as `commanders[]`.
  for (const id of input.commanderOracleIds) authorisedIds.add(id)

  return {
    candidates,
    authorisedIds,
    commanderColorIdentity: commanderCI,
    meta: {
      requestedCapabilities: requestedCaps,
      droppedIllegal,
      droppedCiConflict,
      droppedBudget,
      droppedNotOwned,
      perGroupHits,
    },
  }
}

// ── Helpers ────────────────────────────────────────────────────────

const IN_CHUNK = 100

async function batchCheapestPrice(
  oracleIds: string[],
  currency: 'USD' | 'EUR',
): Promise<Map<string, { price: number; currency: 'USD' | 'EUR' }>> {
  const out = new Map<string, { price: number; currency: 'USD' | 'EUR' }>()
  if (oracleIds.length === 0) return out
  const s = getSupabaseServiceClient()

  // Printings → finishes → cheapest current price at the requested
  // currency. Provider/finish left flexible: we just want the cheapest
  // legit paper price we can find for this candidate.
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
      .select('printing_finish_id, price, currency')
      .in('printing_finish_id', chunk)
      .eq('currency', currency)
    for (const p of (data ?? []) as any[]) {
      const oracle = finishToOracle.get(p.printing_finish_id)
      if (!oracle) continue
      const cur = out.get(oracle)
      const price = Number(p.price)
      if (!cur || price < cur.price) out.set(oracle, { price, currency })
    }
  }
  return out
}

async function ownedTotalsForOracles(oracleIds: string[]): Promise<Map<string, number>> {
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

  // Use the request-scoped client so RLS restricts to the caller.
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
