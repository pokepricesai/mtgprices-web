// Block 5A-W-58G — Deep Search eBay CTA routing + dual analytics.
//
// Verifies:
//   * ebayLink(row, 'UK') → ebay.co.uk with legacy customid + raw
//     category and no sold filters.
//   * ebayLink(row, 'US') → ebay.com with the same customid.
//   * The row's card_number is preserved in the affiliate query.
//   * Legacy customid is bare-slug (`pc-` prefix stripped) so EPN
//     reports keep aggregating alongside pre-58G rows.
//
// The click-analytics dual-fire (deep_search_ebay_click PLUS
// affiliate_click) and the affiliate_link_view IO wiring are pinned
// with source-read regex assertions — vitest here runs in node env
// without jsdom, so DOM click / IO simulation is intentionally out
// of scope.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

// SearchResults transitively imports the supabase browser client via
// useMarketplace. Stub it so this module can load in the test env.
vi.mock('@/lib/supabase', () => ({
  supabase: { auth: {
    getSession:        async () => ({ data: { session: null } }),
    onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } }),
  } },
  CHAT_ENDPOINT: '',
}))

import { ebayLink, type SearchResultRow } from '../SearchResults'
import { PUBLIC_EBAY_CAMPAIGN_IDS, type MarketplaceCode } from '@/lib/marketplaces'

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
})

function row(over: Partial<SearchResultRow> = {}): SearchResultRow {
  return {
    card_slug:            'pc-1234',
    card_name:            'Umbreon VMAX',
    set_name:             'Evolving Skies',
    card_number:          '215',
    card_number_display:  '215/203',
    card_url_slug:        'umbreon-vmax-215',
    image_url:            null,
    primary_pokemon_slug: 'umbreon',
    language:             'en',
    set_release_date:     null,
    release_year:         2021,
    raw_usd:              null,
    psa7_usd:             null,
    psa8_usd:             null,
    psa9_usd:             null,
    psa10_usd:            null,
    raw_pct_7d:           null,
    raw_pct_30d:          null,
    raw_pct_90d:          null,
    psa9_uplift:          null,
    psa10_uplift:         null,
    psa9_multiple:        null,
    psa10_multiple:       null,
    ...over,
  }
}

describe('Deep Search — ebayLink marketplace routing', () => {
  it('UK resolves to ebay.co.uk with singles category and no sold filters', () => {
    const url = ebayLink(row(), 'UK')
    expect(url).not.toBeNull()
    const u = new URL(url!)
    expect(u.hostname).toBe('www.ebay.co.uk')
    expect(u.searchParams.get('_sacat')).toBe('183454')
    expect(u.searchParams.get('LH_Sold')).toBeNull()
    expect(u.searchParams.get('LH_Complete')).toBeNull()
  })

  it('US resolves to ebay.com with singles category', () => {
    const url = ebayLink(row(), 'US')
    expect(url).not.toBeNull()
    const u = new URL(url!)
    expect(u.hostname).toBe('www.ebay.com')
    expect(u.searchParams.get('_sacat')).toBe('183454')
  })

  it('UK link carries the UK campaign id and the US link carries the US one', () => {
    const uk = new URL(ebayLink(row(), 'UK')!)
    const us = new URL(ebayLink(row(), 'US')!)
    expect(uk.searchParams.get('campid')).toBe('TEST-UK')
    expect(us.searchParams.get('campid')).toBe('TEST-US')
  })

  it('preserves the legacy bare-slug customid so EPN reports stay comparable', () => {
    const uk = new URL(ebayLink(row(), 'UK')!)
    const us = new URL(ebayLink(row(), 'US')!)
    // `pc-` prefix stripped; matches the pre-58G helper output.
    expect(uk.searchParams.get('customid')).toBe('1234')
    expect(us.searchParams.get('customid')).toBe('1234')
  })

  it('preserves card name + set + card_number in the affiliate query', () => {
    const uk = new URL(ebayLink(row(), 'UK')!)
    const nkw = uk.searchParams.get('_nkw') ?? ''
    expect(nkw).toContain('Umbreon VMAX')
    expect(nkw).toContain('Evolving Skies')
    expect(nkw).toContain('#215')
    // Sanity — should not accidentally add "PSA 10" / sold tail.
    expect(nkw).not.toMatch(/PSA\s+\d/i)
  })

  it('returns null when card_name is missing', () => {
    expect(ebayLink(row({ card_name: '' }), 'UK')).toBeNull()
  })

  it('returns null when set_name is missing', () => {
    expect(ebayLink(row({ set_name: '' }), 'UK')).toBeNull()
  })
})

// ── Source-read pinning for the two analytics guarantees ──

const SRC = readFileSync(join(__dirname, '..', 'SearchResults.tsx'), 'utf8')

describe('Deep Search — analytics wiring pinning (source-read)', () => {
  it('still fires the legacy deep_search_ebay_click event on click', () => {
    expect(SRC).toContain("trackEvent('deep_search_ebay_click'")
  })

  it('also fires the standard affiliate_click event on click', () => {
    expect(SRC).toContain("trackEvent('affiliate_click'")
  })

  it('emits an affiliate_link_view when a row scrolls into view (per-row IO)', () => {
    expect(SRC).toContain("trackEvent('affiliate_link_view'")
    expect(SRC).toContain('IntersectionObserver')
  })

  it('carries placement="deep_search_row" on the affiliate events', () => {
    expect(SRC).toContain("placement:          'deep_search_row'")
  })

  it('reads the resolved marketplace via useMarketplace()', () => {
    expect(SRC).toContain("import { useMarketplace } from '@/lib/marketplaceClient'")
    expect(SRC).toContain('useMarketplace()')
  })

  it('does not fall back to the UK-hardcoded legacy helper', () => {
    // Pre-58G Deep Search imported getEbayUkUrl directly. That path
    // must NOT come back — the marketplace-aware engine takes over.
    expect(SRC).not.toContain('getEbayUkUrl(q')
    expect(SRC).not.toContain('import { buildCardEbayQuery, getEbayUkUrl }')
  })
})
