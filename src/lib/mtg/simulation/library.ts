// src/lib/mtg/simulation/library.ts
//
// SimCard + SimLibrary — the deck's simulation-ready representation.
// Hydrated once from DB rows, then simulated in memory. Never mutated
// during simulation — the runner clones or reshuffles indices.
//
// Key rule: commander(s) in the command zone are NOT in the library.
// Sideboard / maybeboard are NOT in the library.

import { classifyManaSource, type Classification, type ClassifyManaInput } from './mana'
import type { CardCapability } from '../capabilities'

export type SimCard = {
  oracle_card_id: string
  name: string
  mana_cost: string | null
  mana_value: number | null
  type_line: string | null
  colors: string[]
  color_identity: string[]
  capabilities: CardCapability[]
  produced_mana: string[] | null
  oracle_text: string | null
  classification: Classification
}

export type SimLibraryEntry = {
  card: SimCard
  quantity: number   // number of copies in the SHUFFLE-ABLE library
}

export type SimLibrary = {
  /** One entry per DISTINCT oracle card in the library, with quantity. */
  entries: SimLibraryEntry[]
  /** Flat array of SimCard references, one per COPY. This is what
   *  gets shuffled + drawn from. */
  cards: SimCard[]
  /** Commander(s) — NOT in the library. Available in the command zone. */
  commanders: SimCard[]
  /** Companion — NOT in the library. Available outside. */
  companion: SimCard[]
  /** Total library size (sum of entry.quantity). */
  size: number
}

export type BuildSimLibraryInput = {
  /** Deck cards + their oracle info. Oracle info comes from the
   *  hydrated deck-context; we don't hit the DB here. */
  cards: Array<{
    zone: 'main' | 'commander' | 'sideboard' | 'companion' | 'maybeboard'
    quantity: number
    oracle: ClassifyManaInput & {
      oracle_card_id: string
      name: string
      mana_cost: string | null
      mana_value: number | null
      type_line: string | null
      colors: string[] | null
      color_identity: string[] | null
      capabilities: CardCapability[] | string[] | null
      produced_mana: string[] | null
      oracle_text: string | null
    }
  }>
}

export function buildSimLibrary(input: BuildSimLibraryInput): SimLibrary {
  const entries: SimLibraryEntry[] = []
  const commanders: SimCard[] = []
  const companion: SimCard[] = []

  for (const c of input.cards) {
    const sc = toSimCard(c.oracle)
    if (c.zone === 'commander') {
      // 1 commander occupies the command zone regardless of quantity.
      commanders.push(sc)
      continue
    }
    if (c.zone === 'companion') {
      companion.push(sc)
      continue
    }
    if (c.zone === 'sideboard' || c.zone === 'maybeboard') {
      continue
    }
    // Main zone → in the library.
    entries.push({ card: sc, quantity: c.quantity })
  }

  // Flatten into copies. Same object reference is fine because we
  // never mutate a SimCard during simulation.
  const cards: SimCard[] = []
  for (const e of entries) {
    for (let i = 0; i < e.quantity; i++) cards.push(e.card)
  }
  return { entries, cards, commanders, companion, size: cards.length }
}

function toSimCard(o: BuildSimLibraryInput['cards'][number]['oracle']): SimCard {
  const classification = classifyManaSource({
    name: o.name,
    type_line: o.type_line,
    oracle_text: o.oracle_text,
    produced_mana: o.produced_mana,
    colors: o.colors,
    color_identity: o.color_identity,
    capabilities: o.capabilities,
  })
  return {
    oracle_card_id: o.oracle_card_id,
    name: o.name,
    mana_cost: o.mana_cost,
    mana_value: o.mana_value,
    type_line: o.type_line,
    colors: o.colors ?? [],
    color_identity: o.color_identity ?? [],
    capabilities: (o.capabilities ?? []) as CardCapability[],
    produced_mana: o.produced_mana,
    oracle_text: o.oracle_text,
    classification,
  }
}
