'use client'

// src/app/browse/BrowseClient.tsx
// Client filter and sort layer for the sets directory. The parent
// server component fetches every set plus a per-set aggregates map and
// hands them to this component. All filtering, sorting and grouping
// happens in the browser.

import Link from 'next/link'
import { useMemo, useState } from 'react'
import type { MtgSet } from '@/lib/mtg/sets'
import type { SetAggregate } from '@/lib/mtg/set-market-batch'

export type BrowseSet = MtgSet

type Sort =
  | 'newest'
  | 'oldest'
  | 'name_asc'
  | 'name_desc'
  | 'size_desc'
  | 'size_asc'
  | 'value_desc'
  | 'value_asc'
  | 'rise_30d'
  | 'fall_30d'

const SORTS: { key: Sort; label: string }[] = [
  { key: 'newest',    label: 'Release date, newest' },
  { key: 'oldest',    label: 'Release date, oldest' },
  { key: 'name_asc',  label: 'Name A to Z' },
  { key: 'name_desc', label: 'Name Z to A' },
  { key: 'size_desc', label: 'Set size, largest' },
  { key: 'size_asc',  label: 'Set size, smallest' },
  { key: 'value_desc', label: 'Estimated value, high to low' },
  { key: 'value_asc',  label: 'Estimated value, low to high' },
  { key: 'rise_30d',  label: '30 day rise' },
  { key: 'fall_30d',  label: '30 day fall' },
]

const TYPE_LABEL: Record<string, string> = {
  core: 'Core',
  expansion: 'Expansion',
  commander: 'Commander',
  masters: 'Masters',
  masterpiece: 'Masterpiece',
  draft_innovation: 'Draft innovation',
  starter: 'Starter',
  from_the_vault: 'From the Vault',
  premium_deck: 'Premium deck',
  duel_deck: 'Duel deck',
  spellbook: 'Spellbook',
  planechase: 'Planechase',
  archenemy: 'Archenemy',
  promo: 'Promo',
}

type Props = {
  sets: BrowseSet[]
  aggregates: Record<string, SetAggregate>
}

export default function BrowseClient({ sets, aggregates }: Props) {
  const [sort, setSort] = useState<Sort>('newest')
  const [type, setType] = useState<string>('all')
  const [year, setYear] = useState<string>('all')
  const [query, setQuery] = useState('')

  const availableTypes = useMemo(() => {
    const s = new Set<string>()
    for (const x of sets) if (x.set_type) s.add(x.set_type)
    return Array.from(s).sort()
  }, [sets])

  const availableYears = useMemo(() => {
    const s = new Set<string>()
    for (const x of sets) if (x.released_at) s.add(x.released_at.slice(0, 4))
    return Array.from(s).sort((a, b) => b.localeCompare(a))
  }, [sets])

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    return sets.filter((s) => {
      if (type !== 'all' && s.set_type !== type) return false
      if (year !== 'all') {
        const y = s.released_at?.slice(0, 4)
        if (y !== year) return false
      }
      if (q) {
        const hay = `${s.name} ${s.code}`.toLowerCase()
        if (!hay.includes(q)) return false
      }
      return true
    })
  }, [sets, type, year, query])

  const sorted = useMemo(() => {
    const arr = [...filtered]
    const val = (s: BrowseSet) => aggregates[s.code]?.estimatedValue ?? 0
    const pct = (s: BrowseSet) => aggregates[s.code]?.pct30d ?? null
    switch (sort) {
      case 'newest':    arr.sort((a, b) => (b.released_at ?? '').localeCompare(a.released_at ?? '')); break
      case 'oldest':    arr.sort((a, b) => (a.released_at ?? '').localeCompare(b.released_at ?? '')); break
      case 'name_asc':  arr.sort((a, b) => a.name.localeCompare(b.name)); break
      case 'name_desc': arr.sort((a, b) => b.name.localeCompare(a.name)); break
      case 'size_desc': arr.sort((a, b) => (b.card_count ?? 0) - (a.card_count ?? 0)); break
      case 'size_asc':  arr.sort((a, b) => (a.card_count ?? Infinity) - (b.card_count ?? Infinity)); break
      case 'value_desc': arr.sort((a, b) => val(b) - val(a)); break
      case 'value_asc':  arr.sort((a, b) => {
        // Push zero-value sets to the bottom rather than the top.
        const va = val(a), vb = val(b)
        if (va === 0 && vb === 0) return 0
        if (va === 0) return 1
        if (vb === 0) return -1
        return va - vb
      }); break
      case 'rise_30d': arr.sort((a, b) => {
        const pa = pct(a), pb = pct(b)
        if (pa === null && pb === null) return 0
        if (pa === null) return 1
        if (pb === null) return -1
        return pb - pa
      }); break
      case 'fall_30d': arr.sort((a, b) => {
        const pa = pct(a), pb = pct(b)
        if (pa === null && pb === null) return 0
        if (pa === null) return 1
        if (pb === null) return -1
        return pa - pb
      }); break
    }
    return arr
  }, [filtered, sort, aggregates])

  const grouped = useMemo(() => {
    if (sort !== 'newest' && sort !== 'oldest') return null
    const map = new Map<string, BrowseSet[]>()
    for (const s of sorted) {
      const y = s.released_at?.slice(0, 4) ?? 'Unknown'
      if (!map.has(y)) map.set(y, [])
      map.get(y)!.push(s)
    }
    return Array.from(map.entries())
  }, [sorted, sort])

  return (
    <div>
      <div style={{
        display: 'flex', flexWrap: 'wrap', gap: 10, alignItems: 'center',
        marginBottom: 20, padding: 12,
        background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 12,
      }}>
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search set name or code"
          style={{
            flex: '1 1 200px', minWidth: 180,
            padding: '9px 12px', borderRadius: 10,
            border: '1px solid var(--border)', background: 'var(--bg-light)',
            color: 'var(--text)', fontSize: 14, fontFamily: 'inherit', outline: 'none',
          }}
        />
        <Select label="Type" value={type} onChange={setType} options={[
          { value: 'all', label: 'All types' },
          ...availableTypes.map((t) => ({ value: t, label: TYPE_LABEL[t] ?? titlecase(t.replace(/_/g, ' ')) })),
        ]} />
        <Select label="Year" value={year} onChange={setYear} options={[
          { value: 'all', label: 'All years' },
          ...availableYears.map((y) => ({ value: y, label: y })),
        ]} />
        <Select label="Sort" value={sort} onChange={(v) => setSort(v as Sort)} options={SORTS.map((s) => ({ value: s.key, label: s.label }))} />
        <span style={{ marginLeft: 'auto', fontSize: 12, color: 'var(--text-muted)' }}>
          {sorted.length.toLocaleString()} of {sets.length.toLocaleString()} sets
        </span>
      </div>

      {grouped ? (
        grouped.map(([year, rows]) => (
          <section key={year} style={{ marginBottom: 30 }}>
            <div style={{
              display: 'flex', alignItems: 'baseline', gap: 12,
              marginBottom: 10, paddingBottom: 8, borderBottom: '1px solid var(--border)',
            }}>
              <h2 style={{ margin: 0, fontSize: 18 }}>{year}</h2>
              <span style={{ color: 'var(--text-muted)', fontSize: 12 }}>{rows.length} set{rows.length === 1 ? '' : 's'}</span>
            </div>
            <TileGrid sets={rows} aggregates={aggregates} />
          </section>
        ))
      ) : (
        <TileGrid sets={sorted} aggregates={aggregates} />
      )}
    </div>
  )
}

function TileGrid({ sets, aggregates }: { sets: BrowseSet[]; aggregates: Record<string, SetAggregate> }) {
  if (sets.length === 0) {
    return (
      <div style={{ padding: 20, background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 12, color: 'var(--text-muted)', fontSize: 13 }}>
        No sets match the current filters.
      </div>
    )
  }
  return (
    <div style={{
      display: 'grid', gap: 12,
      gridTemplateColumns: 'repeat(auto-fill, minmax(240px, 1fr))',
    }}>
      {sets.map((set) => {
        const agg = aggregates[set.code]
        return (
          <Link
            key={set.id}
            href={`/set/${set.code}`}
            className="card-hover card-hover-gold"
            style={{
              display: 'flex', flexDirection: 'column',
              background: 'var(--surface)',
              border: '1px solid var(--border)', borderRadius: 12,
              padding: '14px 14px 12px', textDecoration: 'none', color: 'var(--text)',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              {set.icon_svg_uri ? (
                /* eslint-disable-next-line @next/next/no-img-element */
                <img src={set.icon_svg_uri} alt="" aria-hidden style={{ width: 22, height: 22, opacity: 0.85 }} />
              ) : (
                <span style={{ width: 22, height: 22, borderRadius: 4, background: 'var(--bg-light)', border: '1px solid var(--border)' }} />
              )}
              <span className="label-mono">{set.code}</span>
              {set.set_type && (
                <span style={{ fontSize: 10, marginLeft: 'auto', color: 'var(--gold-600)', textTransform: 'uppercase', letterSpacing: '0.08em', fontWeight: 700 }}>
                  {(TYPE_LABEL[set.set_type] ?? titlecase(set.set_type.replace(/_/g, ' ')))}
                </span>
              )}
            </div>
            <div style={{ fontSize: 14, fontWeight: 700, marginTop: 8, lineHeight: 1.25, color: 'var(--text-strong)' }}>{set.name}</div>
            <div style={{ color: 'var(--text-muted)', fontSize: 11.5, marginTop: 6, display: 'flex', gap: 10, flexWrap: 'wrap' }}>
              {set.released_at && <span>{set.released_at}</span>}
              {set.card_count != null && <span>{set.card_count.toLocaleString()} cards</span>}
            </div>
            {agg && agg.totalPriced > 0 && (
              <div style={{
                marginTop: 10, paddingTop: 10, borderTop: '1px dashed var(--border)',
                display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8,
              }}>
                <div>
                  <div style={{
                    fontSize: 15, fontWeight: 800, color: 'var(--text-strong)',
                    fontFamily: 'ui-monospace, SFMono-Regular, monospace',
                  }}>${agg.estimatedValue.toLocaleString(undefined, { maximumFractionDigits: 0 })}</div>
                  <div style={{ fontSize: 10, color: 'var(--text-muted)' }}>
                    Est. value ({agg.totalPriced}/{agg.totalPrinted} priced)
                  </div>
                </div>
                {agg.pct30d !== null && (
                  <span style={{
                    fontSize: 11, fontWeight: 800,
                    color: agg.pct30d >= 0 ? 'var(--green)' : 'var(--red)',
                    background: agg.pct30d >= 0 ? 'var(--green-soft)' : 'var(--red-soft)',
                    padding: '3px 8px', borderRadius: 999,
                    fontFamily: 'ui-monospace, SFMono-Regular, monospace',
                  }}>{agg.pct30d >= 0 ? '▲' : '▼'} {Math.abs(agg.pct30d * 100).toFixed(1)}% 30d</span>
                )}
              </div>
            )}
            {agg?.topCardName && agg.topCardPrice !== null && (
              <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 6 }}>
                Top: <strong style={{ color: 'var(--text)' }}>{agg.topCardName}</strong> ${agg.topCardPrice.toFixed(2)}
              </div>
            )}
          </Link>
        )
      })}
    </div>
  )
}

function Select({ label, value, onChange, options }: {
  label: string
  value: string
  onChange: (v: string) => void
  options: { value: string; label: string }[]
}) {
  return (
    <label style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 12, color: 'var(--text-muted)' }}>
      {label}
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        style={{
          background: 'var(--surface)', color: 'var(--text)',
          border: '1px solid var(--border)', borderRadius: 8,
          padding: '6px 10px', fontSize: 12.5, fontFamily: 'inherit',
        }}
      >
        {options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>
    </label>
  )
}

function titlecase(s: string): string {
  return s.replace(/\w\S*/g, (t) => t.charAt(0).toUpperCase() + t.slice(1).toLowerCase())
}
