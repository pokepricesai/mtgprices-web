// app/set/[setCode]/page.tsx — one MTG set: card grid with headline prices.
import Link from 'next/link'
import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { getSetByCode } from '@/lib/mtg/sets'
import { listPrintingsForSet, buildCardSlug } from '@/lib/mtg/cards'
import { getHeadlinePricesByPrinting } from '@/lib/mtg/prices'

export const revalidate = 300

type Params = { setCode: string }

export async function generateMetadata({ params }: { params: Promise<Params> }): Promise<Metadata> {
  const { setCode } = await params
  const set = await getSetByCode(setCode)
  if (!set) return { title: 'Set not found' }
  return {
    title: `${set.name} — MTG prices`,
    description: `Every card in ${set.name} with live paper prices, images and Scryfall metadata.`,
    alternates: { canonical: `https://mtgprices.io/set/${set.code}` },
  }
}

function formatUSD(n: number | undefined): string {
  if (n === undefined || n === null || !Number.isFinite(n)) return '—'
  return `$${n.toFixed(2)}`
}

const RARITY_COLOUR: Record<string, string> = {
  common: '#9AA3B2',
  uncommon: '#c0c8d0',
  rare: '#C9A55C',
  mythic: '#e07d3a',
  special: '#7C5CE7',
  bonus: '#7C5CE7',
}

export default async function SetPage({ params }: { params: Promise<Params> }) {
  const { setCode } = await params
  const set = await getSetByCode(setCode)
  if (!set) notFound()

  const printings = await listPrintingsForSet(set.code)
  const printingIds = printings.map((p) => p.id)
  const headlineMap = await getHeadlinePricesByPrinting(printingIds)

  return (
    <div style={{ maxWidth: 1200, margin: '0 auto', padding: '32px 24px 64px' }}>
      {/* Header */}
      <div style={{ marginBottom: 24 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8 }}>
          {set.icon_svg_uri ? (
            <img src={set.icon_svg_uri} alt="" aria-hidden style={{ width: 26, height: 26, filter: 'invert(85%)' }} />
          ) : null}
          <span className="label-mono">{set.code}</span>
          {set.set_type && <span className="label-mono" style={{ color: 'var(--accent)' }}>{set.set_type.replace(/_/g, ' ')}</span>}
        </div>
        <h1 style={{ margin: 0, fontSize: 30 }}>{set.name}</h1>
        <div style={{ color: 'var(--text-muted)', fontSize: 13, marginTop: 6, display: 'flex', gap: 12, flexWrap: 'wrap' }}>
          {set.released_at && <span>Released {set.released_at}</span>}
          {set.card_count != null && <span>{set.card_count.toLocaleString()} cards</span>}
          {set.block && <span>{set.block}</span>}
          <span>{printings.length.toLocaleString()} printings shown</span>
        </div>
      </div>

      {/* Grid */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))',
          gap: 14,
        }}
      >
        {printings.map((p) => {
          const slug = p.collector_number ? buildCardSlug(p.collector_number, p.name) : ''
          const href = slug ? `/set/${set.code}/card/${slug}` : '#'
          const rarityDot = p.rarity ? RARITY_COLOUR[p.rarity] ?? 'var(--text-muted)' : 'var(--text-muted)'
          const price = headlineMap.get(p.id)
          return (
            <Link
              key={p.id}
              href={href}
              className="card-hover"
              style={{
                display: 'block',
                background: 'var(--surface)',
                border: '1px solid var(--border)',
                borderRadius: 12,
                padding: 12,
                textDecoration: 'none',
                color: 'var(--text)',
              }}
            >
              <div
                style={{
                  aspectRatio: '5 / 7',
                  borderRadius: 6,
                  background: 'var(--bg-light)',
                  marginBottom: 10,
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
                ) : (
                  <span style={{ color: 'var(--text-muted)', fontSize: 12 }}>No image</span>
                )}
              </div>
              <div style={{ fontSize: 14, fontWeight: 700, lineHeight: 1.25, minHeight: 34 }}>{p.name}</div>
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  marginTop: 8,
                  gap: 6,
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, color: 'var(--text-muted)', fontSize: 11 }}>
                  <span style={{ width: 8, height: 8, borderRadius: '50%', background: rarityDot, display: 'inline-block' }} aria-hidden />
                  <span>#{p.collector_number ?? '—'}</span>
                </div>
                <span
                  style={{
                    color: price !== undefined ? 'var(--text)' : 'var(--text-muted)',
                    fontWeight: price !== undefined ? 700 : 500,
                    fontSize: 13,
                    fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
                  }}
                >
                  {formatUSD(price)}
                </span>
              </div>
            </Link>
          )
        })}
      </div>

      {printings.length === 0 && (
        <div
          style={{
            padding: 24,
            background: 'var(--surface)',
            border: '1px solid var(--border)',
            borderRadius: 12,
            color: 'var(--text-muted)',
          }}
        >
          No printings for this set are indexed yet.
        </div>
      )}
    </div>
  )
}
