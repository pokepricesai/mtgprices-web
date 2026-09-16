// src/components/mtg/LegalityMatrix.tsx
// Grouped format legality display for the card page.
// Only shows formats present in FORMATS (the curated list) — hides
// obscure formats that would just add clutter.

import Link from 'next/link'
import type { MtgLegality } from '@/lib/mtg/cards'
import { FORMATS, FORMAT_GROUPS, type FormatDef } from '@/lib/mtg/formats'

type Props = {
  legalities: MtgLegality[]
}

const BADGE: Record<string, { bg: string; fg: string; label: string }> = {
  legal:      { bg: 'rgba(43,134,89,0.14)', fg: 'var(--green)', label: 'Legal' },
  banned:     { bg: 'rgba(180,65,70,0.14)', fg: 'var(--red)', label: 'Banned' },
  restricted: { bg: 'var(--accent-soft)', fg: 'var(--amber)', label: 'Restricted' },
  not_legal:  { bg: 'rgba(107,114,128,0.10)', fg: '#9AA3B2', label: 'Not legal' },
}

export default function LegalityMatrix({ legalities }: Props) {
  const byKey = new Map(legalities.map((l) => [l.format, l.legality]))
  const definedFormats = FORMATS.filter((f) => byKey.has(f.key))
  if (definedFormats.length === 0) {
    return (
      <div style={{ color: 'var(--text-muted)', fontSize: 13 }}>
        No legality data recorded for this card.
      </div>
    )
  }

  const byGroup = new Map<FormatDef['group'], FormatDef[]>()
  for (const f of definedFormats) {
    if (!byGroup.has(f.group)) byGroup.set(f.group, [])
    byGroup.get(f.group)!.push(f)
  }

  return (
    <div style={{ display: 'grid', gap: 16 }}>
      {FORMAT_GROUPS.map((group) => {
        const formats = byGroup.get(group)
        if (!formats || formats.length === 0) return null
        return (
          <div key={group}>
            <div className="label-mono" style={{ marginBottom: 8 }}>{group} formats</div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(160px, 1fr))', gap: 8 }}>
              {formats.map((f) => {
                const state = byKey.get(f.key) ?? 'not_legal'
                const badge = BADGE[state] ?? BADGE.not_legal
                return (
                  <Link
                    key={f.key}
                    href={`/formats/${f.key}`}
                    style={{
                      display: 'flex',
                      justifyContent: 'space-between',
                      alignItems: 'center',
                      padding: '10px 12px',
                      background: 'var(--surface)',
                      border: '1px solid var(--border)',
                      borderRadius: 10,
                      textDecoration: 'none',
                      color: 'var(--text)',
                    }}
                  >
                    <span style={{ fontSize: 13, fontWeight: 600 }}>{f.label}</span>
                    <span
                      style={{
                        fontSize: 11,
                        fontWeight: 700,
                        padding: '2px 8px',
                        borderRadius: 999,
                        background: badge.bg,
                        color: badge.fg,
                        letterSpacing: 0.4,
                        textTransform: 'uppercase',
                      }}
                    >
                      {badge.label}
                    </span>
                  </Link>
                )
              })}
            </div>
          </div>
        )
      })}
    </div>
  )
}
