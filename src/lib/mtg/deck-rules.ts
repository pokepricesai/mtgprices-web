// src/lib/mtg/deck-rules.ts
//
// Deck construction validator. Reads FORMAT_RULES + per-card oracle
// data and returns a list of factual issues + warnings. No React in
// this file; it is reused by the API (deck-context), by the builder
// UI (for the validation panel), and eventually by the AI layer.

import type { FormatKey } from './formats.data'
import type { CardCapability } from './capabilities'
import { getFormatRule, isBasicLand } from './format-rules'

export type DeckZone = 'main' | 'commander' | 'sideboard' | 'companion' | 'maybeboard'

export type DeckCardForValidation = {
  oracle_card_id: string
  name: string
  quantity: number
  zone: DeckZone
  type_line: string | null
  color_identity: string[] | null
  keywords: string[] | null
  oracle_text: string | null
  legality: string | null   // 'legal' | 'not_legal' | 'banned' | 'restricted' | null
}

export type ValidationIssueKind =
  | 'format_not_legal'
  | 'format_banned'
  | 'too_many_copies'
  | 'deck_too_small'
  | 'deck_too_large'
  | 'sideboard_too_large'
  | 'missing_commander'
  | 'too_many_commanders'
  | 'commander_not_legendary'
  | 'color_identity_conflict'
  | 'partner_uncertainty'

export type ValidationIssue = {
  kind: ValidationIssueKind
  severity: 'error' | 'warning'
  message: string
  cardName?: string
  oracle_card_id?: string
}

export type ValidationResult = {
  ok: boolean
  issues: ValidationIssue[]     // severity: error
  warnings: ValidationIssue[]   // severity: warning
}

/** Extract the outer-level card types from a type line.
 *  "Legendary Creature, Human Wizard" → ["legendary","creature"]. */
export function parseCardTypes(typeLine: string | null | undefined): string[] {
  if (!typeLine) return []
  const beforeDash = typeLine.split('-')[0] ?? ''
  return beforeDash.trim().toLowerCase().split(/\s+/).filter(Boolean)
}

/** Colour-identity union across a list of oracle cards. */
export function unionColorIdentity(cards: Pick<DeckCardForValidation, 'color_identity'>[]): string[] {
  const set = new Set<string>()
  for (const c of cards) {
    for (const ch of c.color_identity ?? []) set.add(ch)
  }
  return Array.from(set).sort()
}

/** Detect Commander partner eligibility.
 *
 *  Sources:
 *    - Partner keyword: any two "Partner" commanders together.
 *    - "Partner with [name]" pairs specifically with that named card.
 *    - "Choose a Background": legendary creature + Background enchantment.
 *    - "Friends forever" and "Doctor's companion" are keyword-like
 *      abilities on specific cards.
 *
 *  We surface uncertainty as WARNINGS rather than hard-fail the deck:
 *  "Two commanders in the command zone, verify this pairing is legal."
 */
export function partnerEligibility(cards: DeckCardForValidation[]): {
  simplePartner: number      // count of cards with keyword 'Partner'
  namedPartner: number       // count of cards with "Partner with"
  background: number         // count of cards with "Choose a Background"
  isBackground: number       // count of background enchantments
  friendsForever: number
  doctorsCompanion: number
} {
  let simplePartner = 0, namedPartner = 0, background = 0, isBackground = 0, friendsForever = 0, doctorsCompanion = 0
  for (const c of cards) {
    const kw = (c.keywords ?? []).map((k) => k.toLowerCase())
    const text = (c.oracle_text ?? '').toLowerCase()
    if (kw.includes('partner') && !/partner with/.test(text)) simplePartner++
    if (/partner with/.test(text)) namedPartner++
    if (/choose a background/.test(text)) background++
    if ((c.type_line ?? '').toLowerCase().includes('background')) isBackground++
    if (/friends forever/.test(text)) friendsForever++
    if (/doctor'?s companion/.test(text)) doctorsCompanion++
  }
  return { simplePartner, namedPartner, background, isBackground, friendsForever, doctorsCompanion }
}

/** True if the card can legally be a Commander in some sense, a
 *  legendary creature, OR a card whose Oracle text says "can be your
 *  commander" (which covers a growing list of planeswalkers and a
 *  handful of legendary artifacts). */
export function canBeCommander(card: Pick<DeckCardForValidation, 'type_line' | 'oracle_text'>): boolean {
  const types = parseCardTypes(card.type_line)
  const text = (card.oracle_text ?? '').toLowerCase()
  const isLegendary = types.includes('legendary')
  const isCreature = types.includes('creature')
  if (isLegendary && isCreature) return true
  if (text.includes('can be your commander')) return true
  return false
}

// ── Main validator ────────────────────────────────────────────────

export function validateDeck(input: {
  format: FormatKey
  cards: DeckCardForValidation[]
}): ValidationResult {
  const issues: ValidationIssue[] = []
  const warnings: ValidationIssue[] = []
  const rule = getFormatRule(input.format)
  if (!rule) {
    warnings.push({ kind: 'format_not_legal', severity: 'warning', message: `Unknown format '${input.format}'. Only card-name/type checks will run.` })
  }

  // ── Legality per card ──────────────────────────────────────
  for (const c of input.cards) {
    if (c.zone === 'maybeboard') continue // Maybeboards are informational.
    if (c.legality === 'banned') {
      issues.push({ kind: 'format_banned', severity: 'error', message: `${c.name} is banned in ${rule?.label ?? input.format}.`, cardName: c.name, oracle_card_id: c.oracle_card_id })
    } else if (c.legality === 'not_legal' || c.legality === 'restricted') {
      // "restricted" is Vintage, legal in the deck but only 1 copy. Handle in copy check.
      if (c.legality === 'not_legal') {
        issues.push({ kind: 'format_not_legal', severity: 'error', message: `${c.name} is not legal in ${rule?.label ?? input.format}.`, cardName: c.name, oracle_card_id: c.oracle_card_id })
      }
    }
  }

  // ── Copy limits ────────────────────────────────────────────
  if (rule) {
    // Aggregate quantities across main + sideboard + commander (basics
    // are exempt entirely). Sideboards share the copy limit with the
    // main deck in constructed formats.
    const aggregate = new Map<string, { total: number; name: string; basic: boolean; restricted: boolean }>()
    for (const c of input.cards) {
      if (c.zone === 'maybeboard' || c.zone === 'companion') continue
      const cur = aggregate.get(c.oracle_card_id) ?? {
        total: 0,
        name: c.name,
        basic: isBasicLand(c.type_line),
        restricted: c.legality === 'restricted',
      }
      cur.total += c.quantity
      aggregate.set(c.oracle_card_id, cur)
    }
    const limit = rule.singleton ? 1 : rule.copiesLimit
    for (const [_, cur] of Array.from(aggregate.entries())) {
      if (cur.basic) continue
      const effectiveLimit = cur.restricted ? 1 : limit
      if (cur.total > effectiveLimit) {
        issues.push({
          kind: 'too_many_copies',
          severity: 'error',
          message: `${cur.name}: ${cur.total} copies in deck; ${rule.label} allows a maximum of ${effectiveLimit}.`,
          cardName: cur.name,
        })
      }
    }
  }

  // ── Deck sizes ─────────────────────────────────────────────
  if (rule) {
    const mainQty = input.cards.filter((c) => c.zone === 'main').reduce((n, c) => n + c.quantity, 0)
    const sideQty = input.cards.filter((c) => c.zone === 'sideboard').reduce((n, c) => n + c.quantity, 0)
    const cmdQty  = input.cards.filter((c) => c.zone === 'commander').reduce((n, c) => n + c.quantity, 0)

    if (rule.hasCommander) {
      const totalMain = mainQty + cmdQty
      const expected = rule.minDeckSize + (rule.hasCommander ? 1 : 0) // 99 + 1 = 100 for Commander
      // Adjust for partners / backgrounds: allow 98 main + 2 commanders (still totals 100).
      if (cmdQty === 0) {
        issues.push({ kind: 'missing_commander', severity: 'error', message: `${rule.label} requires a commander.` })
      }
      if (cmdQty > 2) {
        issues.push({ kind: 'too_many_commanders', severity: 'error', message: `${rule.label} allows at most 2 cards in the command zone (Partner / Background).` })
      }
      if (totalMain !== expected) {
        const kind: ValidationIssueKind = totalMain < expected ? 'deck_too_small' : 'deck_too_large'
        issues.push({
          kind, severity: 'error',
          message: `${rule.label} decks must total ${expected} cards (${rule.minDeckSize} main + ${rule.hasCommander ? 1 : 0} commander). This deck has ${totalMain}.`,
        })
      }
    } else {
      if (mainQty < rule.minDeckSize) {
        issues.push({ kind: 'deck_too_small', severity: 'error', message: `${rule.label} decks must have at least ${rule.minDeckSize} cards. This deck has ${mainQty}.` })
      }
      if (mainQty > rule.maxDeckSize) {
        issues.push({ kind: 'deck_too_large', severity: 'error', message: `${rule.label} decks cannot exceed ${rule.maxDeckSize} cards. This deck has ${mainQty}.` })
      }
    }
    if (sideQty > rule.sideboardMaxSize) {
      issues.push({ kind: 'sideboard_too_large', severity: 'error', message: `Sideboard has ${sideQty} cards; ${rule.label} allows up to ${rule.sideboardMaxSize}.` })
    }
  }

  // ── Commander-specific ─────────────────────────────────────
  if (rule?.hasCommander) {
    const commanders = input.cards.filter((c) => c.zone === 'commander')
    for (const c of commanders) {
      if (!canBeCommander(c)) {
        issues.push({
          kind: 'commander_not_legendary',
          severity: 'error',
          message: `${c.name} is not a legendary creature and has no "can be your commander" ability.`,
          cardName: c.name, oracle_card_id: c.oracle_card_id,
        })
      }
    }
    if (commanders.length === 2) {
      const pe = partnerEligibility(commanders)
      const simple = pe.simplePartner === 2
      const named  = pe.namedPartner === 2
      const bg     = pe.background === 1 && pe.isBackground === 1
      const ff     = pe.friendsForever === 2
      const doc    = pe.doctorsCompanion === 1  // Doctor + Companion is asymmetric
      if (!simple && !named && !bg && !ff && !doc) {
        warnings.push({
          kind: 'partner_uncertainty',
          severity: 'warning',
          message: 'Two commanders in the command zone but MTGPrices could not confidently confirm a legal partnership. Verify Partner / Partner-with / Background / Friends forever / Doctor\'s companion pairing.',
        })
      }
    }

    // Colour identity of the 99.
    if (rule.enforceColorIdentity) {
      const ci = new Set(unionColorIdentity(commanders))
      for (const c of input.cards) {
        if (c.zone === 'commander' || c.zone === 'maybeboard') continue
        for (const ch of c.color_identity ?? []) {
          if (!ci.has(ch)) {
            issues.push({
              kind: 'color_identity_conflict',
              severity: 'error',
              message: `${c.name} contains colour identity ${(c.color_identity ?? []).join('') || 'C'} which is outside the commander(s) identity ${Array.from(ci).join('') || 'C'}.`,
              cardName: c.name, oracle_card_id: c.oracle_card_id,
            })
            break
          }
        }
      }
    }
  }

  return { ok: issues.length === 0, issues, warnings }
}

/** For UI: aggregate categories used by the stats panel. Purely
 *  descriptive, no strategic judgement. */
export function typeBreakdown(cards: DeckCardForValidation[]): Record<string, number> {
  const out: Record<string, number> = { creature: 0, instant: 0, sorcery: 0, enchantment: 0, artifact: 0, planeswalker: 0, battle: 0, land: 0 }
  for (const c of cards) {
    if (c.zone !== 'main') continue
    const types = parseCardTypes(c.type_line)
    // Only bucket into the FIRST major type match to avoid double-counting.
    const primary = ['creature', 'planeswalker', 'battle', 'enchantment', 'artifact', 'instant', 'sorcery', 'land'].find((t) => types.includes(t))
    if (primary) out[primary] = (out[primary] ?? 0) + c.quantity
  }
  return out
}

/** Mana-value histogram. Buckets 0..7+ over main-deck non-land cards. */
export function manaCurve(cardsWithMV: Array<DeckCardForValidation & { mana_value?: number | null }>): number[] {
  const buckets = [0, 0, 0, 0, 0, 0, 0, 0]
  for (const c of cardsWithMV) {
    if (c.zone !== 'main') continue
    const types = parseCardTypes(c.type_line)
    if (types.includes('land')) continue
    const mv = c.mana_value ?? 0
    const idx = Math.min(7, Math.max(0, Math.round(mv)))
    buckets[idx] += c.quantity
  }
  return buckets
}

/** Aggregate capability counts across the main deck. Descriptive only. */
export function capabilityBreakdown(cards: Array<DeckCardForValidation & { capabilities?: CardCapability[] | null }>): Partial<Record<CardCapability, number>> {
  const out: Partial<Record<CardCapability, number>> = {}
  for (const c of cards) {
    if (c.zone !== 'main') continue
    for (const cap of c.capabilities ?? []) {
      out[cap] = (out[cap] ?? 0) + c.quantity
    }
  }
  return out
}
