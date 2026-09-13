// Block 5A-W-58G — EbayInlineLink marketplace routing.
//
// The mover placements (set page + Pokémon page) used to hardcode
// UK regardless of the resolved marketplace. 58G routes them through
// useMarketplace() with a UK fallback for SSR / not-yet-resolved.
//
// vitest here runs in node env (no jsdom), so we mock useMarketplace
// and render via react-dom/server to inspect the resulting href.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderToString } from 'react-dom/server'
import { createElement } from 'react'
import { PUBLIC_EBAY_CAMPAIGN_IDS, type MarketplaceCode } from '@/lib/marketplaces'

// Supabase browser client is initialised at module import time by the
// marketplace client — stub it so the test env can evaluate the module
// graph even though we override useMarketplace itself.
vi.mock('@/lib/supabase', () => ({
  supabase: { auth: {
    getSession:        async () => ({ data: { session: null } }),
    onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } }),
  } },
  CHAT_ENDPOINT: '',
}))

// Default mock returns UK. Individual `describe` blocks re-mock via
// vi.doMock or override the module.
const marketplaceRef = { current: 'UK' as MarketplaceCode | null }
vi.mock('@/lib/marketplaceClient', () => ({
  useMarketplace: () => ({
    marketplace:            marketplaceRef.current,
    source:                 'default',
    setMarketplace:         () => {},
    selectableMarketplaces: [],
    isReady:                true,
  }),
}))

import { EbayInlineLink } from '../EbayLiveListings'

const MAP = PUBLIC_EBAY_CAMPAIGN_IDS as Record<MarketplaceCode, string | undefined>
let snap: Record<MarketplaceCode, string | undefined>

beforeEach(() => {
  snap = { ...MAP } as Record<MarketplaceCode, string | undefined>
  MAP.UK = 'TEST-UK'
  MAP.US = 'TEST-US'
  process.env.NEXT_PUBLIC_EBAY_CAMPID_UK = 'TEST-UK'
  process.env.NEXT_PUBLIC_EBAY_CAMPID_US = 'TEST-US'
})
afterEach(() => {
  for (const code of Object.keys(MAP) as MarketplaceCode[]) MAP[code] = snap[code]
  delete process.env.NEXT_PUBLIC_EBAY_CAMPID_UK
  delete process.env.NEXT_PUBLIC_EBAY_CAMPID_US
  marketplaceRef.current = 'UK'
})

function render(props: React.ComponentProps<typeof EbayInlineLink>): string {
  return renderToString(createElement(EbayInlineLink, props))
}

function extractHref(html: string): string | null {
  const m = html.match(/href="([^"]+)"/)
  if (!m) return null
  // HTML-entity-decode the amp; used inside href attrs so URL parsing works.
  return m[1].replace(/&amp;/g, '&')
}

describe('EbayInlineLink — marketplace routing', () => {
  it('UK visitor → ebay.co.uk', () => {
    marketplaceRef.current = 'UK'
    const html = render({
      searchQuery: 'Umbreon VMAX Evolving Skies pokemon card',
      customId:    'mover-1234',
      placement:   'set_mover_row',
      intent:      'raw',
    })
    const url = new URL(extractHref(html)!)
    expect(url.hostname).toBe('www.ebay.co.uk')
    expect(url.searchParams.get('customid')).toBe('mover-1234')
    expect(url.searchParams.get('campid')).toBe('TEST-UK')
  })

  it('US visitor → ebay.com', () => {
    marketplaceRef.current = 'US'
    const html = render({
      searchQuery: 'Umbreon VMAX Evolving Skies pokemon card',
      customId:    'mover-1234',
      placement:   'pokemon_mover_row',
      intent:      'raw',
    })
    const url = new URL(extractHref(html)!)
    expect(url.hostname).toBe('www.ebay.com')
    expect(url.searchParams.get('customid')).toBe('mover-1234')
    expect(url.searchParams.get('campid')).toBe('TEST-US')
  })

  it('null (unresolved) → UK fallback so SSR / cold-render is not broken', () => {
    marketplaceRef.current = null
    const html = render({
      searchQuery: 'Charizard Base Set pokemon card',
      customId:    'mover-4444',
    })
    const url = new URL(extractHref(html)!)
    expect(url.hostname).toBe('www.ebay.co.uk')
    expect(url.searchParams.get('customid')).toBe('mover-4444')
  })

  it('preserves the search query exactly (no marketplace-specific rewriting)', () => {
    marketplaceRef.current = 'US'
    const html = render({
      searchQuery: 'Pikachu Base Set pokemon card',
      customId:    'mover-99',
    })
    const url = new URL(extractHref(html)!)
    expect(url.searchParams.get('_nkw')).toBe('Pikachu Base Set pokemon card')
  })
})
