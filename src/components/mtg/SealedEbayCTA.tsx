'use client'

// Sealed-product discovery CTA for a set page. Deliberately NOT a
// price surface — MTGPrices does not track sealed prices; this
// simply points visitors at eBay's sealed listings for the given
// set. Reuses the shared EPN campaign + marketplace routing from
// buildEbaySearchLink, but composes a sealed-appropriate query so
// the search does not include a card name.

import { useMemo } from 'react'
import { buildEbaySearchLink } from '@/lib/mtg/ebay-links'
import type { EbayMarketplace } from '@/lib/mtg/ebay-links'
import { useCountry } from '@/lib/geo/useCountry'

const SUPPORTED: readonly EbayMarketplace[] = ['US', 'GB', 'DE', 'FR', 'IT', 'ES', 'AU', 'CA'] as const

function mapCountry(country: string | null): EbayMarketplace | undefined {
  if (!country) return undefined
  const key = country.toUpperCase() as EbayMarketplace
  return (SUPPORTED as readonly string[]).includes(key) ? key : undefined
}

type Props = { setName: string; setCode: string }

export default function SealedEbayCTA({ setName, setCode }: Props) {
  const country = useCountry()
  const marketplace = mapCountry(country)

  // `cardName` is repurposed here as the leading query term. eBay
  // treats the whole `_nkw` as free text, so this composes to
  // `${setName} sealed booster box bundle collector commander
  // Magic the Gathering` after buildQuery appends its constants.
  const link = useMemo(
    () =>
      buildEbaySearchLink({
        cardName: setName,
        modifier: 'sealed booster box bundle collector commander',
        marketplace,
        source: 'mtg-set-sealed-cta',
      }),
    [setName, marketplace],
  )

  return (
    <div
      style={{
        marginTop: 20,
        padding: '14px 16px',
        borderRadius: 12,
        border: '1px solid var(--border)',
        background: 'var(--surface)',
        display: 'flex',
        alignItems: 'center',
        gap: 14,
        flexWrap: 'wrap',
        justifyContent: 'space-between',
      }}
    >
      <div style={{ minWidth: 0 }}>
        <div style={{ fontWeight: 700, fontSize: 15 }}>Looking for sealed {setName}?</div>
        <div style={{ color: 'var(--text-muted)', fontSize: 12.5, marginTop: 3 }}>
          MTGPrices tracks singles, not sealed product. Browse booster boxes, bundles,
          collector boxes and commander decks for <span className="label-mono">{setCode}</span> on eBay.
        </div>
      </div>
      <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
        <a
          href={link.href}
          target="_blank"
          rel="sponsored nofollow noopener"
          className="btn btn-gold btn-sm"
        >
          Search sealed on eBay
        </a>
        {link.affiliate && (
          <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>
            Affiliate link. MTGPrices may earn a commission on qualifying purchases.
          </span>
        )}
      </div>
    </div>
  )
}
