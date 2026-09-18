// app/browse/page.tsx, list every non-digital MTG set with filtering
// and sorting. The client component owns the filter, sort and grouping
// UI. The server component just fetches the sets and passes them down.

import type { Metadata } from 'next'
import { listSets } from '@/lib/mtg/sets'
import BrowseClient from './BrowseClient'

export const revalidate = 900   // 15 min

export const metadata: Metadata = {
  title: 'Browse MTG sets, filter by type and year | MTGPrices',
  description: 'Every Magic: The Gathering set indexed by MTGPrices. Filter by type (expansion, commander, masters, promo) and year, sort by release date, name or size.',
  alternates: { canonical: 'https://mtgprices.io/browse' },
  openGraph: { url: 'https://mtgprices.io/browse' },
}

export default async function BrowsePage() {
  const sets = await listSets({ limit: 800 })

  return (
    <div style={{ maxWidth: 1180, margin: '0 auto', padding: '32px 24px 64px' }}>
      <div style={{ marginBottom: 20 }}>
        <div className="label-mono">Browse</div>
        <h1 style={{ margin: '6px 0 0', fontSize: 30 }}>Magic sets</h1>
        <p style={{ color: 'var(--text-muted)', marginTop: 8, maxWidth: 720, lineHeight: 1.6 }}>
          {sets.length.toLocaleString()} sets indexed. Filter by set type (expansion, commander,
          masters, promo, and more) or by release year, and sort to find what you need.
        </p>
      </div>
      <BrowseClient sets={sets} />
    </div>
  )
}
