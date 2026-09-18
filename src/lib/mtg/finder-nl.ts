// src/lib/mtg/finder-nl.ts
//
// Deterministic natural-language → FinderQuery parser.
//
// Never invents cards or recommendations. Every extracted filter maps
// to a real DB constraint that findCards() can enforce.
//
// Currency:
//   "$5" / "5 USD" / "5 dollars"  → USD hard cap
//   "€10" / "10 EUR" / "10 euros" → EUR hard cap
//   "£X"                          → recognised but NOT converted; user
//                                    is told GBP isn't priced yet.
//   "cheap" / "budget"            → sort by cheapest, no hard cap
//
// Nothing here is LLM-driven. This is a small hand-written parser and
// Phase 3 (AI) will plug into the same output shape without changing
// what findCards() enforces.

import type { FinderQuery, FinderCurrency } from './finder'
import type { CardCapability } from './capabilities'
import { CAPABILITY_TAGS, CAPABILITY_LABELS } from './capabilities'
import { FORMATS, FORMAT_BY_KEY, type FormatKey, type FormatDef } from './formats'

const COLOR_WORDS: Record<string, string> = {
  white: 'W', blue: 'U', black: 'B', red: 'R', green: 'G',
  colourless: 'C', colorless: 'C',
  mono: '', // marker; upgraded downstream
  azorius: 'WU', dimir: 'UB', rakdos: 'BR', gruul: 'RG', selesnya: 'GW',
  orzhov: 'WB', izzet: 'UR', golgari: 'BG', boros: 'RW', simic: 'GU',
  bant: 'GWU', esper: 'WUB', grixis: 'UBR', jund: 'BRG', naya: 'RGW',
  abzan: 'WBG', jeskai: 'URW', sultai: 'BGU', mardu: 'RWB', temur: 'GUR',
  domain: 'WUBRG', 'five-color': 'WUBRG', 'five-colour': 'WUBRG',
}

const RARITY_WORDS: Record<string, 'common' | 'uncommon' | 'rare' | 'mythic'> = {
  common: 'common', uncommon: 'uncommon', rare: 'rare', mythic: 'mythic',
  mythics: 'mythic', rares: 'rare',
}

const TYPE_WORDS = ['creature', 'instant', 'sorcery', 'enchantment', 'artifact', 'planeswalker', 'battle', 'land']

/** Small ordered map from natural-language phrases → capability tags.
 *  Longest phrases first so "creature removal" wins over "removal". */
const CAP_PHRASES: [string, CardCapability][] = [
  ['creature removal',        'creature-removal'],
  ['creature kill',           'creature-removal'],
  ['artifact removal',        'artifact-removal'],
  ['artifact hate',           'artifact-removal'],
  ['deals with artifacts',    'artifact-removal'],
  ['destroy artifacts',       'artifact-removal'],
  ['enchantment removal',     'enchantment-removal'],
  ['enchantment hate',        'enchantment-removal'],
  ['destroy enchantments',    'enchantment-removal'],
  ['planeswalker removal',    'planeswalker-removal'],
  ['land destruction',        'land-destruction'],
  ['board wipe',              'board-wipe'],
  ['sweeper',                 'board-wipe'],
  ['wrath',                   'board-wipe'],
  ['card draw',               'card-draw'],
  ['draw cards',              'card-draw'],
  ['drawing',                 'card-draw'],
  ['counterspell',            'counter-spell'],
  ['counter magic',           'counter-spell'],
  ['counter spell',           'counter-spell'],
  ['make tokens',             'token-creation'],
  ['create tokens',           'token-creation'],
  ['make creature tokens',    'token-creation'],
  ['token creation',          'token-creation'],
  ['tokens',                  'token-creation'],
  ['ramp',                    'ramp'],
  ['mana ramp',               'ramp'],
  ['mana rocks',              'ramp'],
  ['mana production',         'mana-production'],
  ['tutor',                   'tutor'],
  ['tutors',                  'tutor'],
  ['graveyard hate',          'exile-effect'],   // hits exile-from-graveyard idioms
  ['graveyard interaction',   'graveyard-interaction'],
  ['reanimator',              'reanimation'],
  ['reanimation',             'reanimation'],
  ['recursion',               'recursion'],
  ['sacrifice outlet',        'sacrifice'],
  ['sac outlet',              'sacrifice'],
  ['lifegain',                'lifegain'],
  ['life gain',               'lifegain'],
  ['lifeloss',                'lifeloss'],
  ['life loss',               'lifeloss'],
  ['damage',                  'damage'],
  ['discard',                 'discard'],
  ['mill',                    'mill'],
  ['exile effect',            'exile-effect'],
  ['copy effect',             'copy'],
  ['clone',                   'copy'],
  ['cost reduction',          'cost-reduction'],
  ['protection',              'protection'],
  ['indestructible',          'protection'],
  ['hexproof',                'protection'],
  ['removal',                 'creature-removal'], // fall-through, spec called for creature removal being the default
]

const BUDGET_WORDS = ['cheap', 'budget', 'affordable', 'inexpensive', 'low cost', 'low-cost']

/** Extracted parse output plus any warnings we want to render. */
export type ParseResult = {
  query: FinderQuery
  suggestions: string[]   // human-readable descriptions of what got extracted
  warnings: string[]      // unsupported bits (e.g. GBP)
}

/** Parse a plain-English request into a structured FinderQuery. */
export function parseFinderText(input: string): ParseResult {
  const text = ` ${input.toLowerCase().replace(/\s+/g, ' ').trim()} `
  const query: FinderQuery = {}
  const suggestions: string[] = []
  const warnings: string[] = []

  // ── Formats ──────────────────────────────────────────────
  const formatHit = findFormat(text)
  if (formatHit) {
    query.legalIn = formatHit.key as FormatKey
    suggestions.push(`Format: ${formatHit.label}`)
  }

  // ── Colours ──────────────────────────────────────────────
  const colors = new Set<string>()
  for (const [word, letters] of Object.entries(COLOR_WORDS)) {
    if (!letters) continue
    // whole-word match to avoid catching "blueprint" etc.
    const rx = new RegExp(`\\b${word.replace(/[-]/g, '[- ]')}\\b`, 'i')
    if (rx.test(text)) for (const l of letters.split('')) colors.add(l)
  }
  if (colors.size > 0) {
    query.colors = Array.from(colors)
    if ((query.colors ?? []).length === 1 && (/\bmono[-\s]?/.test(text) || /\bonly (white|blue|black|red|green)\b/.test(text))) {
      // Treat "mono-blue X" as a colour-identity constraint too.
      query.colorIdentity = query.colors
    }
    suggestions.push(`Colour${query.colors.length > 1 ? 's' : ''}: ${query.colors.join('/')}`)
  }
  if (/\bcolou?rless\b/.test(text)) {
    query.colorless = true
    suggestions.push('Colourless')
  }

  // ── Commander identity, "commander with X" ──────────────
  const cmdColourMatch = text.match(/\bcommander (?:in|for) (mono[- ]?)?(white|blue|black|red|green|azorius|dimir|rakdos|gruul|selesnya|orzhov|izzet|golgari|boros|simic|bant|esper|grixis|jund|naya)\b/)
  if (cmdColourMatch) {
    const clr = COLOR_WORDS[cmdColourMatch[2]]
    if (clr) {
      query.colorIdentity = clr.split('')
      suggestions.push(`Commander colour identity: ${clr}`)
    }
  }

  // ── Types ────────────────────────────────────────────────
  const types: string[] = []
  for (const t of TYPE_WORDS) if (new RegExp(`\\b${t}s?\\b`, 'i').test(text)) types.push(t[0].toUpperCase() + t.slice(1))
  if (types.length > 0) {
    query.types = types
    suggestions.push(`Type: ${types.join(', ')}`)
  }

  // ── Rarity ───────────────────────────────────────────────
  for (const [w, r] of Object.entries(RARITY_WORDS)) {
    if (new RegExp(`\\b${w}\\b`, 'i').test(text)) {
      query.rarity = r
      suggestions.push(`Rarity: ${r}`)
      break
    }
  }

  // ── Reserved list / game changer ─────────────────────────
  if (/\breserved list\b/.test(text)) { query.reservedList = true; suggestions.push('Reserved List') }
  if (/\bgame changer\b/.test(text))  { query.gameChanger = true;  suggestions.push('Game Changer') }
  if (/\betched\b/.test(text))        { query.finish = 'etched';    suggestions.push('Etched finish') }
  else if (/\bfoil\b/.test(text) && !/\bnon[- ]?foil\b/.test(text)) { query.finish = 'foil'; suggestions.push('Foil finish') }
  else if (/\bnon[- ]?foil\b/.test(text)) { query.finish = 'nonfoil'; suggestions.push('Non-foil finish') }

  // ── Mana value ───────────────────────────────────────────
  const mvUnder = text.match(/\b(mv|mana value|cmc|cost)\s*(?:under|below|less than|<=|≤|<)\s*(\d+)\b/) ||
                  text.match(/\bunder (\d+) mana\b/) ||
                  text.match(/\bcosts? less than (\d+)\b/)
  if (mvUnder) {
    query.manaValueMax = Math.max(0, parseInt(mvUnder[mvUnder.length - 1], 10))
    suggestions.push(`MV ≤ ${query.manaValueMax}`)
  }
  const mvAt = text.match(/\b(\d+)\s*mana (spell|card|creature|removal|counter|draw)\b/)
  if (mvAt && !mvUnder) {
    query.manaValueMax = parseInt(mvAt[1], 10)
    suggestions.push(`MV ≤ ${query.manaValueMax}`)
  }

  // ── Year range ("from 1994", "before 2005", "1990s") ─────
  const decade = text.match(/\b(19|20)(\d)0s\b/)
  if (decade) {
    const start = `${decade[1]}${decade[2]}0-01-01`
    const end = `${decade[1]}${decade[2]}9-12-31`
    query.releasedFrom = start; query.releasedTo = end
    suggestions.push(`Released ${decade[1]}${decade[2]}0s`)
  }
  const yrRange = text.match(/\bfrom (\d{4})[– -]+(?:to )?(\d{4})\b/)
  if (yrRange) {
    query.releasedFrom = `${yrRange[1]}-01-01`
    query.releasedTo = `${yrRange[2]}-12-31`
    suggestions.push(`Released ${yrRange[1]}–${yrRange[2]}`)
  } else {
    const yrBefore = text.match(/\bbefore (\d{4})\b/)
    const yrAfter = text.match(/\bafter (\d{4})\b/)
    if (yrBefore) { query.releasedTo = `${parseInt(yrBefore[1], 10) - 1}-12-31`; suggestions.push(`Released before ${yrBefore[1]}`) }
    if (yrAfter)  { query.releasedFrom = `${parseInt(yrAfter[1], 10) + 1}-01-01`; suggestions.push(`Released after ${yrAfter[1]}`) }
  }

  // ── Price ────────────────────────────────────────────────
  // Explicit currency + hard cap.
  const priceUnder =
    text.match(/\bunder\s*\$\s*(\d+(?:\.\d+)?)/) ||
    text.match(/\bunder\s*(\d+(?:\.\d+)?)\s*(?:usd|dollars?)\b/) ||
    text.match(/\bless than\s*\$\s*(\d+(?:\.\d+)?)/)
  if (priceUnder) {
    query.currency = 'USD'
    query.priceMax = parseFloat(priceUnder[1])
    suggestions.push(`Price ≤ $${query.priceMax.toFixed(2)}`)
  }
  const priceEur =
    text.match(/\bunder\s*€\s*(\d+(?:\.\d+)?)/) ||
    text.match(/\bunder\s*(\d+(?:\.\d+)?)\s*(?:eur|euros?)\b/)
  if (priceEur) {
    query.currency = 'EUR'
    query.priceMax = parseFloat(priceEur[1])
    suggestions.push(`Price ≤ €${query.priceMax.toFixed(2)}`)
  }
  // GBP, not silently converted.
  if (/[£]\s*\d/.test(text) || /\bgbp\b/.test(text) || /\bpound(s)?\b/.test(text)) {
    warnings.push('GBP prices are not yet available. MTGPrices currently indexes USD (TCGplayer, Card Kingdom, ManaPool) and EUR (Cardmarket). Try "$5" or "€5" instead.')
  }
  // Budget preference (no hard cap).
  if (BUDGET_WORDS.some((w) => new RegExp(`\\b${w}\\b`).test(text)) && !query.priceMax) {
    query.budgetPreference = true
    suggestions.push('Prefer cheaper prices')
  }

  // ── Capabilities (multi-tag AND) ─────────────────────────
  const caps = new Set<CardCapability>()
  for (const [phrase, cap] of CAP_PHRASES) {
    const rx = new RegExp(`\\b${phrase.replace(/[-]/g, '[- ]?')}\\b`, 'i')
    if (rx.test(text)) caps.add(cap)
  }
  // Guard: if the user typed "removal" but a specific target type was
  // mentioned, drop the generic creature-removal.
  const hasSpecificRemoval = caps.has('artifact-removal') || caps.has('enchantment-removal') || caps.has('planeswalker-removal') || caps.has('land-destruction')
  if (hasSpecificRemoval && !/\bcreature\b/.test(text)) caps.delete('creature-removal')

  if (caps.size > 0) {
    query.caps = Array.from(caps).sort()
    suggestions.push(...Array.from(caps).map((c) => CAPABILITY_LABELS[c]))
  }

  // ── Free-text card-name fallback: none. Card Finder is
  //    intentionally NOT a name search, /cards/search does that.

  return { query, suggestions, warnings }
}

function findFormat(text: string): FormatDef | null {
  // Try exact key matches first, then alias words.
  for (const f of FORMATS) {
    const rx = new RegExp(`\\b${f.label.toLowerCase().replace(/\s+/g, '\\s+')}\\b`, 'i')
    if (rx.test(text)) return f
    if (new RegExp(`\\b${f.key.toLowerCase()}\\b`, 'i').test(text)) return f
  }
  // Aliases.
  const aliases: Record<string, FormatKey> = {
    edh: 'commander',
    cedh: 'commander',
    'standard brawl': 'standardbrawl',
  }
  for (const [alias, key] of Object.entries(aliases)) {
    if (new RegExp(`\\b${alias}\\b`, 'i').test(text) && FORMAT_BY_KEY[key]) return FORMAT_BY_KEY[key]
  }
  return null
}

// Re-export for UI: which capabilities can appear as filter chips.
export const NL_CAPABILITY_LABELS = CAPABILITY_TAGS.map((c) => ({ key: c, label: CAPABILITY_LABELS[c] }))
