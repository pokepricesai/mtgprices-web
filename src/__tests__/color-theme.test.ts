// color-theme.test.ts
// Slice 6. Locks the semantics of card-colour-aware theming derived
// from oracle_colors. No official mana symbols; design tokens only.

import { describe, it, expect } from 'vitest'
import { buildCardTheme, normaliseColours } from '@/lib/mtg/color-theme'

describe('normaliseColours', () => {
  it('returns [] for null / undefined / empty / non-array input', () => {
    expect(normaliseColours(null)).toEqual([])
    expect(normaliseColours(undefined)).toEqual([])
    expect(normaliseColours('W')).toEqual([])
    expect(normaliseColours({})).toEqual([])
    expect(normaliseColours([])).toEqual([])
  })

  it('canonicalises out-of-order colours into WUBRG order', () => {
    expect(normaliseColours(['G', 'W', 'U'])).toEqual(['W', 'U', 'G'])
    expect(normaliseColours(['R', 'B'])).toEqual(['B', 'R'])
  })

  it('is case-insensitive and strips unknown values', () => {
    expect(normaliseColours(['w', 'u', 'X', ' r '])).toEqual(['W', 'U', 'R'])
  })
})

describe('buildCardTheme', () => {
  it('colourless card returns colourless=true, 5-segment neutral rail, no ambient blowout', () => {
    const t = buildCardTheme([])
    expect(t.colourless).toBe(true)
    expect(t.colours).toEqual([])
    expect(t.label).toBe('Colourless')
    expect(t.rail).toHaveLength(5)
    expect(t.rail.every((s) => !s.present)).toBe(true)
  })

  it('mono-blue returns Mono blue label and blue primary hex', () => {
    const t = buildCardTheme(['U'])
    expect(t.label).toBe('Mono blue')
    expect(t.rail.find((s) => s.colour === 'U')!.present).toBe(true)
    expect(t.rail.filter((s) => s.present)).toHaveLength(1)
    expect(t.primaryHex.toUpperCase()).toBe('#3E7BC9')
  })

  it('Rakdos (BR) returns guild name label and blended primary hex', () => {
    const t = buildCardTheme(['B', 'R'])
    expect(t.label).toBe('Rakdos (B/R)')
    expect(t.rail.filter((s) => s.present).map((s) => s.colour)).toEqual(['B', 'R'])
    //  Primary hex is the average of ember + dusk plum. Non-black.
    expect(t.primaryHex).not.toBe('#000000')
  })

  it('five-colour returns "Five-colour" label and all 5 rail segments present', () => {
    const t = buildCardTheme(['W', 'U', 'B', 'R', 'G'])
    expect(t.label).toBe('Five-colour')
    expect(t.rail.filter((s) => s.present)).toHaveLength(5)
  })

  it('ambient string is a css radial-gradient - safe to drop into background:', () => {
    const t = buildCardTheme(['U'])
    expect(t.ambient).toMatch(/^radial-gradient/)
  })
})
