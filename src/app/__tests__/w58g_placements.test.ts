// Block 5A-W-58G — cross-file placement pins.
//
// Source-read regressions catch the callers that pre-58G omitted the
// placement / sourceComponent so analytics tagged the click as
// `placement: 'unknown'` / `'inline'`. The behavioural verification
// happens in EbayInlineLink.marketplace.test.tsx (marketplace routing)
// and SearchResults.ebay.test.tsx (Deep Search).

import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const REPO = join(__dirname, '..', '..', '..')
function read(rel: string): string {
  return readFileSync(join(REPO, rel), 'utf8')
}

describe('Set-page hero — W58G analytics', () => {
  const SRC = read('src/app/set/[slug]/SetPageClient.tsx')

  it('renders the eBay chips inside SetHeroLinks (single IO container)', () => {
    expect(SRC).toContain('function SetHeroLinks(')
    expect(SRC).toContain('<SetHeroLinks')
    expect(SRC).toContain('IntersectionObserver')
  })

  it('fires affiliate_link_view once for the block with placement="set_page_hero"', () => {
    expect(SRC).toContain("trackEvent('affiliate_link_view'")
    expect(SRC).toContain("placement:          'set_page_hero'")
    expect(SRC).toContain("intent:             'set_search'")
    expect(SRC).toContain("source_component:   'set_page_hero_block'")
  })

  it('fires affiliate_click per marketplace anchor (UK + US)', () => {
    expect(SRC).toContain("trackEvent('affiliate_click'")
    expect(SRC).toContain("onEbayClick('UK')")
    expect(SRC).toContain("onEbayClick('US')")
  })

  it('carries the set-<setName> custom tracking id consistent with the URL', () => {
    // Same identifier that getEbayUkUrl/getEbayUsUrl receive as the
    // legacy customid → EPN reports and GA event share one key.
    expect(SRC).toContain('custom_tracking_id: `set-${setName}`')
  })
})

describe('Set-page mover — W58G placement', () => {
  const SRC = read('src/app/set/[slug]/SetPageClient.tsx')

  it('passes placement="set_mover_row" to the EbayInlineLink mover CTA', () => {
    expect(SRC).toContain('placement="set_mover_row"')
    expect(SRC).toContain('sourceComponent="set_page_mover_row"')
  })

  it('does not fall back to the default placement="inline" for movers', () => {
    // A bare `<EbayInlineLink searchQuery=... customId=... />` (pre-58G)
    // would emit placement: 'inline'. The 58G call site must pass
    // placement explicitly.
    expect(SRC).not.toMatch(/<EbayInlineLink\s+searchQuery=\{ebayQuery\}\s+customId=\{ebayCustomId\}\s*\/>/)
  })
})

describe('Pokémon-page hero + mover — W58G placements', () => {
  const SRC = read('src/app/pokemon/[slug]/page.tsx')

  it('passes placement="pokemon_hero" and sourceComponent="pokemon_hero_block" to EbayLiveListings', () => {
    expect(SRC).toContain('placement="pokemon_hero"')
    expect(SRC).toContain('sourceComponent="pokemon_hero_block"')
  })

  it('no longer allows the placement="unknown" fallback on the hero block', () => {
    // Pre-58G: <EbayLiveListings searchQuery={displayName} customId={`pokemon-${slug}`} />
    // The fallback default in EbayLiveListings would emit placement: 'unknown'.
    // Regression guard.
    expect(SRC).not.toMatch(/<EbayLiveListings\s+searchQuery=\{displayName\}\s+customId=\{`pokemon-\$\{slug\}`\}\s*\/>/)
  })

  it('passes placement="pokemon_mover_row" on the movers list', () => {
    expect(SRC).toContain('placement="pokemon_mover_row"')
    expect(SRC).toContain('sourceComponent="pokemon_page_mover_row"')
  })
})
