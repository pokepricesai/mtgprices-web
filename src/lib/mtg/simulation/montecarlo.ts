// src/lib/mtg/simulation/montecarlo.ts
//
// Monte Carlo simulator. Runs `iterations` independent games against
// a SimLibrary, tracking:
//   - opening-hand land distribution (0..7+ lands)
//   - probability of hitting the land-drop-per-turn count through turn T
//   - probability of drawing a specific oracle_card_id by turn T
//   - probability of drawing a card with a specific capability by turn T
//   - probability of drawing at least one card with MV ≤ X by turn Y
//
// Every function operates over the CARDS SEEN by end of a given turn
// (opening 7 + N draw-step draws — respects play/draw + Commander
// first-player-draw toggle). We never claim "you can cast X on
// turn T" — this is availability, not castability.
//
// Simulation is 100% in-memory. No DB. No AI. Deterministic given a
// seed.

import type { SimLibrary, SimCard } from './library'
import { shuffle } from './shuffle'
import { makePrng, defaultSeed, type PRNG } from './prng'
import type { CardCapability } from '../capabilities'

export type PlayOrDraw = 'play' | 'draw'

export type MulliganRule = {
  /** Minimum acceptable lands in the opening 7. Below this ⇒ mulligan. */
  minLands?: number
  /** Maximum acceptable lands in the opening 7. Above this ⇒ mulligan. */
  maxLands?: number
  /** If set, require at least one card with any of these capabilities. */
  requireCapability?: CardCapability[]
  /** If set, require at least one copy of a specific oracle card. */
  requireOracleCardId?: string
  /** How many mulligans before we give up and keep whatever we have. */
  maxMulligans?: number
}

export type MCSpec = {
  library: SimLibrary
  iterations: number
  play: PlayOrDraw
  /** Whether the first player draws on turn 1. Standard constructed
   *  MTG: first player DOES NOT draw. Commander (multiplayer, per
   *  official CR 903): first player DOES draw. Expose this so the
   *  simulator states its own assumption. */
  firstPlayerDrawsOnTurn1?: boolean
  /** Turns to compute "by turn T" probabilities for. Default [1..7]. */
  throughTurns?: number[]
  /** Optional user-defined mulligan rule. Undefined = never mulligan. */
  mulligan?: MulliganRule
  /** Specific card to track (oracle_card_id). */
  trackOracleId?: string
  /** Capabilities to track. */
  trackCapabilities?: CardCapability[]
  /** MV thresholds — for each threshold, we report P(saw a card with MV ≤ threshold by turn T). */
  trackMVLeq?: number[]
  /** Deterministic seed. */
  seed?: number
}

export type LandDistribution = {
  counts: number[]         // counts[k] = number of iterations where opening 7 had k lands
  probabilities: number[]  // = counts[k] / iterations
  averageLands: number
}

export type MCResult = {
  spec: {
    iterations: number
    play: PlayOrDraw
    firstPlayerDrawsOnTurn1: boolean
    librarySize: number
    seed: number
    assumptions: string[]
  }
  openingHandLands: LandDistribution
  /** P(at least T lands seen through end of turn T), for each T. */
  landDropByTurn: Array<{ turn: number; p: number }>
  /** P(≥1 copy of trackOracleId seen through end of turn T), or null when not requested. */
  cardByTurn: Array<{ turn: number; p: number }> | null
  /** P(≥1 card matching each capability seen through end of turn T). */
  capabilityByTurn: Array<{ capability: CardCapability; probs: Array<{ turn: number; p: number }> }>
  /** P(≥1 card with MV ≤ threshold seen through end of turn T). */
  mvByTurn: Array<{ threshold: number; probs: Array<{ turn: number; p: number }> }>
  /** Fraction of games in which the mulligan rule triggered. */
  mulliganed: number
  /** Distribution of mulligans taken (0, 1, 2, …). */
  mulliganCounts: number[]
  wallMs: number
}

const DEFAULT_TURNS = [1, 2, 3, 4, 5, 6, 7]

/** Cards seen by end of turn T under the chosen turn model. */
function cardsSeen(turn: number, play: PlayOrDraw, firstPlayerDrawsOnTurn1: boolean, openingHand: number): number {
  if (turn <= 0) return openingHand
  // On the play (constructed): turn 1 no draw, so through-end-of-T = 7 + (T-1)
  // On the draw: turn 1 draws 1, through-end-of-T = 7 + T
  // Commander first-player-draws override: on the play but firstPlayerDrawsOnTurn1=true → 7 + T
  const skipsFirstDraw = play === 'play' && !firstPlayerDrawsOnTurn1
  const draws = skipsFirstDraw ? Math.max(0, turn - 1) : turn
  return openingHand + draws
}

function isLand(c: SimCard): boolean {
  return c.classification.is_land
}

function passesMulliganRule(hand: SimCard[], rule: MulliganRule | undefined): boolean {
  if (!rule) return true
  const lands = hand.filter(isLand).length
  if (rule.minLands != null && lands < rule.minLands) return false
  if (rule.maxLands != null && lands > rule.maxLands) return false
  if (rule.requireCapability && rule.requireCapability.length > 0) {
    const need = new Set(rule.requireCapability)
    const has = hand.some((c) => c.capabilities.some((k) => need.has(k)))
    if (!has) return false
  }
  if (rule.requireOracleCardId) {
    const has = hand.some((c) => c.oracle_card_id === rule.requireOracleCardId)
    if (!has) return false
  }
  return true
}

/** Choose which cards to bottom on mulligan. Same strategy as
 *  bottomHighMV — bottom highest MV first — but with a bias to KEEP
 *  lands (never bottom lands unless we've bottomed all non-lands). */
function chooseBottom(hand: SimCard[], m: number): SimCard[] {
  if (m <= 0) return hand
  const sorted = hand.slice().sort((a, b) => {
    // Non-lands first (they'll be bottomed), highest MV first inside each group.
    const aLand = isLand(a) ? 1 : 0
    const bLand = isLand(b) ? 1 : 0
    if (aLand !== bLand) return aLand - bLand
    return (b.mana_value ?? 0) - (a.mana_value ?? 0)
  })
  const bottom = new Set(sorted.slice(0, m))
  return hand.filter((c) => !bottom.has(c))
}

/** Run a full Monte Carlo pass. Pure — no DB, no AI. */
export function runMonteCarlo(spec: MCSpec): MCResult {
  const t0 = Date.now()
  const iterations = Math.max(1, Math.floor(spec.iterations))
  const play = spec.play
  const firstDraws = spec.firstPlayerDrawsOnTurn1 ?? false
  const turns = spec.throughTurns ?? DEFAULT_TURNS
  const trackCaps = spec.trackCapabilities ?? []
  const trackMV = spec.trackMVLeq ?? []
  const seed = spec.seed ?? defaultSeed()
  const rng: PRNG = makePrng(seed)
  const maxMulligans = spec.mulligan?.maxMulligans ?? (spec.mulligan ? 3 : 0)

  const librarySize = spec.library.size
  const openingLandCounts = new Array(8).fill(0) as number[]  // 0..7
  const landHitsByTurn = new Map<number, number>()
  const cardHitsByTurn = new Map<number, number>()
  const capHitsByTurn = new Map<string, Map<number, number>>()
  for (const cap of trackCaps) capHitsByTurn.set(cap, new Map())
  const mvHitsByTurn = new Map<number, Map<number, number>>()
  for (const mv of trackMV) mvHitsByTurn.set(mv, new Map())
  let mulliganed = 0
  const mulliganCounts: number[] = []

  // Precompute maximum cards we need to reveal for the largest turn.
  const maxTurn = turns.length > 0 ? Math.max(...turns) : 0
  const maxDraws = cardsSeen(maxTurn, play, firstDraws, 7)

  const trackOracleId = spec.trackOracleId ?? null

  for (let it = 0; it < iterations; it++) {
    const shuffled = shuffle(spec.library.cards, rng)
    // London mulligan loop.
    let m = 0
    let hand: SimCard[] = []
    let libIndex = 0
    while (true) {
      // fresh 7 from the shuffled deck (indices 0..6)
      const seven = shuffled.slice(0, 7)
      const seenPassing = passesMulliganRule(seven, spec.mulligan)
      if (seenPassing || m >= maxMulligans || !spec.mulligan) {
        // Keep this hand. Bottom `m` cards to the end of the library.
        const kept = chooseBottom(seven, m)
        // Reconstruct library with bottomed cards moved to the bottom.
        const bottomed = seven.filter((c) => !kept.includes(c))
        const rest = shuffled.slice(7)  // indices 7..end
        const finalLib = rest.concat(bottomed)
        hand = kept
        libIndex = 0  // draws come from finalLib[0..]
        // Save the state we'll draw from.
        // We re-scope below via local variables for speed.
        mulliganed += m > 0 ? 1 : 0
        mulliganCounts[m] = (mulliganCounts[m] ?? 0) + 1
        // Draw the maximum we might need up-front. Cheap because
        // it's a splice from a plain array; the loop asks only how
        // many are seen by each turn.
        const drawn = finalLib.slice(libIndex, libIndex + maxDraws)

        // Opening-hand lands.
        const lands0 = hand.filter(isLand).length
        openingLandCounts[Math.min(lands0, 7)]++

        // For each turn we care about, gather cards seen so far.
        for (const t of turns) {
          const seenN = cardsSeen(t, play, firstDraws, 7)
          const drawnN = seenN - 7
          const seenCards = hand.concat(drawn.slice(0, drawnN))
          // Land drop: had at least t lands available.
          const seenLands = seenCards.filter(isLand).length
          if (seenLands >= t) landHitsByTurn.set(t, (landHitsByTurn.get(t) ?? 0) + 1)
          // Specific card.
          if (trackOracleId && seenCards.some((c) => c.oracle_card_id === trackOracleId)) {
            cardHitsByTurn.set(t, (cardHitsByTurn.get(t) ?? 0) + 1)
          }
          // Capabilities.
          for (const cap of trackCaps) {
            const map = capHitsByTurn.get(cap)!
            if (seenCards.some((c) => c.capabilities.includes(cap))) {
              map.set(t, (map.get(t) ?? 0) + 1)
            }
          }
          // MV thresholds.
          for (const mv of trackMV) {
            const map = mvHitsByTurn.get(mv)!
            if (seenCards.some((c) => (c.mana_value ?? 0) <= mv && !isLand(c))) {
              map.set(t, (map.get(t) ?? 0) + 1)
            }
          }
        }
        break
      }
      m += 1
      // For the next iteration of the London loop we RESHUFFLE.
      // The London rules do not put returned cards on the top — a
      // fresh shuffle is the standard interpretation for simulation.
      // (We already have `shuffled`; we shuffle again with fresh RNG
      // draws below inline.)
      // Since our `shuffled` was already a per-iteration shuffle,
      // reshuffle to simulate a genuinely fresh library.
      const reshuffled = shuffle(shuffled, rng)
      // Overwrite `shuffled` in place by mutating it via .splice.
      shuffled.length = 0
      Array.prototype.push.apply(shuffled, reshuffled)
    }
  }

  // Assemble result.
  const openingProbs = openingLandCounts.map((c) => c / iterations)
  const avgLands = openingProbs.reduce((s, p, i) => s + p * i, 0)
  const landDropByTurn = turns.map((t) => ({ turn: t, p: (landHitsByTurn.get(t) ?? 0) / iterations }))
  const cardByTurn = trackOracleId
    ? turns.map((t) => ({ turn: t, p: (cardHitsByTurn.get(t) ?? 0) / iterations }))
    : null
  const capabilityByTurn = trackCaps.map((cap) => ({
    capability: cap,
    probs: turns.map((t) => ({ turn: t, p: (capHitsByTurn.get(cap)!.get(t) ?? 0) / iterations })),
  }))
  const mvByTurn = trackMV.map((mv) => ({
    threshold: mv,
    probs: turns.map((t) => ({ turn: t, p: (mvHitsByTurn.get(mv)!.get(t) ?? 0) / iterations })),
  }))
  const mcCounts: number[] = []
  for (let i = 0; i <= maxMulligans; i++) mcCounts.push(mulliganCounts[i] ?? 0)

  const assumptions: string[] = [
    `${iterations.toLocaleString()} independent simulated games`,
    play === 'play' ? 'On the play' : 'On the draw',
    firstDraws ? 'First player draws on turn 1 (Commander multiplayer rule)' : 'First player skips their turn-1 draw (standard constructed rule)',
    `London mulligan up to ${maxMulligans} times${spec.mulligan ? ', using the configured keep-rule' : ' (never mulligans — no rule set)'}`,
    `Draws counted through the end of each turn's draw step`,
    `Card availability, not castability — no mana cost analysis`,
  ]

  return {
    spec: {
      iterations, play,
      firstPlayerDrawsOnTurn1: firstDraws,
      librarySize, seed, assumptions,
    },
    openingHandLands: { counts: openingLandCounts, probabilities: openingProbs, averageLands: avgLands },
    landDropByTurn,
    cardByTurn,
    capabilityByTurn,
    mvByTurn,
    mulliganed,
    mulliganCounts: mcCounts,
    wallMs: Date.now() - t0,
  }
}
