// seo-policy.test.ts
// Pins the route indexability policy so that a future refactor cannot
// silently reclassify a private page as public or accidentally add a
// param-variant route to the sitemap.

import { describe, it, expect } from 'vitest'
import { policyForPath, isSitemapEligible } from '@/lib/seo'

describe('SEO route policy', () => {
  it('classifies public hub pages as INDEX and puts them in the sitemap', () => {
    for (const p of ['/', '/browse', '/market', '/formats', '/card-finder', '/insights', '/ai']) {
      expect(policyForPath(p), p).toBe('INDEX')
      expect(isSitemapEligible(p), p).toBe(true)
    }
  })

  it('classifies format detail and insight article paths as INDEX', () => {
    expect(policyForPath('/formats/commander')).toBe('INDEX')
    expect(policyForPath('/insights/how-mtgprices-tracks-magic-card-prices')).toBe('INDEX')
    expect(isSitemapEligible('/formats/commander')).toBe(true)
    expect(isSitemapEligible('/insights/how-mtgprices-tracks-magic-card-prices')).toBe(true)
  })

  it('classifies set + card detail templates as INDEX', () => {
    expect(policyForPath('/set/lea')).toBe('INDEX')
    expect(policyForPath('/set/lea/card/161-lightning-bolt')).toBe('INDEX')
  })

  it('classifies /cards/search as a PARAM_VARIANT and keeps it OUT of the sitemap', () => {
    expect(policyForPath('/cards/search')).toBe('PARAM_VARIANT')
    expect(isSitemapEligible('/cards/search')).toBe(false)
  })

  it('classifies AUTH routes and keeps them OUT of the sitemap', () => {
    for (const p of ['/login', '/account', '/settings', '/collection', '/collection/import', '/decks', '/decks/new', '/decks/abcdefab-abcd-abcd-abcd-abcdefabcdef', '/decks/abcdefab-abcd-abcd-abcd-abcdefabcdef/test']) {
      expect(policyForPath(p), p).toBe('AUTH')
      expect(isSitemapEligible(p), p).toBe(false)
    }
  })

  it('keeps public decks NOINDEX (deliberate for launch)', () => {
    expect(policyForPath('/decks/public/my-shared-deck')).toBe('NOINDEX')
    expect(isSitemapEligible('/decks/public/my-shared-deck')).toBe(false)
  })

  it('classifies API/asset paths as API and keeps them OUT of the sitemap', () => {
    for (const p of ['/api/ai/ask', '/sitemap.xml', '/robots.txt', '/icon.png', '/apple-icon.png', '/favicon.png']) {
      expect(policyForPath(p), p).toBe('API')
      expect(isSitemapEligible(p), p).toBe(false)
    }
  })

  it('unknown paths default to NOINDEX (safer than INDEX)', () => {
    expect(policyForPath('/what-is-this-random-route')).toBe('NOINDEX')
    expect(isSitemapEligible('/what-is-this-random-route')).toBe(false)
  })
})
