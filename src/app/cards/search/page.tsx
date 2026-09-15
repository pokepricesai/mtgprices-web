// app/cards/search/page.tsx — MTGPrices card search.
import Link from 'next/link'
import type { Metadata } from 'next'
import { searchCards, buildCardSlug } from '@/lib/mtg/cards'

export const dynamic = 'force-dynamic'

export const metadata: Metadata = {
  title: 'Search cards',
  description: 'Search live MTG card prices and printings across every set.',
  alternates: { canonical: 'https://mtgprices.io/cards/search' },
}

type SearchParams = { q?: string }

export default async function CardsSearchPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const params = await searchParams
  const query = (params.q ?? '').trim()
  const hits = query.length >= 2 ? await searchCards(query, 60) : []

  return (
    <div style={{ maxWidth: 1100, margin: '0 auto', padding: '32px 24px 64px' }}>
      <div style={{ marginBottom: 18 }}>
        <div className="label-mono">Search</div>
        <h1 style={{ margin: '6px 0 0', fontSize: 26 }}>
          {query ? <>Cards matching “{query}”</> : 'Search MTG cards'}
        </h1>
      </div>

      <form method="GET" action="/cards/search" style={{ marginBottom: 24 }}>
        <div style={{ display: 'flex', gap: 8 }}>
          <input
            type="text"
            name="q"
            defaultValue={query}
            placeholder="Card name, e.g. lightning bolt"
            autoFocus
            style={{
              flex: 1,
              padding: '11px 14px',
              border: '1px solid var(--border)',
              background: 'var(--surface)',
              color: 'var(--text)',
              borderRadius: 10,
              fontSize: 15,
              outline: 'none',
            }}
          />
          <button
            type="submit"
            style={{
              background: 'var(--primary)',
              color: '#fff',
              padding: '11px 18px',
              border: 'none',
              borderRadius: 10,
              fontWeight: 700,
              fontSize: 14,
              cursor: 'pointer',
            }}
          >
            Search
          </button>
        </div>
      </form>

      {query.length > 0 && query.length < 2 && (
        <div style={{ color: 'var(--text-muted)' }}>Type at least 2 characters.</div>
      )}

      {query.length >= 2 && hits.length === 0 && (
        <div
          style={{
            padding: 24,
            background: 'var(--surface)',
            border: '1px solid var(--border)',
            borderRadius: 12,
            color: 'var(--text-muted)',
          }}
        >
          No cards matching “{query}”.
        </div>
      )}

      {hits.length > 0 && (
        <div style={{ marginBottom: 12, color: 'var(--text-muted)', fontSize: 13 }}>
          Showing {hits.length} card{hits.length === 1 ? '' : 's'} (freshest printing per Oracle card).
        </div>
      )}

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', gap: 14 }}>
        {hits.map((h) => {
          const slug = h.collector_number ? buildCardSlug(h.collector_number, h.name) : ''
          const href = slug ? `/set/${h.set_code}/card/${slug}` : '#'
          return (
            <Link
              key={h.printing_id}
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
                {h.image_uri_small ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={h.image_uri_small}
                    alt={h.name}
                    style={{ width: '100%', height: '100%', objectFit: 'cover' }}
                    loading="lazy"
                  />
                ) : (
                  <span style={{ color: 'var(--text-muted)', fontSize: 12 }}>No image</span>
                )}
              </div>
              <div style={{ fontSize: 14, fontWeight: 700, lineHeight: 1.25 }}>{h.name}</div>
              <div style={{ color: 'var(--text-muted)', fontSize: 12, marginTop: 4, display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                <span style={{ textTransform: 'uppercase' }}>{h.set_code}</span>
                {h.collector_number && <span>· #{h.collector_number}</span>}
                {h.rarity && <span>· {h.rarity}</span>}
              </div>
              {h.type_line && (
                <div style={{ color: 'var(--text-muted)', fontSize: 11, marginTop: 6, lineHeight: 1.3 }}>
                  {h.type_line}
                </div>
              )}
            </Link>
          )
        })}
      </div>
    </div>
  )
}
