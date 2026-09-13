// Block 5A-W-32 — SEO surface invariants.
//
// Pin the rules that should hold across the site so a future change
// can't silently expose `/admin`, `/dashboard`, `/intel`, or a
// submit-form URL to search engines.
//
// All tests run the actual route handlers / read the actual exported
// metadata — no mocks of the underlying surface — so a regression
// shows up here before it ships.

import { describe, it, expect, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

// These metadata tests dynamically import page modules whose default
// exports transitively pull in the supabase browser client and
// server-only helpers. The metadata exports themselves are
// independent — stub the troublesome modules so the import resolves.
vi.mock('server-only', () => ({}))
vi.mock('@/lib/supabase', () => ({
  supabase:        { auth: { getSession: async () => ({ data: { session: null } }) } },
  CHAT_ENDPOINT:   'https://stub.example.com/functions/v1/chat',
}))
vi.mock('@supabase/supabase-js', () => ({
  createClient: () => ({
    from: () => ({
      select: () => ({ eq: () => ({ eq: () => ({ single: async () => ({ data: null, error: null }) }) }) }),
    }),
  }),
}))
vi.mock('@/lib/recentSales/flags', () => ({
  isAdminViewEnabled: () => false,
}))

describe('robots.ts — global crawl rules', () => {
  it('blocks the known private surfaces', async () => {
    const robotsMod = await import('@/app/robots')
    const result = robotsMod.default()
    expect(result.rules).toBeDefined()
    const rules = Array.isArray(result.rules) ? result.rules[0]! : result.rules!
    expect(rules.userAgent).toBe('*')
    expect(rules.allow).toBe('/')
    const disallow = Array.isArray(rules.disallow) ? rules.disallow : [rules.disallow!]
    for (const prefix of ['/admin', '/intel', '/api', '/scan-test', '/dashboard']) {
      expect(disallow).toContain(prefix)
    }
  })

  it('points at the canonical sitemap', async () => {
    const robotsMod = await import('@/app/robots')
    const result = robotsMod.default()
    expect(result.sitemap).toBe('https://www.pokeprices.io/sitemap.xml')
  })

  it('does not block public surfaces by accident', async () => {
    const robotsMod = await import('@/app/robots')
    const result = robotsMod.default()
    const rules = Array.isArray(result.rules) ? result.rules[0]! : result.rules!
    const disallow = Array.isArray(rules.disallow) ? rules.disallow : [rules.disallow!]
    // These public surfaces have been disallowed in the past and were
    // explicitly REMOVED — pin the removal.
    for (const surface of ['/dealer', '/portfolio', '/insights', '/tools', '/pokemon', '/set', '/vendors', '/creators', '/card-shows']) {
      expect(disallow).not.toContain(surface)
    }
  })
})

describe('sitemap-pages.xml — included routes', () => {
  it('includes the canonical public hubs', async () => {
    const mod = await import('@/app/sitemap-pages.xml/route')
    const res = await mod.GET()
    const xml = await res.text()
    for (const path of [
      'https://www.pokeprices.io</loc>',           // home (no trailing slash, no path)
      '/browse</loc>',
      '/pokemon</loc>',
      '/insights</loc>',
      '/tools</loc>',
      '/vendors</loc>',
      '/creators</loc>',
      '/card-shows</loc>',
      '/dealer</loc>',
      '/roadmap</loc>',
    ]) {
      expect(xml).toContain(path)
    }
  })

  it('declares the XML content-type', async () => {
    const mod = await import('@/app/sitemap-pages.xml/route')
    const res = await mod.GET()
    expect(res.headers.get('content-type')).toMatch(/xml/)
  })
})

describe('sitemap-pages.xml — excluded routes', () => {
  it('does NOT include private surfaces (dashboard / admin / intel / api / scan-test / auth)', async () => {
    const mod = await import('@/app/sitemap-pages.xml/route')
    const res = await mod.GET()
    const xml = await res.text()
    // Match `/<segment>` inside <loc> tags so we catch any accidental
    // sub-URL too. Robots.txt blocks these but they also must not be
    // advertised in the sitemap — sitemap inclusion of a robots-blocked
    // URL is itself a soft-quality signal Google flags.
    for (const segment of [
      '/dashboard',
      '/admin',
      '/intel',
      '/api/',
      '/scan-test',
      '/auth/',
    ]) {
      expect(xml).not.toContain(segment)
    }
  })

  it('does NOT advertise submit forms', async () => {
    const mod = await import('@/app/sitemap-pages.xml/route')
    const res = await mod.GET()
    const xml = await res.text()
    expect(xml).not.toContain('/vendors/submit')
    expect(xml).not.toContain('/creators/submit')
  })
})

describe('sitemap.xml index — children', () => {
  it('lists every expected sub-sitemap', async () => {
    const mod = await import('@/app/sitemap.xml/route')
    const res = await mod.GET()
    const xml = await res.text()
    for (const child of [
      'sitemap-pages.xml',
      'sitemap-sets.xml',
      'sitemap-pokemon.xml',
      'sitemap-cards-1.xml',
      'sitemap-cards-2.xml',
      'sitemap-cards-3.xml',
      'sitemap-cards-4.xml',
      'sitemap-insights.xml',
    ]) {
      expect(xml).toContain(`https://www.pokeprices.io/${child}`)
    }
  })

  it('uses the <sitemapindex> root element (not <urlset>)', async () => {
    const mod = await import('@/app/sitemap.xml/route')
    const res = await mod.GET()
    const xml = await res.text()
    expect(xml).toContain('<sitemapindex')
    expect(xml).not.toContain('<urlset')
  })
})

describe('noindex coverage — private + submit pages', () => {
  it('vendors/submit is noindex with self-referencing canonical', async () => {
    const mod = await import('@/app/vendors/submit/page')
    const m = mod.metadata
    expect(m).toBeDefined()
    expect(m.robots).toEqual({ index: false, follow: false })
    expect(m.alternates?.canonical).toBe('https://www.pokeprices.io/vendors/submit')
  })

  it('creators/submit layout is noindex with self-referencing canonical', async () => {
    const mod = await import('@/app/creators/submit/layout')
    const m = mod.metadata
    expect(m).toBeDefined()
    expect(m.robots).toEqual({ index: false, follow: false })
    expect(m.alternates?.canonical).toBe('https://www.pokeprices.io/creators/submit')
  })

  it('intel/login layout is noindex', async () => {
    const mod = await import('@/app/intel/login/layout')
    const m = mod.metadata
    expect(m).toBeDefined()
    expect(m.robots).toEqual({ index: false, follow: false })
  })

  it('dashboard layout is noindex', async () => {
    const mod = await import('@/app/dashboard/layout')
    const m = mod.metadata
    expect(m.robots).toEqual({ index: false, follow: false })
  })

  it('admin/content-studio is noindex', async () => {
    const mod = await import('@/app/admin/content-studio/page')
    const m = mod.metadata
    expect(m.robots).toEqual({ index: false, follow: false })
  })

  it('admin/newsletter-studio is noindex', async () => {
    const mod = await import('@/app/admin/newsletter-studio/page')
    const m = mod.metadata
    expect(m.robots).toEqual({ index: false, follow: false })
  })

  it('admin/recent-sales is noindex', async () => {
    const mod = await import('@/app/admin/recent-sales/page')
    const m = mod.metadata
    expect(m.robots).toEqual({ index: false, follow: false })
  })

  it('auth/reset-password is noindex', async () => {
    const mod = await import('@/app/auth/reset-password/page')
    const m = mod.metadata
    expect(m.robots).toEqual({ index: false, follow: false })
  })

  it('scan-test is noindex', async () => {
    const mod = await import('@/app/scan-test/page')
    const m = mod.metadata
    // scan-test additionally sets googleBot: false
    const robots = m.robots as { index?: boolean; follow?: boolean }
    expect(robots.index).toBe(false)
    expect(robots.follow).toBe(false)
  })
})

describe('root layout — locale / hreflang policy', () => {
  // Block 5A-W-32 — site currently serves one English URL for both
  // UK and US users. Hreflang `alternates.languages` and OG
  // `alternateLocale` were considered and rejected: both make claims
  // about distinct regional/language variants we don't actually host.
  // These tests pin the conservative state so a future change can't
  // silently re-introduce those signals without a deliberate review.
  it('keeps a single en_GB OG locale (no alternateLocale)', async () => {
    const mod = await import('@/app/layout')
    const og = mod.metadata.openGraph as { locale?: string; alternateLocale?: string | string[] }
    expect(og.locale).toBe('en_GB')
    expect(og.alternateLocale).toBeUndefined()
  })

  it('does NOT declare hreflang alternates.languages on the root layout', async () => {
    const mod = await import('@/app/layout')
    const alts = (mod.metadata.alternates ?? null) as { canonical?: string; languages?: Record<string, string> } | null
    if (alts) {
      expect(alts.languages).toBeUndefined()
    }
  })

  it('does NOT declare hreflang alternates.languages on the home page', async () => {
    const mod = await import('@/app/page')
    const alts = mod.metadata.alternates as { canonical?: string; languages?: Record<string, string> }
    expect(alts.canonical).toBe('https://www.pokeprices.io')
    expect(alts.languages).toBeUndefined()
  })
})

describe('root layout — affiliate network ownership verification', () => {
  // Impact requires the ownership meta tag with value="…" instead of
  // the standard content="…" attribute. The tag is rendered as raw JSX
  // inside <head> rather than via Next's Metadata API (which emits
  // content=). Source-read so a refactor cannot silently drop the tag
  // or convert value= → content=.
  const SRC = readFileSync(join(__dirname, '..', 'layout.tsx'), 'utf8')

  it('carries the Impact site-verification meta tag with the exact value', () => {
    expect(SRC).toContain("name:  'impact-site-verification'")
    expect(SRC).toContain("value: 'c311cc8d-61a2-4ec7-97ac-fa7394d477bb'")
  })

  it('renders the Impact verification tag inside the <head>, not the body', () => {
    const head = SRC.match(/<head>[\s\S]*?<\/head>/)
    expect(head).not.toBeNull()
    expect(head![0]).toContain('impact-site-verification')
  })
})
