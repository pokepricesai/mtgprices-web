// src/components/mtg/CapabilityChips.tsx
// Renders the deterministic capability tags produced by classifyCard().
// Non-decorative — each chip is a real filter target for future search.

import Link from 'next/link'
import type { CardCapability } from '@/lib/mtg/classify'
import { labelForCapability } from '@/lib/mtg/classify'

type Props = {
  caps: CardCapability[]
  linkable?: boolean
}

const TYPE_CAPS = new Set<CardCapability>(['creature', 'planeswalker', 'battle', 'enchantment', 'artifact', 'land', 'instant', 'sorcery'])

export default function CapabilityChips({ caps, linkable = false }: Props) {
  if (caps.length === 0) return null
  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
      {caps.map((c) => {
        const isType = TYPE_CAPS.has(c)
        const chip = (
          <span
            style={{
              padding: '4px 10px',
              borderRadius: 999,
              fontSize: 12,
              fontWeight: 600,
              background: isType ? 'var(--surface)' : 'rgba(124,92,231,0.15)',
              color: isType ? 'var(--text)' : '#c8b8ff',
              border: `1px solid ${isType ? 'var(--border)' : 'rgba(124,92,231,0.35)'}`,
              whiteSpace: 'nowrap',
            }}
          >
            {labelForCapability(c)}
          </span>
        )
        if (linkable && !isType) {
          return (
            <Link key={c} href={`/cards/search?cap=${c}`} style={{ textDecoration: 'none' }}>
              {chip}
            </Link>
          )
        }
        return <span key={c}>{chip}</span>
      })}
    </div>
  )
}
