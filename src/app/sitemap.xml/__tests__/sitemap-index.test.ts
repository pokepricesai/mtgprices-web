// sitemap-index.test.ts
// Pins the MTGPrices sitemap index shape and shard inventory.
//
// The root sitemap.xml route emits a <sitemapindex> that references
// three kinds of sub-sitemaps:
//   - sitemap-pages.xml   (marketing routes, formats index)
//   - sitemap-sets.xml    (every English paper set page)
//   - sitemap-cards-N.xml (deterministic sharded card URLs)
//
// The number of card shards is driven by CARD_SITEMAP_SHARDS in
// src/lib/mtg/sitemap.ts. We keep the floor at 5 because 5 shards ×
// SHARD_SIZE covers our current MTGJSON printings volume with headroom.
// A future increase is fine (test uses >=). A future decrease would
// silently drop card URLs from indexing, so we fail loud in that case.

import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { buildSitemapXml } from '@/lib/mtg/sitemap'

const ROOT_SRC = readFileSync(
  join(process.cwd(), 'src/app/sitemap.xml/route.ts'),
  'utf8',
)
const SITEMAP_LIB = readFileSync(
  join(process.cwd(), 'src/lib/mtg/sitemap.ts'),
  'utf8',
)
const PAGES_SRC = readFileSync(
  join(process.cwd(), 'src/app/sitemap-pages.xml/route.ts'),
  'utf8',
)

const CARD_SHARDS_FLOOR = 5

describe('sitemap.xml root index', () => {
  it('is a sitemapindex, not a urlset', () => {
    // Strip comments so any historical mention of <urlset> in module
    // docstrings does not defeat the check.
    const codeOnly = ROOT_SRC.replace(/\/\/.*$/gm, '')
    expect(codeOnly).toContain('<sitemapindex')
    expect(codeOnly).not.toMatch(/<urlset/)
  })

  it('references the pages and sets sub-sitemaps by name', () => {
    for (const name of ['sitemap-pages.xml', 'sitemap-sets.xml']) {
      expect(ROOT_SRC).toContain(`'${name}'`)
    }
  })

  it('generates card shard entries from CARD_SITEMAP_SHARDS at runtime', () => {
    // The root does not hardcode `sitemap-cards-N.xml` strings, it
    // loops over CARD_SITEMAP_SHARDS. Check the loop pattern is intact
    // and the source constant is at least the floor.
    expect(ROOT_SRC).toContain('CARD_SITEMAP_SHARDS')
    expect(ROOT_SRC).toMatch(/sitemap-cards-\$\{i\}\.xml`/)
    const match = SITEMAP_LIB.match(/CARD_SITEMAP_SHARDS\s*=\s*(\d+)/)
    expect(match).toBeTruthy()
    const shards = match ? parseInt(match[1], 10) : 0
    expect(shards).toBeGreaterThanOrEqual(CARD_SHARDS_FLOOR)
  })

  it('sitemap-pages.xml includes /insights and /ai', () => {
    expect(PAGES_SRC).toMatch(/\/insights['`]/)
    expect(PAGES_SRC).toMatch(/\/ai['`]/)
  })

  it('sitemap-pages.xml pulls in every article from listInsights()', () => {
    expect(PAGES_SRC).toContain('listInsights')
  })

  it('sitemap-pages.xml never lists private or search-result URLs', () => {
    // Search-result URLs are an unbounded parameter space and must
    // not appear in the sitemap. Private routes must never appear.
    // Verify the SOURCE does not reference these paths.
    const banned = [
      '/cards/search',   // param variant
      '/login', '/account', '/settings', '/collection',
      '/decks', '/decks/new', '/decks/public',
      '/test-deck',      // NOINDEX per SEO policy
    ]
    for (const b of banned) {
      const pattern = new RegExp(`['\`]${b.replace(/\//g, '\\/')}['\`]`)
      expect(PAGES_SRC, `banned path ${b} appeared in sitemap-pages source`).not.toMatch(pattern)
    }
  })

  it('sitemap-pages.xml routes eligibility through isSitemapEligible', () => {
    // The source should not manually cherry-pick paths, it should
    // ask the central policy helper. Prevents drift from
    // src/lib/seo.ts.
    expect(PAGES_SRC).toContain('isSitemapEligible')
  })

  it('sitemap lastmod values are not live now() timestamps', () => {
    // Live now() on every request made the lastmod signal noisy for
    // crawlers. Assert per-boot BUILD_ISO instead in every sitemap.
    for (const src of [
      readFileSync(join(process.cwd(), 'src/app/sitemap.xml/route.ts'), 'utf8'),
      readFileSync(join(process.cwd(), 'src/app/sitemap-pages.xml/route.ts'), 'utf8'),
      readFileSync(join(process.cwd(), 'src/app/sitemap-sets.xml/route.ts'), 'utf8'),
      readFileSync(join(process.cwd(), 'src/lib/mtg/sitemap.ts'), 'utf8'),
    ]) {
      // Look for a `new Date().toISOString()` call INSIDE the GET
      // handler / buildSitemapXml function. Module-scope BUILD_ISO is
      // fine.
      const insideGet = src.match(/export\s+async\s+function\s+GET[\s\S]*?\n\}/)?.[0]
        ?? src.match(/export\s+function\s+buildSitemapXml[\s\S]*?\n\}/)?.[0]
        ?? ''
      expect(insideGet, 'live now() should not run per request').not.toMatch(/new\s+Date\(\)\.toISOString\(\)/)
    }
  })

  it('percent-encodes non-ASCII collector numbers in card <loc>', () => {
    // Regression: raw ★ in a sitemap loc violates RFC 3986 and the
    // sitemap protocol. Emit "%E2%98%85" so Google receives a
    // well-formed URL, then the route handler decodeURIComponents
    // back to "★" before splitting.
    const xml = buildSitemapXml([
      { setCode: '7ed', collector: '91★', name: 'Opportunity', released_at: '2001-04-11' },
      { setCode: 'ala', collector: '37',  name: "Courier's Capsule", released_at: '2008-10-03' },
    ])
    expect(xml).toContain('/set/7ed/card/91%E2%98%85-opportunity')
    expect(xml).not.toMatch(/\/card\/91★-/)
    expect(xml).toContain('/set/ala/card/37-couriers-capsule')
  })

  it('has a route file for every card shard the constant claims', () => {
    // Ensures we did not raise CARD_SITEMAP_SHARDS without adding the
    // corresponding /sitemap-cards-N.xml routes.
    const match = SITEMAP_LIB.match(/CARD_SITEMAP_SHARDS\s*=\s*(\d+)/)
    const shards = match ? parseInt(match[1], 10) : 0
    expect(shards).toBeGreaterThanOrEqual(CARD_SHARDS_FLOOR)
    for (let i = 1; i <= shards; i++) {
      const path = join(process.cwd(), `src/app/sitemap-cards-${i}.xml/route.ts`)
      // readFileSync throws if the file does not exist.
      expect(() => readFileSync(path, 'utf8')).not.toThrow()
    }
  })
})
