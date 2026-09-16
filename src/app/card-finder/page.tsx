// app/card-finder/page.tsx — Smart Card Finder / Deep Search.
//
// Two modes:
//   - "play"       Find for Play — capability / colour / MV / legality driven.
//   - "collecting" Find for Collecting — set / era / rarity / finish / price driven.
//
// The NL box on top parses to a FinderQuery deterministically. Every
// filter maps to a real DB constraint. Never invents cards.

import Link from 'next/link'
import type { Metadata } from 'next'
import { findCards, type FinderQuery, type FinderHit } from '@/lib/mtg/finder'
import { parseFinderText } from '@/lib/mtg/finder-nl'
import { CAPABILITY_LABELS, TYPE_CAPABILITIES, type CardCapability, CAPABILITY_TAGS } from '@/lib/mtg/capabilities'
import { FORMATS } from '@/lib/mtg/formats'
import { buildCardSlug } from '@/lib/mtg/slug'
import ManaCost from '@/components/mtg/ManaCost'
import AddToDeck from '@/components/mtg/AddToDeck'
import CardFinderControls from './CardFinderControls'

export const dynamic = 'force-dynamic'

const SITE_URL = 'https://mtgprices.io'

export const metadata: Metadata = {
  title: 'Card Finder — deep search',
  description: 'Find MTG cards by what they do: capabilities, colour, format legality, price. Plus deep collector search across set, era, rarity, finish and printing.',
  alternates: { canonical: `${SITE_URL}/card-finder` },
  openGraph: { url: `${SITE_URL}/card-finder` },
}

type SearchParams = {
  mode?: 'play' | 'collecting'
  q?: string           // natural-language box
  // structured params (comma-separated where multi-valued)
  caps?: string
  colors?: string
  identity?: string
  colorless?: string
  types?: string
  legal?: string
  rarity?: string
  mvmin?: string
  mvmax?: string
  set?: string
  from?: string
  to?: string
  rl?: string
  gc?: string
  finish?: string
  artist?: string
  cur?: string
  pmax?: string
  pmin?: string
  budget?: string
  sort?: string
  page?: string
}

function asList(v: string | undefined): string[] {
  if (!v) return []
  return v.split(',').map((s) => s.trim()).filter(Boolean)
}

function paramsToQuery(sp: SearchParams): { query: FinderQuery; suggestions: string[]; warnings: string[] } {
  // NL first — parse "q" into a query.
  const parsed = sp.q ? parseFinderText(sp.q) : { query: {} as FinderQuery, suggestions: [] as string[], warnings: [] as string[] }
  const q: FinderQuery = { ...parsed.query }

  // Structured overrides — always take precedence when explicitly set.
  const capsList = asList(sp.caps).filter((c): c is CardCapability => (CAPABILITY_TAGS as readonly string[]).includes(c))
  if (capsList.length > 0) q.caps = capsList
  const colors = asList(sp.colors)
  if (colors.length > 0) q.colors = colors
  const identity = asList(sp.identity)
  if (identity.length > 0) q.colorIdentity = identity
  if (sp.colorless === '1') q.colorless = true
  const types = asList(sp.types)
  if (types.length > 0) q.types = types
  if (sp.legal) q.legalIn = sp.legal as any
  if (sp.rarity) q.rarity = sp.rarity as any
  if (sp.mvmin) q.manaValueMin = parseInt(sp.mvmin, 10)
  if (sp.mvmax) q.manaValueMax = parseInt(sp.mvmax, 10)
  if (sp.set) q.setCode = sp.set
  if (sp.from) q.releasedFrom = sp.from
  if (sp.to) q.releasedTo = sp.to
  if (sp.rl === '1') q.reservedList = true
  if (sp.gc === '1') q.gameChanger = true
  if (sp.finish) q.finish = sp.finish as any
  if (sp.artist) q.artist = sp.artist
  if (sp.cur === 'USD' || sp.cur === 'EUR') q.currency = sp.cur
  if (sp.pmax) q.priceMax = parseFloat(sp.pmax)
  if (sp.pmin) q.priceMin = parseFloat(sp.pmin)
  if (sp.budget === '1') q.budgetPreference = true
  if (sp.sort) q.sort = sp.sort as any

  return { query: q, suggestions: parsed.suggestions, warnings: parsed.warnings }
}

export default async function CardFinderPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const sp = await searchParams
  const mode: 'play' | 'collecting' = sp.mode === 'collecting' ? 'collecting' : 'play'
  const { query, suggestions, warnings } = paramsToQuery(sp)

  const hasFilter =
    Boolean(query.name || (query.caps && query.caps.length) || (query.colors && query.colors.length) ||
      query.colorless || (query.colorIdentity && query.colorIdentity.length) || (query.types && query.types.length) ||
      query.legalIn || query.rarity || typeof query.manaValueMax === 'number' || typeof query.manaValueMin === 'number' ||
      query.setCode || query.releasedFrom || query.releasedTo || query.reservedList || query.gameChanger ||
      query.finish || query.artist || typeof query.priceMax === 'number' || typeof query.priceMin === 'number' ||
      query.budgetPreference)

  const page = Math.max(1, parseInt(sp.page ?? '1', 10) || 1)
  const result = hasFilter ? await findCards(query, { page, pageSize: 24 }) : null

  const pageCount = result ? Math.max(1, Math.ceil(result.total / result.pageSize)) : 1

  return (
    <div style={{ maxWidth: 1180, margin: '0 auto', padding: '28px 24px 80px' }}>
      <div style={{ marginBottom: 20 }}>
        <div className="label-mono">Card Finder</div>
        <h1 style={{ margin: '6px 0 0', fontSize: 30 }}>
          {mode === 'play' ? 'Find for Play' : 'Find for Collecting'}
        </h1>
        <p style={{ color: 'var(--text-muted)', fontSize: 15, marginTop: 6, maxWidth: 760, lineHeight: 1.55 }}>
          {mode === 'play'
            ? 'Describe what a card should do. Filters map to structured constraints — no invented recommendations.'
            : 'Find cards by set, era, rarity, finish, artist and price. Cheapest printings surface first when you say so.'}
        </p>
      </div>

      <div style={{ display: 'flex', gap: 8, marginBottom: 20, flexWrap: 'wrap' }}>
        <ModeToggle current={mode} target="play" sp={sp} />
        <ModeToggle current={mode} target="collecting" sp={sp} />
      </div>

      <CardFinderControls mode={mode} initialParams={sp as Record<string, string>} suggestions={suggestions} warnings={warnings} />

      {!hasFilter ? (
        <div style={{ padding: 20, background: 'var(--surface)', border: '1px dashed var(--border)', borderRadius: 12, color: 'var(--text-muted)', fontSize: 14, lineHeight: 1.6 }}>
          {mode === 'play' ? (
            <>
              Try:
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginTop: 8 }}>
                <ExampleChip href="/card-finder?mode=play&q=cheap+black+creature+removal+legal+in+commander">cheap black creature removal legal in commander</ExampleChip>
                <ExampleChip href="/card-finder?mode=play&q=blue+card+draw+for+commander+under+3+mana">blue card draw for commander under 3 mana</ExampleChip>
                <ExampleChip href="/card-finder?mode=play&q=green+ramp+legal+in+modern">green ramp legal in modern</ExampleChip>
                <ExampleChip href="/card-finder?mode=play&q=cards+that+make+creature+tokens">cards that make creature tokens</ExampleChip>
                <ExampleChip href="/card-finder?mode=play&q=white+board+wipe+under+%245">white board wipe under $5</ExampleChip>
                <ExampleChip href="/card-finder?mode=play&q=artifact+removal+in+red">artifact removal in red</ExampleChip>
              </div>
            </>
          ) : (
            <>
              Try:
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginTop: 8 }}>
                <ExampleChip href="/card-finder?mode=collecting&q=reserved+list+cards+under+%24100">reserved list cards under $100</ExampleChip>
                <ExampleChip href="/card-finder?mode=collecting&q=foil+mythics+under+%2410">foil mythics under $10</ExampleChip>
                <ExampleChip href="/card-finder?mode=collecting&q=rare+blue+cards+from+the+1990s">rare blue cards from the 1990s</ExampleChip>
                <ExampleChip href="/card-finder?mode=collecting&q=etched+printings">etched printings</ExampleChip>
                <ExampleChip href="/card-finder?mode=collecting&q=game+changer+cards">game changer cards</ExampleChip>
              </div>
            </>
          )}
        </div>
      ) : null}

      {result && (
        <>
          <div style={{ margin: '18px 0 10px', color: 'var(--text-muted)', fontSize: 13, display: 'flex', justifyContent: 'space-between', flexWrap: 'wrap', gap: 8 }}>
            <span>
              <strong style={{ color: 'var(--text)' }}>{result.total.toLocaleString()}</strong>
              {' '}match{result.total === 1 ? '' : 'es'}
              {result.total > result.hits.length + (result.page - 1) * result.pageSize
                ? ' — showing this page'
                : ''}
            </span>
            <span>Page {result.page} / {pageCount}</span>
          </div>

          {result.hits.length === 0 ? (
            <div style={{ padding: 20, background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 12, color: 'var(--text-muted)' }}>
              No cards match these constraints. Try relaxing capabilities, expanding colours or removing the price cap.
            </div>
          ) : (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(240px, 1fr))', gap: 12 }}>
              {result.hits.map((h) => <ResultCard key={h.oracle_card_id} h={h} />)}
            </div>
          )}

          {pageCount > 1 && (
            <Pagination page={result.page} pageCount={pageCount} sp={sp} />
          )}
        </>
      )}
    </div>
  )
}

// ────────────────────────────────────────────────────────────────

function ExampleChip({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <Link href={href} style={{
      padding: '5px 12px', background: 'var(--primary-soft)',
      color: 'var(--primary)', borderRadius: 999,
      fontSize: 12, fontWeight: 600, textDecoration: 'none',
      border: '1px solid rgba(104,65,230,0.25)',
    }}>{children}</Link>
  )
}

function ModeToggle({ current, target, sp }: { current: 'play' | 'collecting'; target: 'play' | 'collecting'; sp: SearchParams }) {
  const params = new URLSearchParams()
  for (const [k, v] of Object.entries(sp)) {
    if (typeof v === 'string' && v.length > 0 && k !== 'mode') params.set(k, v)
  }
  params.set('mode', target)
  const active = current === target
  return (
    <Link
      href={`/card-finder?${params.toString()}`}
      aria-current={active ? 'page' : undefined}
      style={{
        padding: '8px 16px', borderRadius: 10,
        background: active ? 'var(--primary)' : 'var(--surface)',
        color: active ? '#fff' : 'var(--text)',
        border: `1px solid ${active ? 'var(--primary)' : 'var(--border)'}`,
        textDecoration: 'none', fontSize: 13, fontWeight: 700,
      }}
    >
      {target === 'play' ? 'Find for Play' : 'Find for Collecting'}
    </Link>
  )
}

const RARITY_COLOR: Record<string, string> = {
  common: '#9AA3B2', uncommon: '#c0c8d0', rare: '#C9A55C',
  mythic: '#e07d3a', special: '#7C5CE7', bonus: '#7C5CE7',
}

function fmtPrice(p: FinderHit['cheapest']): string {
  if (!p) return '—'
  const sym = p.currency === 'USD' ? '$' : p.currency === 'EUR' ? '€' : ''
  return `${sym}${p.price.toFixed(2)}`
}

function ResultCard({ h }: { h: FinderHit }) {
  const slug = h.printing.collector_number ? buildCardSlug(h.printing.collector_number, h.name) : ''
  const href = slug ? `/set/${h.printing.set_code}/card/${slug}` : '#'
  const dot = h.printing.rarity ? RARITY_COLOR[h.printing.rarity] ?? 'var(--text-muted)' : 'var(--text-muted)'
  return (
    <div
      className="card-hover"
      style={{
        display: 'flex', flexDirection: 'column', background: 'var(--surface)',
        border: '1px solid var(--border)', borderRadius: 12,
        padding: 12, color: 'var(--text)',
      }}
    >
      <Link href={href} style={{ color: 'inherit', textDecoration: 'none' }}>
        <div style={{
          aspectRatio: '5 / 7', borderRadius: 6, background: 'var(--bg-light)',
          marginBottom: 10, overflow: 'hidden',
        }}>
          {h.printing.image_uri_small ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={h.printing.image_uri_small} alt={h.name} style={{ width: '100%', height: '100%', objectFit: 'cover' }} loading="lazy" />
          ) : null}
        </div>
        <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 8, marginBottom: 4 }}>
          <div style={{ fontSize: 14, fontWeight: 700, lineHeight: 1.2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{h.name}</div>
          {h.mana_cost && <span style={{ flexShrink: 0 }}><ManaCost cost={h.mana_cost} size={13} /></span>}
        </div>
        <div style={{ display: 'flex', gap: 6, alignItems: 'center', color: 'var(--text-muted)', fontSize: 11 }}>
          <span style={{ width: 6, height: 6, borderRadius: '50%', background: dot }} aria-hidden />
          <span style={{ textTransform: 'uppercase' }}>{h.printing.set_code}</span>
          {h.printing.collector_number && <span>· #{h.printing.collector_number}</span>}
          <span style={{ marginLeft: 'auto', fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace', color: h.cheapest ? 'var(--text)' : 'var(--text-muted)', fontWeight: h.cheapest ? 700 : 500 }}>
            {fmtPrice(h.cheapest)}
          </span>
        </div>
        {h.type_line && (
          <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 6, lineHeight: 1.35 }}>{h.type_line}</div>
        )}
        {h.reasons.length > 0 && (
          <div style={{ marginTop: 10, paddingTop: 10, borderTop: '1px solid var(--border)' }}>
            <div className="label-mono" style={{ marginBottom: 4, fontSize: 9 }}>Why matched</div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
              {h.reasons.slice(0, 4).map((r, i) => (
                <span key={i} style={{
                  fontSize: 10, padding: '2px 7px', borderRadius: 999,
                  background: 'var(--primary-soft)', color: 'var(--primary)',
                }}>{r}</span>
              ))}
            </div>
          </div>
        )}
      </Link>
      <div style={{ marginTop: 10 }}>
        <AddToDeck oracleId={h.oracle_card_id} cardName={h.name} preferredFinishId={null} />
      </div>
    </div>
  )
}

function Pagination({ page, pageCount, sp }: { page: number; pageCount: number; sp: SearchParams }) {
  function pageHref(p: number) {
    const params = new URLSearchParams()
    for (const [k, v] of Object.entries(sp)) {
      if (typeof v === 'string' && v.length > 0 && k !== 'page') params.set(k, v)
    }
    params.set('page', String(p))
    return `/card-finder?${params.toString()}`
  }
  const prev = Math.max(1, page - 1)
  const next = Math.min(pageCount, page + 1)
  return (
    <div style={{ display: 'flex', justifyContent: 'center', gap: 8, marginTop: 24 }}>
      {page > 1 && <Link href={pageHref(prev)} style={pagerBtn}>‹ Prev</Link>}
      <span style={{ padding: '8px 12px', color: 'var(--text-muted)', fontSize: 13 }}>Page {page} of {pageCount}</span>
      {page < pageCount && <Link href={pageHref(next)} style={pagerBtn}>Next ›</Link>}
    </div>
  )
}

const pagerBtn: React.CSSProperties = {
  padding: '8px 14px', background: 'var(--surface)', border: '1px solid var(--border)',
  borderRadius: 10, fontSize: 13, fontWeight: 600, color: 'var(--text)', textDecoration: 'none',
}
