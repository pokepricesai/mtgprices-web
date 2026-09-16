'use client'

import { useState } from 'react'
import { useRouter, usePathname } from 'next/navigation'
import { CONDITIONS_ORDERED, CONDITION_LABEL, type CardCondition } from '@/lib/mtg/collection.data'

type Props = { initialParams: Record<string, string> }

const COLOR_PIPS = ['W', 'U', 'B', 'R', 'G']

export default function CollectionFilters({ initialParams }: Props) {
  const router = useRouter()
  const pathname = usePathname()
  const [name, setName] = useState(initialParams.name ?? '')
  const [setCode, setSetCode] = useState(initialParams.set ?? '')
  const [colors, setColors] = useState<Set<string>>(new Set((initialParams.colors ?? '').split(',').filter(Boolean)))
  const [rarity, setRarity] = useState(initialParams.rarity ?? '')
  const [finish, setFinish] = useState(initialParams.finish ?? '')
  const [condition, setCondition] = useState<CardCondition | ''>((initialParams.condition as CardCondition) ?? '')
  const [sort, setSort] = useState(initialParams.sort ?? 'name')

  function submit(e: React.FormEvent) {
    e.preventDefault()
    const p = new URLSearchParams()
    if (name.trim()) p.set('name', name.trim())
    if (setCode.trim()) p.set('set', setCode.trim().toLowerCase())
    if (colors.size) p.set('colors', Array.from(colors).join(','))
    if (rarity) p.set('rarity', rarity)
    if (finish) p.set('finish', finish)
    if (condition) p.set('condition', condition)
    if (sort && sort !== 'name') p.set('sort', sort)
    router.push(`${pathname}?${p.toString()}`)
  }

  function clear() {
    setName(''); setSetCode(''); setColors(new Set()); setRarity(''); setFinish(''); setCondition(''); setSort('name')
    router.push(pathname)
  }

  function toggleColor(c: string) {
    setColors((prev) => {
      const next = new Set(prev)
      if (next.has(c)) next.delete(c); else next.add(c)
      return next
    })
  }

  const hasFilter = name || setCode || colors.size > 0 || rarity || finish || condition || (sort && sort !== 'name')

  return (
    <form onSubmit={submit} style={{
      display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 10, padding: 14,
      background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 12, marginBottom: 20,
    }}>
      <Field label="Card name">
        <input type="text" value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. bolt" style={inputStyle} />
      </Field>
      <Field label="Set code">
        <input type="text" value={setCode} onChange={(e) => setSetCode(e.target.value)} placeholder="e.g. neo" style={inputStyle} />
      </Field>
      <Field label="Colours">
        <div style={{ display: 'flex', gap: 4 }}>
          {COLOR_PIPS.map((c) => {
            const active = colors.has(c)
            return (
              <button
                key={c}
                type="button"
                onClick={() => toggleColor(c)}
                aria-pressed={active}
                style={{
                  width: 28, height: 28, borderRadius: '50%',
                  background: active ? 'var(--primary)' : 'var(--bg-light)',
                  color: active ? '#fff' : 'var(--text)',
                  border: active ? '1px solid var(--primary)' : '1px solid var(--border)',
                  fontSize: 12, fontWeight: 800, cursor: 'pointer',
                  fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
                }}
              >{c}</button>
            )
          })}
        </div>
      </Field>
      <Field label="Rarity">
        <select value={rarity} onChange={(e) => setRarity(e.target.value)} style={inputStyle}>
          <option value="">Any</option>
          <option value="common">Common</option>
          <option value="uncommon">Uncommon</option>
          <option value="rare">Rare</option>
          <option value="mythic">Mythic</option>
        </select>
      </Field>
      <Field label="Finish">
        <select value={finish} onChange={(e) => setFinish(e.target.value)} style={inputStyle}>
          <option value="">Any</option>
          <option value="nonfoil">Non-foil</option>
          <option value="foil">Foil</option>
          <option value="etched">Etched</option>
        </select>
      </Field>
      <Field label="Condition">
        <select value={condition} onChange={(e) => setCondition(e.target.value as CardCondition | '')} style={inputStyle}>
          <option value="">Any</option>
          {CONDITIONS_ORDERED.map((c) => <option key={c} value={c}>{CONDITION_LABEL[c]}</option>)}
        </select>
      </Field>
      <Field label="Sort">
        <select value={sort} onChange={(e) => setSort(e.target.value)} style={inputStyle}>
          <option value="name">Name</option>
          <option value="set">Set</option>
          <option value="quantity_desc">Quantity high → low</option>
          <option value="quantity_asc">Quantity low → high</option>
          <option value="price_desc">Value high → low</option>
          <option value="price_asc">Value low → high</option>
          <option value="acquired_desc">Recently acquired</option>
        </select>
      </Field>
      <div style={{ display: 'flex', gap: 8, alignItems: 'flex-end' }}>
        <button type="submit" style={{
          background: 'var(--primary)', color: '#fff', border: 'none',
          padding: '10px 16px', borderRadius: 10, fontWeight: 700, fontSize: 13, cursor: 'pointer', flex: 1,
        }}>Apply</button>
        {hasFilter && (
          <button type="button" onClick={clear} style={{
            background: 'transparent', color: 'var(--text)',
            border: '1px solid var(--border)', padding: '10px 14px',
            borderRadius: 10, fontSize: 13, fontWeight: 600, cursor: 'pointer',
          }}>Clear</button>
        )}
      </div>
    </form>
  )
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
      <span className="label-mono">{label}</span>
      {children}
    </label>
  )
}

const inputStyle: React.CSSProperties = {
  padding: '9px 12px',
  border: '1px solid var(--border)',
  background: 'var(--bg-light)',
  color: 'var(--text)',
  borderRadius: 10,
  fontSize: 14,
  outline: 'none',
  fontFamily: 'inherit',
  boxSizing: 'border-box',
}
