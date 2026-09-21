// ebay-links.test.ts
// Locks the eBay affiliate link contract:
//   - ONE shared EBAY_EPN_CAMPAIGN_ID reused across every marketplace
//   - marketplace-specific mkrid is still selected per marketplace
//   - customid values are preserved and passed through
//   - affiliate params vanish when the master switch is off
//   - unknown country falls back safely to the default marketplace

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { buildEbaySearchLink, marketplaceFor } from '@/lib/mtg/ebay-links'

const SHARED_CAMPAIGN = '5339212159'

// Marketplace hosts. Assertions read this to prove the domain switched
// as we changed the resolved country.
const HOST = {
  US: 'www.ebay.com',
  GB: 'www.ebay.co.uk',
  DE: 'www.ebay.de',
  FR: 'www.ebay.fr',
  IT: 'www.ebay.it',
  ES: 'www.ebay.es',
  AU: 'www.ebay.com.au',
  CA: 'www.ebay.ca',
} as const

// Public MK_IDs published by EPN. If MK_IDS in the source module drifts,
// these tests will catch it.
const MKRID = {
  US: '711-53200-19255-0',
  GB: '710-53481-19255-0',
  DE: '707-53477-19255-0',
  FR: '709-53476-19255-0',
  IT: '724-53478-19255-0',
  ES: '1185-53479-19255-0',
  AU: '705-53470-19255-0',
  CA: '706-53473-19255-0',
} as const

function withEnv<T>(env: Record<string, string | undefined>, fn: () => T): T {
  const before: Record<string, string | undefined> = {}
  for (const key of Object.keys(env)) {
    before[key] = process.env[key]
    if (env[key] === undefined) delete process.env[key]
    else process.env[key] = env[key]
  }
  try { return fn() } finally {
    for (const key of Object.keys(before)) {
      if (before[key] === undefined) delete process.env[key]
      else process.env[key] = before[key]
    }
  }
}

const CARD = { cardName: 'Lightning Bolt', setName: 'Limited Edition Alpha', collectorNumber: '161' }

describe('eBay affiliate links: shared Campaign ID + per-marketplace mkrid', () => {
  it('reuses the same campid on every supported marketplace', () => {
    withEnv({ EBAY_AFFILIATE_ENABLED: 'true', EBAY_EPN_CAMPAIGN_ID: SHARED_CAMPAIGN }, () => {
      for (const mkt of ['US','GB','DE','FR','IT','ES','AU','CA'] as const) {
        const link = buildEbaySearchLink({ ...CARD, marketplace: mkt, source: 'mtg-card-overview' })
        const url = new URL(link.href)
        expect(url.hostname, mkt).toBe(HOST[mkt])
        expect(url.searchParams.get('campid'), mkt).toBe(SHARED_CAMPAIGN)
        expect(url.searchParams.get('mkrid'),  mkt).toBe(MKRID[mkt])
        expect(url.searchParams.get('mkcid'),  mkt).toBe('1')
        expect(url.searchParams.get('mkevt'),  mkt).toBe('1')
        expect(url.searchParams.get('toolid'), mkt).toBe('10001')
        expect(link.affiliate, mkt).toBe(true)
      }
    })
  })

  it('marketplace-specific mkrid differs across marketplaces on the same campid', () => {
    withEnv({ EBAY_AFFILIATE_ENABLED: 'true', EBAY_EPN_CAMPAIGN_ID: SHARED_CAMPAIGN }, () => {
      const us = new URL(buildEbaySearchLink({ ...CARD, marketplace: 'US' }).href).searchParams.get('mkrid')
      const gb = new URL(buildEbaySearchLink({ ...CARD, marketplace: 'GB' }).href).searchParams.get('mkrid')
      const de = new URL(buildEbaySearchLink({ ...CARD, marketplace: 'DE' }).href).searchParams.get('mkrid')
      expect(us).toBe(MKRID.US)
      expect(gb).toBe(MKRID.GB)
      expect(de).toBe(MKRID.DE)
      // Sanity: no two marketplaces share an mkrid.
      const all = new Set(Object.values(MKRID))
      expect(all.size).toBe(Object.values(MKRID).length)
    })
  })

  it('customid is passed through unchanged for the MTGPrices placement labels', () => {
    withEnv({ EBAY_AFFILIATE_ENABLED: 'true', EBAY_EPN_CAMPAIGN_ID: SHARED_CAMPAIGN }, () => {
      for (const src of ['mtg-card-overview', 'mtg-printing-comparison', 'mtg-deck-shopping']) {
        const link = buildEbaySearchLink({ ...CARD, marketplace: 'US', source: src })
        const url = new URL(link.href)
        expect(url.searchParams.get('customid'), src).toBe(src)
      }
    })
  })

  it('affiliate params are absent when the master switch is off', () => {
    withEnv({ EBAY_AFFILIATE_ENABLED: 'false', EBAY_EPN_CAMPAIGN_ID: SHARED_CAMPAIGN }, () => {
      const link = buildEbaySearchLink({ ...CARD, marketplace: 'US', source: 'mtg-card-overview' })
      const url = new URL(link.href)
      expect(url.searchParams.get('campid')).toBeNull()
      expect(url.searchParams.get('mkrid')).toBeNull()
      expect(url.searchParams.get('customid')).toBeNull()
      expect(link.affiliate).toBe(false)
    })
  })

  it('affiliate params are absent when the shared campaign is unset', () => {
    withEnv({ EBAY_AFFILIATE_ENABLED: 'true', EBAY_EPN_CAMPAIGN_ID: undefined }, () => {
      const link = buildEbaySearchLink({ ...CARD, marketplace: 'US' })
      const url = new URL(link.href)
      expect(url.searchParams.get('campid')).toBeNull()
      expect(link.affiliate).toBe(false)
    })
  })

  it('unknown country falls back to the configured default marketplace', () => {
    withEnv({ EBAY_AFFILIATE_ENABLED: 'true', EBAY_EPN_CAMPAIGN_ID: SHARED_CAMPAIGN, EBAY_DEFAULT_MARKETPLACE: 'US' }, () => {
      expect(marketplaceFor('ZZ')).toBe('US')
      expect(marketplaceFor(null)).toBe('US')
      expect(marketplaceFor(undefined)).toBe('US')
    })
  })

  it('query text remains card-specific (name + set + collector number + MTG scope)', () => {
    withEnv({ EBAY_AFFILIATE_ENABLED: 'true', EBAY_EPN_CAMPAIGN_ID: SHARED_CAMPAIGN }, () => {
      const link = buildEbaySearchLink({ ...CARD, marketplace: 'GB', source: 'mtg-card-overview' })
      const url = new URL(link.href)
      const nkw = url.searchParams.get('_nkw') ?? ''
      expect(nkw).toContain('Lightning Bolt')
      expect(nkw).toContain('Limited Edition Alpha')
      expect(nkw).toContain('161')
      expect(nkw).toContain('Magic the Gathering')
      expect(url.searchParams.get('_sacat')).toBe('38292')
    })
  })
})
