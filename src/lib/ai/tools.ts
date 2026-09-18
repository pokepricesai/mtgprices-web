// src/lib/ai/tools.ts
//
// Factual tools exposed to the AI. Each tool is a thin wrapper over an
// existing Phase 3A/3B primitive. Every card the tools return has its
// `oracle_card_id` recorded in `AuthorisedOracles`, the grounding
// contract later rejects any AI-proposed Oracle ID that was not
// authorised by a real tool call.
//
// Tools intentionally do NOT accept `deck_id` as an argument, that
// would let the model target a different deck. The deck is bound at
// construction time via `bindDeckTools(deck)`. Same principle for the
// caller's user_id, never trusted from the model.

import 'server-only'
import { tool } from 'ai'
import { z } from 'zod'
import type { DeckContext } from '@/lib/mtg/deck-context'
import { searchLegalCards, findAlternativesInDeck, findCheaperAlternatives } from '@/lib/mtg/deck-search'
import { getSupabaseServiceClient } from '@/lib/supabaseService'
import { getSupabaseServerClient } from '@/lib/supabase/server'
import { getFormatRule } from '@/lib/mtg/format-rules'
import type { FormatKey } from '@/lib/mtg/formats.data'

export type AuthorisedOracles = Set<string>

// Loose type: AI SDK v7 generics fight when tool records are collected
// into a single object literal. The runtime shape is unchanged; we let
// `generateText` re-infer types from the actual usage site.
export type BoundTools = {
  tools: Record<string, any>
  authorised: AuthorisedOracles
}

/** Bind every tool to a specific DeckContext + caller's session so
 *  the model cannot escape scope. Returns the tools object + a shared
 *  `authorised` set that accumulates every oracle_card_id the tools
 *  return during a run. */
export function bindDeckTools(deck: DeckContext): BoundTools {
  const authorised: AuthorisedOracles = new Set(
    // Cards already in the deck count as authorised, the model may
    // reference them (e.g. suggesting a swap that removes one).
    deck.commanders.concat(deck.main, deck.sideboard, deck.companion, deck.maybeboard)
      .map((c) => c.oracle_card_id)
  )

  return {
    authorised,
    tools: {
      getDeckContext: tool({
        description:
          'Return the current deck state: name, format, commanders, main/sideboard/companion/maybeboard, curve, colour identity, type breakdown, capability counts, ownership summary, deck value at the user\'s valuation basis, and validation state.',
        inputSchema: z.object({}),
        execute: async () => {
          // Compact view, omit fields the model can rederive:
          //   - per-card `colors` (subset of colour identity)
          //   - per-card `capabilities` (aggregate is in capabilityBreakdown)
          //   - per-card current_price when null
          //   - per-card owned_quantity when 0
          // These trims reduced live Improve input tokens 3-4x. If the
          // model needs specifics on any card it can call getCardDetails.
          return {
            deck: {
              id: deck.deck.id,
              name: deck.deck.name,
              format: deck.deck.format,
              description: deck.deck.description,
            },
            totals: deck.totals,
            colorIdentity: deck.colorIdentity,
            curve: deck.curve,
            typeBreakdown: deck.typeBreakdown,
            capabilityBreakdown: deck.capabilityBreakdown,
            ownership: deck.ownership,
            pricing: {
              basis: {
                key: deck.pricing.basis.key,
                label: deck.pricing.basis.label,
                provider: deck.pricing.basis.provider,
                currency: deck.pricing.basis.currency,
              },
              deckValue: deck.pricing.deckValue,
              missingCardsValue: deck.pricing.missingCardsValue,
            },
            validation: deck.validation,
            commanders: deck.commanders.map((c) => ({
              oracle_card_id: c.oracle_card_id,
              name: c.name,
              mana_cost: c.mana_cost,
              type_line: c.type_line,
              color_identity: c.color_identity,
            })),
            main: deck.main.map((c) => {
              const row: Record<string, unknown> = {
                oracle_card_id: c.oracle_card_id,
                name: c.name,
                quantity: c.quantity,
                mana_cost: c.mana_cost,
                mana_value: c.mana_value,
                type_line: c.type_line,
              }
              if (c.owned.ownedQuantityAcrossPrintings > 0) row.owned_quantity = c.owned.ownedQuantityAcrossPrintings
              if (c.currentPrice) row.price = { v: c.currentPrice.price, c: c.currentPrice.currency }
              return row
            }),
          }
        },
      }),

      searchLegalCards: tool({
        description:
          'Search MTG cards legal in the current deck\'s format (auto-scoped) and, for Commander formats, inside the commander colour identity (auto-scoped). Structured filters ONLY: no free-text search. Returns up to 30 candidates with oracle_card_id, mana cost, type_line, colors, capabilities, owned quantity and price at the deck\'s valuation basis.',
        inputSchema: z.object({
          capabilities: z.array(z.string()).describe('Zero or more capability tags to require (AND). Examples: "card-draw", "ramp", "creature-removal", "board-wipe", "counter-spell", "tutor", "token-creation", "protection", "graveyard-interaction".').optional(),
          types: z.array(z.string()).describe('Optional card types to require. Examples: "Creature", "Instant", "Sorcery", "Enchantment", "Artifact", "Planeswalker", "Land".').optional(),
          manaValueMin: z.number().int().min(0).max(20).optional(),
          manaValueMax: z.number().int().min(0).max(20).optional(),
          priceMax: z.number().min(0).describe('Optional max price at the deck\'s valuation basis. Currency is the deck\'s.').optional(),
          ownedOnly: z.boolean().describe('If true, only return cards the user already owns any printing of.').optional(),
          missingOnly: z.boolean().describe('If true, only return cards the user does NOT already own.').optional(),
          excludeInDeck: z.boolean().describe('If true (default), hide cards already in the deck.').optional(),
          page: z.number().int().min(1).max(10).optional(),
        }),
        execute: async (args) => {
          const result = await searchLegalCards(deck, {
            request: {
              caps: (args.capabilities ?? []) as any,
              types: args.types,
              manaValueMin: args.manaValueMin,
              manaValueMax: args.manaValueMax,
              priceMax: args.priceMax,
              currency: deck.pricing.basis.currency,
            },
            ownedOnly: Boolean(args.ownedOnly),
            missingOnly: Boolean(args.missingOnly),
            excludeInDeck: args.excludeInDeck ?? true,
            page: args.page ?? 1,
            // Cap at 10 hits per call. Down from 15, combined with the
            // colours/reasons trim below this cut live Improve input
            // tokens roughly in half.
            pageSize: 10,
          })
          for (const h of result.hits) authorised.add(h.oracle_card_id)
          return {
            total: result.total,
            // Compact: drop `colors` (subset of CI already returned in
            // getDeckContext), drop `reasons` (verbose, redundant with
            // capabilities), collapse price to two fields.
            hits: result.hits.map((h) => {
              const row: Record<string, unknown> = {
                oracle_card_id: h.oracle_card_id,
                name: h.name,
                mana_cost: h.mana_cost,
                mana_value: h.mana_value,
                type_line: h.type_line,
                capabilities: h.capabilities,
              }
              const owned = (h as any).ownedTotal ?? 0
              if (owned > 0) row.owned_quantity = owned
              const inDeck = (h as any).copiesInDeck ?? 0
              if (inDeck > 0) row.copies_in_deck = inDeck
              if (h.cheapest) row.price = { v: h.cheapest.price, c: h.cheapest.currency }
              return row
            }),
          }
        },
      }),

      findAlternatives: tool({
        description:
          'Find deterministic alternatives to a specific card that is IN or PROPOSED FOR the deck. Uses shared capabilities + colour identity + mana value + primary type. Auto-scoped to deck format + commander CI.',
        inputSchema: z.object({
          oracle_card_id: z.string().uuid().describe('The oracle_card_id of the card to find alternatives to. Must be one you have previously retrieved from a tool call or seen in getDeckContext.'),
          limit: z.number().int().min(1).max(20).optional(),
        }),
        execute: async ({ oracle_card_id, limit }) => {
          if (!authorised.has(oracle_card_id)) {
            return { error: 'Refused: oracle_card_id was not previously authorised. Call getDeckContext or searchLegalCards first.' }
          }
          const alts = await findAlternativesInDeck(deck, oracle_card_id, limit ?? 12)
          for (const a of alts) authorised.add(a.oracle_card_id)
          return {
            alternatives: alts.map((a) => ({
              oracle_card_id: a.oracle_card_id,
              name: a.name,
              score: a.score,
              reasons: a.reasons,
              price: a.currentPrice ? { value: a.currentPrice.price, currency: a.currentPrice.currency } : null,
              copies_in_deck: a.copiesInDeck,
            })),
          }
        },
      }),

      findCheaperAlternatives: tool({
        description:
          'Find alternatives that are strictly cheaper than the target under the deck\'s valuation basis. Returns an explicit "reason" when the target has no price on that basis.',
        inputSchema: z.object({
          oracle_card_id: z.string().uuid(),
          limit: z.number().int().min(1).max(20).optional(),
        }),
        execute: async ({ oracle_card_id, limit }) => {
          if (!authorised.has(oracle_card_id)) {
            return { error: 'Refused: oracle_card_id was not previously authorised.' }
          }
          const res = await findCheaperAlternatives(deck, oracle_card_id, limit ?? 12)
          for (const a of res.alternatives) authorised.add(a.oracle_card_id)
          return {
            target: res.target,
            reason: res.reason,
            alternatives: res.alternatives.map((a) => ({
              oracle_card_id: a.oracle_card_id,
              name: a.name,
              price: a.currentPrice ? { value: a.currentPrice.price, currency: a.currentPrice.currency } : null,
              reasons: a.reasons,
            })),
          }
        },
      }),

      getCardDetails: tool({
        description:
          'Fetch full Oracle text, keywords, capabilities, colour identity, mana value, layout and legality-in-format for a small list of oracle_card_ids. Use ONLY for ids you have already seen via other tools.',
        inputSchema: z.object({
          oracle_card_ids: z.array(z.string().uuid()).min(1).max(20),
        }),
        execute: async ({ oracle_card_ids }) => {
          const s = getSupabaseServiceClient()
          const filtered = oracle_card_ids.filter((id) => authorised.has(id))
          if (filtered.length === 0) {
            return { error: 'Refused: none of the provided oracle_card_ids were authorised by a previous tool call.' }
          }
          const [oraclesRes, legalitiesRes] = await Promise.all([
            s.from('mtg_oracle_cards').select('id, name, mana_cost, mana_value, type_line, oracle_text, colors, color_identity, keywords, capabilities, layout').in('id', filtered),
            s.from('mtg_oracle_legalities').select('oracle_card_id, legality').in('oracle_card_id', filtered).eq('format', deck.deck.format),
          ])
          const legal = new Map<string, string>()
          for (const l of (legalitiesRes.data ?? []) as any[]) legal.set(l.oracle_card_id, l.legality)
          return {
            cards: (oraclesRes.data ?? []).map((r: any) => ({
              oracle_card_id: r.id,
              name: r.name,
              mana_cost: r.mana_cost,
              mana_value: r.mana_value,
              type_line: r.type_line,
              oracle_text: r.oracle_text,
              colors: r.colors,
              color_identity: r.color_identity,
              keywords: r.keywords,
              capabilities: r.capabilities,
              layout: r.layout,
              legality: legal.get(r.id) ?? 'unknown',
            })),
          }
        },
      }),

      getFormatRule: tool({
        description: 'Return the deterministic construction rules for the deck\'s format (deck size, copy limits, sideboard, commander requirement, colour identity, singleton, notes).',
        inputSchema: z.object({}),
        execute: async () => {
          const rule = getFormatRule(deck.deck.format)
          return rule ?? { note: 'Unknown format.' }
        },
      }),
    },
  }
}

/** Same tools but with a limited scope, used for deck BUILDING (no
 *  existing deck yet). Instead of a DeckContext we pass format +
 *  optional commander IDs. */
export function bindBuilderTools(input: {
  format: FormatKey
  commanderOracleIds?: string[]
  includeCollection: boolean
  budgetMax?: number
  currency?: 'USD' | 'EUR'
}): BoundTools {
  const authorised: AuthorisedOracles = new Set(input.commanderOracleIds ?? [])

  // Import searchCards lazily to avoid a top-level dependency cycle.
  // The builder does not know owned quantities per card, but we can
  // still filter to "owned only" via a joined query.
  const s = getSupabaseServiceClient()
  const rule = getFormatRule(input.format)
  const commanderCI = rule?.enforceColorIdentity && input.commanderOracleIds && input.commanderOracleIds.length > 0
    ? (async () => {
        const { data } = await s.from('mtg_oracle_cards').select('color_identity').in('id', input.commanderOracleIds!)
        return Array.from(new Set(((data ?? []) as any[]).flatMap((r) => r.color_identity ?? [])))
      })()
    : Promise.resolve(null)

  return {
    authorised,
    tools: {
      searchLegalCards: tool({
        description:
          'Search cards legal in the target format (auto-scoped). For Commander with a chosen commander, colour identity is auto-scoped. Use structured filters, no free-text.',
        inputSchema: z.object({
          capabilities: z.array(z.string()).optional(),
          types: z.array(z.string()).optional(),
          manaValueMin: z.number().int().min(0).max(20).optional(),
          manaValueMax: z.number().int().min(0).max(20).optional(),
          priceMax: z.number().min(0).optional(),
          ownedOnly: z.boolean().optional(),
          page: z.number().int().min(1).max(10).optional(),
        }),
        execute: async (args) => {
          const ci = await commanderCI
          // Delegate to a lightweight direct RPC call, reusing
          // searchLegalCards() would require a full DeckContext.
          const { data: rows, error } = await s.rpc('mtg_search_oracle_cards', {
            p_capabilities: args.capabilities && args.capabilities.length > 0 ? args.capabilities : null,
            p_type: args.types && args.types.length > 0 ? args.types[0] : null,
            p_color_identity: ci && ci.length > 0 ? ci : null,
            p_mv_max: args.manaValueMax ?? null,
            p_mv_min: args.manaValueMin ?? null,
            p_legal_in: input.format,
            p_limit: 15,
            p_offset: 0,
          } as any)
          if (error) return { error: error.message }
          let hits = (rows ?? []) as any[]

          // Owned filter, use the caller's collection via server client.
          // getSupabaseServerClient() only called here so the tool
          // still works from Node scripts when ownedOnly=false.
          if (args.ownedOnly && hits.length > 0) {
            const supabase = await getSupabaseServerClient()
            const oracleIds = hits.map((r) => r.id)
            // Find printings + finishes for those oracles.
            const { data: printings } = await s.from('mtg_printings').select('id, oracle_card_id').in('oracle_card_id', oracleIds).eq('lang', 'en').eq('digital', false)
            const printingToOracle = new Map<string, string>()
            for (const p of (printings ?? []) as any[]) printingToOracle.set(p.id, p.oracle_card_id)
            const printingIds = Array.from(printingToOracle.keys())
            const { data: finishes } = printingIds.length === 0 ? { data: [] } as any :
              await s.from('mtg_printing_finishes').select('id, printing_id').in('printing_id', printingIds)
            const finishToOracle = new Map<string, string>()
            for (const f of (finishes ?? []) as any[]) {
              const oracle = printingToOracle.get(f.printing_id)
              if (oracle) finishToOracle.set(f.id, oracle)
            }
            const finishIds = Array.from(finishToOracle.keys())
            const { data: items } = finishIds.length === 0 ? { data: [] } as any :
              await supabase.from('mtg_collection_items').select('printing_finish_id, quantity').in('printing_finish_id', finishIds)
            const ownedOracles = new Set<string>()
            for (const it of (items ?? []) as any[]) {
              const oracle = finishToOracle.get(it.printing_finish_id)
              if (oracle && it.quantity > 0) ownedOracles.add(oracle)
            }
            hits = hits.filter((r) => ownedOracles.has(r.id))
          }

          for (const h of hits) authorised.add(h.id)
          return {
            hits: hits.map((r) => ({
              oracle_card_id: r.id,
              name: r.name,
              mana_cost: r.mana_cost,
              mana_value: r.mana_value,
              type_line: r.type_line,
              colors: r.colors,
              color_identity: r.color_identity,
              capabilities: r.capabilities,
            })),
          }
        },
      }),

      getFormatRule: tool({
        description: 'Return the deterministic construction rules for the target format.',
        inputSchema: z.object({}),
        execute: async () => rule ?? { note: 'Unknown format.' },
      }),
    },
  }
}
