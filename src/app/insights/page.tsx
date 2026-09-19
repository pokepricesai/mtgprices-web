// app/insights/page.tsx, editorial index.
//
// Client-side category filter over the metadata list. The actual
// articles come from src/lib/insights.ts (repo-based markdown).

import type { Metadata } from 'next'
import Link from 'next/link'
import { listInsights, activeCategories, type InsightMeta } from '@/lib/insights'
import InsightsFilter from './InsightsFilter'

export const revalidate = 900

const SITE_URL = 'https://mtgprices.io'

export const metadata: Metadata = {
  title: 'Insights',
  description: 'Weekly MTGPrices editorial: pricing, collecting, deckbuilding, sets, formats and guides. Grounded in the MTGPrices catalogue and pricing data.',
  alternates: { canonical: `${SITE_URL}/insights` },
  openGraph: { url: `${SITE_URL}/insights` },
}

export default function InsightsIndex() {
  const items = listInsights()
  const cats = activeCategories()
  const featured = items[0] ?? null
  const rest = items.slice(1)

  return (
    <div style={{ maxWidth: 1180, margin: '0 auto', padding: '40px 24px 80px' }}>
      <div className="label-mono" style={{ color: 'var(--gold-600)' }}>Insights</div>
      <h1 className="display" style={{
        margin: '6px 0 0', fontSize: 'clamp(32px, 4vw, 44px)',
        color: 'var(--text-strong)', lineHeight: 1.1,
      }}>MTGPrices editorial</h1>
      <p style={{ color: 'var(--text-muted)', fontSize: 15.5, marginTop: 10, lineHeight: 1.6, maxWidth: 720 }}>
        Weekly writing on the Magic market, collecting, deckbuilding, sets and formats. Every
        piece is grounded in the same catalogue and pricing data as the rest of the site.
      </p>

      {items.length === 0 ? (
        <div style={{
          marginTop: 30, padding: 24, background: 'var(--surface)',
          border: '1px solid var(--border)', borderRadius: 14, color: 'var(--text-muted)',
        }}>
          The first articles are coming soon.
        </div>
      ) : (
        <>
          {featured && <FeaturedCard article={featured} />}
          <div style={{ marginTop: 24 }}>
            <InsightsFilter items={rest} categories={cats} />
          </div>
        </>
      )}
    </div>
  )
}

function FeaturedCard({ article }: { article: InsightMeta }) {
  return (
    <Link
      href={`/insights/${article.slug}`}
      className="card-hover card-hover-gold"
      style={{
        display: 'block', marginTop: 28,
        padding: 26, borderRadius: 20,
        background: 'linear-gradient(180deg, rgba(232,169,75,0.10) 0%, rgba(232,169,75,0) 60%), var(--surface)',
        border: '1px solid var(--border)', textDecoration: 'none', color: 'var(--text)',
        boxShadow: '0 4px 14px rgba(20,33,61,0.04)',
      }}
    >
      <div style={{ display: 'flex', gap: 10, alignItems: 'center', marginBottom: 10 }}>
        <span className="chip chip-gold">Latest</span>
        <span className="label-mono" style={{ color: 'var(--gold-600)' }}>{article.category}</span>
        <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>{formatDate(article.publishedAt)}</span>
        <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>· {article.readingTimeMin} min read</span>
      </div>
      <h2 className="display" style={{
        margin: 0, fontSize: 'clamp(24px, 3vw, 34px)', color: 'var(--text-strong)', lineHeight: 1.15,
      }}>{article.title}</h2>
      {article.description && (
        <p style={{ marginTop: 12, color: 'var(--text-muted)', fontSize: 15, lineHeight: 1.6, maxWidth: 720 }}>
          {article.description}
        </p>
      )}
      <div style={{
        marginTop: 14, fontSize: 13, fontWeight: 700, color: 'var(--gold-600)',
        display: 'inline-flex', alignItems: 'center', gap: 8,
      }}>Read now <span aria-hidden>→</span></div>
    </Link>
  )
}

function formatDate(iso: string): string {
  const d = new Date(iso + 'T00:00:00Z')
  if (Number.isNaN(d.getTime())) return iso
  return d.toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' })
}
