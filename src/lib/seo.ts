// src/lib/seo.ts
// Central indexability policy for MTGPrices. One source of truth so
// the sitemap, per-route metadata and the automated SEO audit script
// agree on what should and should not be indexed.
//
// SITE_LAUNCHED gates the *global* index/follow default in
// src/app/layout.tsx. Private routes must remain noindex whether
// SITE_LAUNCHED is true or false. Never remove a per-route noindex
// override that's protecting private data.

export type IndexPolicy = 'INDEX' | 'NOINDEX' | 'AUTH' | 'API' | 'PARAM_VARIANT'

/** Static / templated route classification. Anchor patterns end with
 *  `*` to match any segment. */
export const ROUTE_POLICY: { pattern: RegExp; policy: IndexPolicy; note?: string }[] = [
  // Indexable public content.
  { pattern: /^\/$/,                             policy: 'INDEX', note: 'Homepage' },
  { pattern: /^\/browse$/,                       policy: 'INDEX', note: 'Sets directory' },
  { pattern: /^\/market$/,                       policy: 'INDEX', note: 'Market movers hub' },
  { pattern: /^\/formats$/,                      policy: 'INDEX', note: 'Formats index' },
  { pattern: /^\/formats\/[a-z0-9-]+$/,          policy: 'INDEX', note: 'Format detail' },
  { pattern: /^\/card-finder$/,                  policy: 'INDEX', note: 'Card finder tool page' },
  { pattern: /^\/ai$/,                           policy: 'INDEX', note: 'Ask AI landing' },
  { pattern: /^\/insights$/,                     policy: 'INDEX', note: 'Insights index' },
  { pattern: /^\/insights\/[a-z0-9-]+$/,         policy: 'INDEX', note: 'Insight article' },
  { pattern: /^\/set\/[a-z0-9]+$/,               policy: 'INDEX', note: 'Set detail' },
  { pattern: /^\/set\/[a-z0-9]+\/card\/[^\/]+$/, policy: 'INDEX', note: 'Card printing detail' },
  { pattern: /^\/contact$/,                      policy: 'INDEX', note: 'Contact' },
  { pattern: /^\/privacy$/,                      policy: 'INDEX', note: 'Privacy' },
  { pattern: /^\/terms$/,                        policy: 'INDEX', note: 'Terms' },

  // Parameter variants: page renders on GET but must NOT be indexed
  // because the parameter space is unbounded.
  { pattern: /^\/cards\/search$/,                policy: 'PARAM_VARIANT', note: 'Search results, canonical to itself, noindex' },

  // Public utility that doesn't warrant indexing (thin content, purely
  // a doorway to the deck-scoped test flow).
  { pattern: /^\/test-deck$/,                    policy: 'NOINDEX', note: 'Landing for deck-scoped Test Your Deck' },

  // Auth-gated / user-owned.
  { pattern: /^\/login$/,                        policy: 'AUTH' },
  { pattern: /^\/account$/,                      policy: 'AUTH' },
  { pattern: /^\/settings$/,                     policy: 'AUTH' },
  { pattern: /^\/collection(\/.*)?$/,            policy: 'AUTH' },
  { pattern: /^\/decks$/,                        policy: 'AUTH' },
  { pattern: /^\/decks\/new$/,                   policy: 'AUTH' },
  { pattern: /^\/decks\/[0-9a-f-]+$/,            policy: 'AUTH' },
  { pattern: /^\/decks\/[0-9a-f-]+\/test$/,      policy: 'AUTH' },
  // Public deck slugs are noindex today; navigate-only. See
  // src/app/decks/public/[slug]/page.tsx.
  { pattern: /^\/decks\/public\/[^\/]+$/,        policy: 'NOINDEX', note: 'Public deck (share) URLs deliberately noindex until we have unique editorial value' },

  // API endpoints and static assets are not HTML.
  { pattern: /^\/api\//,                         policy: 'API' },
  { pattern: /^\/auth\//,                        policy: 'API' },
  { pattern: /^\/sitemap.*\.xml$/,               policy: 'API' },
  { pattern: /^\/robots\.txt$/,                  policy: 'API' },
  { pattern: /^\/opengraph-image/,               policy: 'API' },
  { pattern: /^\/icon\.png$/,                    policy: 'API' },
  { pattern: /^\/apple-icon\.png$/,              policy: 'API' },
  { pattern: /^\/favicon\.png$/,                 policy: 'API' },
]

/** Convert a route path (no query, no origin) into its policy class. */
export function policyForPath(path: string): IndexPolicy {
  for (const entry of ROUTE_POLICY) {
    if (entry.pattern.test(path)) return entry.policy
  }
  return 'NOINDEX'
}

/** Public canonical origin. Never www, always https. */
export const SITE_ORIGIN = 'https://mtgprices.io'

/** Build an absolute canonical URL for an internal path. Strips
 *  query strings by default (this is what sitemap URLs should look
 *  like). Callers that want to allow specific query params should
 *  pass `keepQuery: true` and then set the correct alternates on the
 *  route metadata. */
export function canonicalFor(path: string, opts: { keepQuery?: boolean } = {}): string {
  const clean = opts.keepQuery ? path : path.split('?')[0]
  return `${SITE_ORIGIN}${clean}`
}

/** Suffix used by the site-wide title template
 *  (`title: { template: '%s · MTGPrices' }` in layout.tsx). Kept in
 *  sync here so the SEO audit can validate rendered titles. */
export const TITLE_BRAND_SUFFIX = ' · MTGPrices'

/** Predicate: is this path safe to include in a sitemap. */
export function isSitemapEligible(path: string): boolean {
  const p = policyForPath(path)
  return p === 'INDEX'
}
