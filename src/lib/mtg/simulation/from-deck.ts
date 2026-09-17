// src/lib/mtg/simulation/from-deck.ts
//
// Bridge from DeckContext → BuildSimLibraryInput. Hydrates the Oracle
// fields that the classifier + simulator need but that DeckContext
// stores in a slightly different shape.

import 'server-only'
import type { DeckContext } from '../deck-context'
import { getSupabaseServiceClient } from '@/lib/supabaseService'
import { buildSimLibrary, type BuildSimLibraryInput } from './library'

/** Fetch produced_mana + oracle_text for every oracle in the context.
 *  DeckContext doesn't currently carry `produced_mana` per card, so we
 *  batch-hydrate it here. */
export async function buildSimLibraryFromDeckContext(deck: DeckContext) {
  const s = getSupabaseServiceClient()
  const oracleIds = Array.from(new Set(
    deck.commanders.concat(deck.main, deck.sideboard, deck.companion, deck.maybeboard)
      .map((c) => c.oracle_card_id)
  ))
  const oracleExtras = new Map<string, { produced_mana: string[] | null }>()
  if (oracleIds.length > 0) {
    const IN_CHUNK = 100
    for (let i = 0; i < oracleIds.length; i += IN_CHUNK) {
      const chunk = oracleIds.slice(i, i + IN_CHUNK)
      const { data } = await s.from('mtg_oracle_cards')
        .select('id, produced_mana')
        .in('id', chunk)
      for (const r of (data ?? []) as any[]) {
        oracleExtras.set(r.id, { produced_mana: r.produced_mana ?? null })
      }
    }
  }

  const input: BuildSimLibraryInput = {
    cards: deck.commanders.concat(deck.main, deck.sideboard, deck.companion, deck.maybeboard).map((c) => ({
      zone: c.zone as any,
      quantity: c.quantity,
      oracle: {
        oracle_card_id: c.oracle_card_id,
        name: c.name,
        mana_cost: c.mana_cost,
        mana_value: c.mana_value,
        type_line: c.type_line,
        colors: c.colors ?? [],
        color_identity: c.color_identity ?? [],
        capabilities: c.capabilities ?? [],
        produced_mana: oracleExtras.get(c.oracle_card_id)?.produced_mana ?? null,
        oracle_text: c.oracle_text ?? null,
      },
    })),
  }
  return buildSimLibrary(input)
}
