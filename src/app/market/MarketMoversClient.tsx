'use client'
// src/app/market/MarketMoversClient.tsx
//
// Client island for /market. Owns:
//   * reading `?window=7|30|90` via useSearchParams
//   * fetching mover payloads from /api/market/movers (every window,
//     including the 30-day default — the server page is now a true
//     static shell and does zero mover work)
//   * rendering the window-switch pills, mover sections, and the
//     "scanned N candidates" summary line
//   * caching fetched payloads client-side across window switches so
//     flipping 30 → 7 → 30 does not refetch the already-known data
//
// Flash-avoidance contract:
//   * On initial render for a given window, data is `null` and we
//     show a loading panel labelled with that window's days. The
//     mover sections never render 30-day numbers under a 7-day /
//     90-day label.
//   * The window-switch pills always reflect the URL immediately
//     (not the data) so navigation feels instant even while the
//     fetch is in flight.
//
// The /api/market/movers responses are CDN-cached (24h s-maxage +
// stale-while-revalidate) so the overwhelming majority of these
// client fetches land on the edge, not on a function.

import Link from 'next/link'
import { useEffect, useRef, useState } from 'react'
import { useSearchParams } from 'next/navigation'
import type { MarketMovers, MoverCard, MoverWindow } from '@/lib/mtg/movers'

function parseWindow(raw: string | null): MoverWindow {
  if (raw === '7' || raw === '7d') return 7
  if (raw === '90' || raw === '90d') return 90
  return 30
}

type Status = 'loading' | 'ok' | 'empty' | 'error'
type SlotState = { status: Status; data: MarketMovers | null }

const INITIAL_SLOT: SlotState = { status: 'loading', data: null }

export default function MarketMoversClient() {
  const sp = useSearchParams()
  const activeWindow: MoverWindow = parseWindow(sp.get('window'))

  // Per-window cache so flipping 30 → 7 → 30 does not refetch the
  // already-known-good 30d data. Keyed by MoverWindow literal.
  const cacheRef = useRef<Map<MoverWindow, SlotState>>(new Map())
  const [tick, setTick] = useState(0)
  const bump = () => setTick((t) => t + 1)

  useEffect(() => {
    const w = activeWindow
    const current = cacheRef.current.get(w)
    if (current && (current.status === 'ok' || current.status === 'empty')) {
      // Already have a terminal result for this window — nothing to do.
      return
    }
    // Mark loading synchronously so the first render for this window
    // shows the loading panel (no 30d-under-7d-label flash).
    if (!current || current.status !== 'loading') {
      cacheRef.current.set(w, INITIAL_SLOT)
      bump()
    }
    let cancelled = false
    fetch(`/api/market/movers?window=${w}`, { cache: 'default' })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`status ${r.status}`))))
      .then((payload: { movers: MarketMovers | null }) => {
        if (cancelled) return
        cacheRef.current.set(w, {
          status: payload.movers ? 'ok' : 'empty',
          data: payload.movers,
        })
        bump()
      })
      .catch(() => {
        if (cancelled) return
        cacheRef.current.set(w, { status: 'error', data: null })
        bump()
      })
    return () => { cancelled = true }
  }, [activeWindow])

  // Reference `tick` so React re-renders on cache updates. The ref
  // itself is intentional — we want synchronous writes that don't
  // trigger extra renders per write; we just bump the version.
  void tick
  const slot = cacheRef.current.get(activeWindow) ?? INITIAL_SLOT

  return (
    <>
      <WindowSwitch active={activeWindow} />
      {slot.status === 'loading' ? (
        <LoadingPanel windowDays={activeWindow} />
      ) : slot.status === 'error' ? (
        <ErrorPanel windowDays={activeWindow} />
      ) : slot.status === 'empty' || !slot.data ? (
        <EmptyPanel windowDays={activeWindow} />
      ) : (
        <div style={{ display: 'grid', gap: 24 }}>
          <Section title="Top risers" tiles={slot.data.risers} kind="up" currencySymbol="$" />
          <Section title="Top fallers" tiles={slot.data.fallers} kind="down" currencySymbol="$" />
          <Section title="Biggest absolute movers" tiles={slot.data.active} kind="either" currencySymbol="$" />
          <Section title="Most valuable" tiles={slot.data.mostValuable} kind="value" currencySymbol="$" />
          <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>
            Scanned {slot.data.candidatesScanned.toLocaleString()} priced candidates.
            {' '}{slot.data.candidatesWithMovement.toLocaleString()} had meaningful movement in this window.
          </div>
        </div>
      )}
    </>
  )
}

function WindowSwitch({ active }: { active: MoverWindow }) {
  return (
    <div style={{ display: 'inline-flex', gap: 4, background: 'var(--bg-light)', border: '1px solid var(--border)', borderRadius: 999, padding: 3, marginBottom: 24 }}>
      {([7, 30, 90] as const).map((w) => {
        const isActive = w === active
        return (
          <Link
            key={w}
            href={w === 30 ? '/market' : `/market?window=${w}`}
            scroll={false}
            style={{
              background: isActive ? 'var(--surface)' : 'transparent',
              color: isActive ? 'var(--text-strong)' : 'var(--text-muted)',
              border: isActive ? '1px solid var(--border)' : '1px solid transparent',
              borderRadius: 999, padding: '6px 16px',
              fontSize: 13, fontWeight: 700, textDecoration: 'none',
              boxShadow: isActive ? '0 1px 2px rgba(20,33,61,0.05)' : 'none',
            }}
          >
            {w}d
          </Link>
        )
      })}
    </div>
  )
}

function LoadingPanel({ windowDays }: { windowDays: MoverWindow }) {
  return (
    <div style={{
      padding: 20, background: 'var(--surface)', border: '1px solid var(--border)',
      borderRadius: 12, color: 'var(--text-muted)', fontSize: 14, lineHeight: 1.6,
    }}>
      Loading {windowDays}-day market movers&hellip;
    </div>
  )
}

function ErrorPanel({ windowDays }: { windowDays: MoverWindow }) {
  return (
    <div style={{
      padding: 20, background: 'var(--surface)', border: '1px solid var(--border)',
      borderRadius: 12, color: 'var(--text-muted)', fontSize: 14, lineHeight: 1.6,
    }}>
      Could not load {windowDays}-day market movers right now. Try again shortly.
    </div>
  )
}

function EmptyPanel({ windowDays }: { windowDays: MoverWindow }) {
  return (
    <div style={{
      padding: 20, background: 'var(--surface)', border: '1px solid var(--border)',
      borderRadius: 12, color: 'var(--text-muted)', fontSize: 14, lineHeight: 1.6,
    }}>
      No movers cleared the filters on the TCGplayer USD paper retail basis over the last {windowDays} days.
      This can happen when the observation window has too many single-day price points to compare.
      Try a longer window.
    </div>
  )
}

function Section({ title, tiles, kind, currencySymbol }: {
  title: string
  tiles: MoverCard[]
  kind: 'up' | 'down' | 'either' | 'value'
  currencySymbol: string
}) {
  if (tiles.length === 0) return null
  return (
    <section>
      <div className="label-mono" style={{ marginBottom: 12, color: 'var(--gold-600)' }}>{title}</div>
      <div style={{
        display: 'grid', gap: 12,
        gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))',
      }}>
        {tiles.map((t) => (
          <Link key={t.finish_id + kind} href={t.card_href}
            className="card-hover card-hover-gold"
            style={{
              display: 'flex', gap: 12, alignItems: 'center',
              padding: 14, background: 'var(--surface)', border: '1px solid var(--border)',
              borderRadius: 12, textDecoration: 'none', color: 'var(--text)',
            }}
          >
            {t.image_uri_small ? (
              /* eslint-disable-next-line @next/next/no-img-element */
              <img src={t.image_uri_small} alt="" style={{ width: 46, height: 64, borderRadius: 5, objectFit: 'cover' }} />
            ) : <span style={{ width: 46, height: 64, borderRadius: 5, background: 'var(--bg-strong)' }} />}
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--text-strong)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{t.name}</div>
              <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                {t.set_name}{t.collector_number ? ` · #${t.collector_number}` : ''}{t.finish !== 'nonfoil' ? ` · ${t.finish}` : ''}
              </div>
              <div style={{ marginTop: 6, display: 'flex', alignItems: 'baseline', gap: 8 }}>
                <span style={{ fontFamily: 'ui-monospace, SFMono-Regular, monospace', fontWeight: 800, fontSize: 16 }}>
                  {currencySymbol}{t.latest_price.toFixed(2)}
                </span>
                {kind !== 'value' && (
                  <span style={{
                    fontFamily: 'ui-monospace, SFMono-Regular, monospace',
                    fontSize: 12, fontWeight: 700,
                    color: t.pct_delta >= 0 ? 'var(--green)' : 'var(--red)',
                  }}>
                    {t.pct_delta >= 0 ? '▲' : '▼'} {Math.abs(t.pct_delta * 100).toFixed(1)}%
                  </span>
                )}
              </div>
              <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>
                from {currencySymbol}{t.start_price.toFixed(2)} over {t.period_days}d
              </div>
            </div>
          </Link>
        ))}
      </div>
    </section>
  )
}
