'use client'
// src/components/mtg/SetGridClient.tsx
// Client-side filter + sort for a set's printings grid. Data is
// pre-fetched by the server component and passed in as props — we do
// not hit the DB from here.

import Link from 'next/link'
import { useMemo, useState } from 'react'
import { buildCardSlug } from '@/lib/mtg/slug'

export type SetGridPrinting = {
  id: string
  name: string
  set_code: string
  collector_number: string | null
  rarity: string | null
  image_uri_small: string | null
  released_at: string | null
  finishes: string[]              // e.g. ['nonfoil', 'foil']
  colors: string[] | null         // W|U|B|R|G|C
  type_line: string | null
  price: number | null            // headline nonfoil (or fallback) price
}

type Props = { setCode: string; printings: SetGridPrinting[] }

type SortKey = 'collector' | 'name' | 'rarity' | 'price_asc' | 'price_desc'
const SORT_OPTIONS: { key: SortKey; label: string }[] = [
  { key: 'collector',  label: 'Collector #' },
  { key: 'name',       label: 'Name' },
  { key: 'rarity',     label: 'Rarity' },
  { key: 'price_desc', label: 'Price high → low' },
  { key: 'price_asc',  label: 'Price low → high' },
]

const RARITY_ORDER: Record<string, number> = { mythic: 0, rare: 1, uncommon: 2, common: 3, special: 4, bonus: 5 }
const RARITY_COLOUR: Record<string, string> = {
  common: '#9AA3B2', uncommon: '#c0c8d0', rare: '#E8A94B', mythic: '#e07d3a',
  special: '#235FAE', bonus: '#235FAE',
}

const COLOR_CHOICES: { code: string; label: string; bg: string; fg: string }[] = [
  { code: 'W', label: 'W', bg: '#f9f6df', fg: '#25313f' },
  { code: 'U', label: 'U', bg: '#8ecff6', fg: '#0b2a49' },
  { code: 'B', label: 'B', bg: '#4a4a4a', fg: '#f3f0e8' },
  { code: 'R', label: 'R', bg: '#f0a48f', fg: '#4a1010' },
  { code: 'G', label: 'G', bg: '#9ee0a5', fg: '#0f3418' },
  { code: 'C', label: 'C', bg: '#c8c1b0', fg: '#25313f' },
]

const TYPES = ['Creature', 'Instant', 'Sorcery', 'Enchantment', 'Artifact', 'Planeswalker', 'Land', 'Battle']

function fmtUSD(n: number | null): string {
  if (n === null || !Number.isFinite(n)) return '—'
  return `$${n.toFixed(2)}`
}

function parseCollector(s: string | null): { num: number; suffix: string } {
  if (!s) return { num: 999999, suffix: '' }
  const m = s.match(/^(\d+)(.*)$/)
  if (!m) return { num: 999999, suffix: s }
  return { num: parseInt(m[1], 10), suffix: m[2] ?? '' }
}

export default function SetGridClient({ setCode, printings }: Props) {
  const [sort, setSort] = useState<SortKey>('collector')
  const [rarity, setRarity] = useState<Set<string>>(new Set())
  const [colors, setColors] = useState<Set<string>>(new Set())
  const [types, setTypes] = useState<Set<string>>(new Set())
  const [pricedOnly, setPricedOnly] = useState(false)
  const [finish, setFinish] = useState<'any' | 'nonfoil' | 'foil' | 'etched'>('any')

  const availableRarities = useMemo(() => {
    const s = new Set<string>()
    for (const p of printings) if (p.rarity) s.add(p.rarity)
    return Array.from(s).sort((a, b) => (RARITY_ORDER[a] ?? 99) - (RARITY_ORDER[b] ?? 99))
  }, [printings])

  const availableFinishes = useMemo(() => {
    const s = new Set<string>()
    for (const p of printings) for (const f of p.finishes) s.add(f)
    return Array.from(s)
  }, [printings])

  const filtered = useMemo(() => {
    let out = printings
    if (rarity.size > 0) out = out.filter((p) => p.rarity && rarity.has(p.rarity))
    if (colors.size > 0) out = out.filter((p) => {
      const c = p.colors ?? []
      if (colors.has('C')) {
        if (c.length === 0) return true
      }
      return c.some((cc) => colors.has(cc))
    })
    if (types.size > 0) out = out.filter((p) => {
      const t = (p.type_line ?? '').toLowerCase()
      return Array.from(types).some((tt) => t.includes(tt.toLowerCase()))
    })
    if (finish !== 'any') out = out.filter((p) => p.finishes.includes(finish))
    if (pricedOnly) out = out.filter((p) => p.price !== null && Number.isFinite(p.price))
    return out
  }, [printings, rarity, colors, types, finish, pricedOnly])

  const sorted = useMemo(() => {
    const arr = [...filtered]
    switch (sort) {
      case 'name': arr.sort((a, b) => a.name.localeCompare(b.name)); break
      case 'rarity': arr.sort((a, b) => {
        const ra = a.rarity ? (RARITY_ORDER[a.rarity] ?? 99) : 99
        const rb = b.rarity ? (RARITY_ORDER[b.rarity] ?? 99) : 99
        if (ra !== rb) return ra - rb
        const ca = parseCollector(a.collector_number), cb = parseCollector(b.collector_number)
        return ca.num - cb.num || ca.suffix.localeCompare(cb.suffix)
      }); break
      case 'price_asc': arr.sort((a, b) => {
        const ap = a.price ?? Number.POSITIVE_INFINITY
        const bp = b.price ?? Number.POSITIVE_INFINITY
        if (ap !== bp) return ap - bp
        return a.name.localeCompare(b.name)
      }); break
      case 'price_desc': arr.sort((a, b) => {
        const ap = a.price ?? -1
        const bp = b.price ?? -1
        if (ap !== bp) return bp - ap
        return a.name.localeCompare(b.name)
      }); break
      case 'collector':
      default: arr.sort((a, b) => {
        const ca = parseCollector(a.collector_number), cb = parseCollector(b.collector_number)
        return ca.num - cb.num || ca.suffix.localeCompare(cb.suffix)
      })
    }
    return arr
  }, [filtered, sort])

  function toggle<T>(setter: React.Dispatch<React.SetStateAction<Set<T>>>, val: T) {
    setter((prev) => {
      const next = new Set(prev)
      if (next.has(val)) next.delete(val); else next.add(val)
      return next
    })
  }

  return (
    <div>
      {/* Filter/sort bar */}
      <div style={{
        display: 'flex', flexWrap: 'wrap', gap: 10, marginBottom: 16,
        alignItems: 'center', padding: 12,
        background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 12,
      }}>
        <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>Showing <strong style={{ color: 'var(--text)' }}>{sorted.length}</strong> of {printings.length}</span>

        {/* Sort */}
        <label style={{ display: 'inline-flex', gap: 6, alignItems: 'center', fontSize: 12, color: 'var(--text-muted)' }}>
          Sort
          <select
            value={sort}
            onChange={(e) => setSort(e.target.value as SortKey)}
            style={{
              background: 'var(--bg-light)', color: 'var(--text)',
              border: '1px solid var(--border)', borderRadius: 8,
              padding: '5px 8px', fontSize: 12,
            }}
          >
            {SORT_OPTIONS.map((o) => <option key={o.key} value={o.key}>{o.label}</option>)}
          </select>
        </label>

        {/* Rarity */}
        {availableRarities.length > 0 && (
          <div style={{ display: 'inline-flex', gap: 4, flexWrap: 'wrap' }}>
            {availableRarities.map((r) => (
              <Chip
                key={r}
                active={rarity.has(r)}
                onClick={() => toggle(setRarity, r)}
                dot={RARITY_COLOUR[r]}
                label={r[0].toUpperCase() + r.slice(1)}
              />
            ))}
          </div>
        )}

        {/* Colours */}
        <div style={{ display: 'inline-flex', gap: 4 }}>
          {COLOR_CHOICES.map((c) => (
            <ColorChip
              key={c.code}
              code={c.code}
              label={c.label}
              bg={c.bg}
              fg={c.fg}
              active={colors.has(c.code)}
              onClick={() => toggle(setColors, c.code)}
            />
          ))}
        </div>

        {/* Types */}
        <details style={{ position: 'relative' }}>
          <summary style={{
            listStyle: 'none', cursor: 'pointer', fontSize: 12, color: 'var(--text-muted)',
            padding: '5px 10px', background: 'var(--bg-light)', border: '1px solid var(--border)', borderRadius: 999,
          }}>
            Types {types.size > 0 ? <span style={{ color: 'var(--accent)' }}>({types.size})</span> : null}
          </summary>
          <div style={{
            position: 'absolute', top: 30, left: 0, zIndex: 5,
            background: 'var(--surface)', border: '1px solid var(--border)',
            borderRadius: 10, padding: 10, minWidth: 180, boxShadow: '0 6px 20px rgba(0,0,0,0.35)',
          }}>
            {TYPES.map((t) => (
              <label key={t} style={{ display: 'flex', gap: 8, padding: '4px 0', fontSize: 13, cursor: 'pointer' }}>
                <input type="checkbox" checked={types.has(t)} onChange={() => toggle(setTypes, t)} />
                {t}
              </label>
            ))}
          </div>
        </details>

        {/* Finishes */}
        {availableFinishes.length > 1 && (
          <label style={{ display: 'inline-flex', gap: 6, alignItems: 'center', fontSize: 12, color: 'var(--text-muted)' }}>
            Finish
            <select
              value={finish}
              onChange={(e) => setFinish(e.target.value as any)}
              style={{
                background: 'var(--bg-light)', color: 'var(--text)',
                border: '1px solid var(--border)', borderRadius: 8,
                padding: '5px 8px', fontSize: 12,
              }}
            >
              <option value="any">Any</option>
              {availableFinishes.map((f) => <option key={f} value={f}>{f}</option>)}
            </select>
          </label>
        )}

        <label style={{ display: 'inline-flex', gap: 6, alignItems: 'center', fontSize: 12, color: 'var(--text-muted)', cursor: 'pointer' }}>
          <input type="checkbox" checked={pricedOnly} onChange={(e) => setPricedOnly(e.target.checked)} />
          Priced only
        </label>

        {(rarity.size > 0 || colors.size > 0 || types.size > 0 || pricedOnly || finish !== 'any') && (
          <button
            type="button"
            onClick={() => { setRarity(new Set()); setColors(new Set()); setTypes(new Set()); setPricedOnly(false); setFinish('any') }}
            style={{
              background: 'transparent', color: 'var(--accent)',
              border: '1px solid var(--border)', borderRadius: 999,
              padding: '4px 12px', fontSize: 12, cursor: 'pointer',
            }}
          >Clear</button>
        )}
      </div>

      {/* Grid */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', gap: 14 }}>
        {sorted.map((p) => {
          const slug = p.collector_number ? buildCardSlug(p.collector_number, p.name) : ''
          const href = slug ? `/set/${setCode}/card/${slug}` : '#'
          const dot = p.rarity ? RARITY_COLOUR[p.rarity] ?? 'var(--text-muted)' : 'var(--text-muted)'
          return (
            <Link
              key={p.id}
              href={href}
              className="card-hover"
              style={{
                display: 'block', background: 'var(--surface)',
                border: '1px solid var(--border)', borderRadius: 12,
                padding: 12, textDecoration: 'none', color: 'var(--text)',
              }}
            >
              <div style={{
                aspectRatio: '5 / 7', borderRadius: 6, background: 'var(--bg-light)',
                marginBottom: 10, overflow: 'hidden',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
              }}>
                {p.image_uri_small ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={p.image_uri_small} alt={p.name} style={{ width: '100%', height: '100%', objectFit: 'cover' }} loading="lazy" />
                ) : (
                  <span style={{ color: 'var(--text-muted)', fontSize: 12 }}>No image</span>
                )}
              </div>
              <div style={{ fontSize: 14, fontWeight: 700, lineHeight: 1.25, minHeight: 34 }}>{p.name}</div>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: 8, gap: 6 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, color: 'var(--text-muted)', fontSize: 11 }}>
                  <span style={{ width: 8, height: 8, borderRadius: '50%', background: dot, display: 'inline-block' }} aria-hidden />
                  <span>#{p.collector_number ?? '—'}</span>
                </div>
                <span style={{
                  color: p.price !== null ? 'var(--text)' : 'var(--text-muted)',
                  fontWeight: p.price !== null ? 700 : 500, fontSize: 13,
                  fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
                }}>{fmtUSD(p.price)}</span>
              </div>
            </Link>
          )
        })}
      </div>

      {sorted.length === 0 && (
        <div style={{ padding: 24, background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 12, color: 'var(--text-muted)', marginTop: 20 }}>
          No printings match these filters.
        </div>
      )}
    </div>
  )
}

function Chip({ active, onClick, label, dot }: { active: boolean; onClick: () => void; label: string; dot?: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        display: 'inline-flex', alignItems: 'center', gap: 6,
        background: active ? 'var(--primary-soft)' : 'var(--bg-light)',
        color: active ? 'var(--primary)' : 'var(--text)',
        border: `1px solid ${active ? 'rgba(35,95,174,0.35)' : 'var(--border)'}`,
        borderRadius: 999, padding: '5px 10px', fontSize: 12, fontWeight: 600, cursor: 'pointer',
      }}
    >
      {dot && <span style={{ width: 7, height: 7, borderRadius: '50%', background: dot }} aria-hidden />}
      {label}
    </button>
  )
}

function ColorChip({ code, label, bg, fg, active, onClick }: { code: string; label: string; bg: string; fg: string; active: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      title={`Filter by ${code}`}
      style={{
        width: 26, height: 26, borderRadius: '50%',
        background: bg, color: fg,
        border: active ? '2px solid var(--accent)' : '1px solid rgba(0,0,0,0.1)',
        fontSize: 11, fontWeight: 800, cursor: 'pointer',
        display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
        fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
      }}
    >
      {label}
    </button>
  )
}
