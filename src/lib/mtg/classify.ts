// src/lib/mtg/classify.ts
// Deterministic card-capability classifier.
//
// Rules here operate ONLY on factual card data — type line, Oracle text,
// keywords, produced_mana. Never invents strategic labels, and never uses
// an LLM. Anything ambiguous or low-confidence is deliberately omitted.
//
// Output is a stable, small set of capability tags that downstream code
// (card page, search filters, later the deck builder + AI) can rely on.

export type CardCapability =
  | 'creature'
  | 'planeswalker'
  | 'battle'
  | 'enchantment'
  | 'artifact'
  | 'land'
  | 'instant'
  | 'sorcery'
  | 'removal'
  | 'exile'
  | 'counter-spell'
  | 'card-draw'
  | 'token-creation'
  | 'sacrifice'
  | 'graveyard'
  | 'lifegain'
  | 'lifeloss'
  | 'ramp'
  | 'tutor'
  | 'board-wipe'
  | 'protection'
  | 'reanimation'

const CAPABILITY_LABELS: Record<CardCapability, string> = {
  'creature': 'Creature',
  'planeswalker': 'Planeswalker',
  'battle': 'Battle',
  'enchantment': 'Enchantment',
  'artifact': 'Artifact',
  'land': 'Land',
  'instant': 'Instant',
  'sorcery': 'Sorcery',
  'removal': 'Removal',
  'exile': 'Exile effect',
  'counter-spell': 'Counterspell',
  'card-draw': 'Card draw',
  'token-creation': 'Token creation',
  'sacrifice': 'Sacrifice outlet',
  'graveyard': 'Graveyard interaction',
  'lifegain': 'Lifegain',
  'lifeloss': 'Life loss',
  'ramp': 'Ramp',
  'tutor': 'Tutor',
  'board-wipe': 'Board wipe',
  'protection': 'Protection',
  'reanimation': 'Reanimation',
}

export function labelForCapability(cap: CardCapability): string {
  return CAPABILITY_LABELS[cap]
}

export type ClassifyInput = {
  type_line: string | null
  oracle_text: string | null
  keywords: string[] | null
  produced_mana: string[] | null
  card_faces: unknown
}

/** Concatenate root oracle text with per-face oracle text so double-faced /
 *  split / adventure cards are classified using text from all faces. */
function fullOracleText(input: ClassifyInput): string {
  const parts: string[] = []
  if (input.oracle_text) parts.push(input.oracle_text)
  const faces = input.card_faces
  if (Array.isArray(faces)) {
    for (const f of faces as Record<string, unknown>[]) {
      const t = f?.['oracle_text']
      if (typeof t === 'string' && t.length > 0) parts.push(t)
    }
  }
  return parts.join('\n').toLowerCase()
}

/** True if any of the given regexes matches the text. */
function anyMatch(text: string, regexes: RegExp[]): boolean {
  return regexes.some((rx) => rx.test(text))
}

export function classifyCard(input: ClassifyInput): CardCapability[] {
  const caps = new Set<CardCapability>()
  const type = (input.type_line ?? '').toLowerCase()
  const text = fullOracleText(input)
  const keywords = (input.keywords ?? []).map((k) => k.toLowerCase())

  // ── Types ────────────────────────────────────────────────────────
  if (type.includes('creature')) caps.add('creature')
  if (type.includes('planeswalker')) caps.add('planeswalker')
  if (type.includes('battle')) caps.add('battle')
  if (type.includes('enchantment')) caps.add('enchantment')
  if (type.includes('artifact')) caps.add('artifact')
  if (type.includes('land')) caps.add('land')
  if (type.includes('instant')) caps.add('instant')
  if (type.includes('sorcery')) caps.add('sorcery')

  // ── Effects — only fire when the wording is unambiguous ─────────
  // Counterspell — must reference countering a spell/ability.
  if (anyMatch(text, [/\bcounter target (spell|activated ability|triggered ability)\b/])) {
    caps.add('counter-spell')
  }

  // Removal — targeted destroy / damage / -X toughness to a permanent.
  if (
    anyMatch(text, [
      /\bdestroy target (creature|artifact|enchantment|planeswalker|permanent|battle|nonland permanent|land)\b/,
      /\bexile target (creature|artifact|enchantment|planeswalker|permanent|battle|nonland permanent)\b/,
      /\bdeals? \d+ damage to target creature\b/,
      /\bdeals? \d+ damage to any target\b/,
      /\bdeals? damage equal to .+ to target (creature|any target)\b/,
    ])
  ) {
    caps.add('removal')
  }

  // Exile effect (broader — anything that exiles a card or permanent).
  if (anyMatch(text, [/\bexile (target|all|each|any|the top)\b/])) {
    caps.add('exile')
  }

  // Board wipe.
  if (
    anyMatch(text, [
      /\bdestroy all (creatures|nonland permanents|artifacts|enchantments|permanents|lands)\b/,
      /\bexile all (creatures|nonland permanents|artifacts|enchantments|permanents)\b/,
      /\ball creatures get -\d+\/-\d+\b/,
    ])
  ) {
    caps.add('board-wipe')
  }

  // Card draw. Must be pure draw, not just referencing "drawn this turn".
  if (
    anyMatch(text, [
      /\bdraw a card\b/,
      /\bdraw \d+ cards\b/,
      /\bdraw two cards\b/,
      /\bdraw three cards\b/,
      /\bdraws? cards? equal to\b/,
    ])
  ) {
    caps.add('card-draw')
  }

  // Token creation.
  if (
    anyMatch(text, [
      /\bcreate (a|an|two|three|four|five|six|seven|eight|nine|ten|x|that many) [a-z0-9 -]*(token|tokens)\b/,
      /\bputs? .* creature token/,
    ])
  ) {
    caps.add('token-creation')
  }

  // Sacrifice.
  if (
    anyMatch(text, [
      /\bsacrifice a (creature|land|artifact|enchantment|permanent|token)\b/,
      /\bsacrifice another (creature|artifact|enchantment|permanent)\b/,
      /,? sacrifice ~/,
      /,? sacrifice [a-z ]+:/,
    ])
  ) {
    caps.add('sacrifice')
  }

  // Graveyard interaction — draws/exiles/mills from a graveyard.
  if (
    anyMatch(text, [
      /\bfrom (a|your|each|their|target) (player'?s? )?graveyard\b/,
      /\bmill \d+ cards?\b/,
      /\bput .* from .* graveyard onto the battlefield\b/,
    ])
  ) {
    caps.add('graveyard')
    // Reanimation is a strict subset — bringing a creature back from a graveyard.
    if (anyMatch(text, [
      /\breturn target creature card from .* graveyard to the battlefield\b/,
      /\bput target creature card from .* graveyard onto the battlefield\b/,
    ])) {
      caps.add('reanimation')
    }
  }

  // Life gain / loss.
  if (anyMatch(text, [/\bgain \d+ life\b/, /\bgains? life\b/, /\bgain (x|that much) life\b/])) {
    caps.add('lifegain')
  }
  if (anyMatch(text, [/\blose \d+ life\b/, /\bloses \d+ life\b/, /\btarget (player|opponent) loses \d+ life\b/])) {
    caps.add('lifeloss')
  }

  // Tutor.
  if (anyMatch(text, [/\bsearch your library for (a|an|up to|any|the)\b/])) {
    caps.add('tutor')
  }

  // Ramp — mana production or "add {" or produces mana of multiple colours.
  const isLand = type.includes('land')
  const producesMana = Array.isArray(input.produced_mana) && input.produced_mana.length > 0
  const addsMana = /\badd (\{[wubrgcxs0-9/]+\}|one mana of|two mana of)/i.test(text)
  if (!isLand && (producesMana || addsMana)) {
    caps.add('ramp')
  }

  // Protection — keyword or explicit oracle wording.
  if (keywords.some((k) => k === 'hexproof' || k === 'shroud' || k === 'ward' || k === 'protection' || k === 'indestructible')) {
    caps.add('protection')
  } else if (anyMatch(text, [/\bprotection from\b/, /\bhexproof\b/, /\bshroud\b/, /\bindestructible\b/, /\bward /])) {
    caps.add('protection')
  }

  return Array.from(caps)
}

/** For search-facing filters — the subset of capabilities that are
 *  meaningful UI-facing filters (not the type tags, which have their own
 *  dimension). */
export const SEARCHABLE_CAPABILITIES: CardCapability[] = [
  'removal',
  'card-draw',
  'counter-spell',
  'token-creation',
  'ramp',
  'tutor',
  'board-wipe',
  'protection',
  'graveyard',
  'lifegain',
  'sacrifice',
  'exile',
  'reanimation',
]
