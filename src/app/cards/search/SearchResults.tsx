'use client'
// Block 5A-W-56A — Deep Card Search results. Renders a data table on
// desktop and compact cards on mobile. Every card row links to the
// existing canonical /set/{setName}/card/{slug} URL using a crawlable
// <a> so search engines follow the internal links.

import Link from 'next/link'
import { useEffect, useMemo, useRef } from 'react'
import { usdCentsToPounds, type DeepCardSearchFilters } from '@/lib/deepSearch/filters'
import { buildAffiliateLink } from '@/lib/ebayAffiliate'
import { useMarketplace } from '@/lib/marketplaceClient'
import { trackEvent } from '@/lib/analytics'

/**
 * Result row shape returned by search_cards_deep — mirrors the view's
 * projected columns. Values are permissive on the client because the
 * RPC serialises through jsonb + all filters are nullable.
 */
export interface SearchResultRow {
  card_slug:             string
  card_name:             string
  set_name:              string
  card_number:           string | number | null
  card_number_display:   string | null
  card_url_slug:         string
  image_url:             string | null
  primary_pokemon_slug:  string | null
  language:              'en' | 'jp' | null
  set_release_date:      string | null
  release_year:          number | null
  raw_usd:               number | null
  psa7_usd:              number | null
  psa8_usd:              number | null
  psa9_usd:              number | null
  psa10_usd:             number | null
  raw_pct_7d:            number | null
  raw_pct_30d:           number | null
  raw_pct_90d:           number | null
  psa9_uplift:           number | null
  psa10_uplift:          number | null
  psa9_multiple:         number | null
  psa10_multiple:        number | null
}

interface Props {
  rows:            SearchResultRow[]
  loading:         boolean
  filters:         DeepCardSearchFilters
  onClearFilters:  () => void
}

export default function SearchResults({ rows, loading, filters, onClearFilters }: Props) {
  const hasAnyFilter = useMemo(() => Object.keys(filters).length > 0, [filters])
  // Block 5A-W-58G — Deep Search routes eBay clicks through the
  // resolved marketplace (was UK-hardcoded pre-58G). Fallback to UK
  // when the hook has not resolved yet keeps SSR / cold-render safe.
  const mp = useMarketplace()
  const marketplace: 'UK' | 'US' = mp.marketplace === 'US' ? 'US' : 'UK'

  if (loading && rows.length === 0) {
    return <SkeletonBlock />
  }

  if (rows.length === 0) {
    return (
      <div style={{
        background: 'var(--card)', border: '1px dashed var(--border)',
        borderRadius: 14, padding: '40px 20px', textAlign: 'center',
        color: 'var(--text-muted)', fontFamily: "'Figtree', sans-serif",
        fontSize: 14, lineHeight: 1.6,
      }}>
        <p style={{ margin: '0 0 12px' }}>No cards match those filters.</p>
        <p style={{ margin: '0 0 16px', fontSize: 13 }}>
          Try increasing your price range, removing a grade restriction, or including both English and Japanese cards.
        </p>
        {hasAnyFilter && (
          <button onClick={onClearFilters} style={{
            padding: '9px 18px', borderRadius: 10, border: 'none',
            background: 'var(--primary)', color: '#fff',
            fontSize: 13, fontWeight: 700,
            fontFamily: "'Figtree', sans-serif", cursor: 'pointer',
          }}>
            Clear filters
          </button>
        )}
      </div>
    )
  }

  return (
    <>
      {/* Desktop table */}
      <div className="deep-search-desktop" style={{
        background: 'var(--card)', border: '1px solid var(--border)',
        borderRadius: 14, overflowX: 'auto',
        opacity: loading ? 0.6 : 1, transition: 'opacity 0.15s',
      }}>
        <table style={{
          width: '100%', borderCollapse: 'collapse',
          fontFamily: "'Figtree', sans-serif", fontSize: 13,
        }}>
          <thead>
            <tr style={{ background: 'var(--bg-light)' }}>
              <Th>Card</Th>
              <Th>Set</Th>
              <Th align="center">Year</Th>
              <Th align="center">Lang</Th>
              <Th align="right">Raw</Th>
              <Th align="right">PSA 7</Th>
              <Th align="right">PSA 8</Th>
              <Th align="right">PSA 9</Th>
              <Th align="right">PSA 10</Th>
              <Th align="right">30d</Th>
              <Th align="right">90d</Th>
              <Th align="center">eBay</Th>
            </tr>
          </thead>
          <tbody>
            {rows.map(row => <ResultRow key={row.card_slug} row={row} marketplace={marketplace} />)}
          </tbody>
        </table>
      </div>

      {/* Mobile cards */}
      <div className="deep-search-mobile" style={{ display: 'none', flexDirection: 'column', gap: 10, opacity: loading ? 0.6 : 1 }}>
        {rows.map(row => <MobileCard key={row.card_slug} row={row} marketplace={marketplace} />)}
      </div>

      <style jsx>{`
        @media (max-width: 900px) {
          :global(.deep-search-desktop) { display: none !important; }
          :global(.deep-search-mobile)  { display: flex !important; }
        }
      `}</style>
    </>
  )
}

// ─── Desktop row ─────────────────────────────────────

function ResultRow({ row, marketplace }: { row: SearchResultRow; marketplace: 'UK' | 'US' }) {
  const href = `/set/${encodeURIComponent(row.set_name)}/card/${row.card_url_slug}`
  const cardNumberLabel = row.card_number_display || (row.card_number != null ? `#${row.card_number}` : '')
  const ebay = ebayLink(row, marketplace)
  return (
    <tr style={{ borderTop: '1px solid var(--border)' }}>
      <Td>
        <Link href={href} style={{ display: 'flex', gap: 10, alignItems: 'center', textDecoration: 'none' }}>
          {row.image_url
            ? <img src={row.image_url} alt={row.card_name} loading="lazy" style={{ width: 32, height: 44, objectFit: 'contain', borderRadius: 4, flexShrink: 0 }} />
            : <div style={{ width: 32, height: 44, background: 'var(--bg-light)', borderRadius: 4, flexShrink: 0 }} />}
          <div style={{ minWidth: 0 }}>
            <div style={{ color: 'var(--text)', fontWeight: 700, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {row.card_name}
            </div>
            <div style={{ color: 'var(--text-muted)', fontSize: 11 }}>
              {cardNumberLabel}
            </div>
          </div>
        </Link>
      </Td>
      <Td>
        <span style={{ color: 'var(--text-muted)' }}>{row.set_name}</span>
      </Td>
      <Td align="center">{row.release_year ?? '—'}</Td>
      <Td align="center">
        {row.language === 'jp'
          ? <span style={{ fontSize: 10, fontWeight: 800, background: '#e11d48', color: '#fff', padding: '1px 6px', borderRadius: 4 }}>JP</span>
          : <span style={{ fontSize: 10, color: 'var(--text-muted)' }}>EN</span>}
      </Td>
      <Td align="right">{formatPrice(row.raw_usd)}</Td>
      <Td align="right">{formatPrice(row.psa7_usd)}</Td>
      <Td align="right">{formatPrice(row.psa8_usd)}</Td>
      <Td align="right">{formatPrice(row.psa9_usd)}</Td>
      <Td align="right">{formatPrice(row.psa10_usd)}</Td>
      <Td align="right"><PctCell val={row.raw_pct_30d} /></Td>
      <Td align="right"><PctCell val={row.raw_pct_90d} /></Td>
      <Td align="center">
        {ebay && (
          <DeepSearchEbayLink
            href={ebay}
            row={row}
            marketplace={marketplace}
            label="eBay ↗"
            style={{ fontSize: 11, color: 'var(--primary)', textDecoration: 'none', fontWeight: 700 }}
          />
        )}
      </Td>
    </tr>
  )
}

function Th({ children, align = 'left' }: { children: React.ReactNode; align?: 'left' | 'right' | 'center' }) {
  return (
    <th style={{
      textAlign: align,
      padding: '10px 12px',
      fontSize: 11, fontWeight: 800, textTransform: 'uppercase',
      letterSpacing: 0.8, color: 'var(--text-muted)',
      fontFamily: "'Figtree', sans-serif", whiteSpace: 'nowrap',
    }}>{children}</th>
  )
}
function Td({ children, align = 'left' }: { children: React.ReactNode; align?: 'left' | 'right' | 'center' }) {
  return (
    <td style={{
      textAlign: align,
      padding: '10px 12px',
      color: 'var(--text)', fontFamily: "'Figtree', sans-serif",
      whiteSpace: 'nowrap',
    }}>{children}</td>
  )
}

// ─── Mobile card ─────────────────────────────────────

function MobileCard({ row, marketplace }: { row: SearchResultRow; marketplace: 'UK' | 'US' }) {
  const href = `/set/${encodeURIComponent(row.set_name)}/card/${row.card_url_slug}`
  const ebay = ebayLink(row, marketplace)
  const showPsa10 = row.psa10_usd != null
  const showPsa9  = !showPsa10 && row.psa9_usd != null
  return (
    <div style={{
      background: 'var(--card)', border: '1px solid var(--border)',
      borderRadius: 12, padding: '12px 14px',
      display: 'flex', gap: 12, alignItems: 'flex-start',
    }}>
      <Link href={href} style={{ flexShrink: 0 }}>
        {row.image_url
          ? <img src={row.image_url} alt={row.card_name} loading="lazy" style={{ width: 60, height: 84, objectFit: 'contain', borderRadius: 6 }} />
          : <div style={{ width: 60, height: 84, background: 'var(--bg-light)', borderRadius: 6 }} />}
      </Link>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: 'flex', gap: 6, alignItems: 'center', marginBottom: 4 }}>
          {row.language === 'jp' && (
            <span style={{ fontSize: 9, fontWeight: 800, background: '#e11d48', color: '#fff', padding: '1px 5px', borderRadius: 4 }}>JP</span>
          )}
          <Link href={href} style={{
            fontSize: 14, fontWeight: 800, color: 'var(--text)',
            fontFamily: "'Figtree', sans-serif", textDecoration: 'none',
            overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
          }}>
            {row.card_name}
          </Link>
        </div>
        <div style={{
          fontSize: 11, color: 'var(--text-muted)',
          fontFamily: "'Figtree', sans-serif", marginBottom: 8,
          overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
        }}>
          {row.set_name}{row.release_year ? ` · ${row.release_year}` : ''}
          {row.card_number_display ? ` · ${row.card_number_display}` : ''}
        </div>
        <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', fontFamily: "'Figtree', sans-serif" }}>
          {row.raw_usd != null && <MobileStat label="Raw" value={formatPrice(row.raw_usd)} />}
          {showPsa10 && <MobileStat label="PSA 10" value={formatPrice(row.psa10_usd)} highlight />}
          {showPsa9  && <MobileStat label="PSA 9"  value={formatPrice(row.psa9_usd)}  highlight />}
          {row.raw_pct_30d != null && <MobileStat label="30d" value={pctLabel(row.raw_pct_30d)} />}
        </div>
        <div style={{ display: 'flex', gap: 10, marginTop: 10 }}>
          <Link href={href} style={mobilePrimaryLink}>View card</Link>
          {ebay && (
            <DeepSearchEbayLink
              href={ebay}
              row={row}
              marketplace={marketplace}
              label="Find on eBay ↗"
              style={mobileOutlineLink}
            />
          )}
        </div>
      </div>
    </div>
  )
}

function MobileStat({ label, value, highlight = false }: { label: string; value: string; highlight?: boolean }) {
  return (
    <div>
      <div style={{ fontSize: 9, fontWeight: 800, letterSpacing: 0.8, color: 'var(--text-muted)', textTransform: 'uppercase' }}>{label}</div>
      <div style={{ fontSize: 13, fontWeight: 800, color: highlight ? 'var(--primary)' : 'var(--text)' }}>{value}</div>
    </div>
  )
}

function PctCell({ val }: { val: number | null }) {
  if (val == null) return <span style={{ color: 'var(--border)' }}>—</span>
  const isUp = val > 0
  return (
    <span style={{
      color: isUp ? '#16a34a' : val < 0 ? '#dc2626' : 'var(--text-muted)',
      fontWeight: 700,
    }}>
      {pctLabel(val)}
    </span>
  )
}

function pctLabel(v: number): string {
  return `${v > 0 ? '+' : ''}${v.toFixed(1)}%`
}

function formatPrice(cents: number | null): string {
  if (cents == null) return '—'
  const gbp = usdCentsToPounds(cents)
  if (gbp == null) return '—'
  if (gbp >= 1000) return `£${(gbp / 1000).toFixed(1)}k`
  return `£${gbp}`
}

// Block 5A-W-58G — Deep Search now routes through the resolved
// marketplace via the v2 engine. Custom tracking ID keeps the same
// bare-slug shape the legacy helper emitted so existing EPN reports
// stay comparable.
//
// Exported for unit tests — the function is pure so it can be
// tested without rendering the component tree.
export function ebayLink(row: SearchResultRow, marketplace: 'UK' | 'US'): string | null {
  if (!row.card_name || !row.set_name) return null
  const built = buildAffiliateLink({
    marketplace:      marketplace === 'US' ? 'us' : 'uk',
    intent:           'raw',
    cardName:         row.card_name,
    setName:          row.set_name,
    cardNumber:       row.card_number != null ? String(row.card_number) : null,
    cardSlug:         row.card_slug,
    setSlug:          row.set_name,
    placement:        'deep_search_row',
    pageType:         'deep_search',
    sourceComponent:  'deep_search_results',
    legacyCustomId:   row.card_slug ? row.card_slug.replace(/^pc-/, '') : undefined,
  })
  return built.url
}

// Shared eBay CTA used by both desktop rows and mobile cards. Owns
// impression IO (fires once per mounted anchor when visible) and
// dual click analytics: keeps the historical `deep_search_ebay_click`
// event AND also emits the standard `affiliate_click` so this
// placement rolls up alongside every other affiliate CTA.
function DeepSearchEbayLink({
  href, row, marketplace, label, style,
}: {
  href:        string
  row:         SearchResultRow
  marketplace: 'UK' | 'US'
  label:       string
  style?:      React.CSSProperties
}) {
  const anchorRef = useRef<HTMLAnchorElement | null>(null)
  const firedRef = useRef(false)
  const customTrackingId = row.card_slug ? row.card_slug.replace(/^pc-/, '') : ''
  useEffect(() => {
    if (firedRef.current) return
    if (typeof window === 'undefined' || typeof IntersectionObserver === 'undefined') return
    const el = anchorRef.current
    if (!el) return
    const io = new IntersectionObserver((entries) => {
      for (const entry of entries) {
        if (entry.isIntersecting && !firedRef.current) {
          firedRef.current = true
          trackEvent('affiliate_link_view', {
            placement:          'deep_search_row',
            intent:             'raw',
            marketplace,
            card_slug:          row.card_slug,
            set_slug:           row.set_name,
            custom_tracking_id: customTrackingId,
            source_component:   'deep_search_results',
          })
          io.disconnect()
          break
        }
      }
    }, { threshold: 0.5 })
    io.observe(el)
    return () => io.disconnect()
  }, [marketplace, row.card_slug, row.set_name, customTrackingId])

  function onClick() {
    // Preserve the historical event for existing dashboards.
    trackEvent('deep_search_ebay_click', {
      card_slug: row.card_slug,
      set_slug:  row.set_name,
    })
    // 58G — also fire the standard affiliate_click so Deep Search
    // rolls up alongside every other placement in the affiliate funnel.
    trackEvent('affiliate_click', {
      placement:          'deep_search_row',
      intent:             'raw',
      marketplace,
      card_slug:          row.card_slug,
      set_slug:           row.set_name,
      custom_tracking_id: customTrackingId,
      source_component:   'deep_search_results',
    })
  }

  return (
    <a
      ref={anchorRef}
      href={href}
      target="_blank"
      rel="sponsored noopener noreferrer"
      onClick={onClick}
      style={style}
    >
      {label}
    </a>
  )
}

// ─── Loading skeleton ────────────────────────────────

function SkeletonBlock() {
  return (
    <div style={{
      background: 'var(--card)', border: '1px solid var(--border)',
      borderRadius: 14, padding: 20,
    }}>
      {Array.from({ length: 6 }).map((_, i) => (
        <div key={i} className="skeleton" style={{ height: 44, marginBottom: 8, borderRadius: 8 }} />
      ))}
    </div>
  )
}

const mobilePrimaryLink: React.CSSProperties = {
  padding: '7px 14px', borderRadius: 8,
  background: 'var(--primary)', color: '#fff',
  fontSize: 12, fontWeight: 700, textDecoration: 'none',
  fontFamily: "'Figtree', sans-serif",
}
const mobileOutlineLink: React.CSSProperties = {
  padding: '7px 14px', borderRadius: 8,
  background: 'transparent', color: 'var(--primary)',
  border: '1px solid var(--primary)',
  fontSize: 12, fontWeight: 700, textDecoration: 'none',
  fontFamily: "'Figtree', sans-serif",
}
