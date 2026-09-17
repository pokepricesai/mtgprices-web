// src/lib/mtg/simulation/mana.ts
//
// Conservative mana-source classifier for Phase 4A. The goal is honest
// modelling — do NOT claim a mana rock is equivalent to an untapped
// coloured land. We surface distinct categories so the UI can show
// each separately and users can read their deck's mana base clearly.
//
// Categories (mutually exclusive, ordered from most-guaranteed to
// least-guaranteed):
//
//   basic_land            — Basic Plains / Island / Swamp / Mountain /
//                           Forest. Guaranteed produces its colour(s),
//                           always enters untapped.
//   nonbasic_untapped     — Non-basic land with a produced_mana list AND
//                           Oracle text strongly implies it enters
//                           untapped in this context (Shocklands,
//                           dual lands, City of Brass, etc). We ONLY
//                           mark these when the classification is
//                           unambiguous — anything questionable falls
//                           to nonbasic_conditional.
//   nonbasic_conditional  — Non-basic land with produced_mana but
//                           requires conditions to enter untapped (tap
//                           lands, "enters tapped unless…" lands, check
//                           lands, fetch lands). Still a real land for
//                           the land-drop count, but NOT counted as an
//                           untapped-turn-1 coloured source without
//                           further modelling.
//   colourless_land       — Land that produces only colourless mana
//                           (Wastes, utility lands). Counts for land
//                           drops; does not produce colour.
//   mana_rock             — Non-land, non-creature that produces mana
//                           (Sol Ring, Signets). Requires being cast.
//   mana_creature         — Creature that produces mana (Llanowar Elves,
//                           mana dorks). Requires being cast + a turn
//                           to activate in most cases.
//   ramp_spell            — Non-land ramp effect that puts a land into
//                           play or produces mana (Cultivate, Rampant
//                           Growth). Counts as ramp capability, not a
//                           direct untapped source.
//   other                 — Everything else — NOT a mana source.
//
// The user's UI shows all categories with their assumption explicitly
// stated. We never silently roll them together.

import type { CardCapability } from '../capabilities'

export type ManaSourceCategory =
  | 'basic_land'
  | 'nonbasic_untapped'
  | 'nonbasic_conditional'
  | 'colourless_land'
  | 'mana_rock'
  | 'mana_creature'
  | 'ramp_spell'
  | 'other'

export type Classification = {
  category: ManaSourceCategory
  colours: string[]                // e.g. ['U','R'] — colours PRODUCED (empty for colourless_land or other)
  is_land: boolean
  enters_tapped_default: boolean   // best-effort read from oracle_text
  reason: string                    // short explanation of the classification
}

const BASIC_NAMES = new Set(['Plains', 'Island', 'Swamp', 'Mountain', 'Forest'])
const BASIC_COLOUR: Record<string, string> = { Plains: 'W', Island: 'U', Swamp: 'B', Mountain: 'R', Forest: 'G' }

export type ClassifyManaInput = {
  name: string
  type_line: string | null
  oracle_text: string | null
  produced_mana: string[] | null
  colors: string[] | null
  color_identity: string[] | null
  capabilities: CardCapability[] | string[] | null
}

/** Deterministic classifier. Zero DB access, zero AI. Given an
 *  Oracle card, return a single `Classification`. */
export function classifyManaSource(c: ClassifyManaInput): Classification {
  const type = (c.type_line ?? '').toLowerCase()
  const text = (c.oracle_text ?? '').toLowerCase()
  const produced = normaliseProduced(c.produced_mana)
  const capsRaw: string[] = (c.capabilities ?? []) as string[]
  const caps = new Set(capsRaw.map((k) => k.toLowerCase()))
  const isLand = /\bland\b/.test(type)
  const isBasic = isLand && /\bbasic\b/.test(type)
  const entersTapped = detectEntersTapped(text)

  // ── Basic lands ───────────────────────────────────────────────
  if (isBasic) {
    // Snow basics still count; use the mapped base-name.
    const baseName = Array.from(BASIC_NAMES).find((n) => c.name.endsWith(n))
    const colour = baseName ? BASIC_COLOUR[baseName] : null
    return {
      category: 'basic_land',
      colours: colour ? [colour] : produced.length > 0 ? produced : [],
      is_land: true,
      enters_tapped_default: false,
      reason: 'Basic land — always untapped, always produces its named colour.',
    }
  }

  // ── Non-basic lands ───────────────────────────────────────────
  if (isLand) {
    const colouredProduction = produced.filter((p) => 'WUBRG'.includes(p))
    if (colouredProduction.length === 0) {
      // Land that only produces colourless (Wastes, utility lands
      // producing {C} only, or lands where produced_mana is missing).
      return {
        category: 'colourless_land',
        colours: [],
        is_land: true,
        enters_tapped_default: entersTapped,
        reason: produced.length === 0
          ? 'Land with no coloured produced_mana signalled.'
          : 'Land produces only colourless mana.',
      }
    }
    if (entersTapped) {
      return {
        category: 'nonbasic_conditional',
        colours: colouredProduction,
        is_land: true,
        enters_tapped_default: true,
        reason: 'Non-basic land that enters tapped by default (or subject to conditions in its Oracle text).',
      }
    }
    // Untapped and produces colours. This includes dual lands, shock
    // lands (which have a life-payment CONDITION to enter untapped —
    // we still call it untapped since the choice belongs to the
    // player), fetch lands (which fetch other lands), City of Brass
    // etc. Fetch lands specifically produce nothing directly — they
    // sacrifice for another land. Detect and downgrade.
    if (/\bsearch your library for a .* land\b/.test(text) && /\bsacrifice\b/.test(text)) {
      return {
        category: 'nonbasic_conditional',
        colours: colouredProduction,
        is_land: true,
        enters_tapped_default: false,
        reason: 'Fetch land — untapped, but does not directly produce mana until it fetches a land which may itself enter tapped.',
      }
    }
    return {
      category: 'nonbasic_untapped',
      colours: colouredProduction,
      is_land: true,
      enters_tapped_default: false,
      reason: 'Non-basic land, produces colour, no default enters-tapped clause detected.',
    }
  }

  // ── Non-land mana producers ───────────────────────────────────
  const producesMana = produced.length > 0 || caps.has('mana-production')
  const isCreature = /\bcreature\b/.test(type)
  const isArtifact = /\bartifact\b/.test(type)

  if (producesMana) {
    if (isCreature) {
      return {
        category: 'mana_creature',
        colours: produced.filter((p) => 'WUBRG'.includes(p)),
        is_land: false,
        enters_tapped_default: true,          // needs summoning sickness by default
        reason: 'Creature that produces mana. Must be cast; ordinarily cannot tap for mana the turn it enters.',
      }
    }
    if (isArtifact) {
      return {
        category: 'mana_rock',
        colours: produced.filter((p) => 'WUBRG'.includes(p)),
        is_land: false,
        enters_tapped_default: false,
        reason: 'Artifact that produces mana. Must be cast; ready the turn after.',
      }
    }
  }

  // Ramp spells that put lands into play or produce mana temporarily.
  if (caps.has('ramp')) {
    return {
      category: 'ramp_spell',
      colours: [],
      is_land: false,
      enters_tapped_default: false,
      reason: 'Ramp spell — accelerates mana but not itself an untapped source turn 1.',
    }
  }

  return {
    category: 'other',
    colours: [],
    is_land: false,
    enters_tapped_default: false,
    reason: 'Not a mana source.',
  }
}

// ── Helpers ────────────────────────────────────────────────────────

function normaliseProduced(p: string[] | null): string[] {
  if (!p) return []
  return p.map((s) => (s ?? '').toUpperCase())
    .filter((s) => s.length === 1)
    .filter((s) => 'WUBRGC'.includes(s))
}

/** Best-effort detection of "enters tapped" behaviour from Oracle text.
 *  Deliberately conservative: false-negatives are OK (the card gets
 *  classified nonbasic_untapped and reality catches up when a user
 *  plays it), false-positives are worse (we'd under-count real
 *  colour sources). */
function detectEntersTapped(text: string): boolean {
  if (!text) return false
  // Shockland idiom: "As X enters, you may pay N life. If you don't,
  // it enters tapped." — treat as UNTAPPED by default (players nearly
  // always pay). Detect and short-circuit.
  if (/as [^.]* enters,? you may pay \d+ life\.?\s*if you don'?t,? it enters (?:the battlefield )?tapped/i.test(text)) {
    return false
  }
  // Direct "enters tapped" or "enters the battlefield tapped".
  if (/\benters (?:the battlefield )?tapped\b/.test(text)) return true
  // Check-land / "enters tapped unless you control a Plains" — still
  // enters tapped by default under our conservative model, since we
  // don't know what else the player controls at random opening-hand
  // time.
  return false
}

// ── Aggregations for a deck ────────────────────────────────────────

export type SourceCounts = {
  by_category: Record<ManaSourceCategory, number>          // total cards per category
  by_colour_untapped: Record<'W'|'U'|'B'|'R'|'G'|'C', number>  // basic + nonbasic_untapped only
  by_colour_all_lands: Record<'W'|'U'|'B'|'R'|'G'|'C', number> // all lands including conditional
  total_lands: number
  total_ramp: number            // rocks + creatures + ramp spells (potential ramp)
  total_cards: number
}

export function aggregateSources(
  cards: Array<{ classification: Classification; quantity: number }>,
): SourceCounts {
  const by_category: SourceCounts['by_category'] = {
    basic_land: 0, nonbasic_untapped: 0, nonbasic_conditional: 0,
    colourless_land: 0, mana_rock: 0, mana_creature: 0, ramp_spell: 0, other: 0,
  }
  const by_colour_untapped: SourceCounts['by_colour_untapped'] = { W: 0, U: 0, B: 0, R: 0, G: 0, C: 0 }
  const by_colour_all_lands: SourceCounts['by_colour_all_lands'] = { W: 0, U: 0, B: 0, R: 0, G: 0, C: 0 }
  let total_lands = 0
  let total_ramp = 0
  let total_cards = 0

  for (const { classification: cls, quantity: q } of cards) {
    by_category[cls.category] += q
    total_cards += q
    if (cls.is_land) {
      total_lands += q
      if (cls.category === 'basic_land' || cls.category === 'nonbasic_untapped') {
        for (const col of cls.colours) {
          const key = (col as any) as 'W'|'U'|'B'|'R'|'G'|'C'
          if (key in by_colour_untapped) by_colour_untapped[key] += q
        }
      }
      // All-lands colour count also includes conditional lands so
      // players can see the full colour spread of their manabase.
      if (cls.category === 'basic_land' || cls.category === 'nonbasic_untapped' || cls.category === 'nonbasic_conditional') {
        for (const col of cls.colours) {
          const key = (col as any) as 'W'|'U'|'B'|'R'|'G'|'C'
          if (key in by_colour_all_lands) by_colour_all_lands[key] += q
        }
      }
      if (cls.category === 'colourless_land') by_colour_all_lands.C += q
    }
    if (cls.category === 'mana_rock' || cls.category === 'mana_creature' || cls.category === 'ramp_spell') {
      total_ramp += q
    }
  }
  return { by_category, by_colour_untapped, by_colour_all_lands, total_lands, total_ramp, total_cards }
}

// ── Mana-cost symbol pressure ──────────────────────────────────────

/** Count coloured mana symbols in a mana_cost string. E.g.
 *  "{2}{U}{U}" → { U: 2 }, "{X}{R}{R}{R}" → { R: 3 }, "{W/U}" → each
 *  hybrid symbol contributes 0.5 to each side (soft evidence, not
 *  strict). */
export function countManaSymbols(cost: string | null | undefined): Record<'W'|'U'|'B'|'R'|'G', number> {
  const out = { W: 0, U: 0, B: 0, R: 0, G: 0 }
  if (!cost) return out
  const symbols = cost.match(/\{[^}]+\}/g) ?? []
  for (const sym of symbols) {
    const body = sym.slice(1, -1).toUpperCase()
    if (body.length === 1 && 'WUBRG'.includes(body)) {
      out[body as 'W'|'U'|'B'|'R'|'G'] += 1
      continue
    }
    // Hybrid W/U, phyrexian, 2/W etc.
    if (body.includes('/')) {
      const parts = body.split('/')
      const colouredParts = parts.filter((p) => p.length === 1 && 'WUBRG'.includes(p))
      if (colouredParts.length > 0) {
        const share = 1 / colouredParts.length
        for (const p of colouredParts) out[p as 'W'|'U'|'B'|'R'|'G'] += share
      }
    }
  }
  return out
}

/** Aggregate coloured mana pressure across a deck's main + commanders
 *  (excluding lands themselves — a land's own mana cost is zero). */
export function aggregateColourPressure(
  entries: Array<{ mana_cost: string | null; quantity: number; is_land: boolean }>,
): Record<'W'|'U'|'B'|'R'|'G', number> {
  const acc = { W: 0, U: 0, B: 0, R: 0, G: 0 }
  for (const e of entries) {
    if (e.is_land) continue
    const per = countManaSymbols(e.mana_cost)
    for (const k of ['W','U','B','R','G'] as const) acc[k] += per[k] * e.quantity
  }
  return acc
}
