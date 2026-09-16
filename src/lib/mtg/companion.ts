// src/lib/mtg/companion.ts
//
// Deterministic Companion deck-construction validator.
//
// There are 10 canonical Companion cards. Each imposes a specific
// starting-deck restriction. This module encodes only the restrictions
// we can reliably check from Oracle-derived fields:
//
//   - Keruga, the Macrosage           non-land cards have MV ≥ 3
//   - Lurrus of the Dream-Den         permanent cards have MV ≤ 2
//   - Obosh, the Preypiercer          non-land cards have odd MV
//   - Gyruda, Doom of Depths          non-land cards have even MV
//   - Yorion, Sky Nomad               deck ≥ format min size + 20
//   - Jegantha, the Wellspring        no mana cost has >1 of any coloured symbol
//   - Umori, the Collector            all non-land cards share one card type
//
// The following are intentionally NOT enforced here because their
// Oracle-text-only detection is fragile enough to false-flag legal
// decks. They surface as warnings via the general validator instead:
//
//   - Kaheera, the Orphanguard        specific creature subtypes
//   - Lutri, the Spellchaser          singleton (also banned in most
//                                      constructed formats)
//   - Zirda, the Dawnwaker            every permanent has an activated
//                                      ability (requires parsing ":" from
//                                      oracle_text with many edge cases)
//
// SOURCES:
//   Companion rulings (Rule 702.139) — Wizards Comprehensive Rules
//   Individual card Oracle text on Scryfall

import type { DeckCardForValidation, ValidationIssue } from './deck-rules'
import { getFormatRule, isBasicLand } from './format-rules'
import { parseCardTypes } from './deck-rules'
import type { FormatKey } from './formats.data'

/** Canonical Companion identity. Matched by Oracle name. */
export const COMPANION_NAMES = [
  'Keruga, the Macrosage',
  'Lurrus of the Dream-Den',
  'Obosh, the Preypiercer',
  'Gyruda, Doom of Depths',
  'Yorion, Sky Nomad',
  'Jegantha, the Wellspring',
  'Umori, the Collector',
  // Not enforced here — surfaced as a warning:
  'Kaheera, the Orphanguard',
  'Lutri, the Spellchaser',
  'Zirda, the Dawnwaker',
] as const
export type CompanionName = typeof COMPANION_NAMES[number]

const DETERMINISTIC = new Set<CompanionName>([
  'Keruga, the Macrosage',
  'Lurrus of the Dream-Den',
  'Obosh, the Preypiercer',
  'Gyruda, Doom of Depths',
  'Yorion, Sky Nomad',
  'Jegantha, the Wellspring',
  'Umori, the Collector',
])

/** Parsed mana-cost symbol run. Returns per-colour counts. */
function coloredSymbolCounts(manaCost: string | null | undefined): Record<string, number> {
  if (!manaCost) return {}
  const counts: Record<string, number> = {}
  const rx = /\{([^{}]+)\}/g
  let m: RegExpExecArray | null
  while ((m = rx.exec(manaCost)) !== null) {
    const inner = m[1].toUpperCase()
    // Ignore generic ({2}), X, T, S, P suffixes, hybrid halves count each half once.
    if (/^\d+$/.test(inner) || inner === 'X' || inner === 'Y' || inner === 'Z' || inner === 'T' || inner === 'S') continue
    // Hybrid like {W/U} counts against both W and U caps.
    for (const ch of inner.replace(/P/g, '').split('/')) {
      if ('WUBRGC'.includes(ch)) counts[ch] = (counts[ch] ?? 0) + 1
    }
  }
  return counts
}

/** Primary card type set for Umori/Companion checks. Returns the set
 *  of primary types (creature/instant/sorcery/…). */
function primaryTypes(typeLine: string | null | undefined): string[] {
  const parts = parseCardTypes(typeLine ?? null)
  const primaries = ['creature', 'instant', 'sorcery', 'enchantment', 'artifact', 'planeswalker', 'battle', 'land']
  return primaries.filter((t) => parts.includes(t))
}

export type CompanionCardInput = DeckCardForValidation & {
  mana_cost?: string | null
  mana_value?: number | null
}

/** Validate every companion currently in the deck against the main
 *  deck. Only zone === 'companion' cards are considered. */
export function validateCompanion(input: {
  format: FormatKey
  cards: CompanionCardInput[]
}): { issues: ValidationIssue[]; warnings: ValidationIssue[] } {
  const issues: ValidationIssue[] = []
  const warnings: ValidationIssue[] = []
  const rule = getFormatRule(input.format)

  const companions = input.cards.filter((c) => c.zone === 'companion')
  if (companions.length === 0) return { issues, warnings }
  if (companions.length > 1) {
    issues.push({
      kind: 'too_many_commanders' as any,
      severity: 'error',
      message: `Only one Companion is allowed. This deck has ${companions.length}.`,
    })
  }

  const main = input.cards.filter((c) => c.zone === 'main')

  for (const c of companions) {
    const name = c.name as CompanionName
    if (!(COMPANION_NAMES as readonly string[]).includes(name)) {
      // Unknown card in companion slot — warn but don't hard-fail.
      warnings.push({
        kind: 'partner_uncertainty' as any,
        severity: 'warning',
        message: `${c.name} is in the Companion zone but is not a recognised Companion card. Verify manually.`,
        cardName: c.name,
        oracle_card_id: c.oracle_card_id,
      })
      continue
    }
    if (!DETERMINISTIC.has(name)) {
      warnings.push({
        kind: 'partner_uncertainty' as any,
        severity: 'warning',
        message: `${c.name}: its deck-construction restriction (creature subtypes / singleton / activated abilities) cannot be reliably verified from Oracle data alone. MTGPrices does not enforce it — please double-check the deck against the rules text.`,
        cardName: c.name,
        oracle_card_id: c.oracle_card_id,
      })
      continue
    }

    switch (name) {
      case 'Keruga, the Macrosage': {
        for (const m of main) {
          const isLand = isBasicLand(m.type_line) || primaryTypes(m.type_line).includes('land')
          if (isLand) continue
          if ((m.mana_value ?? 0) < 3) {
            issues.push({
              kind: 'partner_uncertainty' as any, severity: 'error',
              message: `Keruga requires every non-land card to have mana value 3 or greater. ${m.name} has MV ${m.mana_value ?? '?'}.`,
              cardName: m.name, oracle_card_id: m.oracle_card_id,
            })
          }
        }
        break
      }
      case 'Lurrus of the Dream-Den': {
        for (const m of main) {
          const types = primaryTypes(m.type_line)
          const isPermanent = ['creature', 'artifact', 'enchantment', 'planeswalker', 'battle', 'land'].some((t) => types.includes(t))
          if (!isPermanent) continue
          if ((m.mana_value ?? 0) > 2) {
            issues.push({
              kind: 'partner_uncertainty' as any, severity: 'error',
              message: `Lurrus requires every permanent card to have mana value 2 or less. ${m.name} has MV ${m.mana_value ?? '?'}.`,
              cardName: m.name, oracle_card_id: m.oracle_card_id,
            })
          }
        }
        break
      }
      case 'Obosh, the Preypiercer': {
        for (const m of main) {
          const types = primaryTypes(m.type_line)
          if (types.includes('land')) continue
          const mv = m.mana_value ?? 0
          if (mv % 2 === 0) {
            issues.push({
              kind: 'partner_uncertainty' as any, severity: 'error',
              message: `Obosh requires every non-land card to have odd mana value. ${m.name} has MV ${mv}.`,
              cardName: m.name, oracle_card_id: m.oracle_card_id,
            })
          }
        }
        break
      }
      case 'Gyruda, Doom of Depths': {
        for (const m of main) {
          const types = primaryTypes(m.type_line)
          if (types.includes('land')) continue
          const mv = m.mana_value ?? 0
          if (mv % 2 !== 0) {
            issues.push({
              kind: 'partner_uncertainty' as any, severity: 'error',
              message: `Gyruda requires every non-land card to have even mana value. ${m.name} has MV ${mv}.`,
              cardName: m.name, oracle_card_id: m.oracle_card_id,
            })
          }
        }
        break
      }
      case 'Yorion, Sky Nomad': {
        if (!rule) break
        const mainQty = main.reduce((n, c) => n + c.quantity, 0)
        const cmdQty = input.cards.filter((c) => c.zone === 'commander').reduce((n, c) => n + c.quantity, 0)
        const total = mainQty + cmdQty
        const minWith = rule.minDeckSize + (rule.hasCommander ? 1 : 0) + 20
        if (total < minWith) {
          issues.push({
            kind: 'deck_too_small' as any, severity: 'error',
            message: `Yorion requires a starting deck of at least ${minWith} cards (${rule.minDeckSize}${rule.hasCommander ? ' + 1 commander' : ''} + 20). This deck has ${total}.`,
          })
        }
        break
      }
      case 'Jegantha, the Wellspring': {
        for (const m of main) {
          const counts = coloredSymbolCounts(m.mana_cost)
          for (const [colour, n] of Object.entries(counts)) {
            if (n > 1) {
              issues.push({
                kind: 'partner_uncertainty' as any, severity: 'error',
                message: `Jegantha requires no more than one of the same coloured mana symbol in any card's cost. ${m.name} has ${n} × {${colour}}.`,
                cardName: m.name, oracle_card_id: m.oracle_card_id,
              })
              break
            }
          }
        }
        break
      }
      case 'Umori, the Collector': {
        const typesByCard = main
          .filter((m) => !primaryTypes(m.type_line).includes('land'))
          .map((m) => new Set(primaryTypes(m.type_line).filter((t) => t !== 'land')))
        if (typesByCard.length === 0) break
        // Intersect all type-sets. If empty, Umori is not satisfied.
        const shared = typesByCard.reduce((acc, s) => new Set(Array.from(acc).filter((x) => s.has(x))))
        if (shared.size === 0) {
          issues.push({
            kind: 'partner_uncertainty' as any, severity: 'error',
            message: `Umori requires every non-land card in the starting deck to share a card type. Nothing is common across the current main deck.`,
          })
        }
        break
      }
    }
  }
  return { issues, warnings }
}
