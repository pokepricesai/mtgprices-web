// Block 5A-W-50D, pin the sitemap index shape + child inventory.
//
// The audit found the sitemap index only referenced 4 card shards
// covering row positions 1..50000, leaving 14,813 rows (dominated
// by the Japanese W48D catalogue) with no shard. This test set
// pins the index against future regressions.

import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const ROOT_SRC = readFileSync(
  join(process.cwd(), 'src/app/sitemap.xml/route.ts'),
  'utf8',
)

describe('sitemap.xml root index', () => {
  it('is a sitemapindex, not a urlset', () => {
    // Strip line comments so a historical mention of <urlset> in the
    // module docstring does not defeat the check.
    const codeOnly = ROOT_SRC.replace(/\/\/.*$/gm, '')
    expect(codeOnly).toContain('<sitemapindex')
    expect(codeOnly).not.toMatch(/<urlset/)
  })

  it('references every required child sitemap', () => {
    const required = [
      'sitemap-pages.xml',
      'sitemap-sets.xml',
      'sitemap-pokemon.xml',
      'sitemap-cards-1.xml',
      'sitemap-cards-2.xml',
      'sitemap-cards-3.xml',
      'sitemap-cards-4.xml',
      'sitemap-cards-5.xml',   // Block 5A-W-50D
      'sitemap-insights.xml',
    ]
    for (const name of required) {
      expect(ROOT_SRC).toContain(`'${name}'`)
    }
  })

  it('card shard count is at least 5 (Block 5A-W-50D coverage floor)', () => {
    // If a future change drops the number of card shards below 5,
    // JP cards imported by W48D will silently disappear from the
    // index. Pin this so the regression is loud.
    const cardShards = (ROOT_SRC.match(/sitemap-cards-\d+\.xml/g) || []).length
    expect(cardShards).toBeGreaterThanOrEqual(5)
  })
})
