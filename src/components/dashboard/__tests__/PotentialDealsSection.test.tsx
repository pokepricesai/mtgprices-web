// Block 5A-W-43A / 5A-W-43B — invariants for the dashboard's
// Potential eBay Deals section. Source-read tests pin the cautious
// copy, forbidden-language guards, deep-link CTA path, Pro gating,
// tabs + pagination structure, and empty-state handling.
//
// The component transitively imports @/lib/supabase which builds a
// browser client at module load time. Stub it before the top-level
// import so the vitest node env can evaluate the module.

import { describe, it, expect, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

vi.mock('@/lib/supabase', () => ({
  supabase: {
    from: () => ({
      select: () => ({
        eq: () => ({ then: (cb: any) => Promise.resolve({ data: [], error: null }).then(cb) }),
      }),
    }),
    rpc: () => Promise.resolve({ data: null, error: null }),
    auth: {
      getSession:        async () => ({ data: { session: null } }),
      onAuthStateChange: () => ({ data: { subscription: { unsubscribe: () => {} } } }),
    },
  },
  CHAT_ENDPOINT: 'https://stub.example.com/functions/v1/chat',
}))

import { marketplaceLabel, marketplaceMode, DEALS_PAGE_SIZE } from '../PotentialDealsSection'

const SRC = readFileSync(join(__dirname, '..', 'PotentialDealsSection.tsx'), 'utf8')

// ── Cautious copy ─────────────────────────────────────────────────

describe('PotentialDealsSection — cautious copy', () => {
  it('renders the required heading, sub-copy and disclaimer verbatim', () => {
    // W43G — heading stays; sub-copy + disclaimer were rewritten to
    // name currency as a thing the collector should check, and the
    // disclaimer stops implying "seen recently" (W43F wording).
    expect(SRC).toContain('Potential eBay deals')
    expect(SRC).toContain('Validated eBay listings from our latest market scan. Check condition, currency and seller before buying.')
    // W43E — small USD-reference note near the sub-copy.
    expect(SRC).toContain('Market reference shown in USD.')
    expect(SRC).toContain('Prices and availability can change quickly. Always check the listing on eBay before buying.')
    // Regression guards — must never claim the listing is definitely
    // still available or active, or that these are the best deals on
    // all of eBay. 'guaranteed' is already in the forbidden-word list
    // below; these are novel W43G guards.
    expect(SRC.toLowerCase()).not.toContain('still available')
    expect(SRC.toLowerCase()).not.toContain('currently active')
    expect(SRC.toLowerCase()).not.toContain('best deals on ebay')
    expect(SRC.toLowerCase()).not.toContain('cheapest on ebay')
    // W43G — the old W43C/W43F copy strings must not linger.
    expect(SRC).not.toContain('Listings 15–30% below recent market data.')
    expect(SRC).not.toContain('Listings were seen recently')
    expect(SRC).not.toContain('Listings are checked against recent eBay data')
  })

  it('labels the reference market value as USD explicitly (W43C/E)', () => {
    // The reference value column reads "Market ref: $X.XX USD" so
    // collectors don't confuse it with the native-currency listing price.
    expect(SRC).toContain('Market ref: ')
    expect(SRC).toContain(' USD')
  })

  it('labels the listing price with "Listed:" and the ISO currency code (W43E)', () => {
    expect(SRC).toContain('Listed: ')
    // Currency code (e.g. GBP / USD) appears after the formatted amount.
    expect(SRC).toContain('${deal.currency}')
  })

  it('shows the required empty-state copy for both tabs (W43G)', () => {
    // W43G — "deals" language is retained on the Watchlist tab where
    // it still describes the tab, but the primary (validated) tab
    // uses "validated listings".
    expect(SRC).toContain('No validated listings on your watchlist right now.')
    expect(SRC).toContain('No validated listings found right now.')
    // The old "Best deals" empty-state strings must be gone.
    expect(SRC).not.toContain('No watchlist deals found today.')
    expect(SRC).not.toContain('No best deals found today.')
    expect(SRC).not.toContain('No potential deals found today.')
  })

  it('CTA label is "Check listing on eBay"', () => {
    expect(SRC).toContain('Check listing on eBay')
  })

  it('never uses forbidden marketing language', () => {
    for (const banned of [
      'guaranteed', 'guarantee',
      'profit',
      'easy money',
      'sure thing', 'sure-thing',
      'to flip', 'quick flip', 'flip for',
      'arbitrage',
    ]) {
      expect(SRC.toLowerCase()).not.toContain(banned)
    }
  })
})

// ── W44A — anchor id for dashboard hub tile hash-link ─────────────

describe('PotentialDealsSection — W44A anchor id', () => {
  it('carries id="potential-deals" on the outer section (both Pro and free branches)', () => {
    // W44A — the dashboard hub's Validated listings tile hash-links
    // to #potential-deals. Both the Pro-authenticated section render
    // AND the LockedForFree render must expose the anchor so the
    // scroll target exists regardless of plan.
    const matches = SRC.match(/<section[^>]*id="potential-deals"/g) || []
    expect(matches.length).toBeGreaterThanOrEqual(2)
  })
})

// ── W43G — tab rename + display safety ────────────────────────────

describe('PotentialDealsSection — W43G tab rename + display safety', () => {
  it('renames the "Best deals" tab to "Validated listings"', () => {
    expect(SRC).toContain('label="Validated listings"')
    // The old label must be gone from any user-visible TabButton.
    expect(SRC).not.toContain('label="Best deals"')
  })

  it('cross-tab CTAs use the new "validated listings" wording', () => {
    expect(SRC).toContain('View validated listings →')
    // The old CTA copy must not survive.
    expect(SRC).not.toContain('View Best deals →')
  })

  it('imports the W43G safety helpers from potentialDeals', () => {
    expect(SRC).toContain('toUsdCents')
    expect(SRC).toContain('isDiscountCoherent')
  })

  it('gates the green discount chip on isDiscountCoherent (UI safety net)', () => {
    // The chip render must be guarded by the coherence check so a
    // future data drift can never surface an unverified "X% below"
    // badge.
    expect(SRC).toContain('const chipSafe = isDiscountCoherent(')
    expect(SRC).toMatch(/typeof deal\.discount_pct === 'number' && chipSafe/)
  })

  it('shows an approximate USD conversion under GBP listing prices', () => {
    // For a GBP row, the price column shows "Approx $X.XX USD" so the
    // collector can eyeball the deal claim against the USD market ref.
    expect(SRC).toContain("deal.currency === 'GBP' ? toUsdCents(deal.total_cost_cents, 'GBP')")
    expect(SRC).toContain('Approx ')
  })
})

// ── Deep-link affiliate wrapping ───────────────────────────────────

describe('PotentialDealsSection — deep-link affiliate CTA', () => {
  it('imports buildDealDeepLink (not affiliateWrapEbayUrl) for the row CTA', () => {
    expect(SRC).toContain("import { buildDealDeepLink } from '@/lib/dashboard/affiliateDealLink'")
    expect(SRC).toContain('buildDealDeepLink({')
    // Regression guard against slipping back to the search-collapse
    // helper that was breaking the "most links do not work" report.
    expect(SRC).not.toContain('affiliateWrapEbayUrl')
  })

  it('passes ebay_item_id + item_web_url + marketplaceHint + customId through to the deep-link builder', () => {
    expect(SRC).toContain('itemWebUrl:      deal.item_web_url')
    expect(SRC).toContain('ebayItemId:      deal.ebay_item_id')
    // W43C — marketplaceHint enforces UK URL ↔ UK campaign / US URL ↔
    // US campaign at the CTA layer. Loader also drops mismatches.
    expect(SRC).toContain('marketplaceHint: deal.marketplace')
    // W58G — the customId is now extracted into a shared const so
    // analytics events + the deep-link URL carry the SAME token.
    // Assert both the const value and that the deep-link builder
    // still receives it.
    expect(SRC).toMatch(/`pp:dashboard-deals:\$\{marketplaceMode\(deal\.marketplace\) \?\? 'uk'\}:\$\{deal\.card_slug \?\? '_'\}`/)
    expect(SRC).toContain('customId:        affiliateCustomId')
  })

  it('never assigns deal.item_web_url directly to an href', () => {
    expect(SRC).not.toMatch(/href=\{deal\.item_web_url\}/)
    expect(SRC).not.toMatch(/href=\{`\$\{deal\.item_web_url\}/)
  })

  it('fails closed when the deep-link builder returns null (renders "eBay listing" instead)', () => {
    expect(SRC).toMatch(/affiliateUrl \? \(/)
    expect(SRC).toContain('eBay listing')
  })

  it('external anchors carry safe rel + target attributes', () => {
    expect(SRC).toContain('target="_blank"')
    expect(SRC).toContain('rel="noopener sponsored nofollow"')
  })
})

// ── Pro gating ────────────────────────────────────────────────────

describe('PotentialDealsSection — Pro gating', () => {
  it('reads the user plan via useUserPlan and blocks free users', () => {
    expect(SRC).toContain("import { useUserPlan } from '@/lib/account/useUserPlan'")
    expect(SRC).toContain('const { plan, loading: planLoading } = useUserPlan(userId ?? null)')
    // The plan-loading branch renders a skeleton, and only the "pro"
    // branch continues to the main render.
    expect(SRC).toMatch(/if \(planLoading\)/)
    expect(SRC).toMatch(/if \(plan !== 'pro'\)/)
  })

  it('renders a LockedForFree card with the required upgrade copy + CTA for free users', () => {
    expect(SRC).toContain('Pro members can view potential eBay listings priced below recent market data.')
    expect(SRC).toContain('Upgrade to Pro')
    expect(SRC).toContain('href="/dashboard/settings"')
  })

  it('does not fetch or render deal rows when the user is not Pro', () => {
    // The Watchlist / Best data fetches are inside effects gated on
    // `plan === 'pro'`. Pin that guard so a future refactor cannot
    // start firing daily_deals reads for free users.
    expect(SRC).toContain("if (plan !== 'pro' || !userId)")
  })
})

// ── Block 5A-W-43E — LIVE ROWS RE-ENABLED ─────────────────────────
//
// The W43D "coming soon" gate is removed. Pro users see live deals
// again, now backed by the two-step loader that joins daily_deals
// candidates against fresh ebay_listings rows (see potentialDeals.ts).

describe('PotentialDealsSection — W43E live rows re-enabled', () => {
  it('does not carry the W43D SHOW_LIVE_DEALS gate anywhere in the source', () => {
    expect(SRC).not.toContain('SHOW_LIVE_DEALS')
  })

  it('does not carry the W43D ComingSoonForPro component anywhere in the source', () => {
    expect(SRC).not.toContain('ComingSoonForPro')
    expect(SRC).not.toContain('Manage Pro settings')
  })

  it('Pro branch calls loadPotentialDeals inside the data effect (not gated on any coming-soon flag)', () => {
    // The effect that fetches deals must fire on tab/watchlist changes
    // without an extra gate.
    expect(SRC).toContain('loadPotentialDeals(supabase, { limit: DEALS_MAX_FETCH, cardSlugFilter: filter })')
  })
})

// ── Tabs + pagination ─────────────────────────────────────────────

describe('PotentialDealsSection — tabs + pagination', () => {
  it('renders Watchlist deals + Validated listings tabs (W43G)', () => {
    expect(SRC).toContain('label="Watchlist deals"')
    // W43G — renamed from "Best deals". See the tab-rename describe
    // block above for the corresponding regression guard.
    expect(SRC).toContain('label="Validated listings"')
    expect(SRC).toContain('role="tablist"')
  })

  it('defaults to Watchlist when the user has watched cards, Best otherwise', () => {
    expect(SRC).toContain("setTab(slugs.length > 0 ? 'watchlist' : 'best')")
  })

  it('resets pagination to page 1 whenever the tab or watchlist set changes', () => {
    // The load effect explicitly setPage(1) each time it fires.
    expect(SRC).toContain('setPage(1)')
    // And the load effect is keyed on tab + watchlistSlugs (W43D
    // additionally threads SHOW_LIVE_DEALS through the dep array).
    expect(SRC).toMatch(/\[tab, watchlistSlugs(?:, SHOW_LIVE_DEALS)?\]/)
  })

  it('threads the watchlist card_slugs filter into loadPotentialDeals for the Watchlist tab', () => {
    // Line-ending agnostic (Windows checkouts land as CRLF): regex
    // that tolerates \r?\n rather than a literal \n multi-line string.
    expect(SRC).toMatch(/import\s*\{\s*\r?\n\s*loadPotentialDeals,\s*\r?\n\s*loadWatchlistSlugs,/)
    expect(SRC).toContain("tab === 'watchlist' ? watchlistSlugs : null")
    expect(SRC).toContain('cardSlugFilter: filter')
  })

  it('paginates client-side with a fixed page size', () => {
    // Page size constant is exported (see the DEALS_PAGE_SIZE import
    // below) and used by both the slice and the totalPages calc.
    expect(SRC).toContain('export const DEALS_PAGE_SIZE = 5')
    expect(SRC).toContain('deals.length / DEALS_PAGE_SIZE')
    expect(SRC).toContain('deals.slice(pageStart, pageStart + DEALS_PAGE_SIZE)')
  })

  it('hides the pager when there is only one page', () => {
    expect(SRC).toContain('const showPager = totalPages > 1')
    expect(SRC).toMatch(/\{showPager && \(/)
  })

  it('clamps the current page against a shrinking result set (safePage math)', () => {
    expect(SRC).toContain('const safePage = Math.min(page, totalPages)')
    expect(SRC).toMatch(/setPage\(p => Math\.max\(1, p - 1\)\)/)
    expect(SRC).toMatch(/setPage\(p => Math\.min\(totalPages, p \+ 1\)\)/)
  })

  it('caps the DB fetch at DEALS_MAX_FETCH to keep the round trip cheap', () => {
    expect(SRC).toContain('DEALS_MAX_FETCH = 30')
    expect(SRC).toContain('limit: DEALS_MAX_FETCH')
  })
})

// ── Empty state cross-tab links ───────────────────────────────────

describe('PotentialDealsSection — empty-state cross-tab affordance', () => {
  it('offers a link to Validated listings when Watchlist deals is empty (W43G)', () => {
    // W43G — was "View Best deals →".
    expect(SRC).toContain('View validated listings →')
  })

  it('offers a link to Watchlist deals when the validated tab is empty AND the user has a watchlist', () => {
    expect(SRC).toContain('View Watchlist deals →')
    expect(SRC).toContain('hasWatchlist')
  })
})

// ── Block 5A-W-58G — affiliate analytics parity ───────────────────

describe('PotentialDealsSection — W58G affiliate analytics', () => {
  it('imports the standard trackEvent helper', () => {
    expect(SRC).toContain("import { trackEvent } from '@/lib/analytics'")
  })

  it('fires affiliate_link_view when a row scrolls into view (per-row IO)', () => {
    expect(SRC).toContain("trackEvent('affiliate_link_view'")
    expect(SRC).toContain('IntersectionObserver')
    // The IO is attached to the <li> row so it only fires when the
    // deal is actually visible — not on load for every row.
    expect(SRC).toContain('<li ref={rowRef}')
  })

  it('fires affiliate_click on the CTA anchor', () => {
    expect(SRC).toContain("trackEvent('affiliate_click'")
    expect(SRC).toContain('onClick={onCtaClick}')
  })

  it('carries placement="dashboard_deals_row" and intent="exact_listing" on both events', () => {
    expect(SRC).toContain("placement:          'dashboard_deals_row'")
    expect(SRC).toContain("intent:             'exact_listing'")
  })

  it('derives marketplace from deal.marketplace (EBAY_GB → UK, EBAY_US → US)', () => {
    // Both events pass the derived marketplace so the funnel can
    // segment UK vs US clicks.
    expect(SRC).toContain('analyticsMarketplace')
    expect(SRC).toContain("marketplaceMode(deal.marketplace) === 'uk' ? 'UK'")
    expect(SRC).toContain("marketplaceMode(deal.marketplace) === 'us' ? 'US'")
  })

  it('uses the same custom tracking id on the events as on the deep-link', () => {
    // Regression guard — the events and the URL must carry the SAME
    // pp:dashboard-deals:… string, otherwise EPN reports and
    // affiliate_click cannot be joined.
    expect(SRC).toContain('const affiliateCustomId')
    // Deep-link builder receives the same const.
    expect(SRC).toContain('customId:        affiliateCustomId')
    // Analytics events reference the same const.
    expect(SRC).toContain('custom_tracking_id: affiliateCustomId')
  })
})

// ── Utility helpers ───────────────────────────────────────────────

describe('PotentialDealsSection — utility helpers', () => {
  it('exports DEALS_PAGE_SIZE = 5', () => {
    expect(DEALS_PAGE_SIZE).toBe(5)
  })

  it('maps eBay marketplace codes to collector-facing labels (W43C)', () => {
    expect(marketplaceLabel('EBAY_GB')).toBe('eBay UK')
    expect(marketplaceLabel('EBAY_US')).toBe('eBay US')
    expect(marketplaceLabel('unknown')).toBe('eBay')
    expect(marketplaceLabel(null)).toBe('eBay')
  })

  it('maps eBay marketplace codes to the ebayAffiliate marketplace type', () => {
    expect(marketplaceMode('EBAY_GB')).toBe('uk')
    expect(marketplaceMode('EBAY_US')).toBe('us')
    expect(marketplaceMode('unknown')).toBe(null)
  })
})
