// src/lib/mtg/simulation/prng.ts
//
// Seedable pseudo-random number generator. Deterministic — the same
// seed always produces the same sequence, so simulations can be
// reproduced for debugging or test assertion.
//
// Algorithm: xoshiro128** — small state (128 bits), good statistical
// properties, extremely fast. Not cryptographically secure; that is
// not the goal.

export type PRNG = () => number  // returns a float in [0, 1)

/** Convert an arbitrary integer seed into a 4-tuple of 32-bit words
 *  suitable for xoshiro128 state. Uses splitmix32-like mixing. */
function mulberryExpand(seed: number): [number, number, number, number] {
  let z = (seed >>> 0) || 1
  function next() {
    z = (z + 0x9e3779b9) >>> 0
    let t = z
    t = Math.imul(t ^ (t >>> 15), 0x85ebca6b)
    t = Math.imul(t ^ (t >>> 13), 0xc2b2ae35)
    return (t ^ (t >>> 16)) >>> 0
  }
  return [next(), next(), next(), next()]
}

/** xoshiro128** — returns a function that yields floats in [0, 1). */
export function makePrng(seed: number): PRNG {
  let [s0, s1, s2, s3] = mulberryExpand(seed >>> 0)
  return function next(): number {
    // xoshiro128** step.
    const result = (Math.imul(Math.imul(s1, 5) | 0, 9) | 0) >>> 0
    const t = (s1 << 9) >>> 0
    s2 = (s2 ^ s0) >>> 0
    s3 = (s3 ^ s1) >>> 0
    s1 = (s1 ^ s2) >>> 0
    s0 = (s0 ^ s3) >>> 0
    s2 = (s2 ^ t) >>> 0
    s3 = ((s3 << 11) | (s3 >>> 21)) >>> 0
    return (result >>> 0) / 4294967296
  }
}

/** A convenient default seed for one-off use. Uses the current
 *  millisecond clock — do NOT use where reproducibility matters.
 *  For reproducible results, pass an explicit seed to makePrng. */
export function defaultSeed(): number {
  return Date.now() ^ Math.floor(Math.random() * 0x7fffffff)
}
