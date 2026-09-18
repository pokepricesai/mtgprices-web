// src/components/mtg/SimilarCards.tsx
// Server component, renders the "Find cards like this" strip on card
// pages using the deterministic similarity from src/lib/mtg/finder.ts.

import Link from 'next/link'
import { findSimilar } from '@/lib/mtg/finder'
import { buildCardSlug } from '@/lib/mtg/slug'

type Props = {
  oracleId: string
  currentPrintingId: string
}

export default async function SimilarCards({ oracleId, currentPrintingId }: Props) {
  const hits = await findSimilar(oracleId, 8)
  const filtered = hits.filter((h) => h.oracle_card_id !== oracleId)  // safety
  if (filtered.length === 0) return null

  return (
    <div>
      <div className="label-mono" style={{ marginBottom: 8, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <span>Similar cards</span>
        <Link href={`/card-finder?mode=play`} style={{ color: 'var(--accent)', fontSize: 11 }}>
          Open Card Finder →
        </Link>
      </div>
      <div style={{ fontSize: 11, color: 'var(--text-muted)', fontStyle: 'italic', marginBottom: 10 }}>
        Ranked by shared capabilities, colour identity, mana value and type. Never by strategic judgement.
      </div>
      <div style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fill, minmax(160px, 1fr))',
        gap: 10,
      }}>
        {filtered.map((h) => {
          const href = h.printing.collector_number
            ? `/set/${h.printing.set_code}/card/${buildCardSlug(h.printing.collector_number, h.name)}`
            : '#'
          return (
            <Link
              key={h.oracle_card_id}
              href={href}
              className="card-hover"
              style={{
                display: 'block', background: 'var(--surface)',
                border: '1px solid var(--border)', borderRadius: 10,
                padding: 8, textDecoration: 'none', color: 'var(--text)',
              }}
            >
              <div style={{
                aspectRatio: '5 / 7', borderRadius: 5, background: 'var(--bg-light)',
                marginBottom: 8, overflow: 'hidden',
              }}>
                {h.printing.image_uri_small ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={h.printing.image_uri_small} alt={h.name} style={{ width: '100%', height: '100%', objectFit: 'cover' }} loading="lazy" />
                ) : null}
              </div>
              <div style={{ fontSize: 12, fontWeight: 700, lineHeight: 1.25, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{h.name}</div>
              {h.reasons.length > 0 && (
                <div style={{ marginTop: 6, display: 'flex', flexWrap: 'wrap', gap: 4 }}>
                  {h.reasons.slice(0, 2).map((r, i) => (
                    <span key={i} style={{
                      fontSize: 10, padding: '2px 6px', borderRadius: 999,
                      background: 'var(--primary-soft)', color: 'var(--primary)',
                    }}>{r}</span>
                  ))}
                </div>
              )}
            </Link>
          )
        })}
      </div>
    </div>
  )
}
