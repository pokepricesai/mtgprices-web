'use client'
// src/app/card-finder/CardFinderControls.tsx
// Interactive filter surface for /card-finder. Structured overrides
// take precedence over anything the NL parser inferred from `q`.

import { useRouter, useSearchParams, usePathname } from 'next/navigation'
import { useMemo, useState } from 'react'
import { SEARCHABLE_CAPABILITIES, CAPABILITY_LABELS, type CardCapability } from '@/lib/mtg/capabilities'
import { FORMATS } from '@/lib/mtg/formats.data'

type Props = {
  mode: 'play' | 'collecting'
  initialParams: Record<string, string>
  suggestions: string[]
  warnings: string[]
}

const COLOR_LIST = ['W', 'U', 'B', 'R', 'G']

export default function CardFinderControls({ mode, initialParams, suggestions, warnings }: Props) {
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()

  const [q, setQ] = useState(initialParams.q ?? '')
  const [colors, setColors] = useState<Set<string>>(new Set((initialParams.colors ?? '').split(',').filter(Boolean)))
  const [identity, setIdentity] = useState<Set<string>>(new Set((initialParams.identity ?? '').split(',').filter(Boolean)))
  const [colorless, setColorless] = useState(initialParams.colorless === '1')
  const [caps, setCaps] = useState<Set<string>>(new Set((initialParams.caps ?? '').split(',').filter(Boolean)))
  const [legal, setLegal] = useState(initialParams.legal ?? '')
  const [rarity, setRarity] = useState(initialParams.rarity ?? '')
  const [mvmin, setMvmin] = useState(initialParams.mvmin ?? '')
  const [mvmax, setMvmax] = useState(initialParams.mvmax ?? '')
  const [pmax, setPmax] = useState(initialParams.pmax ?? '')
  const [cur, setCur] = useState(initialParams.cur ?? 'USD')
  const [budget, setBudget] = useState(initialParams.budget === '1')
  const [finish, setFinish] = useState(initialParams.finish ?? '')
  const [reserved, setReserved] = useState(initialParams.rl === '1')
  const [gameChanger, setGameChanger] = useState(initialParams.gc === '1')
  const [set, setSet] = useState(initialParams.set ?? '')
  const [from, setFrom] = useState(initialParams.from ?? '')
  const [to, setTo] = useState(initialParams.to ?? '')
  const [artist, setArtist] = useState(initialParams.artist ?? '')
  const [sort, setSort] = useState(initialParams.sort ?? '')

  function toggle(set: Set<string>, val: string) {
    const next = new Set(set)
    if (next.has(val)) next.delete(val); else next.add(val)
    return next
  }

  function submit(e: React.FormEvent) {
    e.preventDefault()
    const params = new URLSearchParams()
    params.set('mode', mode)
    if (q.trim()) params.set('q', q.trim())
    if (colors.size) params.set('colors', Array.from(colors).join(','))
    if (identity.size) params.set('identity', Array.from(identity).join(','))
    if (colorless) params.set('colorless', '1')
    if (caps.size) params.set('caps', Array.from(caps).join(','))
    if (legal) params.set('legal', legal)
    if (rarity) params.set('rarity', rarity)
    if (mvmin) params.set('mvmin', mvmin)
    if (mvmax) params.set('mvmax', mvmax)
    if (pmax) params.set('pmax', pmax)
    if (cur !== 'USD') params.set('cur', cur)
    else if (pmax) params.set('cur', 'USD')
    if (budget) params.set('budget', '1')
    if (finish) params.set('finish', finish)
    if (reserved) params.set('rl', '1')
    if (gameChanger) params.set('gc', '1')
    if (set) params.set('set', set)
    if (from) params.set('from', from)
    if (to) params.set('to', to)
    if (artist) params.set('artist', artist)
    if (sort) params.set('sort', sort)
    router.push(`${pathname}?${params.toString()}`)
  }

  function clearAll() {
    setQ(''); setColors(new Set()); setIdentity(new Set()); setColorless(false); setCaps(new Set())
    setLegal(''); setRarity(''); setMvmin(''); setMvmax(''); setPmax(''); setCur('USD'); setBudget(false)
    setFinish(''); setReserved(false); setGameChanger(false); setSet(''); setFrom(''); setTo(''); setArtist('')
    setSort('')
    router.push(`${pathname}?mode=${mode}`)
  }

  return (
    <form onSubmit={submit} style={{ marginBottom: 20 }}>
      {/* NL box */}
      <div style={{ marginBottom: 12 }}>
        <input
          type="text"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder={mode === 'play'
            ? 'Describe what you need — "cheap black creature removal legal in commander"'
            : 'Describe collector interest — "foil mythics under $10 from 2020"'}
          style={{
            width: '100%', padding: '14px 16px',
            border: '1px solid var(--border)', background: 'var(--surface)',
            color: 'var(--text)', borderRadius: 12, fontSize: 15, outline: 'none',
            fontFamily: 'inherit', boxSizing: 'border-box',
          }}
        />
        {(suggestions.length > 0 || warnings.length > 0) && (
          <div style={{ marginTop: 8, display: 'flex', flexWrap: 'wrap', gap: 6 }}>
            {suggestions.map((s, i) => (
              <span key={i} style={{
                fontSize: 11, fontWeight: 600, padding: '3px 10px', borderRadius: 999,
                background: 'var(--primary-soft)', color: 'var(--primary)',
              }}>{s}</span>
            ))}
            {warnings.map((w, i) => (
              <span key={i} style={{
                fontSize: 11, fontWeight: 600, padding: '3px 10px', borderRadius: 999,
                background: 'var(--accent-soft)', color: 'var(--amber)',
              }}>{w}</span>
            ))}
          </div>
        )}
      </div>

      {/* Filter grid — different fields per mode */}
      <div style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
        gap: 10, padding: 14,
        background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 12,
      }}>
        {/* Play-mode fields */}
        {mode === 'play' && (
          <>
            <Field label="Capabilities">
              <CapPicker selected={caps} onToggle={(v) => setCaps(toggle(caps, v))} />
            </Field>
            <Field label="Colours (any of)">
              <ColorPips selected={colors} onToggle={(v) => setColors(toggle(colors, v))} />
              <label style={{ marginTop: 6, display: 'inline-flex', gap: 6, alignItems: 'center', fontSize: 12, color: 'var(--text-muted)' }}>
                <input type="checkbox" checked={colorless} onChange={(e) => setColorless(e.target.checked)} /> Colourless
              </label>
            </Field>
            <Field label="Colour identity (subset of)">
              <ColorPips selected={identity} onToggle={(v) => setIdentity(toggle(identity, v))} />
            </Field>
            <Field label="Legal in">
              <select value={legal} onChange={(e) => setLegal(e.target.value)} style={inputStyle}>
                <option value="">Any format</option>
                {FORMATS.map((f) => <option key={f.key} value={f.key}>{f.label}</option>)}
              </select>
            </Field>
            <Field label="Mana value">
              <div style={{ display: 'flex', gap: 6 }}>
                <input type="number" min="0" max="20" value={mvmin} onChange={(e) => setMvmin(e.target.value)} placeholder="Min" style={{ ...inputStyle, flex: 1 }} />
                <input type="number" min="0" max="20" value={mvmax} onChange={(e) => setMvmax(e.target.value)} placeholder="Max" style={{ ...inputStyle, flex: 1 }} />
              </div>
            </Field>
          </>
        )}

        {/* Collecting-mode fields */}
        {mode === 'collecting' && (
          <>
            <Field label="Set code">
              <input type="text" value={set} onChange={(e) => setSet(e.target.value)} placeholder="e.g. neo" style={inputStyle} />
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
            <Field label="Released from">
              <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} style={inputStyle} />
            </Field>
            <Field label="Released to">
              <input type="date" value={to} onChange={(e) => setTo(e.target.value)} style={inputStyle} />
            </Field>
            <Field label="Artist">
              <input type="text" value={artist} onChange={(e) => setArtist(e.target.value)} placeholder="e.g. Rebecca Guay" style={inputStyle} />
            </Field>
            <Field label="Flags">
              <label style={{ display: 'flex', gap: 6, alignItems: 'center', fontSize: 13, marginBottom: 4 }}>
                <input type="checkbox" checked={reserved} onChange={(e) => setReserved(e.target.checked)} /> Reserved List
              </label>
              <label style={{ display: 'flex', gap: 6, alignItems: 'center', fontSize: 13 }}>
                <input type="checkbox" checked={gameChanger} onChange={(e) => setGameChanger(e.target.checked)} /> Game Changer
              </label>
            </Field>
          </>
        )}

        {/* Price + sort (both modes) */}
        <Field label="Price ceiling">
          <div style={{ display: 'flex', gap: 6 }}>
            <select value={cur} onChange={(e) => setCur(e.target.value)} style={{ ...inputStyle, flex: '0 0 74px' }}>
              <option value="USD">USD $</option>
              <option value="EUR">EUR €</option>
            </select>
            <input type="number" min="0" step="0.5" value={pmax} onChange={(e) => setPmax(e.target.value)} placeholder="Max" style={{ ...inputStyle, flex: 1 }} />
          </div>
          <label style={{ marginTop: 6, display: 'inline-flex', gap: 6, alignItems: 'center', fontSize: 12, color: 'var(--text-muted)' }}>
            <input type="checkbox" checked={budget} onChange={(e) => setBudget(e.target.checked)} /> Prefer cheaper prices (sort)
          </label>
        </Field>
        <Field label="Sort">
          <select value={sort} onChange={(e) => setSort(e.target.value)} style={inputStyle}>
            <option value="">Relevance</option>
            <option value="mv_asc">Mana value asc</option>
            <option value="name">Name</option>
            <option value="released_desc">Newest printing</option>
            <option value="released_asc">Oldest printing</option>
            <option value="price_asc">Price low → high</option>
            <option value="price_desc">Price high → low</option>
          </select>
        </Field>

        <div style={{ display: 'flex', alignItems: 'flex-end', gap: 8 }}>
          <button
            type="submit"
            style={{
              background: 'var(--primary)', color: '#fff',
              border: 'none', borderRadius: 10,
              padding: '10px 18px', fontWeight: 700, fontSize: 14, cursor: 'pointer', flex: 1,
            }}
          >Find cards</button>
          <button
            type="button"
            onClick={clearAll}
            style={{
              padding: '10px 14px', border: '1px solid var(--border)',
              background: 'transparent', color: 'var(--text)',
              borderRadius: 10, fontSize: 13, fontWeight: 600, cursor: 'pointer',
            }}
          >Clear</button>
        </div>
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

function ColorPips({ selected, onToggle }: { selected: Set<string>; onToggle: (v: string) => void }) {
  const PIP: Record<string, { bg: string; fg: string }> = {
    W: { bg: '#f9f6df', fg: '#25313f' },
    U: { bg: '#8ecff6', fg: '#0b2a49' },
    B: { bg: '#4a4a4a', fg: '#f3f0e8' },
    R: { bg: '#f0a48f', fg: '#4a1010' },
    G: { bg: '#9ee0a5', fg: '#0f3418' },
  }
  return (
    <div style={{ display: 'flex', gap: 4 }}>
      {COLOR_LIST.map((c) => {
        const active = selected.has(c)
        const { bg, fg } = PIP[c]
        return (
          <button
            key={c}
            type="button"
            onClick={() => onToggle(c)}
            aria-pressed={active}
            style={{
              width: 30, height: 30, borderRadius: '50%',
              background: bg, color: fg, fontSize: 12, fontWeight: 800,
              border: active ? '2px solid var(--accent)' : '1px solid rgba(0,0,0,0.1)',
              cursor: 'pointer', fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
              display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
            }}
          >{c}</button>
        )
      })}
    </div>
  )
}

function CapPicker({ selected, onToggle }: { selected: Set<string>; onToggle: (v: string) => void }) {
  return (
    <details style={{ position: 'relative' }}>
      <summary style={{
        listStyle: 'none', cursor: 'pointer', ...inputStyle,
        display: 'flex', justifyContent: 'space-between', alignItems: 'center',
      }}>
        <span>{selected.size === 0 ? 'Any' : `${selected.size} selected`}</span>
        <span style={{ color: 'var(--text-muted)' }}>▾</span>
      </summary>
      <div style={{
        position: 'absolute', top: 42, left: 0, right: 0, zIndex: 10,
        background: 'var(--surface)', border: '1px solid var(--border)',
        borderRadius: 10, padding: 10, maxHeight: 320, overflowY: 'auto',
        boxShadow: '0 6px 20px rgba(0,0,0,0.35)',
      }}>
        {SEARCHABLE_CAPABILITIES.map((c) => (
          <label key={c} style={{ display: 'flex', gap: 8, padding: '4px 0', fontSize: 13, cursor: 'pointer' }}>
            <input type="checkbox" checked={selected.has(c)} onChange={() => onToggle(c)} />
            {CAPABILITY_LABELS[c as CardCapability]}
          </label>
        ))}
      </div>
    </details>
  )
}
