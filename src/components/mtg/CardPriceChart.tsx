'use client'
// MTGPrices card-page price chart. Simple Recharts wrapper. Data is
// pre-fetched server-side (up to 90 days) and passed as a prop. When the
// user selects the All window we lazy-fetch the full history over
// /api/cards/history so the initial page payload stays lean.

import { useEffect, useMemo, useRef, useState } from 'react'
import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid } from 'recharts'

export type MtgChartSeries = {
  key: string           // e.g. 'tcgplayer_paper_USD_retail'
  label: string         // e.g. 'TCGplayer USD'
  color: string         // css colour
  provider?: string     // used for lazy full-history matching by provider
  points: { date: string; value: number }[]
}

function formatUSD(v: number): string {
  if (v == null || Number.isNaN(v)) return '-'
  if (v >= 1000) return '$' + (v / 1000).toFixed(1) + 'k'
  if (v >= 100)  return '$' + v.toFixed(0)
  return '$' + v.toFixed(2)
}

type Window = 7 | 30 | 90 | 'all'

export default function CardPriceChart({
  series,
  height = 240,
  finishId,
  providerColorMap,
  providerLabelMap,
}: {
  series: MtgChartSeries[]
  height?: number
  // When provided, the All window lazy-fetches full history for this
  // finish. Without it, All simply widens the visible window over the
  // data already loaded.
  finishId?: string | null
  providerColorMap?: Record<string, string>
  providerLabelMap?: Record<string, string>
}) {
  const [windowDays, setWindowDays] = useState<Window>(90)
  const [fullSeries, setFullSeries] = useState<MtgChartSeries[] | null>(null)
  const [fullLoading, setFullLoading] = useState(false)
  const [fullError, setFullError] = useState<string | null>(null)
  const [fullTruncated, setFullTruncated] = useState(false)
  const fetchedForFinish = useRef<string | null>(null)

  // If a new finish is selected while All is showing, drop the stale
  // full history so the next request refetches. This also protects
  // against a mid-fetch finish change.
  useEffect(() => {
    if (!finishId) return
    if (fetchedForFinish.current && fetchedForFinish.current !== finishId) {
      setFullSeries(null)
      setFullError(null)
      setFullTruncated(false)
      fetchedForFinish.current = null
    }
  }, [finishId])

  // Lazy fetch the full history the first time All is selected for the
  // current finish.
  useEffect(() => {
    if (windowDays !== 'all') return
    if (!finishId) return
    if (fullSeries || fullLoading) return
    if (fetchedForFinish.current === finishId) return
    let cancelled = false
    setFullLoading(true)
    setFullError(null)
    fetch(`/api/cards/history?finish=${encodeURIComponent(finishId)}&days=all`)
      .then((r) => r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`)))
      .then((json) => {
        if (cancelled) return
        type ApiSeries = { provider: string; points: { date: string; value: number }[] }
        const raw = (json.series ?? []) as ApiSeries[]
        const mapped: MtgChartSeries[] = raw.map((s) => ({
          key: `${s.provider}_paper_USD_retail`,
          label: providerLabelMap?.[s.provider] ?? s.provider,
          color: providerColorMap?.[s.provider] ?? '#14213D',
          provider: s.provider,
          points: s.points,
        }))
        setFullSeries(mapped)
        setFullTruncated(Boolean(json.truncated))
        fetchedForFinish.current = finishId
      })
      .catch((err) => {
        if (!cancelled) setFullError(String(err?.message ?? err))
      })
      .finally(() => { if (!cancelled) setFullLoading(false) })
    return () => { cancelled = true }
  }, [windowDays, finishId, fullSeries, fullLoading, providerColorMap, providerLabelMap])

  // Which series to render depends on window: All uses lazy full data
  // when it has landed, otherwise falls back to the pre-loaded series.
  const activeSeriesList = (windowDays === 'all' && fullSeries) ? fullSeries : series

  // Compute the cutoff date once per series prop / window switch.
  // "all" shows the full series (no cutoff), 7/30/90 windows are
  // filtered client-side against whichever series set is active.
  const cutoffIso = useMemo(() => {
    if (windowDays === 'all') return null
    let latest = ''
    for (const s of activeSeriesList) for (const p of s.points) if (p.date > latest) latest = p.date
    if (!latest) return null
    const d = new Date(latest + 'T00:00:00Z')
    d.setUTCDate(d.getUTCDate() - windowDays)
    return d.toISOString().slice(0, 10)
  }, [activeSeriesList, windowDays])

  // Fold series into a wide row shape { date, [seriesKey]: value }.
  const wide = useMemo(() => {
    const byDate = new Map<string, Record<string, any>>()
    for (const s of activeSeriesList) {
      for (const p of s.points) {
        if (cutoffIso && p.date < cutoffIso) continue
        if (!byDate.has(p.date)) byDate.set(p.date, { date: p.date })
        byDate.get(p.date)![s.key] = p.value
      }
    }
    return Array.from(byDate.values()).sort((a, b) => a.date.localeCompare(b.date))
  }, [activeSeriesList, cutoffIso])

  // Quick stats for the active window (latest, high, low, delta) based
  // on the first series so the header numbers stay stable while the
  // user toggles other providers.
  const primary = activeSeriesList[0]
  const stats = useMemo(() => {
    if (!primary) return null
    const pts = primary.points.filter((p) => !cutoffIso || p.date >= cutoffIso)
    if (pts.length === 0) return null
    let hi = pts[0].value, lo = pts[0].value
    for (const p of pts) { if (p.value > hi) hi = p.value; if (p.value < lo) lo = p.value }
    const first = pts[0].value, last = pts[pts.length - 1].value
    const abs = last - first
    const pct = first > 0 ? abs / first : null
    return { latest: last, high: hi, low: lo, abs, pct, points: pts.length }
  }, [primary, cutoffIso])

  const seriesOrder = activeSeriesList.map((s) => s.key)
  const [visible, setVisible] = useState<Set<string>>(new Set(seriesOrder))
  // When the active series set changes (window switch), re-seed
  // visibility so newly discovered providers are visible by default.
  useEffect(() => { setVisible(new Set(activeSeriesList.map((s) => s.key))) }, [activeSeriesList])

  // Only render the "All" pill when we actually have a way to fetch
  // real full history (a finish id + the api route). Without a finishId
  // there is no way to promise anything beyond what's already loaded,
  // so we hide the option rather than mislabel it.
  const canLoadAll = Boolean(finishId)
  const WINDOW_OPTIONS: { key: Window; label: string }[] = [
    { key: 7,  label: '7D' },
    { key: 30, label: '30D' },
    { key: 90, label: '90D' },
    ...(canLoadAll ? [{ key: 'all' as const, label: 'All' }] : []),
  ]

  const showAllLoading = windowDays === 'all' && fullLoading
  const showAllError = windowDays === 'all' && !!fullError && !fullSeries

  if (wide.length < 2 && !showAllLoading && !showAllError) {
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
      <div style={{
        display: 'flex', flexWrap: 'wrap', gap: 10, alignItems: 'center', justifyContent: 'space-between',
        marginBottom: 10,
      }}>
        <div style={{ display: 'inline-flex', gap: 4, background: 'var(--bg-light)', border: '1px solid var(--border)', borderRadius: 999, padding: 3 }}>
          {WINDOW_OPTIONS.map((o) => {
            const active = windowDays === o.key
            return (
              <button
                key={String(o.key)}
                type="button"
                onClick={() => setWindowDays(o.key)}
                style={{
                  background: active ? 'var(--surface)' : 'transparent',
                  color: active ? 'var(--text-strong)' : 'var(--text-muted)',
                  border: active ? '1px solid var(--border)' : '1px solid transparent',
                  borderRadius: 999, padding: '4px 12px',
                  fontSize: 12, fontWeight: 700, fontFamily: 'inherit', cursor: 'pointer',
                  boxShadow: active ? '0 1px 2px rgba(20,33,61,0.05)' : 'none',
                }}
              >{o.label}</button>
            )
          })}
        </div>
        {stats && (
          <div style={{ display: 'flex', gap: 12, alignItems: 'baseline', fontSize: 12, color: 'var(--text-muted)' }}>
            <span>Latest <strong style={{ color: 'var(--text-strong)', fontFamily: 'ui-monospace, SFMono-Regular, monospace' }}>{formatUSD(stats.latest)}</strong></span>
            <span>High <strong style={{ color: 'var(--text-strong)', fontFamily: 'ui-monospace, SFMono-Regular, monospace' }}>{formatUSD(stats.high)}</strong></span>
            <span>Low <strong style={{ color: 'var(--text-strong)', fontFamily: 'ui-monospace, SFMono-Regular, monospace' }}>{formatUSD(stats.low)}</strong></span>
            {stats.pct !== null && (
              <span style={{
                color: stats.pct >= 0 ? 'var(--green)' : 'var(--red)',
                fontWeight: 700, fontFamily: 'ui-monospace, SFMono-Regular, monospace',
              }}>
                {stats.pct >= 0 ? '▲' : '▼'} {Math.abs(stats.pct * 100).toFixed(1)}%
              </span>
            )}
          </div>
        )}
      </div>
      {activeSeriesList.length > 1 && (
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 10 }}>
          {activeSeriesList.map((s) => {
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
            <CartesianGrid stroke="#E4DAC1" strokeDasharray="3 3" />
            <XAxis
              dataKey="date"
              stroke="#5E6B85"
              tick={{ fill: '#5E6B85', fontSize: 11 }}
              minTickGap={24}
              tickFormatter={(d: string) => d.slice(5)}
            />
            <YAxis stroke="#5E6B85" tick={{ fill: '#5E6B85', fontSize: 11 }} tickFormatter={(v) => formatUSD(Number(v))} />
            <Tooltip
              contentStyle={{ background: '#FFFFFF', border: '1px solid #E4DAC1', borderRadius: 8, fontSize: 12, boxShadow: '0 6px 20px rgba(20,33,61,0.10)' }}
              labelStyle={{ color: '#14213D' }}
              formatter={(v: any) => formatUSD(Number(v))}
            />
            {activeSeriesList
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
      {(showAllLoading || showAllError || (windowDays === 'all' && fullTruncated)) && (
        <div style={{ marginTop: 8, fontSize: 11.5, color: 'var(--text-muted)' }}>
          {showAllLoading && 'Loading full price history.'}
          {showAllError && `Full history failed: ${fullError}.`}
          {windowDays === 'all' && fullTruncated && !showAllLoading && !showAllError && (
            'Full history truncated at the fetch cap. Older observations may not be shown.'
          )}
        </div>
      )}
    </div>
  )
}
