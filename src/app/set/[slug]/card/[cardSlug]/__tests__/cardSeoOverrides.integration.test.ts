// Block 5A-W-58H — integration tests for the generateMetadata swap
// and the seoIntroSlot server-render.
//
// Boots the actual route with a stubbed Supabase RPC client so we
// can pin end-to-end behaviour:
//
//   * Every one of the ten hand-picked slugs → block-brief title +
//     description; openGraph/twitter inherit those (single SEO
//     surface, not two).
//   * A non-overridden slug → falls through to the existing
//     generated shape.
//   * Canonical unchanged.
//   * Robots gate is untouched by the override.
//   * seoIntroSlot fires ONLY on override pages, contains the exact
//     override.intro text, and never leaks a hardcoded price.
//   * Control card renders NO seoIntroSlot.
//   * Override does NOT apply on the RPC-error safe-fallback branch.

import { describe, it, expect, vi, beforeEach } from 'vitest'

// The route creates a supabase client at module import time. Stub
// @supabase/supabase-js before the top-level import so the module
// evaluates cleanly in the vitest node env, and drive a per-test RPC
// stub via `setRpc()` below.
type RpcArgs = { p_set_name: string; p_card_url_slug: string }
type RpcHandler = (args: RpcArgs) => { data: unknown; error: unknown }
let rpcHandler: RpcHandler = () => ({ data: null, error: null })
function setRpc(h: RpcHandler) { rpcHandler = h }

vi.mock('@supabase/supabase-js', () => ({
  createClient: () => ({
    rpc: async (_name: string, args: RpcArgs) => rpcHandler(args),
  }),
}))
// React's `cache` primitive is only defined inside an RSC render.
// In vitest node the import lands as undefined, so page.tsx errors at
// module load. Mock it as a passthrough.
vi.mock('react', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react')>()
  return { ...actual, cache: <T,>(fn: T) => fn }
})
vi.mock('@/lib/supabase', () => ({
  supabase:      { auth: { getSession: async () => ({ data: { session: null } }) } },
  CHAT_ENDPOINT: 'https://stub.example.com/functions/v1/chat',
}))
vi.mock('server-only', () => ({}))
// Card page's default handler pulls recent sales in and structures
// the JSX with CardPageClient. For metadata-only tests we still
// import via the page module, but the default export runs when we
// call the page handler for intro-slot tests. Neuter the recent-
// sales loader so tests do not need a real DB.
vi.mock('@/lib/recentSales/cardQueries', () => ({
  loadRecentSalesGroupedForCardIfEnabled: async () => ({ groups: [], total: 0 }),
}))

import { generateMetadata } from '../page'
import CardPageDefault from '../page'
import { _internalOverrideMap } from '@/lib/seo/cardSeoOverrides'
import { renderToStaticMarkup } from 'react-dom/server'
import { isValidElement, Children, type ReactElement, type ReactNode } from 'react'

type Meta = Awaited<ReturnType<typeof generateMetadata>>

function params(slug: string, cardSlug: string) {
  return { params: Promise.resolve({ slug, cardSlug }) }
}

function cardRow(over: Partial<Record<string, unknown>> = {}): Record<string, unknown> {
  return {
    card_slug:           '999999',
    card_url_slug:       'test-card-1',
    card_name:           'Test Card #1',
    set_name:            'Test Set',
    card_number:         '1',
    card_number_display: '1/100',
    set_printed_total:   100,
    image_url:           'https://example.com/x.png',
    raw_usd:             1000,
    psa9_usd:            2500,
    psa10_usd:           7500,
    is_sealed:           false,
    language:            'en',
    ...over,
  }
}

beforeEach(() => {
  rpcHandler = () => ({ data: null, error: null })
})

// ── Every override applies exactly ────────────────────────────────

describe('generateMetadata — all ten hand-picked overrides apply exactly', () => {
  for (const [slug, entry] of Object.entries(_internalOverrideMap())) {
    it(`${slug} (${entry.setName}) → block-brief title + description`, async () => {
      setRpc(() => ({
        data: cardRow({
          card_url_slug: slug,
          set_name:      entry.setName,
          card_name:     `${slug} #1`,
        }),
        error: null,
      }))
      const meta = await generateMetadata(params(entry.setName, slug)) as Meta
      expect(meta.title).toBe(entry.title)
      expect(meta.description).toBe(entry.description)
      const og = meta.openGraph as { title?: string; description?: string; url?: string }
      const tw = meta.twitter   as { title?: string; description?: string }
      expect(og.title).toBe(entry.title)
      expect(og.description).toBe(entry.description)
      expect(tw.title).toBe(entry.title)
      expect(tw.description).toBe(entry.description)
    })
  }
})

// ── Non-overridden card falls through cleanly ─────────────────────

describe('generateMetadata — non-overridden slug keeps the generated shape', () => {
  it('a random slug produces the year + brand generated title, not an override', async () => {
    setRpc(() => ({
      data: cardRow({
        card_url_slug: 'totally-not-in-override-map-abc123',
        set_name:      'Base Set',
        card_name:     'Nidoking #34',
        card_number:   '34',
        raw_usd:       2500,
        psa9_usd:      6000,
        psa10_usd:     15000,
      }),
      error: null,
    }))
    const meta = await generateMetadata(params('Base Set', 'totally-not-in-override-map-abc123')) as Meta
    const year = String(new Date().getFullYear())
    expect(typeof meta.title).toBe('string')
    expect(meta.title as string).toContain(year)
    for (const entry of Object.values(_internalOverrideMap())) {
      expect(meta.title).not.toBe(entry.title)
      expect(meta.description).not.toBe(entry.description)
    }
    expect(meta.description as string).toContain('Nidoking')
  })
})

// ── Canonical / robots / OG image untouched by override ───────────

describe('generateMetadata — override touches ONLY title + description', () => {
  it('canonical URL matches the pre-58H shape', async () => {
    setRpc(() => ({
      data: cardRow({
        card_url_slug: 'umbreon-vmax-215',
        set_name:      'Evolving Skies',
      }),
      error: null,
    }))
    const override = await generateMetadata(params('Evolving Skies', 'umbreon-vmax-215')) as Meta
    setRpc(() => ({
      data: cardRow({
        card_url_slug: 'not-in-map-xyz',
        set_name:      'Evolving Skies',
      }),
      error: null,
    }))
    const control  = await generateMetadata(params('Evolving Skies', 'not-in-map-xyz'))  as Meta
    expect((override.alternates as { canonical?: string }).canonical)
      .toBe('https://www.pokeprices.io/set/Evolving Skies/card/umbreon-vmax-215')
    expect((control.alternates  as { canonical?: string }).canonical)
      .toBe('https://www.pokeprices.io/set/Evolving Skies/card/not-in-map-xyz')
  })

  it('robots gate is unchanged: card with prices stays indexable (robots undefined)', async () => {
    setRpc(() => ({
      data: cardRow({
        card_url_slug: 'lugia-v-186',
        set_name:      'Silver Tempest',
      }),
      error: null,
    }))
    const meta = await generateMetadata(params('Silver Tempest', 'lugia-v-186')) as Meta
    expect(meta.robots).toBeUndefined()
  })

  it('OG image still comes from card.image_url — override does not touch it', async () => {
    setRpc(() => ({
      data: cardRow({
        card_url_slug: 'lugia-v-186',
        set_name:      'Silver Tempest',
        image_url:     'https://example.com/lugia.png',
      }),
      error: null,
    }))
    const meta = await generateMetadata(params('Silver Tempest', 'lugia-v-186')) as Meta
    const og = meta.openGraph as { images?: Array<{ url: string }> }
    expect(og.images?.[0]?.url).toBe('https://example.com/lugia.png')
  })
})

// ── Cross-set guard ───────────────────────────────────────────────

describe('generateMetadata — override does not cross set boundaries', () => {
  it('same override slug under a different set → falls through to the generated title', async () => {
    setRpc(() => ({
      data: cardRow({
        card_url_slug: 'lugia-v-186',
        set_name:      'Some Other Set',
        card_name:     'Impostor #1',
        raw_usd:       500,
        psa9_usd:      1000,
        psa10_usd:     3000,
      }),
      error: null,
    }))
    const meta = await generateMetadata(params('Some Other Set', 'lugia-v-186')) as Meta
    expect(meta.title).not.toBe(_internalOverrideMap()['lugia-v-186'].title)
    const year = String(new Date().getFullYear())
    expect(meta.title as string).toContain(year)
  })
})

// ── Error branch is not silently overridden ──────────────────────

describe('generateMetadata — override does NOT apply on the error branch', () => {
  it('RPC error keeps the SAFE FALLBACK title, ignoring the override map', async () => {
    setRpc(() => ({ data: null, error: { message: 'boom' } }))
    const meta = await generateMetadata(params('Evolving Skies', 'umbreon-vmax-215')) as Meta
    expect(meta.title).toBe('Pokémon Card Price Guide — PokePrices')
    expect(meta.description).toBe('Track raw, PSA 9 and PSA 10 Pokémon card prices, grading data and recent sales.')
    expect(meta.robots).toEqual({ index: false, follow: true })
  })
})

// ── seoIntroSlot — server-rendered on override pages only ────────

// CardPageClient calls useRouter/usePathname at mount, so we cannot
// SSR it in the vitest node env without staging a full Next request
// context. Instead we inspect the JSX tree returned by the server
// page handler: find the CardPageClient element and read its
// `seoIntroSlot` prop. The prop's presence/absence and its rendered
// HTML give us everything the block brief asks to verify.

type SlotProbe = { seoIntroSlot: ReactNode }

function findCardPageClientProps(root: ReactNode): SlotProbe | null {
  if (!root) return null
  if (Array.isArray(root)) {
    for (const child of root) {
      const hit = findCardPageClientProps(child)
      if (hit) return hit
    }
    return null
  }
  if (!isValidElement(root)) return null
  const el = root as ReactElement
  // Match by the prop shape used by CardPageClient. Every other
  // component in the returned tree uses different prop names, so
  // "has seoIntroSlot in its props" uniquely identifies our target.
  const props = el.props as Record<string, unknown>
  if ('seoIntroSlot' in props) {
    return { seoIntroSlot: props.seoIntroSlot as ReactNode }
  }
  return findCardPageClientProps(el.props.children as ReactNode)
}

function slotHtml(node: ReactNode): string {
  if (node == null || node === false) return ''
  return renderToStaticMarkup(node as ReactElement)
}

// renderToStaticMarkup HTML-encodes apostrophes as &#x27;, quotes as
// &quot; etc. Decode the small entity set that our intro strings can
// contain so `toContain` assertions can match the raw source text.
function decodeEntities(html: string): string {
  return html
    .replace(/&#x27;/g, "'")
    .replace(/&#39;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
}

describe('CardPage — seoIntroSlot server-render', () => {
  it('override page passes the exact intro string in the seoIntroSlot prop', async () => {
    setRpc(() => ({
      data: cardRow({
        card_url_slug: 'greninja-gold-star-swsh144',
        set_name:      'Celebrations',
        card_name:     'Greninja [Gold Star] #SWSH144',
      }),
      error: null,
    }))
    const tree = await CardPageDefault(params('Celebrations', 'greninja-gold-star-swsh144'))
    const probe = findCardPageClientProps(tree as ReactNode)
    expect(probe, 'CardPageClient not found in returned tree').not.toBeNull()
    expect(probe!.seoIntroSlot, 'expected non-null intro slot on override page').not.toBeNull()
    const html = decodeEntities(slotHtml(probe!.seoIntroSlot))
    const expected = _internalOverrideMap()['greninja-gold-star-swsh144'].intro!
    expect(html).toContain(expected)
    // Emitted through the identifiable slot marker.
    expect(html).toContain('data-testid="card-seo-intro"')
    // Slot never contains a price token or a year (regression guard).
    expect(html, 'intro must not contain $').not.toMatch(/\$\s*\d/)
    expect(html, 'intro must not contain £').not.toMatch(/£\s*\d/)
    expect(html, 'intro must not contain a year').not.toMatch(/\b(19|20)\d{2}\b/)
  })

  it('every override slug produces a non-empty intro slot with its own intro text', async () => {
    for (const [slug, entry] of Object.entries(_internalOverrideMap())) {
      setRpc(() => ({
        data: cardRow({
          card_url_slug: slug,
          set_name:      entry.setName,
        }),
        error: null,
      }))
      const tree  = await CardPageDefault(params(entry.setName, slug))
      const probe = findCardPageClientProps(tree as ReactNode)
      expect(probe, `${slug}: CardPageClient not found`).not.toBeNull()
      const raw   = slotHtml(probe!.seoIntroSlot)
      const html  = decodeEntities(raw)
      expect(raw,  `${slug}: expected intro html present`).toContain('data-testid="card-seo-intro"')
      expect(html, `${slug}: intro text mismatch`).toContain(entry.intro!)
    }
  })

  it('control (non-overridden) card renders NO seoIntroSlot', async () => {
    setRpc(() => ({
      data: cardRow({
        card_url_slug: 'totally-not-in-override-map-abc123',
        set_name:      'Base Set',
        card_name:     'Nidoking #34',
      }),
      error: null,
    }))
    const tree  = await CardPageDefault(params('Base Set', 'totally-not-in-override-map-abc123'))
    const probe = findCardPageClientProps(tree as ReactNode)
    expect(probe, 'CardPageClient not found').not.toBeNull()
    expect(probe!.seoIntroSlot).toBeNull()
    const html = slotHtml(probe!.seoIntroSlot)
    // And none of the override intros leaked into whatever the slot
    // rendered (which should be nothing).
    for (const entry of Object.values(_internalOverrideMap())) {
      if (entry.intro) expect(html).not.toContain(entry.intro)
    }
  })

  it('RPC error branch renders NO seoIntroSlot', async () => {
    setRpc(() => ({ data: null, error: { message: 'boom' } }))
    const tree  = await CardPageDefault(params('Celebrations', 'greninja-gold-star-swsh144'))
    const probe = findCardPageClientProps(tree as ReactNode)
    expect(probe, 'CardPageClient not found on error branch').not.toBeNull()
    expect(probe!.seoIntroSlot).toBeNull()
  })
})

// Silence the unused-import warning from an earlier iteration.
void Children
