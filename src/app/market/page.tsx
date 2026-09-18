// app/market/page.tsx, dedicated market movers surface. Window is
// picked via a small query-string switch (7 / 30 / 90 days). All
// numbers are basis-locked (TCGplayer USD paper retail).

import Link from 'next/link'
import type { Metadata } from 'next'
import { getMarketMovers, type MoverWindow, type MoverCard } from '@/lib/mtg/movers'

export const revalidate = 300

export const metadata: Metadata = {
  title: 'MTG Market Movers, Top Risers and Fallers',
  description: 'Deterministic 7, 30 and 90 day market movers for Magic: The Gathering cards on TCGplayer USD paper retail. Top risers, top fallers, most active, most valuable.',
  alternates: { canonical: 'https://mtgprices.io/market' },
  openGraph: { url: 'https://mtgprices.io/market' },
}

type Search = { window?: string }

function parseWindow(raw: string | undefined): MoverWindow {
  if (raw === '7' || raw === '7d') return 7
  if (raw === '90' || raw === '90d') return 90
  return 30
}

export default async function MarketPage({ searchParams }: { searchParams: Promise<Search> }) {
  const sp = await searchParams
  const windowDays = parseWindow(sp.window)
  const movers = await getMarketMovers({ windowDays, topN: 10 })

  return (
    <div style={{ maxWidth: 1180, margin: '0 auto', padding: '32px 24px 64px' }}>
      <div style={{ marginBottom: 20 }}>
        <div className="label-mono">Market</div>
        <h1 style={{ margin: '6px 0 0', fontSize: 30 }}>MTG market movers</h1>
        <p style={{ color: 'var(--text-muted)', marginTop: 8, maxWidth: 720, lineHeight: 1.6 }}>
          Deterministic rises and falls over the last window. Basis locked to TCGplayer
          USD paper retail so every number is like for like. Movers require a healthy
          span of observations inside the window and a headline price of at least $2 to
          reduce noise. Not financial advice.
        </p>
      </div>

      {/* Window switch */}
      <div style={{ display: 'inline-flex', gap: 4, background: 'var(--bg-light)', border: '1px solid var(--border)', borderRadius: 999, padding: 3, marginBottom: 24 }}>
        {([7, 30, 90] as const).map((w) => {
          const active = w === windowDays
          return (
            <Link key={w} href={`/market?window=${w}`} style={{
              background: active ? 'var(--surface)' : 'transparent',
              color: active ? 'var(--text-strong)' : 'var(--text-muted)',
              border: active ? '1px solid var(--border)' : '1px solid transparent',
              borderRadius: 999, padding: '6px 16px',
              fontSize: 13, fontWeight: 700, textDecoration: 'none',
              boxShadow: active ? '0 1px 2px rgba(20,33,61,0.05)' : 'none',
            }}>{w}d</Link>
          )
        })}
      </div>

      {!movers ? (
        <EmptyPanel windowDays={windowDays} />
      ) : (
        <div style={{ display: 'grid', gap: 24 }}>
          <Section title="Top risers" tiles={movers.risers} kind="up" currencySymbol="$" />
          <Section title="Top fallers" tiles={movers.fallers} kind="down" currencySymbol="$" />
          <Section title="Biggest absolute movers" tiles={movers.active} kind="either" currencySymbol="$" />
          <Section title="Most valuable" tiles={movers.mostValuable} kind="value" currencySymbol="$" />
          <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>
            Scanned {movers.candidatesScanned.toLocaleString()} priced candidates.
            {' '}{movers.candidatesWithMovement.toLocaleString()} had meaningful movement in this window.
          </div>
        </div>
      )}
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
