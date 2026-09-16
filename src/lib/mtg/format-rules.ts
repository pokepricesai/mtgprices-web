// src/lib/mtg/format-rules.ts
//
// Per-format deck-construction rules for MTGPrices.
//
// SOURCES (as of 2026-09-17):
//   - Magic: The Gathering Comprehensive Rules 100.2 (deck construction)
//     https://magic.wizards.com/en/rules
//   - Commander philosophy + rules
//     https://mtgcommander.net/index.php/rules/
//   - Wizards format-legality pages (Standard, Modern, Legacy, etc.)
//     https://magic.wizards.com/en/formats
//
// This file INTENTIONALLY does not encode obscure exceptions
// ("Rat Colony can appear any number of times"). Those are flagged as
// warnings by the validator rather than hard-failed. Format changes
// require editing this table only — no rules logic lives in React.

import type { FormatKey } from './formats.data'

export type FormatRule = {
  key: FormatKey
  label: string
  /** Deck size counts only cards in the main deck (does NOT count
   *  commanders in the command zone). */
  minDeckSize: number
  /** Some formats have a strict max (Standard: no max but pragmatically
   *  60), some have an exact size (Commander: 99 + 1 commander = 100).
   *  Number.POSITIVE_INFINITY means "no strict cap". */
  maxDeckSize: number
  /** Max copies of any single non-basic card. Basic lands are
   *  always exempt. */
  copiesLimit: number
  /** Max sideboard size. 0 for formats that don't use one. */
  sideboardMaxSize: number
  /** Formats requiring a commander in the command zone. */
  hasCommander: boolean
  /** Commander's colour identity restricts the 99. */
  enforceColorIdentity: boolean
  /** Singleton — one copy of any non-basic across the deck. */
  singleton: boolean
  /** Deck-construction notes surfaced in the UI. */
  notes: string[]
}

const RULES: Record<string, FormatRule> = {
  standard: {
    key: 'standard', label: 'Standard',
    minDeckSize: 60, maxDeckSize: Number.POSITIVE_INFINITY,
    copiesLimit: 4, sideboardMaxSize: 15,
    hasCommander: false, enforceColorIdentity: false, singleton: false,
    notes: [
      'Minimum 60 cards, no maximum (60 is standard practice).',
      'Up to 4 copies of any non-basic card.',
      '15-card sideboard, optional.',
    ],
  },
  pioneer: {
    key: 'pioneer', label: 'Pioneer',
    minDeckSize: 60, maxDeckSize: Number.POSITIVE_INFINITY,
    copiesLimit: 4, sideboardMaxSize: 15,
    hasCommander: false, enforceColorIdentity: false, singleton: false,
    notes: ['Same construction as Standard. Non-rotating format from Return to Ravnica forward.'],
  },
  modern: {
    key: 'modern', label: 'Modern',
    minDeckSize: 60, maxDeckSize: Number.POSITIVE_INFINITY,
    copiesLimit: 4, sideboardMaxSize: 15,
    hasCommander: false, enforceColorIdentity: false, singleton: false,
    notes: ['60-card minimum, up to 4 copies of any non-basic. 15-card sideboard.'],
  },
  legacy: {
    key: 'legacy', label: 'Legacy',
    minDeckSize: 60, maxDeckSize: Number.POSITIVE_INFINITY,
    copiesLimit: 4, sideboardMaxSize: 15,
    hasCommander: false, enforceColorIdentity: false, singleton: false,
    notes: ['60-card minimum. 4-copy limit. Eternal format — deep card pool.'],
  },
  vintage: {
    key: 'vintage', label: 'Vintage',
    minDeckSize: 60, maxDeckSize: Number.POSITIVE_INFINITY,
    copiesLimit: 4, sideboardMaxSize: 15,
    hasCommander: false, enforceColorIdentity: false, singleton: false,
    notes: [
      '60-card minimum, 4-copy limit.',
      'Vintage uses a restricted list — restricted cards are limited to 1 copy. Enforced separately.',
    ],
  },
  pauper: {
    key: 'pauper', label: 'Pauper',
    minDeckSize: 60, maxDeckSize: Number.POSITIVE_INFINITY,
    copiesLimit: 4, sideboardMaxSize: 15,
    hasCommander: false, enforceColorIdentity: false, singleton: false,
    notes: ['60-card minimum, 4-copy limit. Only cards printed at common somewhere.'],
  },
  historic: {
    key: 'historic', label: 'Historic',
    minDeckSize: 60, maxDeckSize: Number.POSITIVE_INFINITY,
    copiesLimit: 4, sideboardMaxSize: 15,
    hasCommander: false, enforceColorIdentity: false, singleton: false,
    notes: ['MTG Arena non-rotating. 60/4/15 like Standard.'],
  },
  timeless: {
    key: 'timeless', label: 'Timeless',
    minDeckSize: 60, maxDeckSize: Number.POSITIVE_INFINITY,
    copiesLimit: 4, sideboardMaxSize: 15,
    hasCommander: false, enforceColorIdentity: false, singleton: false,
    notes: ['MTG Arena eternal. 60/4/15.'],
  },
  alchemy: {
    key: 'alchemy', label: 'Alchemy',
    minDeckSize: 60, maxDeckSize: Number.POSITIVE_INFINITY,
    copiesLimit: 4, sideboardMaxSize: 15,
    hasCommander: false, enforceColorIdentity: false, singleton: false,
    notes: ['MTG Arena format with digital-only rebalances. 60/4/15.'],
  },
  premodern: {
    key: 'premodern', label: 'Premodern',
    minDeckSize: 60, maxDeckSize: Number.POSITIVE_INFINITY,
    copiesLimit: 4, sideboardMaxSize: 15,
    hasCommander: false, enforceColorIdentity: false, singleton: false,
    notes: ['Community format — 4th Edition through Scourge. 60/4/15.'],
  },
  oldschool: {
    key: 'oldschool', label: 'Old School',
    minDeckSize: 60, maxDeckSize: Number.POSITIVE_INFINITY,
    copiesLimit: 4, sideboardMaxSize: 15,
    hasCommander: false, enforceColorIdentity: false, singleton: false,
    notes: ['Community format — Alpha through Fallen Empires-era. 60/4/15.'],
  },
  penny: {
    key: 'penny', label: 'Penny Dreadful',
    minDeckSize: 60, maxDeckSize: Number.POSITIVE_INFINITY,
    copiesLimit: 4, sideboardMaxSize: 15,
    hasCommander: false, enforceColorIdentity: false, singleton: false,
    notes: ['Community format — only cards under the small price ceiling. 60/4/15.'],
  },
  future: {
    key: 'future', label: 'Future Standard',
    minDeckSize: 60, maxDeckSize: Number.POSITIVE_INFINITY,
    copiesLimit: 4, sideboardMaxSize: 15,
    hasCommander: false, enforceColorIdentity: false, singleton: false,
    notes: ['What Standard will look like once the current block rotates in. 60/4/15.'],
  },

  // ── Singleton / Commander family ─────────────────────────────
  commander: {
    key: 'commander', label: 'Commander',
    minDeckSize: 99, maxDeckSize: 99,
    copiesLimit: 1, sideboardMaxSize: 0,
    hasCommander: true, enforceColorIdentity: true, singleton: true,
    notes: [
      '100 cards total: 1 or 2 commanders + 99 (or 98 with Partner/Background) main-deck cards.',
      'Singleton: only 1 copy of any non-basic card.',
      'Commander(s) colour identity restricts the 99.',
      'Cards on the Commander RC banned list are not legal.',
    ],
  },
  oathbreaker: {
    key: 'oathbreaker', label: 'Oathbreaker',
    minDeckSize: 58, maxDeckSize: 58,
    copiesLimit: 1, sideboardMaxSize: 0,
    hasCommander: true, enforceColorIdentity: true, singleton: true,
    notes: [
      '60 cards total: 1 planeswalker + 1 signature spell + 58 main.',
      'Singleton. Colour identity of the planeswalker + signature spell restricts the deck.',
      'MTGPrices treats the command zone as a single "commander" slot for now — two-card command zones (planeswalker + signature) are a future refinement.',
    ],
  },
  brawl: {
    key: 'brawl', label: 'Brawl',
    minDeckSize: 59, maxDeckSize: 59,
    copiesLimit: 1, sideboardMaxSize: 0,
    hasCommander: true, enforceColorIdentity: true, singleton: true,
    notes: ['60 cards total: 1 commander + 59 singleton. Historic-legal on Arena.'],
  },
  standardbrawl: {
    key: 'standardbrawl', label: 'Standard Brawl',
    minDeckSize: 59, maxDeckSize: 59,
    copiesLimit: 1, sideboardMaxSize: 0,
    hasCommander: true, enforceColorIdentity: true, singleton: true,
    notes: ['60 cards total: 1 commander + 59. Standard-legal cards only.'],
  },
  gladiator: {
    key: 'gladiator', label: 'Gladiator',
    minDeckSize: 100, maxDeckSize: 100,
    copiesLimit: 1, sideboardMaxSize: 0,
    hasCommander: false, enforceColorIdentity: false, singleton: true,
    notes: ['100-card singleton on Arena — no commander.'],
  },
  duel: {
    key: 'duel', label: 'Duel Commander',
    minDeckSize: 99, maxDeckSize: 99,
    copiesLimit: 1, sideboardMaxSize: 0,
    hasCommander: true, enforceColorIdentity: true, singleton: true,
    notes: [
      '1v1 Commander variant. Same construction as Commander but its own ban list.',
    ],
  },
  predh: {
    key: 'predh', label: 'PreDH',
    minDeckSize: 99, maxDeckSize: 99,
    copiesLimit: 1, sideboardMaxSize: 0,
    hasCommander: true, enforceColorIdentity: true, singleton: true,
    notes: [
      'Commander using pre-2011 cards only. Same construction as Commander.',
    ],
  },
}

export const FORMAT_RULES: Record<FormatKey, FormatRule> = RULES as Record<FormatKey, FormatRule>

export function getFormatRule(format: string): FormatRule | null {
  return (RULES as Record<string, FormatRule | undefined>)[format] ?? null
}

/** True when `type_line` marks the card as a basic land. Basic lands
 *  are exempt from the copies limit in every format that has one. */
export function isBasicLand(typeLine: string | null | undefined): boolean {
  if (!typeLine) return false
  return /\bbasic\b/i.test(typeLine) && /\bland\b/i.test(typeLine)
}
