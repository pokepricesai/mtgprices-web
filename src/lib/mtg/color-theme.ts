// src/lib/mtg/color-theme.ts
//
// Given the MTG oracle colours of a card (['W','U','B','R','G'] or a
// subset, empty for colourless), produce the design tokens that
// drive the card-colour-aware accent rail and any subtle theming
// applied on that card's public pages.
//
// This is DESIGN accent only. It does NOT replicate official mana
// symbols. It uses our --hue-* tokens defined in globals.css.
// Missing colours simply fall out - never rendered as neutral grey
// on a coloured card.

export type MtgColour = 'W' | 'U' | 'B' | 'R' | 'G'

const ALL: MtgColour[] = ['W', 'U', 'B', 'R', 'G']

const HUE_VAR: Record<MtgColour, string> = {
  W: 'var(--hue-w)',
  U: 'var(--hue-u)',
  B: 'var(--hue-b)',
  R: 'var(--hue-r)',
  G: 'var(--hue-g)',
}

const HUE_HEX: Record<MtgColour, string> = {
  W: '#E9DDA6',
  U: '#3E7BC9',
  B: '#4A3A55',
  R: '#E85A2C',
  G: '#4E8F5A',
}

/** Normalise a raw oracle_colors payload into a canonical WUBRG-ordered
 *  array. Handles null/undefined + case-insensitive strings. */
export function normaliseColours(input: unknown): MtgColour[] {
  if (!Array.isArray(input)) return []
  const set = new Set<MtgColour>()
  for (const raw of input) {
    if (typeof raw !== 'string') continue
    const c = raw.trim().toUpperCase()
    if (c === 'W' || c === 'U' || c === 'B' || c === 'R' || c === 'G') set.add(c)
  }
  return ALL.filter((c) => set.has(c))
}

export type CardTheme = {
  /** WUBRG-ordered colours present. */
  colours: MtgColour[]
  /** True when the card has no oracle colours - artifact/land/colourless. */
  colourless: boolean
  /** Five-segment rail description. Every segment is coloured (present
   *  colours use their hue, absent colours use a muted stone/silver so
   *  the rail retains visual anchoring). */
  rail: Array<{ colour: MtgColour; present: boolean; hex: string; token: string }>
  /** Primary accent hex used for hover shadows / border tint. Muted
   *  metal for colourless, saturated single hue for mono, blended for
   *  multi. */
  primaryHex: string
  /** Ambient glow gradient string (radial-gradient) suitable for use
   *  as a background layer BEHIND the card image or hero. Very low
   *  opacity. */
  ambient: string
  /** Short display label describing the identity - "Mono blue", "Golgari
   *  (BG)", "Five-colour", "Colourless". Used in a11y labels + tooltips. */
  label: string
}

const GUILD_NAMES: Record<string, string> = {
  WU: 'Azorius',
  UB: 'Dimir',
  BR: 'Rakdos',
  RG: 'Gruul',
  GW: 'Selesnya',
  WB: 'Orzhov',
  UR: 'Izzet',
  BG: 'Golgari',
  RW: 'Boros',
  UG: 'Simic',
  WUB: 'Esper',
  UBR: 'Grixis',
  BRG: 'Jund',
  RGW: 'Naya',
  GWU: 'Bant',
  WBG: 'Abzan',
  URW: 'Jeskai',
  BGU: 'Sultai',
  RWB: 'Mardu',
  GUR: 'Temur',
  WUBR: 'Yore-Tiller',
  UBRG: 'Glint-Eye',
  BRGW: 'Dune-Brood',
  RGWU: 'Ink-Treader',
  GWUB: 'Witch-Maw',
  WUBRG: 'Five-colour',
}
const COLOUR_NAMES: Record<MtgColour, string> = { W: 'white', U: 'blue', B: 'black', R: 'red', G: 'green' }

function guildKey(cs: MtgColour[]): string {
  return cs.join('')
}

/** Build a full CardTheme from a raw oracle_colors payload. */
export function buildCardTheme(oracleColours: unknown): CardTheme {
  const cs = normaliseColours(oracleColours)
  const colourless = cs.length === 0

  const rail: CardTheme['rail'] = ALL.map((c) => ({
    colour: c,
    present: cs.includes(c),
    hex: cs.includes(c) ? HUE_HEX[c] : '#C8BEA6',
    token: cs.includes(c) ? HUE_VAR[c] : 'var(--mana-c)',
  }))

  const primaryHex = colourless
    ? '#B9A87C'
    : cs.length === 1
      ? HUE_HEX[cs[0]]
      : blendHex(cs.map((c) => HUE_HEX[c]))

  const ambient = buildAmbientGradient(cs, colourless)

  const label = colourless
    ? 'Colourless'
    : cs.length === 1
      ? `Mono ${COLOUR_NAMES[cs[0]]}`
      : cs.length === 5
        ? 'Five-colour'
        : (GUILD_NAMES[guildKey(cs)] ?? `${cs.length}-colour`) + ` (${cs.join('/')})`

  return { colours: cs, colourless, rail, primaryHex, ambient, label }
}

/** Blend a set of hex colours into a single average hex string. */
function blendHex(hexes: string[]): string {
  if (hexes.length === 0) return '#B9A87C'
  let r = 0, g = 0, b = 0
  for (const h of hexes) {
    const [rr, gg, bb] = hexToRgb(h)
    r += rr; g += gg; b += bb
  }
  r = Math.round(r / hexes.length)
  g = Math.round(g / hexes.length)
  b = Math.round(b / hexes.length)
  return `#${r.toString(16).padStart(2, '0')}${g.toString(16).padStart(2, '0')}${b.toString(16).padStart(2, '0')}`
}

function hexToRgb(hex: string): [number, number, number] {
  const h = hex.replace(/^#/, '')
  const n = parseInt(h.length === 3 ? h.split('').map((c) => c + c).join('') : h, 16)
  return [(n >> 16) & 0xff, (n >> 8) & 0xff, n & 0xff]
}

function buildAmbientGradient(cs: MtgColour[], colourless: boolean): string {
  //  A restrained radial glow. Very low opacity so it never competes with
  //  card artwork or price data. Multi-colour cards fan the hues around
  //  a central point.
  if (colourless) {
    return 'radial-gradient(60% 60% at 50% 30%, rgba(185,168,124,0.10), transparent 70%)'
  }
  if (cs.length === 1) {
    const [r, g, b] = hexToRgb(HUE_HEX[cs[0]])
    return `radial-gradient(60% 60% at 50% 30%, rgba(${r},${g},${b},0.12), transparent 70%)`
  }
  //  Multicolour - stack low-opacity radial spots.
  const stops = cs.map((c, i) => {
    const [r, g, b] = hexToRgb(HUE_HEX[c])
    const angle = (i / cs.length) * 360
    return `radial-gradient(30% 30% at ${50 + 35 * Math.cos((angle * Math.PI) / 180)}% ${50 + 35 * Math.sin((angle * Math.PI) / 180)}%, rgba(${r},${g},${b},0.09), transparent 60%)`
  })
  return stops.join(',')
}

export const __testables = { blendHex, hexToRgb, guildKey, normaliseColours }
