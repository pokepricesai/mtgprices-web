// src/lib/mtg/simulation/shuffle.ts
//
// Fisher–Yates shuffle keyed off a PRNG. Operates in-place for speed.

import type { PRNG } from './prng'

export function shuffleInPlace<T>(arr: T[], rng: PRNG): T[] {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1))
    const tmp = arr[i]
    arr[i] = arr[j]
    arr[j] = tmp
  }
  return arr
}

/** Non-destructive shuffle — returns a fresh array. */
export function shuffle<T>(arr: readonly T[], rng: PRNG): T[] {
  const copy = arr.slice()
  return shuffleInPlace(copy, rng)
}
