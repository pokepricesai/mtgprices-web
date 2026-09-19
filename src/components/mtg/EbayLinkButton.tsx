'use client'

// src/components/mtg/EbayLinkButton.tsx
// Client-side wrapper that resolves the visitor's country via the
// existing useCountry hook (single session-cached /api/geo fetch) and
// builds a marketplace-appropriate eBay search link.
//
// Rendering variants:
//   variant="gold"      Primary CTA in the CardMarketOverview panel.
//   variant="chip"      Compact chip used in the printing comparison
//                       actions column.

import { useMemo } from 'react'
import { buildEbaySearchLink } from '@/lib/mtg/ebay-links'
import type { EbayMarketplace, EbaySearchInput } from '@/lib/mtg/ebay-links'
import { useCountry } from '@/lib/geo/useCountry'

type Props = Omit<EbaySearchInput, 'marketplace'> & {
  variant?: 'gold' | 'chip'
  // When true, hide the affiliate disclosure. Callers where multiple
  // ebay buttons render in a row can prefer showing a single disclosure
  // above the row.
  hideDisclosure?: boolean
}

const SUPPORTED: readonly EbayMarketplace[] = ['US', 'GB', 'DE', 'FR', 'IT', 'ES', 'AU', 'CA'] as const

function mapCountry(country: string | null): EbayMarketplace | undefined {
  if (!country) return undefined
  const key = country.toUpperCase() as EbayMarketplace
  return (SUPPORTED as readonly string[]).includes(key) ? key : undefined
}

export default function EbayLinkButton({
  variant = 'gold',
  hideDisclosure = false,
  ...input
}: Props) {
  const country = useCountry()
  const marketplace = mapCountry(country)

  const link = useMemo(() => buildEbaySearchLink({ ...input, marketplace }), [input, marketplace])

  if (variant === 'chip') {
    return (
      <a
        href={link.href}
        target="_blank"
        rel="sponsored nofollow noopener"
        title={link.label}
        style={{
          padding: '5px 10px', borderRadius: 8,
          background: 'var(--accent-soft)', color: 'var(--gold-600)',
          border: '1px solid var(--accent-border)',
          fontSize: 11.5, fontWeight: 700, textDecoration: 'none',
        }}
      >eBay</a>
    )
  }

  return (
    <span style={{ display: 'inline-flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
      <a
        href={link.href}
        target="_blank"
        rel="sponsored nofollow noopener"
        className="btn btn-gold btn-sm"
      >
        {link.label}
      </a>
      {link.affiliate && !hideDisclosure && (
        <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>
          Affiliate link. MTGPrices may earn a commission on qualifying purchases.
        </span>
      )}
    </span>
  )
}
