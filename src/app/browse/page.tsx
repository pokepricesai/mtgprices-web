// app/browse/page.tsx, list every non-digital MTG set with filtering,
// sorting and per-set market intelligence (estimated value, 30D
// change, priced coverage, top card). The client component owns filter,
// sort and grouping UI. The server component fetches the sets plus the
// batched aggregates.

import type { Metadata } from 'next'
import { listSets } from '@/lib/mtg/sets'
import { getSetAggregates } from '@/lib/mtg/set-market-batch'
import BrowseClient from './BrowseClient'

export const revalidate = 900   // 15 min

export const metadata: Metadata = {
  title: 'Browse MTG sets, filter by type and year | MTGPrices',
  description: 'Every Magic: The Gathering set indexed by MTGPrices. Filter by type (expansion, commander, masters, promo) and year, sort by release date, name, size, estimated value or 30D change.',
  alternates: { canonical: 'https://mtgprices.io/browse' },
  openGraph: { url: 'https://mtgprices.io/browse' },
}

export default async function BrowsePage() {
  const sets = await listSets({ limit: 800 })
  const aggregates = await getSetAggregates(sets.map((s) => s.code))

  return (
    <div style={{ maxWidth: 1180, margin: '0 auto', padding: '32px 24px 64px' }}>
      <div style={{ marginBottom: 20 }}>
        <div className="label-mono">Browse</div>
        <h1 style={{ margin: '6px 0 0', fontSize: 30 }}>Magic sets</h1>
        <p style={{ color: 'var(--text-muted)', marginTop: 8, maxWidth: 720, lineHeight: 1.6 }}>
          {sets.length.toLocaleString()} sets indexed. Filter by set type (expansion, commander,
          masters, promo, and more) or by release year. Sort by release date, name, size,
          estimated value or 30 day change. Set values are cheapest nonfoil TCGplayer USD retail
          per printing.
        </p>
      </div>
      <BrowseClient
        sets={sets}
        aggregates={Object.fromEntries(Array.from(aggregates.entries()).map(([k, v]) => [k, v]))}
      />
    </div>
  )
}
