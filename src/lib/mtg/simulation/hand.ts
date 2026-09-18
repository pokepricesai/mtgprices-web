// src/lib/mtg/simulation/hand.ts
//
// Opening-hand + draw helpers. Uses a shuffled library index array so
// the hot loop mutates only ints, never the SimCard objects.

import type { SimCard, SimLibrary } from './library'
import type { PRNG } from './prng'
import { shuffle } from './shuffle'

export type LibraryDeck = {
  /** The shuffled card list. Index 0 = top of library. */
  deck: SimCard[]
}

/** Fresh shuffled library. Never mutates the SimLibrary input. */
export function shuffledLibrary(lib: SimLibrary, rng: PRNG): LibraryDeck {
  return { deck: shuffle(lib.cards, rng) }
}

/** Draw n cards from the top of the deck. Mutates the deck. */
export function drawN(state: LibraryDeck, n: number): SimCard[] {
  return state.deck.splice(0, n)
}

/** London mulligan: after `m` mulligans (m >= 0), take a fresh 7-card
 *  hand from the shuffled library, then bottom `m` cards. If we're
 *  simulating and the caller doesn't specify which cards to bottom,
 *  we use a deterministic strategy (see `chooseBottom`).
 *
 *  Returns the resulting 7-card (minus `m` bottomed) opening hand and
 *  the remaining library state.
 *
 *  The manual (UI) flow calls drawN(state, 7) directly and lets the
 *  user pick cards to bottom themselves, this helper is for
 *  automated / simulation mulliganing. */
export type BottomStrategy = (hand: SimCard[], m: number) => SimCard[]

/** Simple deterministic bottom-strategy: bottom the highest mana-value
 *  spells first (assumption: keeping curve-appropriate cards).
 *  Callers can pass their own strategy. */
export function bottomHighMV(hand: SimCard[], m: number): SimCard[] {
  const copy = hand.slice()
  copy.sort((a, b) => (b.mana_value ?? 0) - (a.mana_value ?? 0))
  const toBottom = copy.slice(0, m)
  const keep = hand.filter((c) => !toBottom.includes(c))
  return keep
}

/** Take a fresh 7 from the current deck state, then bottom `m` cards
 *  (they go to the bottom of the deck) using the chosen strategy.
 *  Mutates state. */
export function londonMulligan(
  state: LibraryDeck,
  m: number,
  strategy: BottomStrategy = bottomHighMV,
): SimCard[] {
  // Return previous hand (if any) to the deck? In simulation each
  // mulligan starts from a fresh shuffle; we assume caller has
  // already re-shuffled.
  const seven = drawN(state, 7)
  if (m <= 0) return seven
  const keep = strategy(seven, m)
  const bottomed = seven.filter((c) => !keep.includes(c))
  // Return bottomed cards to the bottom of the library.
  state.deck.push(...bottomed)
  return keep
}
