'use client'

// src/components/mtg/PrintingComparison.tsx
// Sortable comparison of every priced paper printing of an oracle card.
// Consumes the pre-joined pricedPrintings list from card-market.ts.
// Sorting, filtering and eBay-link building happen in the browser.
//
// Actions:
//   - Add to Collection (reuses AddToCollection from src/components/mtg/AddToCollection)
//   - Add to Deck       (reuses AddToDeck)
//   - eBay search       (reuses ebay-links.ts with country from useCountry)

import { useMemo, useState } from 'react'
import Link from 'next/link'
import { buildCardSlug } from '@/lib/mtg/slug'
import type { PrintingPriceRow, MarketBasis } from '@/lib/mtg/card-market.types'
import { CURRENCY_SYMBOL } from '@/lib/mtg/card-market.types'
import { buildEbaySearchLink } from '@/lib/mtg/ebay-links'
import { useCountry } from '@/lib/geo/useCountry'
import AddToCollection from '@/components/mtg/AddToCollection'
import AddToDeck from '@/components/mtg/AddToDeck'

type SortKey =
  | 'cheapest'
  | 'expensive'
  | 'newest'
  | 'oldest'
  | 'name'
  | 'rise_30d'
  | 'fall_30d'
  | 'owned'

const SORTS: { key: SortKey; label: string }[] = [
  { key: 'cheapest',  label: 'Cheapest first' },
  { key: 'expensive', label: 'Most expensive first' },
  { key: 'newest',    label: 'Newest' },
  { key: 'oldest',    label: 'Oldest' },
  { key: 'name',      label: 'Set name A to Z' },
  { key: 'rise_30d',  label: 'Biggest 30D rise' },
  { key: 'fall_30d',  label: 'Biggest 30D fall' },
  { key: 'owned',     label: 'Owned quantity' },
]

const RARITY_COLOUR: Record<string, string> = {
  common: 'var(--text-muted)',
  uncommon: 'var(--text-muted)',
  rare: 'var(--gold-500)',
  mythic: 'var(--ember-500)',
  special: 'var(--primary)',
  bonus: 'var(--primary)',
}

type Props = {
  cardName: string
  oracleId: string
  basis: MarketBasis
  pricedPrintings: PrintingPriceRow[]
  currentPrintingId?: string | null
  // { printing_id: count } supplied when the current viewer is signed
  // in and their collection has been fetched server-side.
  ownedByPrintingId?: Record<string, number>
}

export default function PrintingComparison({
  cardName, oracleId, basis, pricedPrintings, currentPrintingId, ownedByPrintingId,
}: Props) {
  const [sort, setSort] = useState<SortKey>('cheapest')
  const [finishFilter, setFinishFilter] = useState<'any' | 'nonfoil' | 'foil' | 'etched'>('any')
  const [openActions, setOpenActions] = useState<string | null>(null)
  const country = useCountry()

  const sym = CURRENCY_SYMBOL[basis.currency]

  const rows = useMemo(() => {
    let out = pricedPrintings
    if (finishFilter !== 'any') out = out.filter((r) => r.finish === finishFilter)
    const arr = [...out]
    const owned = (r: PrintingPriceRow) => ownedByPrintingId?.[r.printing_id] ?? 0
    switch (sort) {
      case 'cheapest':  arr.sort((a, b) => a.price - b.price); break
      case 'expensive': arr.sort((a, b) => b.price - a.price); break
      case 'newest':    arr.sort((a, b) => (b.released_at ?? '').localeCompare(a.released_at ?? '')); break
      case 'oldest':    arr.sort((a, b) => (a.released_at ?? '').localeCompare(b.released_at ?? '')); break
      case 'name':      arr.sort((a, b) => a.set_name.localeCompare(b.set_name)); break
      case 'rise_30d':  arr.sort((a, b) => (b.pct_30d ?? -Infinity) - (a.pct_30d ?? -Infinity)); break
      case 'fall_30d':  arr.sort((a, b) => (a.pct_30d ?? Infinity) - (b.pct_30d ?? Infinity)); break
      case 'owned':     arr.sort((a, b) => owned(b) - owned(a) || a.price - b.price); break
    }
    return arr
  }, [pricedPrintings, finishFilter, sort, ownedByPrintingId])

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
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13.5, minWidth: 780 }}>
            <thead>
              <tr style={{ background: 'var(--bg-light)' }}>
                <Th>Printing</Th>
                <Th align="center">Finish</Th>
                <Th align="center">Rarity</Th>
                <Th align="right">Price</Th>
                <Th align="right">7D</Th>
                <Th align="right">30D</Th>
                {ownedByPrintingId && <Th align="right">Owned</Th>}
                <Th align="right">Actions</Th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => {
                const rowKey = r.printing_id + r.finish
                const slug = r.collector_number ? buildCardSlug(r.collector_number, cardName) : ''
                const href = slug ? `/set/${r.set_code}/card/${slug}` : '#'
                const isCurrent = r.printing_id === currentPrintingId
                const owned = ownedByPrintingId?.[r.printing_id] ?? 0
                const rarityColor = r.rarity ? (RARITY_COLOUR[r.rarity] ?? 'var(--text-muted)') : 'var(--text-muted)'
                const isActionsOpen = openActions === rowKey
                const ebay = buildEbaySearchLink({
                  cardName,
                  setName: r.set_name,
                  setCode: r.set_code,
                  collectorNumber: r.collector_number,
                  finish: (r.finish === 'foil' || r.finish === 'etched') ? r.finish : 'nonfoil',
                  marketplace: country ? undefined : undefined,
                })
                // Rebuild with country if we have one so the search
                // opens on the visitor's marketplace TLD.
                const ebayLocalised = country ? buildEbaySearchLink({
                  cardName,
                  setName: r.set_name,
                  setCode: r.set_code,
                  collectorNumber: r.collector_number,
                  finish: (r.finish === 'foil' || r.finish === 'etched') ? r.finish : 'nonfoil',
                  marketplace: mapCountryToMarketplace(country),
                }) : ebay
                return (
                  <>
                    <tr key={rowKey}
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
                              {r.released_at ? ` · ${r.released_at}` : ''}
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
                      <Td align="center" style={{ color: rarityColor, textTransform: 'capitalize', fontWeight: 600, fontSize: 12 }}>
                        {r.rarity ?? '-'}
                      </Td>
                      <Td align="right" style={{ fontFamily: 'ui-monospace, SFMono-Regular, monospace', fontWeight: 700 }}>
                        {sym}{r.price.toFixed(2)}
                      </Td>
                      <Td align="right"><DeltaCell pct={r.pct_7d} /></Td>
                      <Td align="right"><DeltaCell pct={r.pct_30d} /></Td>
                      {ownedByPrintingId && (
                        <Td align="right" style={{ color: owned > 0 ? 'var(--green)' : 'var(--text-muted)', fontWeight: 600 }}>
                          {owned > 0 ? String(owned) : '-'}
                        </Td>
                      )}
                      <Td align="right">
                        <div style={{ display: 'inline-flex', gap: 6, alignItems: 'center' }}>
                          <a
                            href={ebayLocalised.href}
                            target="_blank"
                            rel="sponsored nofollow noopener"
                            title={ebayLocalised.label}
                            style={{
                              padding: '5px 10px', borderRadius: 8,
                              background: 'var(--accent-soft)', color: 'var(--gold-600)',
                              border: '1px solid var(--accent-border)',
                              fontSize: 11.5, fontWeight: 700, textDecoration: 'none',
                            }}
                          >eBay</a>
                          <button
                            type="button"
                            onClick={() => setOpenActions(isActionsOpen ? null : rowKey)}
                            style={{
                              padding: '5px 10px', borderRadius: 8,
                              background: 'var(--surface)', color: 'var(--text)',
                              border: '1px solid var(--border)',
                              fontSize: 11.5, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit',
                            }}
                          >{isActionsOpen ? 'Close' : 'Add'}</button>
                        </div>
                      </Td>
                    </tr>
                    {isActionsOpen && (
                      <tr key={rowKey + '-actions'} style={{ background: 'var(--bg-light)' }}>
                        <td colSpan={ownedByPrintingId ? 8 : 7} style={{ padding: 12 }}>
                          <RowActions
                            cardName={cardName}
                            oracleId={oracleId}
                            finishId={r.finish_id}
                            finish={r.finish as 'nonfoil' | 'foil' | 'etched'}
                          />
                        </td>
                      </tr>
                    )}
                  </>
                )
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}

function DeltaCell({ pct }: { pct: number | null }) {
  if (pct === null || Number.isNaN(pct)) {
    return <span style={{ color: 'var(--text-muted)', fontSize: 12 }}>-</span>
  }
  const up = pct >= 0
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center', gap: 3,
      fontSize: 12, fontWeight: 700,
      color: up ? 'var(--green)' : 'var(--red)',
      fontFamily: 'ui-monospace, SFMono-Regular, monospace',
    }}>
      {up ? '▲' : '▼'} {Math.abs(pct * 100).toFixed(1)}%
    </span>
  )
}

function RowActions({
  cardName, oracleId, finishId, finish,
}: {
  cardName: string
  oracleId: string
  finishId: string
  finish: 'nonfoil' | 'foil' | 'etched'
}) {
  return (
    <div style={{ display: 'grid', gap: 8, gridTemplateColumns: 'minmax(0, 1fr) minmax(0, 1fr)' }}>
      <div>
        <div className="label-mono" style={{ marginBottom: 6 }}>Add to collection</div>
        <AddToCollection
          cardName={cardName}
          finishes={[{ id: finishId, finish }]}
        />
      </div>
      <div>
        <div className="label-mono" style={{ marginBottom: 6 }}>Add to deck</div>
        <AddToDeck
          oracleId={oracleId}
          cardName={cardName}
          preferredFinishId={finishId}
        />
      </div>
    </div>
  )
}

function mapCountryToMarketplace(country: string): 'US' | 'GB' | 'DE' | 'FR' | 'IT' | 'ES' | 'AU' | 'CA' {
  const key = country.toUpperCase()
  if (key === 'US' || key === 'GB' || key === 'DE' || key === 'FR' || key === 'IT' || key === 'ES' || key === 'AU' || key === 'CA') return key
  return 'US'
}

function Th({ children, align = 'left' }: { children: React.ReactNode; align?: 'left' | 'right' | 'center' }) {
  return (
    <th style={{
      textAlign: align, padding: '10px 12px', fontSize: 11, fontWeight: 700,
      color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.06em',
      whiteSpace: 'nowrap',
    }}>{children}</th>
  )
}
function Td({ children, align = 'left', style }: { children: React.ReactNode; align?: 'left' | 'right' | 'center'; style?: React.CSSProperties }) {
  return <td style={{ textAlign: align, padding: '10px 12px', verticalAlign: 'middle', ...style }}>{children}</td>
}
