'use client'
// src/components/mtg/RulingsList.tsx
// Chronological ruling list with a "show more" cutoff so a card with
// dozens of rulings doesn't dominate the page.

import { useState } from 'react'
import type { MtgRuling } from '@/lib/mtg/cards'

type Props = {
  rulings: MtgRuling[]
  initialCount?: number
}

function formatDate(iso: string | null): string {
  if (!iso) return ''
  try {
    const d = new Date(iso)
    return d.toLocaleDateString('en-GB', { year: 'numeric', month: 'short', day: 'numeric' })
  } catch { return iso }
}

export default function RulingsList({ rulings, initialCount = 6 }: Props) {
  const [expanded, setExpanded] = useState(false)
  if (rulings.length === 0) {
    return <div style={{ color: 'var(--text-muted)', fontSize: 13 }}>No rulings recorded for this card.</div>
  }
  // Rulings arrive newest-first from getCardBySlug. Present them
  // newest-first — most recent rulings are usually the most relevant.
  const shown = expanded ? rulings : rulings.slice(0, initialCount)
  const hiddenCount = rulings.length - shown.length

  return (
    <div style={{ display: 'grid', gap: 12 }}>
      {shown.map((r, i) => (
        <div
          key={i}
          style={{
            padding: 12,
            background: 'var(--surface)',
            border: '1px solid var(--border)',
            borderRadius: 10,
          }}
        >
          <div style={{ display: 'flex', gap: 10, alignItems: 'center', marginBottom: 6 }}>
            <span
              style={{
                fontSize: 11,
                fontWeight: 700,
                padding: '2px 8px',
                borderRadius: 999,
                background: 'var(--primary-soft)',
                color: 'var(--primary)',
                letterSpacing: 0.4,
                textTransform: 'uppercase',
              }}
            >
              {r.source}
            </span>
            <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>{formatDate(r.published_at)}</span>
          </div>
          <div style={{ fontSize: 14, lineHeight: 1.55, color: 'var(--text)' }}>{r.comment}</div>
        </div>
      ))}
      {hiddenCount > 0 && (
        <button
          type="button"
          onClick={() => setExpanded(!expanded)}
          style={{
            padding: '10px 14px',
            background: 'transparent',
            border: '1px solid var(--border)',
            borderRadius: 10,
            color: 'var(--accent)',
            fontSize: 13,
            fontWeight: 600,
            cursor: 'pointer',
          }}
        >
          {expanded ? 'Show fewer rulings' : `Show ${hiddenCount} more ruling${hiddenCount === 1 ? '' : 's'}`}
        </button>
      )}
    </div>
  )
}
