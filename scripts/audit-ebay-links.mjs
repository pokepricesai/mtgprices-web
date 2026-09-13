#!/usr/bin/env node
// scripts/audit-ebay-links.mjs
// PokePrices v2 Block 2C — repository audit for stray eBay URLs.
//
// Walks src/** and supabase/functions/** looking for raw eBay tokens
// outside an allow-list of files that are permitted to mention them
// (the central engine, the audited reusable component, tests, the
// edge-function source — which is allow-listed for now while the
// server-side wrapping is staged for the next deploy — and the vendor
// submission form whose only token is a placeholder string).
//
// Exits non-zero when a violation is found, so it can be wired into CI
// later. Run on demand:
//
//   node scripts/audit-ebay-links.mjs
//
// Tokens scanned: ebay.com, ebay.co.uk, item_web_url, _nkw, LH_Sold,
// LH_Complete, mkrid, mkevt. `customid`/`campid` are NOT scanned because
// they appear as variable / JSX-prop names in legitimate consumers of
// the central engine (e.g. `<EbayInlineLink customId=...>`).

import fs from 'node:fs'
import path from 'node:path'

const ROOTS = [
  path.resolve(process.cwd(), 'src'),
  path.resolve(process.cwd(), 'supabase', 'functions'),
]

const TOKEN_REGEX = /(ebay\.com|ebay\.co\.uk|item_web_url|_nkw|LH_Sold|LH_Complete|mkrid|mkevt)/i

// File suffixes we scan.
const EXTENSIONS = new Set(['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs'])

// Files that are allowed to mention eBay tokens. Anything OUTSIDE this
// list that contains a token is a regression.
const ALLOW = new Set([
  // Central engine + tests
  'src/lib/ebayAffiliate.ts',
  'src/lib/__tests__/ebayAffiliate.test.ts',
  'src/lib/__tests__/ebayAffiliate.engine.test.ts',
  'src/lib/__tests__/ebayAffiliate.placements.test.ts',

  // Block 2D — central marketplace registry: hostnames + per-marketplace
  // MKRIDs live here so the engine can compose URLs per marketplace.
  'src/lib/marketplaces.ts',
  'src/lib/__tests__/marketplaces.test.ts',
  'src/lib/__tests__/marketplaceResolver.test.ts',

  // Reusable component (uses the engine only)
  'src/components/affiliate/EbayAffiliateAction.tsx',

  // Components that re-export engine output via centralised helpers
  'src/components/EbayLiveListings.tsx',

  // The auth/affiliate analytics helper carries the AffiliateIntent type
  'src/lib/analytics.ts',

  // Vendor submission form: only token is a placeholder text in an <input>.
  'src/app/vendors/submit/VendorSubmitClient.tsx',

  // Edge function: server-side wrapping is staged for the next manual
  // deploy. Client-side wrapping covers production today.
  'supabase/functions/smart-endpoint/index.ts',

  // Comment-only mention of the legacy field name; the file uses
  // affiliateWrapEbayUrl from the central engine.
  'src/components/InlineChat.tsx',

  // Block 5A-W-33 — offline SEO/affiliate analyzer. References eBay
  // hostnames only in (1) a header comment explaining what the file
  // does and (2) test fixture strings used to verify the analyzer
  // handles the real export's landing-page format. Neither path
  // constructs or emits a real affiliate URL.
  'src/lib/seo-analysis/ebayAnalysis.ts',
  'src/lib/seo-analysis/__tests__/analyzers.test.ts',

  // Block 5A-W-43A — Potential eBay deals dashboard section reads the
  // daily_deals.item_web_url column and routes it through an
  // affiliate helper for the CTA. Same policy as InlineChat.tsx:
  // allowed to reference the raw column name because every user-
  // facing URL passes through an audited helper.
  'src/lib/dashboard/potentialDeals.ts',
  'src/lib/dashboard/__tests__/potentialDeals.test.ts',
  'src/components/dashboard/PotentialDealsSection.tsx',
  'src/components/dashboard/__tests__/PotentialDealsSection.test.tsx',

  // Block 5A-W-43B — Daily-deals CTA deep-link builder. Constructs
  // affiliate-wrapped /itm/<id> URLs using campaign IDs read from the
  // central marketplace registry (src/lib/marketplaces.ts). Does NOT
  // modify the W39 engine; it is a narrow, deal-specific consumer
  // that exists because the engine deliberately collapses /itm/
  // URLs into affiliate search results.
  'src/lib/dashboard/affiliateDealLink.ts',
  'src/lib/dashboard/__tests__/affiliateDealLink.test.ts',

  // Block 5A-W-58G — Deep Search + mover marketplace-routing tests.
  // Reference eBay hostnames only in URL-parse assertions on the
  // engine's output. No new URL construction outside the engine.
  'src/app/cards/search/__tests__/SearchResults.ebay.test.tsx',
  'src/components/__tests__/EbayInlineLink.marketplace.test.tsx',
])

function relative(p) {
  return path.relative(process.cwd(), p).split(path.sep).join('/')
}

function walk(dir, out = []) {
  let entries
  try { entries = fs.readdirSync(dir, { withFileTypes: true }) }
  catch { return out }
  for (const entry of entries) {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) {
      if (entry.name === 'node_modules' || entry.name === '.next' || entry.name === 'coverage') continue
      walk(full, out)
    } else if (EXTENSIONS.has(path.extname(entry.name))) {
      out.push(full)
    }
  }
  return out
}

const offenders = []
for (const root of ROOTS) {
  for (const file of walk(root)) {
    const rel = relative(file)
    if (ALLOW.has(rel)) continue
    const contents = fs.readFileSync(file, 'utf8')
    if (!TOKEN_REGEX.test(contents)) continue
    // Capture the matching lines with line numbers for the report.
    const lines = contents.split(/\r?\n/)
    const hits = []
    for (let i = 0; i < lines.length; i++) {
      if (TOKEN_REGEX.test(lines[i])) {
        hits.push({ line: i + 1, text: lines[i].trim().slice(0, 200) })
      }
    }
    offenders.push({ file: rel, hits })
  }
}

if (offenders.length === 0) {
  // eslint-disable-next-line no-console
  console.log('[audit-ebay-links] OK — no stray eBay URLs outside the central engine.')
  process.exit(0)
}

// eslint-disable-next-line no-console
console.error('[audit-ebay-links] regression: eBay tokens found outside the allow-list:')
for (const o of offenders) {
  // eslint-disable-next-line no-console
  console.error(`  ${o.file}`)
  for (const hit of o.hits) {
    // eslint-disable-next-line no-console
    console.error(`    L${hit.line}: ${hit.text}`)
  }
}
process.exit(1)
