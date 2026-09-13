'use client'
import { useEffect, useRef } from 'react'
import { getEbayUkUrl, getEbayUsUrl } from '@/lib/ebayAffiliate'
import { useMarketplace } from '@/lib/marketplaceClient'
import { trackEvent } from '@/lib/analytics'
import type { AffiliateIntent, Marketplace } from '@/lib/analytics'

type Size = 'sm' | 'md'

type Props = {
  searchQuery: string
  customId?: string
  /** Optional — kept for backwards compat. Ignored after the eBay-compliance update. */
  label?: string
  size?: Size
  className?: string
  /** Analytics-only context. Defaults are conservative; UI is unaffected. */
  placement?: string
  intent?: AffiliateIntent
  cardSlug?: string
  setSlug?: string
  sourceComponent?: string
}

const SIZE_STYLES: Record<Size, { padding: string; fontSize: number; flagSize: number; gap: number }> = {
  sm: { padding: '6px 12px', fontSize: 11, flagSize: 13, gap: 6 },
  md: { padding: '9px 16px', fontSize: 13, flagSize: 15, gap: 7 },
}

export default function EbayLiveListings({
  searchQuery,
  customId,
  size = 'md',
  className,
  placement,
  intent,
  cardSlug,
  setSlug,
  sourceComponent,
}: Props) {
  const ukUrl = getEbayUkUrl(searchQuery, customId)
  const usUrl = getEbayUsUrl(searchQuery, customId)
  const s = SIZE_STYLES[size]

  const containerRef = useRef<HTMLDivElement>(null)
  const firedViewRef = useRef(false)

  // Single impression event per mount. IntersectionObserver fires once
  // when 50% of the affiliate block enters the viewport. Avoids double-
  // fires from scrolling, React Strict Mode or re-renders.
  useEffect(() => {
    if (firedViewRef.current) return
    if (typeof window === 'undefined') return
    if (typeof IntersectionObserver === 'undefined') return
    const el = containerRef.current
    if (!el) return
    const io = new IntersectionObserver((entries) => {
      for (const entry of entries) {
        if (entry.isIntersecting && !firedViewRef.current) {
          firedViewRef.current = true
          trackEvent('affiliate_link_view', {
            placement:          placement ?? 'unknown',
            intent:             intent    ?? 'other',
            card_slug:          cardSlug,
            set_slug:           setSlug,
            custom_tracking_id: customId,
            source_component:   sourceComponent ?? 'ebay_live_listings',
          })
          io.disconnect()
          break
        }
      }
    }, { threshold: 0.5 })
    io.observe(el)
    return () => io.disconnect()
  }, [placement, intent, cardSlug, setSlug, customId, sourceComponent])

  function onClick(marketplace: Marketplace) {
    trackEvent('affiliate_click', {
      placement:          placement ?? 'unknown',
      marketplace,
      intent:             intent    ?? 'other',
      card_slug:          cardSlug,
      set_slug:           setSlug,
      custom_tracking_id: customId,
      source_component:   sourceComponent ?? 'ebay_live_listings',
    })
  }

  return (
    <div ref={containerRef} className={className} style={{ fontFamily: "'Figtree', sans-serif" }}>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        <RegionButton href={ukUrl} flag="🇬🇧" sizeStyles={s} primary onClickCapture={() => onClick('UK')} />
        <RegionButton href={usUrl} flag="🇺🇸" sizeStyles={s}         onClickCapture={() => onClick('US')} />
      </div>
      <p
        style={{
          fontSize: 10,
          color: 'var(--text-muted)',
          margin: '8px 0 0',
          opacity: 0.75,
        }}
      >
        Affiliate link · we may earn commission
      </p>
    </div>
  )
}

// Compact, single-link variant for inline use inside dense rows (top movers,
// risers, fallers). Block 5A-W-58G — reads the resolved marketplace
// via useMarketplace() so US visitors land on ebay.com instead of the
// old UK hardcode. Falls back to UK when the hook has not resolved
// (SSR / no cookies yet).
export function EbayInlineLink({
  searchQuery,
  customId,
  label = 'See eBay listings →',
  placement,
  intent,
  cardSlug,
  setSlug,
  sourceComponent,
}: {
  searchQuery: string
  customId: string
  label?: string
  placement?: string
  intent?: AffiliateIntent
  cardSlug?: string
  setSlug?: string
  sourceComponent?: string
}) {
  const mp = useMarketplace()
  const marketplace: Marketplace = mp.marketplace === 'US' ? 'US' : 'UK'
  const url = marketplace === 'US'
    ? getEbayUsUrl(searchQuery, customId)
    : getEbayUkUrl(searchQuery, customId)
  const containerRef = useRef<HTMLAnchorElement>(null)
  const firedViewRef = useRef(false)

  useEffect(() => {
    if (firedViewRef.current) return
    if (typeof window === 'undefined' || typeof IntersectionObserver === 'undefined') return
    const el = containerRef.current
    if (!el) return
    const io = new IntersectionObserver((entries) => {
      for (const entry of entries) {
        if (entry.isIntersecting && !firedViewRef.current) {
          firedViewRef.current = true
          trackEvent('affiliate_link_view', {
            placement:          placement ?? 'inline',
            intent:             intent    ?? 'other',
            marketplace,
            card_slug:          cardSlug,
            set_slug:           setSlug,
            custom_tracking_id: customId,
            source_component:   sourceComponent ?? 'ebay_inline_link',
          })
          io.disconnect()
          break
        }
      }
    }, { threshold: 0.5 })
    io.observe(el)
    return () => io.disconnect()
  }, [placement, intent, marketplace, cardSlug, setSlug, customId, sourceComponent])

  function handleClick() {
    trackEvent('affiliate_click', {
      placement:          placement ?? 'inline',
      marketplace,
      intent:             intent    ?? 'other',
      card_slug:          cardSlug,
      set_slug:           setSlug,
      custom_tracking_id: customId,
      source_component:   sourceComponent ?? 'ebay_inline_link',
    })
  }

  return (
    <a
      ref={containerRef}
      href={url}
      target="_blank"
      rel="sponsored noopener noreferrer"
      onClick={handleClick}
      style={{
        fontSize: 10,
        color: 'var(--text-muted)',
        textDecoration: 'none',
        fontFamily: "'Figtree', sans-serif",
        whiteSpace: 'nowrap',
        flexShrink: 0,
        padding: '2px 4px',
      }}
      onMouseEnter={e => {
        ;(e.currentTarget as HTMLAnchorElement).style.textDecoration = 'underline'
        ;(e.currentTarget as HTMLAnchorElement).style.color = 'var(--text)'
      }}
      onMouseLeave={e => {
        ;(e.currentTarget as HTMLAnchorElement).style.textDecoration = 'none'
        ;(e.currentTarget as HTMLAnchorElement).style.color = 'var(--text-muted)'
      }}
    >
      {label}
    </a>
  )
}

function RegionButton({
  href,
  flag,
  sizeStyles,
  primary = false,
  onClickCapture,
}: {
  href: string
  flag: string
  sizeStyles: { padding: string; fontSize: number; flagSize: number; gap: number }
  primary?: boolean
  onClickCapture?: () => void
}) {
  return (
    <a
      href={href}
      target="_blank"
      rel="sponsored noopener noreferrer"
      onClick={onClickCapture}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: sizeStyles.gap,
        padding: sizeStyles.padding,
        borderRadius: 10,
        textDecoration: 'none',
        fontSize: sizeStyles.fontSize,
        fontWeight: 700,
        fontFamily: "'Figtree', sans-serif",
        border: '1px solid var(--border)',
        background: primary ? 'var(--primary)' : 'var(--bg-light)',
        color: primary ? '#fff' : 'var(--text)',
        whiteSpace: 'nowrap',
        transition: 'opacity 0.15s',
      }}
      onMouseEnter={e => {
        ;(e.currentTarget as HTMLAnchorElement).style.opacity = '0.85'
      }}
      onMouseLeave={e => {
        ;(e.currentTarget as HTMLAnchorElement).style.opacity = '1'
      }}
    >
      <span style={{ fontSize: sizeStyles.flagSize }}>{flag}</span>
      Click here for eBay listings
    </a>
  )
}
