'use client'

// src/components/mtg/TcgplayerLinkButton.tsx
//
// CN-05 Sprint 5 — second buying CTA alongside EbayLinkButton on
// CardMarketOverview. Uses the Impact share-link deep-link pattern
// verified in Sprint 4. Exact-product URL when productId is numeric;
// search fallback otherwise with an honest "Find on TCGplayer" label.
//
// Rendering variants mirror EbayLinkButton:
//   variant="gold" — primary-weight CTA in CardMarketOverview.
//   variant="chip" — compact chip for the printing-comparison row.
//
// Click tracking: fires window.gtag('event', 'affiliate_click', …)
// directly. MTG does not use the shared @collector-network/affiliate-
// tracking beacon (separate repo), so the component attaches an
// inline onClick. gtag is defined by components/GoogleAnalytics.tsx
// at page load; the call is a no-op when gtag is undefined (dev,
// blocked analytics). No per-click Supabase write.

import { useMemo } from 'react'
import { buildMtgTcgplayerLink } from '@/lib/mtg/tcgplayerAffiliate'

type Props = {
  cardName: string
  setName?: string | null
  setCode?: string | null
  collectorNumber?: string | null
  /** Numeric TCGplayer product ID from mtg_external_identifiers.
   *  When null (current state across the catalogue), falls back to
   *  a TCGplayer magic search URL. */
  productId?: string | number | null
  variant?: 'gold' | 'chip'
  /** Placement identifier for GA4 event parameters and Impact SubID. */
  placement?: string
}

export default function TcgplayerLinkButton({
  cardName,
  setName,
  setCode,
  collectorNumber,
  productId,
  variant = 'gold',
  placement = 'mtg-card-market',
}: Props) {
  const link = useMemo(
    () =>
      buildMtgTcgplayerLink({
        cardName,
        setCode: setCode ?? null,
        collectorNumber: collectorNumber ?? null,
        productId: productId ?? null,
        subid: `mtg:${placement}:${(setCode ?? '').toLowerCase()}-${(collectorNumber ?? '').toString().slice(0, 20)}`,
      }),
    [cardName, setCode, collectorNumber, productId, placement],
  )

  function onClick() {
    // Lightweight direct gtag call — matches MTG's existing analytics
    // approach (no central trackEvent helper in this repo). No-op when
    // gtag is undefined.
    try {
      const w = window as unknown as {
        gtag?: (command: 'event', eventName: string, params?: Record<string, unknown>) => void
      }
      if (typeof w.gtag === 'function') {
        w.gtag('event', 'affiliate_click', {
          site: window.location.hostname,
          merchant: 'tcgplayer',
          placement,
          page_type: 'card',
          source_component: 'TcgplayerLinkButton',
          set_slug: setCode ?? undefined,
          card_slug: collectorNumber ? `${(setCode ?? '').toLowerCase()}-${collectorNumber}` : undefined,
          intent: link.isExact ? 'exact' : 'search',
          destination_host: 'www.tcgplayer.com',
        })
      }
    } catch {
      /* ignore — never block navigation */
    }
  }

  if (variant === 'chip') {
    return (
      <a
        href={link.href}
        target="_blank"
        rel="sponsored nofollow noopener"
        title={link.label}
        onClick={onClick}
        data-affiliate="1"
        data-merchant="tcgplayer"
        data-component="TcgplayerLinkButton"
        data-placement={placement}
        data-intent={link.isExact ? 'exact' : 'search'}
        style={{
          padding: '5px 10px',
          borderRadius: 8,
          background: 'var(--surface)',
          color: 'var(--text)',
          border: '1px solid var(--border)',
          fontSize: 11.5,
          fontWeight: 700,
          textDecoration: 'none',
        }}
      >
        TCGplayer
      </a>
    )
  }

  return (
    <a
      href={link.href}
      target="_blank"
      rel="sponsored nofollow noopener"
      onClick={onClick}
      data-affiliate="1"
      data-merchant="tcgplayer"
      data-component="TcgplayerLinkButton"
      data-placement={placement}
      data-intent={link.isExact ? 'exact' : 'search'}
      className="btn btn-sm"
      style={{
        background: 'var(--surface)',
        color: 'var(--text)',
        border: '1px solid var(--border)',
      }}
    >
      {link.label}
    </a>
  )
}
