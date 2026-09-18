// src/components/mtg/OtherPrintings.tsx
// Grid of other printings for the same oracle card.
// Server component, takes pre-computed headline prices from the parent.

import Link from 'next/link'
import { buildCardSlug, type MtgPrinting } from '@/lib/mtg/cards'

type Props = {
  currentPrintingId: string
  otherPrintings: MtgPrinting[]
  headlinePriceByPrinting: Map<string, number>
}

const RARITY_COLOR: Record<string, string> = {
  common: '#9AA3B2',
  uncommon: '#c0c8d0',
  rare: '#E8A94B',
  mythic: '#e07d3a',
  special: '#235FAE',
  bonus: '#235FAE',
}

function fmtUSD(v: number | undefined): string {
  if (v === undefined || v === null || !Number.isFinite(v)) return '-'
  return `$${v.toFixed(2)}`
}

export default function OtherPrintings({ currentPrintingId, otherPrintings, headlinePriceByPrinting }: Props) {
  if (otherPrintings.length === 0) {
    return <div style={{ color: 'var(--text-muted)', fontSize: 13 }}>This is the only English printing.</div>
  }
  // Summary line
  const releaseDates = otherPrintings.map((p) => p.released_at).filter((s): s is string => Boolean(s)).sort()
  const cheapest = otherPrintings.reduce<{ p: MtgPrinting; price: number } | null>((acc, p) => {
    const price = headlinePriceByPrinting.get(p.id)
    if (price === undefined || !Number.isFinite(price)) return acc
    if (!acc || price < acc.price) return { p, price }
    return acc
  }, null)

  return (
    <div>
      <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 12, display: 'flex', flexWrap: 'wrap', gap: 12 }}>
        <span><strong style={{ color: 'var(--text)' }}>{otherPrintings.length}</strong> other English printing{otherPrintings.length === 1 ? '' : 's'}</span>
        {releaseDates.length > 0 && (
          <>
            <span>Earliest <strong style={{ color: 'var(--text)' }}>{releaseDates[0]}</strong></span>
            <span>Newest <strong style={{ color: 'var(--text)' }}>{releaseDates[releaseDates.length - 1]}</strong></span>
          </>
        )}
        {cheapest && (
          <span>Cheapest priced <strong style={{ color: 'var(--text)' }}>{fmtUSD(cheapest.price)}</strong> in {cheapest.p.set_code.toUpperCase()}</span>
        )}
      </div>
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fill, minmax(160px, 1fr))',
          gap: 10,
        }}
      >
        {otherPrintings.map((p) => {
          if (p.id === currentPrintingId) return null
          const slug = p.collector_number ? buildCardSlug(p.collector_number, p.name) : ''
          const href = slug ? `/set/${p.set_code}/card/${slug}` : '#'
          const price = headlinePriceByPrinting.get(p.id)
          const dot = p.rarity ? RARITY_COLOR[p.rarity] ?? 'var(--text-muted)' : 'var(--text-muted)'
          return (
            <Link
              key={p.id}
              href={href}
              className="card-hover"
              style={{
                display: 'block',
                background: 'var(--surface)',
                border: '1px solid var(--border)',
                borderRadius: 10,
                padding: 8,
                textDecoration: 'none',
                color: 'var(--text)',
              }}
            >
              <div
                style={{
                  aspectRatio: '5 / 7',
                  borderRadius: 5,
                  background: 'var(--bg-light)',
                  marginBottom: 8,
                  overflow: 'hidden',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
              >
                {p.image_uri_small ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={p.image_uri_small}
                    alt={p.name}
                    style={{ width: '100%', height: '100%', objectFit: 'cover' }}
                    loading="lazy"
                  />
                ) : null}
              </div>
              <div style={{ fontSize: 11, color: 'var(--text-muted)', display: 'flex', gap: 6, alignItems: 'center' }}>
                <span style={{ width: 6, height: 6, borderRadius: '50%', background: dot }} aria-hidden />
                <span style={{ textTransform: 'uppercase' }}>{p.set_code}</span>
                <span>· #{p.collector_number ?? '-'}</span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginTop: 4 }}>
                <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>{p.released_at ?? ''}</span>
                <span style={{ fontSize: 13, fontWeight: 700, fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace' }}>{fmtUSD(price)}</span>
              </div>
            </Link>
          )
        })}
      </div>
    </div>
  )
}
