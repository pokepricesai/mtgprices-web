// src/lib/mtg/capabilities.ts
//
// SINGLE SOURCE OF TRUTH for the MTG capability taxonomy + classifier.
//
// Used by:
//   - The Next.js app (card page annotation, Card Finder search, Card
//     Finder "why matched" explanations).
//   - The backfill script (scripts/phase2b-backfill-capabilities.ts).
//   - The incremental classifier (scripts/phase2b-classify-changed.ts).
//
// No framework imports — this file must be safe to run in Node scripts
// and in Next.js server components. It never imports `server-only`,
// database clients, or React.
//
// Conservative principle: miss a capability rather than falsely label
// one. Every regex here is written to fire on unambiguous Oracle-text
// idioms. Cards with unusual wording will simply not receive that tag —
// that is intended.

// ── Taxonomy ────────────────────────────────────────────────────────

export const CAPABILITY_TAGS = [
  // Types (from type_line)
  'creature', 'planeswalker', 'battle', 'enchantment',
  'artifact', 'land', 'instant', 'sorcery', 'legendary-creature',

  // Targeted removal
  'creature-removal', 'artifact-removal', 'enchantment-removal',
  'planeswalker-removal', 'land-destruction',

  // Sweep
  'board-wipe',

  // Card advantage
  'card-draw', 'discard', 'mill', 'exile-effect',

  // Board / tempo
  'counter-spell', 'token-creation', 'copy', 'cost-reduction',

  // Mana
  'ramp', 'mana-production',

  // Value / recycling
  'tutor', 'graveyard-interaction', 'reanimation', 'recursion', 'sacrifice',

  // Life / damage
  'lifegain', 'lifeloss', 'damage',

  // Protection
  'protection',
] as const

export type CardCapability = typeof CAPABILITY_TAGS[number]

/** Which tags describe fundamental card type (used to render them
 *  differently from effect tags in the UI). */
export const TYPE_CAPABILITIES = new Set<CardCapability>([
  'creature', 'planeswalker', 'battle', 'enchantment',
  'artifact', 'land', 'instant', 'sorcery', 'legendary-creature',
])

/** Display labels for every tag. */
export const CAPABILITY_LABELS: Record<CardCapability, string> = {
  creature: 'Creature',
  planeswalker: 'Planeswalker',
  battle: 'Battle',
  enchantment: 'Enchantment',
  artifact: 'Artifact',
  land: 'Land',
  instant: 'Instant',
  sorcery: 'Sorcery',
  'legendary-creature': 'Legendary creature',

  'creature-removal': 'Creature removal',
  'artifact-removal': 'Artifact removal',
  'enchantment-removal': 'Enchantment removal',
  'planeswalker-removal': 'Planeswalker removal',
  'land-destruction': 'Land destruction',
  'board-wipe': 'Board wipe',

  'card-draw': 'Card draw',
  'discard': 'Discard',
  'mill': 'Mill',
  'exile-effect': 'Exile effect',

  'counter-spell': 'Counterspell',
  'token-creation': 'Token creation',
  'copy': 'Copy effect',
  'cost-reduction': 'Cost reduction',

  'ramp': 'Ramp',
  'mana-production': 'Mana production',

  'tutor': 'Tutor',
  'graveyard-interaction': 'Graveyard interaction',
  'reanimation': 'Reanimation',
  'recursion': 'Recursion',
  'sacrifice': 'Sacrifice outlet',

  'lifegain': 'Life gain',
  'lifeloss': 'Life loss',
  'damage': 'Direct damage',

  'protection': 'Protection',
}

export function labelForCapability(cap: CardCapability): string {
  return CAPABILITY_LABELS[cap]
}

/** Card-Finder-facing set — the tags a user would meaningfully filter
 *  on. Type tags are handled by the type filter dimension and omitted
 *  here to avoid duplication in the UI. */
export const SEARCHABLE_CAPABILITIES: CardCapability[] = CAPABILITY_TAGS
  .filter((c) => !TYPE_CAPABILITIES.has(c))

// ── Classifier ─────────────────────────────────────────────────────

export type ClassifyInput = {
  type_line: string | null
  oracle_text: string | null
  keywords: string[] | null
  produced_mana: string[] | null
  card_faces: unknown
}

/** Aggregate root oracle_text with every card_faces[].oracle_text so
 *  multi-face layouts (transform / MDFC / split / adventure / meld /
 *  flip / aftermath) are classified from both faces' rules. */
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

/** Aggregate root type_line with per-face type_lines. Some multi-face
 *  cards (e.g. modal DFCs where the back is a Land) rely on the face's
 *  type_line, not the root's. */
function fullTypeLine(input: ClassifyInput): string {
  const parts: string[] = []
  if (input.type_line) parts.push(input.type_line)
  const faces = input.card_faces
  if (Array.isArray(faces)) {
    for (const f of faces as Record<string, unknown>[]) {
      const t = f?.['type_line']
      if (typeof t === 'string' && t.length > 0) parts.push(t)
    }
  }
  return parts.join(' // ').toLowerCase()
}

/** Oracle text uses word-numbers ("mill three cards") interchangeably
 *  with digits ("mill 3 cards"). This alternation covers both. */
const NUM = '(?:\\d+|a|an|one|two|three|four|five|six|seven|eight|nine|ten|x|that many)'

export function classify(input: ClassifyInput): CardCapability[] {
  const caps = new Set<CardCapability>()
  const type = fullTypeLine(input)
  const text = fullOracleText(input)
  const keywords = (input.keywords ?? []).map((k) => String(k).toLowerCase())
  const producesMana = Array.isArray(input.produced_mana) && input.produced_mana.length > 0
  const has = (rx: RegExp) => rx.test(text)

  // ── Types (from type_line) ────────────────────────────────
  if (type.includes('creature'))     caps.add('creature')
  if (type.includes('planeswalker')) caps.add('planeswalker')
  if (type.includes('battle'))       caps.add('battle')
  if (type.includes('enchantment'))  caps.add('enchantment')
  if (type.includes('artifact'))     caps.add('artifact')
  if (type.includes('land'))         caps.add('land')
  if (type.includes('instant'))      caps.add('instant')
  if (type.includes('sorcery'))      caps.add('sorcery')
  if (type.includes('legendary') && type.includes('creature')) caps.add('legendary-creature')

  // ── Counterspells ─────────────────────────────────────────
  if (has(/\bcounter target (spell|activated ability|triggered ability)\b/)) {
    caps.add('counter-spell')
  }

  // ── Targeted removal — by target type ────────────────────
  if (
    has(/\bdestroy target creature\b/) ||
    has(/\bexile target (creature|attacking creature|blocking creature|creature card)\b/) ||
    has(new RegExp(`\\bdeals? ${NUM} damage to target creature\\b`)) ||
    has(/\bdeals? damage equal to .+ to target (creature|any target)\b/) ||
    has(/\btarget creature gets -[0-9x]+\/-[0-9x]+\b/)
  ) {
    caps.add('creature-removal')
  }
  if (has(/\b(destroy|exile) target artifact\b/)) caps.add('artifact-removal')
  if (has(/\b(destroy|exile) target enchantment\b/)) caps.add('enchantment-removal')
  if (has(/\b(destroy|exile) target (artifact or enchantment|artifact, enchantment|enchantment or artifact)\b/)) {
    caps.add('artifact-removal'); caps.add('enchantment-removal')
  }
  if (has(/\b(destroy|exile) target planeswalker\b/)) caps.add('planeswalker-removal')
  if (has(/\b(destroy|exile) target (nonland |non-land )?permanent\b/)) {
    caps.add('creature-removal'); caps.add('artifact-removal')
    caps.add('enchantment-removal'); caps.add('planeswalker-removal')
  }
  if (has(/\b(destroy|exile) target land\b/)) caps.add('land-destruction')

  // ── Board wipes ──────────────────────────────────────────
  if (has(/\b(destroy|exile) all creatures\b/)) {
    caps.add('board-wipe'); caps.add('creature-removal')
  }
  if (has(/\b(destroy|exile) all nonland permanents\b/)) {
    caps.add('board-wipe')
    caps.add('creature-removal'); caps.add('artifact-removal'); caps.add('enchantment-removal')
  }
  if (has(/\ball creatures get -[0-9x]+\/-[0-9x]+\b/)) caps.add('board-wipe')

  // ── Card advantage ───────────────────────────────────────
  if (
    has(new RegExp(`\\bdraw ${NUM} cards?\\b`)) ||
    has(/\bdraws? cards? equal to\b/)
  ) {
    caps.add('card-draw')
  }
  if (
    has(/\btarget (player|opponent) discards\b/) ||
    has(/\beach opponent discards\b/) ||
    has(new RegExp(`\\bdiscards? ${NUM} cards?\\b`))
  ) {
    caps.add('discard')
  }
  if (
    has(new RegExp(`\\bmill ${NUM} cards?\\b`)) ||
    has(new RegExp(`\\bputs? the top ${NUM} cards? .+ graveyard\\b`))
  ) {
    caps.add('mill')
  }
  if (
    has(new RegExp(`\\bexile the top ${NUM} cards? of\\b`)) ||
    has(/\bexile (the top card|target card) of\b/)
  ) {
    caps.add('exile-effect')
  }

  // ── Tokens ───────────────────────────────────────────────
  if (has(/\bcreate (a|an|two|three|four|five|six|seven|eight|nine|ten|x|that many) [a-z0-9 -]*token\b/)) {
    caps.add('token-creation')
  }

  // ── Ramp / mana production ───────────────────────────────
  const isLand = type.includes('land')
  if (!isLand && (producesMana || has(/\badd (\{[wubrgcxs0-9/]+\}|one mana|two mana|three mana|any color)/))) {
    caps.add('ramp')
  }
  if (producesMana) caps.add('mana-production')

  // ── Tutor ────────────────────────────────────────────────
  if (has(/\bsearch your library for (a|an|up to|any|the)\b/)) caps.add('tutor')

  // ── Graveyard / recursion / reanimation ──────────────────
  if (has(/\bfrom (a|your|each|their|target) (player'?s? )?graveyard\b/)) {
    caps.add('graveyard-interaction')
  }
  if (
    has(/\breturn target creature card from .+ graveyard to (the battlefield|your hand)\b/) ||
    has(/\bput target creature card from .+ graveyard onto the battlefield\b/)
  ) {
    caps.add('reanimation'); caps.add('graveyard-interaction')
  }
  if (has(/\breturn target (card|nonland permanent card|instant or sorcery card) from your graveyard to your hand\b/)) {
    caps.add('recursion'); caps.add('graveyard-interaction')
  }

  // ── Sacrifice ────────────────────────────────────────────
  if (
    has(/,\s?sacrifice (a|another) (creature|artifact|enchantment|permanent|token|land)\b/) ||
    has(/,\s?sacrifice [a-z ]+:/)
  ) {
    caps.add('sacrifice')
  }

  // ── Life ─────────────────────────────────────────────────
  if (has(new RegExp(`\\bgain ${NUM} life\\b`))) caps.add('lifegain')
  if (
    has(new RegExp(`\\btarget (player|opponent) loses ${NUM} life\\b`)) ||
    has(new RegExp(`\\beach opponent loses ${NUM} life\\b`))
  ) {
    caps.add('lifeloss')
  }

  // ── Damage (non-removal) ─────────────────────────────────
  if (has(new RegExp(`\\bdeals? ${NUM} damage to (target (player|opponent|any target)|each opponent)`))) {
    caps.add('damage')
  }

  // ── Cost reduction ───────────────────────────────────────
  if (has(/\bcosts? \{[0-9]+\} less to cast\b/)) caps.add('cost-reduction')

  // ── Copy ─────────────────────────────────────────────────
  if (
    has(/\bcreate a (token that'?s a )?copy of\b/) ||
    has(/\bcopy target (spell|activated ability|triggered ability)\b/)
  ) {
    caps.add('copy')
  }

  // ── Protection ───────────────────────────────────────────
  if (['hexproof', 'shroud', 'ward', 'protection', 'indestructible'].some((k) => keywords.includes(k))) {
    caps.add('protection')
  } else if (has(/\bprotection from\b/)) {
    caps.add('protection')
  }

  return Array.from(caps).sort() as CardCapability[]
}
