// src/lib/ai/grounding.ts
//
// Enforces the grounding contract on every AI-produced suggestion.
//
//   1. oracle_card_id must be a real Oracle row in mtg_oracle_cards.
//   2. oracle_card_id must have been authorised by a factual tool
//      call during this conversation (or be already-in-deck for a
//      "remove" target).
//   3. Add-target must be legal in the deck's format.
//   4. Add-target must be inside the commander colour identity when
//      applicable.
//   5. The deterministic validator runs against the RESULTING deck
//      (with the proposed swaps applied) — if it fails, the suggestion
//      is refused with an explanation.

import 'server-only'
import { z } from 'zod'
import { getSupabaseServiceClient } from '@/lib/supabaseService'
import { getFormatRule } from '@/lib/mtg/format-rules'
import { validateDeck, type DeckCardForValidation, type DeckZone } from '@/lib/mtg/deck-rules'
import type { DeckContext } from '@/lib/mtg/deck-context'
import type { AuthorisedOracles } from './tools'

// ── Schemas ─────────────────────────────────────────────────────────

export const SuggestionSchema = z.object({
  remove_oracle_card_id: z.string().uuid().nullable().optional(),
  add_oracle_card_id: z.string().uuid(),
  quantity: z.number().int().min(1).max(4).default(1),
  reason: z.string().min(1).max(400),
})

export const ImproveSchema = z.object({
  summary: z.string().max(2000),
  suggestions: z.array(SuggestionSchema).min(0).max(8),
})

export const AnalyseSchema = z.object({
  game_plan: z.string().max(4000),
  key_cards: z.array(z.object({ oracle_card_id: z.string().uuid(), evidence: z.string().max(400) })).max(20),
  curve_notes: z.string().max(2000),
  capability_notes: z.string().max(2000),
  ownership_notes: z.string().max(2000),
  cost_notes: z.string().max(2000),
})

export const ReplaceSchema = z.object({
  target_oracle_card_id: z.string().uuid(),
  candidates: z.array(z.object({
    oracle_card_id: z.string().uuid(),
    reason: z.string().max(400),
    confidence: z.enum(['high', 'med', 'low']).optional(),
  })).max(12),
})

export const BuildSchema = z.object({
  summary: z.string().max(4000),
  commanders: z.array(z.object({ oracle_card_id: z.string().uuid() })).max(2),
  main: z.array(z.object({
    oracle_card_id: z.string().uuid(),
    quantity: z.number().int().min(1).max(4).default(1),
    reason: z.string().max(400).optional(),
  })).max(120),
  warnings: z.array(z.string().max(400)).optional(),
})

export type Suggestion = z.infer<typeof SuggestionSchema>

// ── Grounding checks ────────────────────────────────────────────────

export type GroundingResult<T> =
  | { ok: true; value: T; rejected: RejectedSuggestion[] }
  | { ok: false; error: string; rejected: RejectedSuggestion[] }

export type RejectedSuggestion = {
  suggestion: Suggestion
  reason: string
}

/** Enforce grounding + legality on an ImproveDeck response. */
export async function verifyImproveResponse(
  raw: unknown,
  deck: DeckContext,
  authorised: AuthorisedOracles,
): Promise<GroundingResult<{ summary: string; suggestions: Suggestion[] }>> {
  const parsed = ImproveSchema.safeParse(raw)
  if (!parsed.success) {
    return { ok: false, error: 'malformed_response', rejected: [] }
  }
  const s = getSupabaseServiceClient()

  // Collect every add_oracle_card_id + remove_oracle_card_id.
  const addIds = Array.from(new Set(parsed.data.suggestions.map((x) => x.add_oracle_card_id)))
  const removeIds = Array.from(new Set(parsed.data.suggestions.map((x) => x.remove_oracle_card_id).filter(Boolean) as string[]))
  const inDeckIds = new Set(
    deck.commanders.concat(deck.main, deck.sideboard, deck.companion, deck.maybeboard)
      .map((c) => c.oracle_card_id)
  )

  // 1. Existence + legality lookup for every add.
  const legalityByOracle = new Map<string, string>()
  const oracleById = new Map<string, any>()
  if (addIds.length > 0) {
    const [{ data: oracles }, { data: legalities }] = await Promise.all([
      s.from('mtg_oracle_cards').select('id, name, mana_value, type_line, color_identity, keywords, oracle_text, capabilities').in('id', addIds),
      s.from('mtg_oracle_legalities').select('oracle_card_id, legality').in('oracle_card_id', addIds).eq('format', deck.deck.format),
    ])
    for (const o of (oracles ?? []) as any[]) oracleById.set(o.id, o)
    for (const l of (legalities ?? []) as any[]) legalityByOracle.set(l.oracle_card_id, l.legality)
  }

  const commanderCI = deck.commanders.length > 0
    ? new Set(deck.commanders.flatMap((c) => c.color_identity))
    : null
  const rule = getFormatRule(deck.deck.format)

  const kept: Suggestion[] = []
  const rejected: RejectedSuggestion[] = []
  for (const sug of parsed.data.suggestions) {
    // Authorisation.
    if (!authorised.has(sug.add_oracle_card_id)) {
      rejected.push({ suggestion: sug, reason: 'add_oracle_card_id was not returned by any factual tool during this conversation.' })
      continue
    }
    if (sug.remove_oracle_card_id && !inDeckIds.has(sug.remove_oracle_card_id)) {
      rejected.push({ suggestion: sug, reason: 'remove_oracle_card_id is not currently in the deck.' })
      continue
    }
    // Existence.
    const oracle = oracleById.get(sug.add_oracle_card_id)
    if (!oracle) {
      rejected.push({ suggestion: sug, reason: 'add_oracle_card_id does not resolve to a real Oracle card.' })
      continue
    }
    // Legality.
    const legality = legalityByOracle.get(sug.add_oracle_card_id) ?? 'unknown'
    if (legality === 'banned' || legality === 'not_legal') {
      rejected.push({ suggestion: sug, reason: `add_oracle_card_id is ${legality} in ${rule?.label ?? deck.deck.format}.` })
      continue
    }
    // Commander colour identity.
    if (rule?.enforceColorIdentity && commanderCI) {
      const outside = (oracle.color_identity ?? []).some((c: string) => !commanderCI.has(c))
      if (outside) {
        rejected.push({ suggestion: sug, reason: `add_oracle_card_id has colour identity outside the commander(s).` })
        continue
      }
    }
    kept.push(sug)
  }

  // Full validator run against the RESULT deck.
  const projected = projectDeck(deck, kept, oracleById)
  const validation = validateDeck({ format: deck.deck.format, cards: projected })
  // Blocked issues: hard failures on the projected deck. Warnings are OK.
  if (validation.issues.length > deck.validation.issues.length) {
    // The AI made things worse; filter out swaps until we're at parity.
    // Simple approach: refuse suggestions one by one starting from the
    // end until the validator matches the original count.
    const trimmed = trimUntilNotWorse(deck, kept, oracleById)
    return {
      ok: true,
      value: { summary: parsed.data.summary, suggestions: trimmed.kept },
      rejected: [...rejected, ...trimmed.rejected],
    }
  }
  return { ok: true, value: { summary: parsed.data.summary, suggestions: kept }, rejected }
}

/** Apply a set of suggestions to a deck IN MEMORY and return the
 *  resulting DeckCardForValidation set. Used only for validator preview. */
function projectDeck(
  deck: DeckContext,
  suggestions: Suggestion[],
  addOracleById: Map<string, any>,
): DeckCardForValidation[] {
  const bag = new Map<string, DeckCardForValidation>()
  for (const c of deck.commanders.concat(deck.main, deck.sideboard, deck.companion, deck.maybeboard)) {
    const key = `${c.zone}|${c.oracle_card_id}`
    bag.set(key, {
      oracle_card_id: c.oracle_card_id,
      name: c.name,
      quantity: c.quantity,
      zone: c.zone,
      type_line: c.type_line,
      color_identity: c.color_identity,
      keywords: c.keywords,
      oracle_text: c.oracle_text,
      legality: c.legality,
    })
  }
  for (const s of suggestions) {
    if (s.remove_oracle_card_id) {
      // Decrement/remove main-zone copies first.
      const key = `main|${s.remove_oracle_card_id}`
      const existing = bag.get(key)
      if (existing) {
        if (existing.quantity <= s.quantity) bag.delete(key)
        else bag.set(key, { ...existing, quantity: existing.quantity - s.quantity })
      }
    }
    const addOracle = addOracleById.get(s.add_oracle_card_id)
    if (!addOracle) continue
    const addKey = `main|${s.add_oracle_card_id}`
    const existing = bag.get(addKey)
    if (existing) {
      bag.set(addKey, { ...existing, quantity: existing.quantity + s.quantity })
    } else {
      bag.set(addKey, {
        oracle_card_id: s.add_oracle_card_id,
        name: addOracle.name,
        quantity: s.quantity,
        zone: 'main' as DeckZone,
        type_line: addOracle.type_line,
        color_identity: addOracle.color_identity,
        keywords: addOracle.keywords,
        oracle_text: addOracle.oracle_text,
        legality: 'legal',
      })
    }
  }
  return Array.from(bag.values())
}

function trimUntilNotWorse(
  deck: DeckContext,
  suggestions: Suggestion[],
  addOracleById: Map<string, any>,
): { kept: Suggestion[]; rejected: RejectedSuggestion[] } {
  const baselineIssueCount = deck.validation.issues.length
  const kept = [...suggestions]
  const rejected: RejectedSuggestion[] = []
  while (kept.length > 0) {
    const projected = projectDeck(deck, kept, addOracleById)
    const v = validateDeck({ format: deck.deck.format, cards: projected })
    if (v.issues.length <= baselineIssueCount) return { kept, rejected }
    const dropped = kept.pop()!
    rejected.push({ suggestion: dropped, reason: 'Applying this suggestion would break the deterministic validator (worse than current).' })
  }
  return { kept, rejected }
}

// ── Verifier for BuildDeck responses ────────────────────────────────

export async function verifyBuildResponse(
  raw: unknown,
  format: string,
  authorised: AuthorisedOracles,
): Promise<GroundingResult<{
  summary: string
  commanders: string[]
  main: Array<{ oracle_card_id: string; quantity: number; reason?: string | null }>
  warnings: string[]
}>> {
  const parsed = BuildSchema.safeParse(raw)
  if (!parsed.success) return { ok: false, error: 'malformed_response', rejected: [] }
  const s = getSupabaseServiceClient()

  const allIds = Array.from(new Set([
    ...parsed.data.commanders.map((c) => c.oracle_card_id),
    ...parsed.data.main.map((c) => c.oracle_card_id),
  ]))
  // Any invented ID → reject the whole build.
  for (const id of allIds) {
    if (!authorised.has(id)) return { ok: false, error: `Refused: oracle_card_id=${id} was not authorised by a factual tool call.`, rejected: [] }
  }
  const [{ data: oracles }, { data: legalities }] = await Promise.all([
    s.from('mtg_oracle_cards').select('id, name, type_line, color_identity, keywords, oracle_text').in('id', allIds),
    s.from('mtg_oracle_legalities').select('oracle_card_id, legality').in('oracle_card_id', allIds).eq('format', format),
  ])
  const oracleById = new Map<string, any>()
  for (const o of (oracles ?? []) as any[]) oracleById.set(o.id, o)
  const legalityByOracle = new Map<string, string>()
  for (const l of (legalities ?? []) as any[]) legalityByOracle.set(l.oracle_card_id, l.legality)

  for (const id of allIds) {
    if (!oracleById.has(id)) return { ok: false, error: `Refused: oracle_card_id=${id} does not exist.`, rejected: [] }
    const legality = legalityByOracle.get(id)
    if (legality === 'banned' || legality === 'not_legal') return { ok: false, error: `Refused: ${oracleById.get(id).name} is ${legality} in ${format}.`, rejected: [] }
  }
  return {
    ok: true,
    value: {
      summary: parsed.data.summary,
      commanders: parsed.data.commanders.map((c) => c.oracle_card_id),
      main: parsed.data.main.map((c) => ({ oracle_card_id: c.oracle_card_id, quantity: c.quantity, reason: c.reason ?? null })),
      warnings: parsed.data.warnings ?? [],
    },
    rejected: [],
  }
}
