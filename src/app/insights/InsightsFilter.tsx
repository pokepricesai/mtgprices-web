'use client'

// src/app/insights/InsightsFilter.tsx
// Compact category filter + article grid for the /insights index.

import { useMemo, useState } from 'react'
import Link from 'next/link'
import type { InsightMeta, InsightCategory } from '@/lib/insights'

type Props = {
  items: InsightMeta[]
  categories: InsightCategory[]
}

export default function InsightsFilter({ items, categories }: Props) {
  const [active, setActive] = useState<'All' | InsightCategory>('All')
  const filtered = useMemo(() => (
    active === 'All' ? items : items.filter((a) => a.category === active)
  ), [items, active])

  if (items.length === 0) return null

  const chips: ('All' | InsightCategory)[] = ['All', ...categories]

  return (
    <div>
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 20 }}>
        {chips.map((c) => (
          <button
            key={c}
            type="button"
            onClick={() => setActive(c)}
            style={{
              padding: '6px 12px', borderRadius: 999,
              background: active === c ? 'var(--accent-soft)' : 'var(--surface)',
              color: active === c ? 'var(--gold-600)' : 'var(--text)',
              border: `1px solid ${active === c ? 'var(--accent-border)' : 'var(--border)'}`,
              fontSize: 13, fontWeight: 700, fontFamily: 'inherit', cursor: 'pointer',
            }}
          >{c}</button>
        ))}
      </div>

      {filtered.length === 0 ? (
        <div style={{
          padding: 20, background: 'var(--surface)',
          border: '1px solid var(--border)', borderRadius: 14,
          color: 'var(--text-muted)', fontSize: 14,
        }}>Nothing in this category yet.</div>
      ) : (
        <div style={{
          display: 'grid', gap: 16,
          gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))',
        }}>
          {filtered.map((a) => <ArticleCard key={a.slug} article={a} />)}
        </div>
      )}
    </div>
  )
}

function ArticleCard({ article }: { article: InsightMeta }) {
  return (
    <Link
      href={`/insights/${article.slug}`}
      className="card-hover card-hover-gold"
      style={{
        display: 'flex', flexDirection: 'column', gap: 8,
        padding: 20, borderRadius: 16,
        background: 'var(--surface)', border: '1px solid var(--border)',
        textDecoration: 'none', color: 'var(--text)',
        boxShadow: '0 4px 14px rgba(20,33,61,0.04)',
      }}
    >
      <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
        <span className="chip chip-arcane" style={{ fontSize: 11 }}>{article.category}</span>
        <span style={{ fontSize: 11.5, color: 'var(--text-muted)' }}>{formatDate(article.publishedAt)}</span>
        <span style={{ fontSize: 11.5, color: 'var(--text-muted)' }}>· {article.readingTimeMin} min</span>
      </div>
      <div style={{
        fontSize: 18, fontWeight: 700, color: 'var(--text-strong)', lineHeight: 1.25,
      }}>{article.title}</div>
      {article.description && (
        <p style={{ margin: 0, fontSize: 13.5, color: 'var(--text-muted)', lineHeight: 1.55 }}>
          {article.description}
        </p>
      )}
    </Link>
  )
}

function formatDate(iso: string): string {
  const d = new Date(iso + 'T00:00:00Z')
  if (Number.isNaN(d.getTime())) return iso
  return d.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' })
}
