// src/lib/mtg/mana.ts
// Renders Magic mana-cost strings (e.g. "{2}{W}{U}") into styled tokens.

export type ManaToken = {
  raw: string          // "{W}", "{2/U}", "{X}", "{T}" …
  label: string        // display label (W, 2/U, X, T)
  colors: string[]     // W|U|B|R|G|C (all colours the token counts as)
  isHybrid: boolean
  isGeneric: boolean
  isX: boolean
  isTap: boolean
  isSnow: boolean
  isPhyrexian: boolean
}

const COLOR_LETTERS = new Set(['W', 'U', 'B', 'R', 'G', 'C'])

/** Tokenize a Scryfall-format mana cost. Never throws; unknown tokens
 *  are emitted with their raw label so nothing renders as a gap. */
export function parseManaCost(cost: string | null | undefined): ManaToken[] {
  if (!cost) return []
  const out: ManaToken[] = []
  const rx = /\{([^{}]+)\}/g
  let m: RegExpExecArray | null
  while ((m = rx.exec(cost)) !== null) {
    const inside = m[1]
    const upper = inside.toUpperCase()
    const isHybrid = inside.includes('/')
    const isGeneric = /^\d+$/.test(inside)
    const isX = upper === 'X' || upper === 'Y' || upper === 'Z'
    const isTap = upper === 'T'
    const isSnow = upper === 'S'
    const isPhyrexian = inside.includes('P') || inside.includes('p')

    const colors: string[] = []
    if (isHybrid) {
      for (const part of upper.split('/')) {
        if (COLOR_LETTERS.has(part)) colors.push(part)
      }
    } else if (COLOR_LETTERS.has(upper)) {
      colors.push(upper)
    }

    out.push({
      raw: m[0],
      label: inside,
      colors,
      isHybrid,
      isGeneric,
      isX,
      isTap,
      isSnow,
      isPhyrexian,
    })
  }
  return out
}

/** CSS background/foreground for a single mana pip. */
export function manaColors(token: ManaToken): { bg: string; fg: string; ring?: string } {
  if (token.isTap)       return { bg: '#2A303B', fg: '#F3F0E8' }
  if (token.isSnow)      return { bg: '#e6ecf5', fg: '#25313f' }
  if (token.isGeneric)   return { bg: '#c8c1b0', fg: '#25313f' }
  if (token.isX)         return { bg: '#c8c1b0', fg: '#25313f' }
  if (token.colors.length === 0) return { bg: '#c8c1b0', fg: '#25313f' }
  if (token.colors.length === 1) {
    const c = token.colors[0]
    if (c === 'W') return { bg: '#f9f6df', fg: '#25313f' }
    if (c === 'U') return { bg: '#8ecff6', fg: '#0b2a49' }
    if (c === 'B') return { bg: '#4a4a4a', fg: '#f3f0e8' }
    if (c === 'R') return { bg: '#f0a48f', fg: '#4a1010' }
    if (c === 'G') return { bg: '#9ee0a5', fg: '#0f3418' }
    if (c === 'C') return { bg: '#c8c1b0', fg: '#25313f' }
  }
  // Hybrid — halved background, use ring to hint at hybrid.
  const [a, b] = token.colors
  return { bg: manaColors({ ...token, colors: [a] }).bg, fg: '#25313f', ring: manaColors({ ...token, colors: [b] }).bg }
}
