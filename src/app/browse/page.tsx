// app/browse/page.tsx — list every non-digital MTG set.
import Link from 'next/link'
import type { Metadata } from 'next'
import { listSets } from '@/lib/mtg/sets'

export const revalidate = 900   // 15 min

export const metadata: Metadata = {
  title: 'Browse MTG sets',
  description: 'Every Magic: The Gathering set with live prices, sorted newest first.',
  alternates: { canonical: 'https://mtgprices.io/browse' },
  openGraph: { url: 'https://mtgprices.io/browse' },
}

export default async function BrowsePage() {
  const sets = await listSets({ limit: 800 })

  // Group by release year for scannable browsing.
  const byYear = new Map<string, typeof sets>()
  for (const s of sets) {
    const year = s.released_at?.slice(0, 4) ?? 'Unknown'
    if (!byYear.has(year)) byYear.set(year, [])
    byYear.get(year)!.push(s)
  }
  const years = Array.from(byYear.keys()).sort((a, b) => (a === 'Unknown' ? 1 : b === 'Unknown' ? -1 : b.localeCompare(a)))

  return (
    <div style={{ maxWidth: 1100, margin: '0 auto', padding: '32px 24px 64px' }}>
      <div style={{ marginBottom: 24 }}>
        <div className="label-mono">Browse</div>
        <h1 style={{ margin: '6px 0 0', fontSize: 28 }}>Magic sets</h1>
        <p style={{ color: 'var(--text-muted)', marginTop: 6 }}>
          {sets.length.toLocaleString()} sets ready for browsing. Click a set to see its printings and prices.
        </p>
      </div>

      {years.map((year) => (
        <section key={year} style={{ marginBottom: 36 }}>
          <div
            style={{
              display: 'flex',
              alignItems: 'baseline',
              gap: 12,
              marginBottom: 12,
              paddingBottom: 8,
              borderBottom: '1px solid var(--border)',
            }}
          >
            <h2 style={{ margin: 0, fontSize: 18 }}>{year}</h2>
            <span style={{ color: 'var(--text-muted)', fontSize: 12 }}>
              {byYear.get(year)!.length} set{byYear.get(year)!.length === 1 ? '' : 's'}
            </span>
          </div>
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))',
              gap: 10,
            }}
          >
            {byYear.get(year)!.map((set) => (
              <Link
                key={set.id}
                href={`/set/${set.code}`}
                className="card-hover"
                style={{
                  display: 'block',
                  background: 'var(--surface)',
                  border: '1px solid var(--border)',
                  borderRadius: 10,
                  padding: '12px 14px',
                  textDecoration: 'none',
                  color: 'var(--text)',
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  {set.icon_svg_uri ? (
                    <img src={set.icon_svg_uri} alt="" aria-hidden style={{ width: 20, height: 20, filter: 'invert(85%)' }} />
                  ) : (
                    <span style={{ width: 20, height: 20, borderRadius: 4, background: 'var(--bg-light)', border: '1px solid var(--border)' }} />
                  )}
                  <span className="label-mono">{set.code}</span>
                </div>
                <div style={{ fontSize: 14, fontWeight: 700, marginTop: 6, lineHeight: 1.25 }}>{set.name}</div>
                <div style={{ color: 'var(--text-muted)', fontSize: 11, marginTop: 4 }}>
                  {set.released_at ?? '—'}
                  {set.card_count ? <> · {set.card_count.toLocaleString()} cards</> : null}
                </div>
              </Link>
            ))}
          </div>
        </section>
      ))}
    </div>
  )
}
