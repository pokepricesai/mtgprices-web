'use client'

// src/components/mtg/SetValueHistoryChart.tsx
// Compact set-value trend chart. Data is fetched server-side and
// passed in as three pre-computed series (7 / 30 / 90 day windows).
// User toggles the visible window locally.

import { useMemo, useState } from 'react'
import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid, Area, AreaChart } from 'recharts'
import type { SetValueHistory } from '@/lib/mtg/set-value-history'

type Props = {
  windows: {
    d7: SetValueHistory | null
    d30: SetValueHistory | null
    d90: SetValueHistory | null
  }
}

type WindowKey = '7' | '30' | '90'

export default function SetValueHistoryChart({ windows }: Props) {
  const [win, setWin] = useState<WindowKey>('30')
  const current = win === '7' ? windows.d7 : win === '30' ? windows.d30 : windows.d90
  const label = win + 'D'

  const stats = useMemo(() => {
    if (!current || current.points.length === 0) return null
    const first = current.points[0].value
    const last = current.points[current.points.length - 1].value
    let hi = current.points[0].value, lo = current.points[0].value
    for (const p of current.points) { if (p.value > hi) hi = p.value; if (p.value < lo) lo = p.value }
    const pct = first > 0 ? (last - first) / first : null
    return { first, last, hi, lo, pct }
  }, [current])

  const availableWindows: WindowKey[] = ['7', '30', '90'].filter(
    (k) => (k === '7' && windows.d7) || (k === '30' && windows.d30) || (k === '90' && windows.d90),
  ) as WindowKey[]

  if (availableWindows.length === 0) {
    return null
  }

  return (
    <section
      style={{
        marginTop: 20, padding: 18,
        background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 14,
        boxShadow: '0 3px 12px rgba(20,33,61,0.04)',
      }}
    >
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, alignItems: 'baseline', justifyContent: 'space-between', marginBottom: 8 }}>
        <div>
          <div className="label-mono" style={{ color: 'var(--gold-600)' }}>Set value history</div>
          {current && (
            <div style={{ marginTop: 2, fontSize: 12, color: 'var(--text-muted)' }}>
              {current.basketSize} card basket · {current.basis.provider} {current.basis.currency} {current.basis.priceType}
            </div>
          )}
        </div>
        <div style={{ display: 'inline-flex', gap: 4, background: 'var(--bg-light)', border: '1px solid var(--border)', borderRadius: 999, padding: 3 }}>
          {availableWindows.map((w) => {
            const active = w === win
            return (
              <button
                key={w}
                type="button"
                onClick={() => setWin(w)}
                style={{
                  background: active ? 'var(--surface)' : 'transparent',
                  color: active ? 'var(--text-strong)' : 'var(--text-muted)',
                  border: active ? '1px solid var(--border)' : '1px solid transparent',
                  borderRadius: 999, padding: '4px 12px',
                  fontSize: 12, fontWeight: 700, fontFamily: 'inherit', cursor: 'pointer',
                }}
              >{w}D</button>
            )
          })}
        </div>
      </div>

      {!current || current.points.length < 2 ? (
        <div style={{
          height: 140, display: 'flex', alignItems: 'center', justifyContent: 'center',
          color: 'var(--text-muted)', fontSize: 13,
          background: 'var(--bg-light)', border: '1px dashed var(--border)', borderRadius: 10,
        }}>Not enough coverage in this window.</div>
      ) : (
        <>
          {stats && (
            <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap', fontSize: 12.5, color: 'var(--text-muted)', marginBottom: 8 }}>
              <span>{label} start <strong style={{ color: 'var(--text-strong)', fontFamily: 'ui-monospace, SFMono-Regular, monospace' }}>${stats.first.toFixed(0)}</strong></span>
              <span>Latest <strong style={{ color: 'var(--text-strong)', fontFamily: 'ui-monospace, SFMono-Regular, monospace' }}>${stats.last.toFixed(0)}</strong></span>
              <span>High <strong style={{ color: 'var(--text-strong)', fontFamily: 'ui-monospace, SFMono-Regular, monospace' }}>${stats.hi.toFixed(0)}</strong></span>
              <span>Low <strong style={{ color: 'var(--text-strong)', fontFamily: 'ui-monospace, SFMono-Regular, monospace' }}>${stats.lo.toFixed(0)}</strong></span>
              {stats.pct !== null && (
                <span style={{
                  color: stats.pct >= 0 ? 'var(--green)' : 'var(--red)',
                  fontWeight: 700, fontFamily: 'ui-monospace, SFMono-Regular, monospace',
                }}>{stats.pct >= 0 ? '▲' : '▼'} {Math.abs(stats.pct * 100).toFixed(1)}%</span>
              )}
            </div>
          )}
          <div style={{ height: 180 }}>
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={current.points} margin={{ top: 6, right: 10, left: 0, bottom: 4 }}>
                <defs>
                  <linearGradient id="setValueFill" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%"  stopColor="#A8681C" stopOpacity={0.30} />
                    <stop offset="100%" stopColor="#A8681C" stopOpacity={0.02} />
                  </linearGradient>
                </defs>
                <CartesianGrid stroke="#E4DAC1" strokeDasharray="3 3" />
                <XAxis dataKey="date" stroke="#5E6B85" tick={{ fill: '#5E6B85', fontSize: 11 }} minTickGap={40} tickFormatter={(d: string) => d.slice(5)} />
                <YAxis stroke="#5E6B85" tick={{ fill: '#5E6B85', fontSize: 11 }} width={54} tickFormatter={(v) => '$' + Math.round(Number(v)).toLocaleString()} />
                <Tooltip
                  contentStyle={{ background: '#FFFFFF', border: '1px solid #E4DAC1', borderRadius: 8, fontSize: 12, boxShadow: '0 6px 20px rgba(20,33,61,0.10)' }}
                  labelStyle={{ color: '#14213D' }}
                  formatter={(v: any) => '$' + Number(v).toLocaleString(undefined, { maximumFractionDigits: 0 })}
                />
                <Area type="monotone" dataKey="value" stroke="#A8681C" strokeWidth={2} fill="url(#setValueFill)" isAnimationActive={false} />
              </AreaChart>
            </ResponsiveContainer>
          </div>
          <details style={{ marginTop: 8, fontSize: 11.5, color: 'var(--text-muted)' }}>
            <summary style={{ cursor: 'pointer', fontWeight: 600 }}>Methodology</summary>
            <p style={{ margin: '6px 0 0', lineHeight: 1.55 }}>{current.methodology}</p>
          </details>
        </>
      )}
    </section>
  )
}
