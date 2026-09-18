// src/components/mtg/CapabilityChips.tsx
// Renders the deterministic capability tags produced by classifyCard().
// Non-decorative, each chip is a real filter target for future search.

import Link from 'next/link'
import type { CardCapability } from '@/lib/mtg/capabilities'
import { CAPABILITY_LABELS, TYPE_CAPABILITIES } from '@/lib/mtg/capabilities'

type Props = {
  caps: CardCapability[]
  /** When true, non-type chips link to the Card Finder filtered by that
   *  capability. Default true, capability chips are the primary
   *  discovery bridge from a card page into Card Finder. */
  linkable?: boolean
}

export default function CapabilityChips({ caps, linkable = true }: Props) {
  if (caps.length === 0) return null
  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
      {caps.map((c) => {
        const isType = TYPE_CAPABILITIES.has(c)
        const label = CAPABILITY_LABELS[c]
        const chipStyle: React.CSSProperties = {
          padding: '4px 10px',
          borderRadius: 999,
          fontSize: 12,
          fontWeight: 600,
          background: isType ? 'var(--surface)' : 'var(--primary-soft)',
          color: isType ? 'var(--text)' : 'var(--primary)',
          border: `1px solid ${isType ? 'var(--border)' : 'rgba(35,95,174,0.35)'}`,
          whiteSpace: 'nowrap',
          display: 'inline-block',
          textDecoration: 'none',
        }
        if (linkable && !isType) {
          return (
            <Link key={c} href={`/card-finder?mode=play&caps=${c}`} style={chipStyle} title={`Find more ${label.toLowerCase()} cards`}>
              {label}
            </Link>
          )
        }
        return <span key={c} style={chipStyle}>{label}</span>
      })}
    </div>
  )
}
