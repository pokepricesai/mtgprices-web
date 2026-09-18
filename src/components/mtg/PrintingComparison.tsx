'use client'

// src/components/mtg/PrintingComparison.tsx
// Sortable comparison of every priced paper printing of an oracle card.
// Consumes the pre-joined pricedPrintings list from card-market.ts, so
// this component does not hit the database at all. Sorting happens in
// the browser.
//
// Sort options (all deterministic against pricedPrintings):
//   cheapest, most expensive, newest, oldest, name.
//
// If the parent later passes a per-printing 30d delta map we will
// gracefully surface it, but the initial version does not require it.

import { useMemo, useState } from 'react'
import Link from 'next/link'
import { buildCardSlug } from '@/lib/mtg/slug'
import type { PrintingPriceRow, MarketBasis } from '@/lib/mtg/card-market.types'
import { CURRENCY_SYMBOL } from '@/lib/mtg/card-market.types'

type SortKey = 'cheapest' | 'expensive' | 'newest' | 'oldest' | 'name'

const SORTS: { key: SortKey; label: string }[] = [
  { key: 'cheapest',  label: 'Cheapest first' },
  { key: 'expensive', label: 'Most expensive first' },
  { key: 'newest',    label: 'Newest' },
  { key: 'oldest',    label: 'Oldest' },
  { key: 'name',      label: 'Name (A→Z)' },
]

type Props = {
  cardName: string
  basis: MarketBasis
  pricedPrintings: PrintingPriceRow[]
  currentPrintingId?: string | null
  // Optional additions for later expansion: owned quantities keyed by printing_id.
  ownedByPrintingId?: Record<string, number>
}

export default function PrintingComparison({
  cardName, basis, pricedPrintings, currentPrintingId, ownedByPrintingId,
}: Props) {
  const [sort, setSort] = useState<SortKey>('cheapest')
  const [finishFilter, setFinishFilter] = useState<'any' | 'nonfoil' | 'foil' | 'etched'>('any')

  const sym = CURRENCY_SYMBOL[basis.currency]

  const rows = useMemo(() => {
    let out = pricedPrintings
    if (finishFilter !== 'any') out = out.filter((r) => r.finish === finishFilter)
    const arr = [...out]
    switch (sort) {
      case 'cheapest':  arr.sort((a, b) => a.price - b.price); break
      case 'expensive': arr.sort((a, b) => b.price - a.price); break
      case 'newest':    arr.sort((a, b) => (b.released_at ?? '').localeCompare(a.released_at ?? '')); break
      case 'oldest':    arr.sort((a, b) => (a.released_at ?? '').localeCompare(b.released_at ?? '')); break
      case 'name':      arr.sort((a, b) => a.set_name.localeCompare(b.set_name)); break
    }
    return arr
  }, [pricedPrintings, finishFilter, sort])

  if (pricedPrintings.length === 0) {
    return (
      <div style={{ padding: 14, background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 12, color: 'var(--text-muted)', fontSize: 13 }}>
        No priced paper printings on the {basis.provider} {basis.currency} {basis.priceType} basis yet.
      </div>
    )
  }

  return (
    <div>
      <div style={{
        display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center',
        marginBottom: 12,
      }}>
        <span className="label-mono">Compare printings ({pricedPrintings.length} priced)</span>
        <select
          value={sort}
          onChange={(e) => setSort(e.target.value as SortKey)}
          style={{
            marginLeft: 'auto',
            background: 'var(--surface)', color: 'var(--text)',
            border: '1px solid var(--border)', borderRadius: 8,
            padding: '6px 10px', fontSize: 12.5, fontFamily: 'inherit',
          }}
        >
          {SORTS.map((s) => <option key={s.key} value={s.key}>{s.label}</option>)}
        </select>
        <select
          value={finishFilter}
          onChange={(e) => setFinishFilter(e.target.value as any)}
          style={{
            background: 'var(--surface)', color: 'var(--text)',
            border: '1px solid var(--border)', borderRadius: 8,
            padding: '6px 10px', fontSize: 12.5, fontFamily: 'inherit',
          }}
        >
          <option value="any">Any finish</option>
          <option value="nonfoil">Nonfoil</option>
          <option value="foil">Foil</option>
          <option value="etched">Etched</option>
        </select>
      </div>

      <div style={{
        border: '1px solid var(--border)', borderRadius: 12, overflow: 'hidden',
        background: 'var(--surface)',
      }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13.5 }}>
          <thead>
            <tr style={{ background: 'var(--bg-light)' }}>
              <Th>Printing</Th>
              <Th align="center">Finish</Th>
              <Th align="center">Released</Th>
              <Th align="right">Price</Th>
              {ownedByPrintingId && <Th align="right">Owned</Th>}
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => {
              const slug = r.collector_number ? buildCardSlug(r.collector_number, cardName) : ''
              const href = slug ? `/set/${r.set_code}/card/${slug}` : '#'
              const isCurrent = r.printing_id === currentPrintingId
              const owned = ownedByPrintingId?.[r.printing_id] ?? 0
              return (
                <tr key={r.printing_id + r.finish}
                  style={{
                    borderTop: '1px solid var(--border)',
                    background: isCurrent ? 'var(--accent-soft)' : 'transparent',
                  }}
                >
                  <Td>
                    <Link href={href} style={{
                      display: 'flex', alignItems: 'center', gap: 10,
                      textDecoration: 'none', color: 'var(--text)',
                    }}>
                      {r.image_uri_small ? (
                        /* eslint-disable-next-line @next/next/no-img-element */
                        <img src={r.image_uri_small} alt="" style={{ width: 26, height: 36, borderRadius: 4, objectFit: 'cover' }} />
                      ) : <span style={{ width: 26, height: 36, borderRadius: 4, background: 'var(--bg-strong)' }} />}
                      <span style={{ display: 'flex', flexDirection: 'column', minWidth: 0 }}>
                        <span style={{ fontWeight: 700, color: 'var(--text-strong)' }}>{r.set_name}</span>
                        <span style={{ fontSize: 11.5, color: 'var(--text-muted)' }}>
                          {r.set_code.toUpperCase()}{r.collector_number ? ` · #${r.collector_number}` : ''}
                        </span>
                      </span>
                    </Link>
                  </Td>
                  <Td align="center">
                    <span className="chip" style={{
                      padding: '2px 8px', fontSize: 11,
                      background: r.finish === 'foil' ? 'var(--accent-soft)' : r.finish === 'etched' ? 'var(--primary-soft)' : 'var(--bg-light)',
                      color: r.finish === 'foil' ? 'var(--gold-600)' : r.finish === 'etched' ? 'var(--primary-strong)' : 'var(--text)',
                      borderColor: r.finish === 'foil' ? 'var(--accent-border)' : r.finish === 'etched' ? 'var(--primary-border)' : 'var(--border)',
                    }}>{r.finish}</span>
                  </Td>
                  <Td align="center" style={{ color: 'var(--text-muted)', fontSize: 12 }}>
                    {r.released_at ?? '-'}
                  </Td>
                  <Td align="right" style={{ fontFamily: 'ui-monospace, SFMono-Regular, monospace', fontWeight: 700 }}>
                    {sym}{r.price.toFixed(2)}
                  </Td>
                  {ownedByPrintingId && (
                    <Td align="right" style={{ color: owned > 0 ? 'var(--green)' : 'var(--text-muted)', fontWeight: 600 }}>
                      {owned > 0 ? `${owned}` : '-'}
                    </Td>
                  )}
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </div>
  )
}

function Th({ children, align = 'left' }: { children: React.ReactNode; align?: 'left' | 'right' | 'center' }) {
  return (
    <th style={{
      textAlign: align, padding: '10px 12px', fontSize: 11, fontWeight: 700,
      color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.06em',
    }}>{children}</th>
  )
}
function Td({ children, align = 'left', style }: { children: React.ReactNode; align?: 'left' | 'right' | 'center'; style?: React.CSSProperties }) {
  return <td style={{ textAlign: align, padding: '10px 12px', verticalAlign: 'middle', ...style }}>{children}</td>
}
