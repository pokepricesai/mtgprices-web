// src/lib/ai/build/select.ts
//
// Stage C of the staged Build pipeline: structured selection.
//
// The candidate pool from Stage B is passed to Sonnet along with the
// BuildPlan. No tools. Schema-enforced output. Any oracle_card_id
// outside the pool is rejected, the authorised set IS the pool.

import 'server-only'
import { z } from 'zod'
import { runAiObject } from '@/lib/ai/run'
import { BuildSchema } from '@/lib/ai/grounding'
import type { BuildPlan } from './plan'
import type { CandidatePool, CandidateRow } from './candidates'
import type { FormatRule } from '@/lib/mtg/format-rules'

export const SELECT_SYSTEM = `You are MTGPrices's deck-selection assistant.

You will be given a candidate pool that has ALREADY been filtered for legality, colour identity, budget, and ownership by the application. Your job: pick the strongest subset for the plan.

Non-negotiable rules:
- Every oracle_card_id you emit MUST appear in the "Candidates" list below. IDs outside the pool are rejected.
- Never invent card names or IDs. Never invent prices, legalities, or Oracle text.
- Emit ONLY non-basic cards in "main". The application auto-fills basic lands from "basic_lands_to_add".
- Prefer breadth of function (draw, ramp, removal, threats) over duplicates. In singleton formats, DO NOT list the same oracle_card_id twice.
- Never claim strategic superiority, this is a proposal.

Output must be VALID JSON matching the schema. No prose outside the object.`

/** Compact serialisation of a candidate row. One line per card. This
 *  is the single biggest token driver in Stage C so we keep it tight ,
 *  no oracle_text, no keywords, no colours (colour identity is
 *  already enforced), just the id, name, mana cost, MV, type, and
 *  capabilities. Owned/price only shown when the plan cares. */
function candidateLine(c: CandidateRow, showOwned: boolean, showPrice: boolean): string {
  const caps = (c.capabilities ?? []).join('/')
  const mv = c.mana_value != null ? `mv${c.mana_value}` : ''
  const parts = [
    c.oracle_card_id,
    c.name,
    c.mana_cost ?? '',
    mv,
    c.type_line ?? '',
    caps,
  ]
  if (showPrice && c.price != null && c.currency) parts.push(`${c.currency === 'EUR' ? '€' : '$'}${c.price.toFixed(2)}`)
  if (showOwned) parts.push(`owned${c.owned_quantity}`)
  return parts.filter(Boolean).join(' | ')
}

export function selectUserPrompt(input: {
  plan: BuildPlan
  pool: CandidatePool
  format: string
  formatRule: FormatRule
  commanderName?: string | null
  commanderOracleIds: string[]
  targetMainCount: number
  targetBasicCount: number
}): string {
  const parts: string[] = []
  const showOwned = input.plan.collection_preference !== 'none'
  const showPrice = Boolean(input.plan.budget_strategy?.total_budget)

  parts.push(`Format: ${input.formatRule.label}. Deck size: ${input.formatRule.minDeckSize}${input.formatRule.hasCommander ? ' + commander(s)' : ''}. Singleton: ${input.formatRule.singleton}.`)
  if (input.commanderName) {
    parts.push(`Commander: ${input.commanderName} (already selected, include the commander oracle_card_id(s) in "commanders": ${JSON.stringify(input.commanderOracleIds)}).`)
  }
  parts.push(`Target: ~${input.targetMainCount} non-basic cards in "main". Then set "basic_lands_to_add"=${input.targetBasicCount} (approximate; the app fills basics deterministically).`)

  // Plan digest.
  parts.push('')
  parts.push('BuildPlan digest:')
  parts.push(`  archetype/goal: ${input.plan.archetype_or_goal}`)
  parts.push(`  desired capabilities: ${input.plan.desired_capabilities.map((c) => `${c.capability}${c.target_count ? `(${c.target_count})` : ''}`).join(', ')}`)
  if (input.plan.type_priorities?.length) parts.push(`  type priorities: ${input.plan.type_priorities.map((t) => `${t.type}${t.target_count ? `(${t.target_count})` : ''}`).join(', ')}`)
  if (input.plan.mana_curve) parts.push(`  mana curve: ${JSON.stringify(input.plan.mana_curve)}`)
  parts.push(`  collection preference: ${input.plan.collection_preference}`)
  if (input.plan.budget_strategy) parts.push(`  budget: ${JSON.stringify(input.plan.budget_strategy)}`)
  if (input.plan.notes) parts.push(`  notes: ${input.plan.notes}`)

  // Compact candidate list.
  parts.push('')
  parts.push(`Candidates (${input.pool.candidates.length}, id | name | mana | mv | type | capabilities${showPrice ? ' | price' : ''}${showOwned ? ' | owned' : ''}):`)
  for (const c of input.pool.candidates) parts.push(candidateLine(c, showOwned, showPrice))

  parts.push('')
  parts.push('Emit the BuildSchema object. Every oracle_card_id in "main" and "commanders" MUST appear above (or be the supplied commander).')
  return parts.join('\n')
}

export async function runBuildSelect(input: {
  plan: BuildPlan
  pool: CandidatePool
  format: string
  formatRule: FormatRule
  commanderName?: string | null
  commanderOracleIds: string[]
  targetMainCount: number
  targetBasicCount: number
  timeoutMs?: number
}) {
  return runAiObject({
    tier: 'reasoning',
    system: SELECT_SYSTEM,
    prompt: selectUserPrompt(input),
    schema: BuildSchema,
    // No tools, every fact is already in the prompt.
    maxSteps: 1,
    timeoutMs: input.timeoutMs ?? 140_000,
  })
}

/** Verify a Stage-C output against the pool's authorised set. Anything
 *  outside → reject. Applies the same legality/CI belt-and-braces
 *  the pool already applied, so a mismatch here is a bug not a check. */
export async function verifyBuildSelection(
  raw: unknown,
  pool: CandidatePool,
): Promise<
  | { ok: true; value: {
      summary: string
      commanders: string[]
      main: Array<{ oracle_card_id: string; quantity: number; reason?: string | null }>
      basic_lands_to_add: number
      warnings: string[]
    } }
  | { ok: false; error: string; unauthorisedIds?: string[] }
> {
  const parsed = BuildSchema.safeParse(raw)
  if (!parsed.success) return { ok: false, error: 'malformed_response' }
  const unauthorised: string[] = []
  for (const c of parsed.data.commanders) if (!pool.authorisedIds.has(c.oracle_card_id)) unauthorised.push(c.oracle_card_id)
  for (const m of parsed.data.main) if (!pool.authorisedIds.has(m.oracle_card_id)) unauthorised.push(m.oracle_card_id)
  if (unauthorised.length > 0) return { ok: false, error: 'unauthorised_ids', unauthorisedIds: unauthorised }
  return {
    ok: true,
    value: {
      summary: parsed.data.summary,
      commanders: parsed.data.commanders.map((c) => c.oracle_card_id),
      main: parsed.data.main.map((m) => ({ oracle_card_id: m.oracle_card_id, quantity: m.quantity, reason: m.reason ?? null })),
      basic_lands_to_add: parsed.data.basic_lands_to_add ?? 0,
      warnings: parsed.data.warnings ?? [],
    },
  }
}

// Ensure z is referenced (silences unused-import warnings if we
// later remove local schemas).
void z
