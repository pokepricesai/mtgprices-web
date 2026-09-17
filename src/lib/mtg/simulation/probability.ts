// src/lib/mtg/simulation/probability.ts
//
// Closed-form hypergeometric helpers. Not used in the hot simulation
// loop — kept here for (1) validation of Monte Carlo results in tests
// and (2) fast approximate probabilities the UI can quote without
// running 10k simulations.
//
// Hypergeometric: probability of drawing exactly k successes in n
// draws without replacement from a population of size N with K total
// successes.

/** log-Gamma via Stirling's approximation. Numerically stable for
 *  the range we care about (deck sizes 40–120, draws up to ~20). */
function logGamma(z: number): number {
  const g = 7
  const c = [
    0.99999999999980993, 676.5203681218851, -1259.1392167224028,
    771.32342877765313, -176.61502916214059, 12.507343278686905,
    -0.13857109526572012, 9.9843695780195716e-6, 1.5056327351493116e-7,
  ]
  if (z < 0.5) {
    return Math.log(Math.PI / Math.sin(Math.PI * z)) - logGamma(1 - z)
  }
  z -= 1
  let x = c[0]
  for (let i = 1; i < g + 2; i++) x += c[i] / (z + i)
  const t = z + g + 0.5
  return 0.5 * Math.log(2 * Math.PI) + (z + 0.5) * Math.log(t) - t + Math.log(x)
}

function logComb(n: number, k: number): number {
  if (k < 0 || k > n) return -Infinity
  if (k === 0 || k === n) return 0
  return logGamma(n + 1) - logGamma(k + 1) - logGamma(n - k + 1)
}

/** P(X = k) — hypergeometric point probability. */
export function hyperPmf(N: number, K: number, n: number, k: number): number {
  if (k < 0 || k > n || k > K || (n - k) > (N - K)) return 0
  return Math.exp(logComb(K, k) + logComb(N - K, n - k) - logComb(N, n))
}

/** P(X ≥ k) — hypergeometric right tail. */
export function hyperAtLeast(N: number, K: number, n: number, k: number): number {
  let p = 0
  const upper = Math.min(n, K)
  for (let x = k; x <= upper; x++) p += hyperPmf(N, K, n, x)
  return p
}

/** P(X ≤ k) — hypergeometric left tail. */
export function hyperAtMost(N: number, K: number, n: number, k: number): number {
  let p = 0
  const lower = Math.max(0, n - (N - K))
  for (let x = lower; x <= k; x++) p += hyperPmf(N, K, n, x)
  return p
}

/** Convenience: probability of drawing at least one success in n
 *  draws — the classic "chance of seeing a specific card by turn T"
 *  when K is small (e.g. K=1 for a specific singleton). */
export function pAtLeastOne(N: number, K: number, n: number): number {
  return hyperAtLeast(N, K, n, 1)
}

/** Cards seen by end of turn T under our simulator's turn model.
 *   - Opening hand: 7 cards
 *   - On the play: turn 1 skips draw; turn T draws (T-1) cards
 *   - On the draw: turn T draws T cards
 *  So cards SEEN through the end of turn T = 7 + drawsFromTurns(T).
 *  For the "have a card by turn T" question, this is what to use. */
export function cardsSeenByEndOfTurn(t: number, onThePlay: boolean, openingHand = 7): number {
  if (t <= 0) return openingHand
  const draws = onThePlay ? Math.max(0, t - 1) : t
  return openingHand + draws
}
