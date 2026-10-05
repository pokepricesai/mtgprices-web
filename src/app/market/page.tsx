// app/market/page.tsx, dedicated market movers surface. Window is
// picked via a small query-string switch (7 / 30 / 90 days). All
// numbers are basis-locked (TCGplayer USD paper retail).
//
// Rendering shape:
//   - True static shell. This Server Component performs ZERO Supabase
//     / database / API mover queries. getMarketMoversStrict is not
//     referenced here and never runs during build. Build-time
//     statement_timeout pressure cannot kill this page.
//   - All mover payloads come from MarketMoversClient fetching
//     /api/market/movers?window=7|30|90 after hydration. That API
//     route uses getMarketMoversStrict and is separately CDN-cached
//     (24h s-maxage + stale-while-revalidate) so repeat requests are
//     edge HITs and only the first warm call per window per cache
//     window per region executes the full computation.
//   - Canonical URL stays https://mtgprices.io/market for every
//     window variant — searchParams never participate in canonical,
//     so `?window=7` and `?window=90` consolidate to the same
//     indexable page.
//
// Follow-up: see src/lib/mtg/movers.ts strict path. A future ingest
// job could materialise 7/30/90-day snapshots so the server page can
// server-render the 30d view from a single cheap read, restoring
// first-paint content for crawlers without reintroducing the full
// strict calculation at build time.

import type { Metadata } from 'next'
import { Suspense } from 'react'
import HubFaq, { A } from '@/components/mtg/HubFaq'
import MarketMoversClient from './MarketMoversClient'

export const revalidate = 86400

export const metadata: Metadata = {
  title: 'MTG Market Movers, Top Risers and Fallers',
  description: 'Deterministic 7, 30 and 90 day market movers for Magic: The Gathering cards on TCGplayer USD paper retail. Top risers, top fallers, most active, most valuable.',
  alternates: { canonical: 'https://mtgprices.io/market' },
  openGraph: { url: 'https://mtgprices.io/market' },
}

export default function MarketPage() {
  return (
    <div style={{ maxWidth: 1180, margin: '0 auto', padding: '32px 24px 64px' }}>
      <div style={{ marginBottom: 20 }}>
        <div className="label-mono">Market</div>
        <h1 style={{ margin: '6px 0 0', fontSize: 30 }}>MTG market movers</h1>
        <p style={{ color: 'var(--text-muted)', marginTop: 8, maxWidth: 720, lineHeight: 1.6 }}>
          Deterministic rises and falls over the last window. Basis locked to TCGplayer
          USD paper retail so every number is like for like. Movers require a healthy
          span of observations inside the window and a headline price of at least $2 to
          reduce noise. Not financial advice.
        </p>
      </div>

      {/* Suspense boundary required so useSearchParams inside the
          client island does not opt the whole route into dynamic
          rendering. The server HTML ships a lightweight shell + the
          client island; mover payloads arrive after hydration from
          the cached /api/market/movers endpoint. */}
      <Suspense fallback={null}>
        <MarketMoversClient />
      </Suspense>

      <HubFaq
        heading="About MTG market movers"
        entries={[
          {
            q: 'What price basis is used?',
            a: (
              <>
                Every mover on this page is computed on TCGplayer USD paper retail. We do
                not blend Card Kingdom, Cardmarket EUR, ManaPool, or graded slabs into the
                movers ranking. If a card has no TCGplayer price on the day, it does not
                appear as a mover.
              </>
            ),
          },
          {
            q: 'Why do some famously valuable cards not appear here?',
            a: (
              <>
                A mover must have both an earliest and a latest observation with a genuine
                span inside the selected window, a headline price of at least $2 (penny
                cards are noisy), and an absolute delta over $0.25. Cards that are stable in
                price simply have no movement to report. Use the "Most valuable" panel or
                the <A href="/browse">Browse sets</A> value view for absolute worth.
              </>
            ),
          },
          {
            q: 'Are risers a buy signal?',
            a: (
              <>
                No. This is not financial advice. Movers show what changed on the retail
                basis; they do not distinguish speculation from real reprint/format shifts.
                Use the 7 / 30 / 90 day windows together to sanity check whether a rise or
                fall is a spike or a sustained trend.
              </>
            ),
          },
          {
            q: 'How do I see graded movers?',
            a: (
              <>
                Graded pricing lives on <A href="/graded">/graded</A> and on each card page's
                Graded Market panel. We do not currently rank graded movers site-wide.
              </>
            ),
          },
          {
            q: 'How do I find cards under a specific price?',
            a: (
              <>
                Use the <A href="/card-finder">Card Finder</A> with a max-price filter and a
                format legality filter. Combine with a rarity or set filter to narrow further.
              </>
            ),
          },
        ]}
      />
    </div>
  )
}
