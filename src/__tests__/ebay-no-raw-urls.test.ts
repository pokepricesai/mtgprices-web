// ebay-no-raw-urls.test.ts
//
// Repo-level guard: no file inside src/ is allowed to carry a raw
// eBay URL (ebay.com / ebay.co.uk / ebay.de / etc.) or a raw EPN
// marketplace host unless it is on an explicit allowlist. Every
// user-facing MTGPrices eBay link must go through buildEbaySearchLink
// in src/lib/mtg/ebay-links.ts so campid, mkrid, customid, mkevt,
// mkcid and toolid are attached automatically.
//
// The allowlist is intentionally short:
//   - the helper itself (defines HOST_BY_MARKETPLACE)
//   - the tests that lock the helper's behaviour
//
// Any new src/ file that mentions an eBay host will fail this test
// until the author routes the link through the helper (or adds a
// deliberate allowlist entry with a comment).

import { describe, it, expect } from 'vitest'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative, sep } from 'node:path'

const SRC_ROOT = join(__dirname, '..')

// Files allowed to mention a raw eBay host string. Everything else
// must consume the helper.
const ALLOWLIST = new Set([
  'lib/mtg/ebay-links.ts',
  '__tests__/ebay-links.test.ts',
  '__tests__/ebay-no-raw-urls.test.ts',
  // Prose insight — mentions "eBay" as a plain word, not a URL. Still
  // explicitly listed because the regex below is URL-shaped and should
  // not match this file; keeping the allowlist entry prevents a
  // future author sneaking a URL in via that path.
  'content/insights/how-mtgprices-tracks-magic-card-prices.md',
])

// Matches a hostname-shaped eBay reference: "ebay.com", "ebay.co.uk",
// "www.ebay.de", etc. Does NOT match the word "eBay" on its own, so
// prose/UI copy that just says "on eBay" is not flagged.
const EBAY_HOST_RE = /\bebay\.(com|co\.uk|de|fr|it|es|com\.au|ca)\b/i

const EXT_RE = /\.(ts|tsx|js|jsx|mjs|cjs|md|mdx|json)$/

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry)
    const s = statSync(full)
    if (s.isDirectory()) {
      if (entry === 'node_modules' || entry.startsWith('.')) continue
      walk(full, out)
    } else if (EXT_RE.test(entry)) {
      out.push(full)
    }
  }
  return out
}

describe('eBay link guardrail: no raw hostnames outside the helper', () => {
  it('every raw ebay.* host in src/ lives on the allowlist', () => {
    const files = walk(SRC_ROOT)
    const offenders: { path: string; sample: string }[] = []
    for (const full of files) {
      const rel = relative(SRC_ROOT, full).split(sep).join('/')
      if (ALLOWLIST.has(rel)) continue
      let text: string
      try { text = readFileSync(full, 'utf8') } catch { continue }
      const m = text.match(EBAY_HOST_RE)
      if (m) offenders.push({ path: rel, sample: m[0] })
    }
    expect(
      offenders,
      offenders.length === 0
        ? 'no raw ebay hosts in src/'
        : `found raw ebay hostnames outside the approved helper (${offenders.length}): \n` +
          offenders.map((o) => `  - ${o.path} (${o.sample})`).join('\n') +
          '\n\nRoute the link through buildEbaySearchLink in src/lib/mtg/ebay-links.ts, ' +
          'or add the file to ALLOWLIST with a comment explaining why.',
    ).toEqual([])
  })
})
