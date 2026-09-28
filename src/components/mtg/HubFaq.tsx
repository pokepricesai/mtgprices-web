// src/components/mtg/HubFaq.tsx
// Server component. Reusable visible FAQ block for public hub pages
// (homepage, /browse, /market, /graded, /card-finder, /formats).
// Deterministic content only (no AI, no per-request DB reads inside
// the component itself). Callers may pass counts/basis for a hub in
// props if they want to inline real numbers.
//
// No FAQPage JSON-LD is emitted (Google retired FAQ rich results in
// 2026). The block is for humans and for on-page relevance signals.

import Link from 'next/link'
import type { ReactNode } from 'react'

export type HubFaqEntry = {
  q: string
  a: ReactNode
}

type Props = {
  label?: string
  heading: string
  entries: HubFaqEntry[]
}

export default function HubFaq({ label = 'Frequently asked', heading, entries }: Props) {
  if (entries.length === 0) return null
  return (
    <section
      aria-label={heading}
      style={{
        padding: 20,
        background: 'var(--surface)',
        border: '1px solid var(--border)',
        borderRadius: 14,
        boxShadow: '0 3px 10px rgba(20,33,61,0.03)',
        marginTop: 32,
      }}
    >
      <div className="label-mono" style={{ color: 'var(--gold-600)', marginBottom: 8 }}>{label}</div>
      <h2 className="display" style={{ margin: 0, fontSize: 22, color: 'var(--text-strong)' }}>
        {heading}
      </h2>
      <div style={{ marginTop: 12, display: 'grid', gap: 4 }}>
        {entries.map((f) => (
          <details
            key={f.q}
            style={{ padding: '10px 12px', borderTop: '1px solid var(--border)' }}
          >
            <summary
              style={{
                cursor: 'pointer',
                fontWeight: 700,
                color: 'var(--text-strong)',
                fontSize: 14.5,
                listStyle: 'none',
              }}
            >{f.q}</summary>
            <div style={{ marginTop: 8, fontSize: 13.5, color: 'var(--text-muted)', lineHeight: 1.6 }}>
              {f.a}
            </div>
          </details>
        ))}
      </div>
    </section>
  )
}

// Convenience Link wrapper for FAQ answers so callers don't have to
// import Link on every hub page.
export function A({ href, children }: { href: string; children: ReactNode }) {
  return (
    <Link href={href} style={{ color: 'var(--gold-600)', fontWeight: 700, textDecoration: 'none' }}>
      {children}
    </Link>
  )
}
