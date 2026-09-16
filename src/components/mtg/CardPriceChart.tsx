'use client'
// MTGPrices card-page price chart. Simple Recharts wrapper. Data is
// pre-fetched server-side and passed as a prop; this file is a client
// component only because Recharts needs to run in the browser.

import { useMemo, useState } from 'react'
import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid } from 'recharts'

export type MtgChartSeries = {
  key: string           // e.g. 'tcgplayer_paper_USD_retail'
  label: string         // e.g. 'TCGplayer USD'
  color: string         // css colour
  points: { date: string; value: number }[]
}

function formatUSD(v: number): string {
  if (v == null || Number.isNaN(v)) return '—'
  if (v >= 1000) return '$' + (v / 1000).toFixed(1) + 'k'
  if (v >= 100)  return '$' + v.toFixed(0)
  return '$' + v.toFixed(2)
}

export default function CardPriceChart({
  series,
  height = 240,
}: {
  series: MtgChartSeries[]
  height?: number
}) {
  // Fold series into a wide row shape { date, [seriesKey]: value }.
  const wide = useMemo(() => {
    const byDate = new Map<string, Record<string, any>>()
    for (const s of series) {
      for (const p of s.points) {
        if (!byDate.has(p.date)) byDate.set(p.date, { date: p.date })
        byDate.get(p.date)![s.key] = p.value
      }
    }
    return Array.from(byDate.values()).sort((a, b) => a.date.localeCompare(b.date))
  }, [series])

  const seriesOrder = series.map((s) => s.key)
  const [visible, setVisible] = useState<Set<string>>(new Set(seriesOrder))

  if (wide.length < 2) {
    return (
      <div
        style={{
          height,
          background: 'var(--bg-light)',
          border: '1px dashed var(--border)',
          borderRadius: 10,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          color: 'var(--text-muted)',
          fontSize: 13,
        }}
      >
        Not enough price history yet.
      </div>
    )
  }

  return (
    <div>
      {series.length > 1 && (
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 10 }}>
          {series.map((s) => {
            const active = visible.has(s.key)
            return (
              <button
                key={s.key}
                type="button"
                onClick={() =>
                  setVisible((prev) => {
                    const next = new Set(prev)
                    if (next.has(s.key)) next.delete(s.key)
                    else next.add(s.key)
                    return next
                  })
                }
                style={{
                  background: active ? 'var(--primary-soft)' : 'transparent',
                  color: active ? 'var(--text)' : 'var(--text-muted)',
                  border: `1px solid ${active ? s.color : 'var(--border)'}`,
                  borderRadius: 999,
                  padding: '4px 10px',
                  fontSize: 12,
                  fontWeight: 600,
                  cursor: 'pointer',
                }}
              >
                <span
                  aria-hidden
                  style={{
                    display: 'inline-block',
                    width: 8,
                    height: 8,
                    borderRadius: '50%',
                    background: s.color,
                    marginRight: 6,
                    verticalAlign: 'middle',
                  }}
                />
                {s.label}
              </button>
            )
          })}
        </div>
      )}
      <div style={{ height }}>
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={wide} margin={{ top: 8, right: 12, left: 0, bottom: 4 }}>
            <CartesianGrid stroke="#E4E1D9" strokeDasharray="3 3" />
            <XAxis
              dataKey="date"
              stroke="#6B7280"
              tick={{ fill: '#6B7280', fontSize: 11 }}
              minTickGap={24}
              tickFormatter={(d: string) => d.slice(5)}
            />
            <YAxis stroke="#6B7280" tick={{ fill: '#6B7280', fontSize: 11 }} tickFormatter={(v) => formatUSD(Number(v))} />
            <Tooltip
              contentStyle={{ background: '#FFFFFF', border: '1px solid #E4E1D9', borderRadius: 8, fontSize: 12, boxShadow: '0 6px 20px rgba(23,32,58,0.10)' }}
              labelStyle={{ color: '#17203A' }}
              formatter={(v: any) => formatUSD(Number(v))}
            />
            {series
              .filter((s) => visible.has(s.key))
              .map((s) => (
                <Line
                  key={s.key}
                  type="monotone"
                  dataKey={s.key}
                  stroke={s.color}
                  strokeWidth={2}
                  dot={false}
                  connectNulls
                  isAnimationActive={false}
                  name={s.label}
                />
              ))}
          </LineChart>
        </ResponsiveContainer>
      </div>
    </div>
  )
}
