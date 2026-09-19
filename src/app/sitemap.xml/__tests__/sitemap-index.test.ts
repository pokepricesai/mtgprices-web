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

const ROOT_SRC = readFileSync(
  join(process.cwd(), 'src/app/sitemap.xml/route.ts'),
  'utf8',
)
const SITEMAP_LIB = readFileSync(
  join(process.cwd(), 'src/lib/mtg/sitemap.ts'),
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
