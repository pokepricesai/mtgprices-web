// src/components/mtg/SetMarketOverview.tsx
// Server component. Compact set-level market panel that sits above the
// printings grid on a set page. Renders total value, priced coverage,
// top movers within the set, and top most-valuable cards. Methodology
// is printed on the panel so the number is never mysterious.

import Link from 'next/link'
import type { SetMarket, SetMoverTile, SetValueTile } from '@/lib/mtg/set-market'
import { SET_VALUE_COVERAGE_THRESHOLD, formatCoveragePct } from '@/lib/mtg/set-aggregate'

type Props = { market: SetMarket; setName: string }

export default function SetMarketOverview({ market, setName }: Props) {
  const sym = market.currencySymbol
  const coverage = market.totalPrinted > 0
    ? market.totalPriced / market.totalPrinted
    : 0
  const coverageLabel = formatCoveragePct(market.totalPriced, market.totalPrinted)
  const showsFullValue = coverage >= SET_VALUE_COVERAGE_THRESHOLD
  const valueLabel = showsFullValue ? 'Set value' : 'Priced-card subtotal'
  const valueSublabel = showsFullValue
    ? `Estimated set value on ${providerLabel(market.basis.provider)}`
    : `Subtotal for the ${market.totalPriced.toLocaleString()} priced ${market.totalPriced === 1 ? 'card' : 'cards'} on ${providerLabel(market.basis.provider)}. Coverage is below ${Math.round(SET_VALUE_COVERAGE_THRESHOLD * 100)}%, so this is not a whole-set estimate.`

  return (
    <section
      aria-label={`${setName} market overview`}
      style={{
        marginBottom: 24, padding: 20,
        background: 'linear-gradient(180deg, rgba(232,169,75,0.05) 0%, rgba(232,169,75,0) 60%), var(--surface)',
        border: '1px solid var(--border)', borderRadius: 16,
        boxShadow: '0 3px 12px rgba(20,33,61,0.04)',
      }}
    >
      <div className="label-mono" style={{ color: 'var(--gold-600)', marginBottom: 8 }}>Set market overview</div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 24, alignItems: 'baseline' }}>
        <div>
          <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 2, textTransform: 'uppercase', letterSpacing: '0.06em', fontWeight: 600 }}>{valueLabel}</div>
          <div style={{ fontSize: 32, fontWeight: 800, fontFamily: 'ui-monospace, SFMono-Regular, monospace', color: 'var(--text-strong)' }}>
            {sym}{market.estimatedValue.toLocaleString(undefined, { maximumFractionDigits: 0 })}
          </div>
          <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 4, maxWidth: 460, lineHeight: 1.4 }}>
            {valueSublabel}
          </div>
        </div>
        <MiniStat label="Priced cards" value={`${market.totalPriced} / ${market.totalPrinted}`} sub={`${coverageLabel} coverage`} />
        <MiniStat label="Unpriced" value={String(market.totalUnpriced)} sub="No current observation on this basis" />
      </div>

      <details style={{ marginTop: 10, fontSize: 12, color: 'var(--text-muted)' }}>
        <summary style={{ cursor: 'pointer', fontWeight: 600 }}>Methodology</summary>
        <p style={{ margin: '6px 0 0', lineHeight: 1.55 }}>{market.methodology}</p>
      </details>

      <div style={{
        marginTop: 18, display: 'grid', gap: 14,
        gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))',
      }}>
        {market.mostValuable.length > 0 && (
          <TileGroup title="Most valuable" tiles={market.mostValuable} currencySymbol={sym} />
        )}
        {market.risers.length > 0 && (
          <MoverGroup title="Top risers (30d)" tiles={market.risers} currencySymbol={sym} kind="up" />
        )}
        {market.fallers.length > 0 && (
          <MoverGroup title="Top fallers (30d)" tiles={market.fallers} currencySymbol={sym} kind="down" />
        )}
        {market.cheapest.length > 0 && market.mostValuable.length > 0 && (
          <TileGroup title="Cheapest" tiles={market.cheapest} currencySymbol={sym} />
        )}
      </div>
    </section>
  )
}

function MiniStat({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div>
      <div className="label-mono">{label}</div>
      <div style={{ fontSize: 18, fontWeight: 800, color: 'var(--text-strong)', fontFamily: 'ui-monospace, SFMono-Regular, monospace' }}>{value}</div>
      {sub && <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 2 }}>{sub}</div>}
    </div>
  )
}

function TileGroup({ title, tiles, currencySymbol }: { title: string; tiles: SetValueTile[]; currencySymbol: string }) {
  return (
    <div style={{ padding: 12, borderRadius: 12, border: '1px solid var(--border)', background: 'var(--bg-light)' }}>
      <div className="label-mono" style={{ marginBottom: 8 }}>{title}</div>
      <div style={{ display: 'grid', gap: 8 }}>
        {tiles.map((t) => (
          <Link key={t.printing_id + t.finish_id} href={t.card_href} style={{
            display: 'flex', gap: 10, alignItems: 'center', textDecoration: 'none',
            color: 'var(--text)', padding: 8, borderRadius: 10, background: 'var(--surface)',
            border: '1px solid var(--border)',
          }}>
            {t.image_uri_small ? (
              /* eslint-disable-next-line @next/next/no-img-element */
              <img src={t.image_uri_small} alt="" style={{ width: 30, height: 42, borderRadius: 4, objectFit: 'cover' }} />
            ) : <span style={{ width: 30, height: 42, borderRadius: 4, background: 'var(--bg-strong)' }} />}
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--text-strong)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{t.name}</div>
              <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>#{t.collector_number ?? '-'}</div>
            </div>
            <div style={{ fontFamily: 'ui-monospace, SFMono-Regular, monospace', fontWeight: 700 }}>
              {currencySymbol}{t.price.toFixed(2)}
            </div>
          </Link>
        ))}
      </div>
    </div>
  )
}

function MoverGroup({ title, tiles, currencySymbol, kind }: { title: string; tiles: SetMoverTile[]; currencySymbol: string; kind: 'up' | 'down' }) {
  return (
    <div style={{ padding: 12, borderRadius: 12, border: '1px solid var(--border)', background: 'var(--bg-light)' }}>
      <div className="label-mono" style={{ marginBottom: 8 }}>{title}</div>
      <div style={{ display: 'grid', gap: 8 }}>
        {tiles.map((t) => (
          <Link key={t.printing_id + t.finish_id} href={t.card_href} style={{
            display: 'flex', gap: 10, alignItems: 'center', textDecoration: 'none',
            color: 'var(--text)', padding: 8, borderRadius: 10, background: 'var(--surface)',
            border: '1px solid var(--border)',
          }}>
            {t.image_uri_small ? (
              /* eslint-disable-next-line @next/next/no-img-element */
              <img src={t.image_uri_small} alt="" style={{ width: 30, height: 42, borderRadius: 4, objectFit: 'cover' }} />
            ) : <span style={{ width: 30, height: 42, borderRadius: 4, background: 'var(--bg-strong)' }} />}
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--text-strong)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{t.name}</div>
              <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>#{t.collector_number ?? '-'} · {t.period_days}d</div>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end' }}>
              <span style={{ fontFamily: 'ui-monospace, SFMono-Regular, monospace', fontWeight: 700 }}>
                {currencySymbol}{t.price.toFixed(2)}
              </span>
              <span style={{
                fontSize: 11, fontWeight: 700,
                color: kind === 'up' ? 'var(--green)' : 'var(--red)',
                fontFamily: 'ui-monospace, SFMono-Regular, monospace',
              }}>
                {kind === 'up' ? '▲' : '▼'} {Math.abs(t.pct_delta * 100).toFixed(1)}%
              </span>
            </div>
          </Link>
        ))}
      </div>
    </div>
  )
}

function providerLabel(p: 'tcgplayer' | 'cardkingdom' | 'cardmarket' | 'manapool' | 'cardhoarder'): string {
  switch (p) {
    case 'tcgplayer': return 'TCGplayer'
    case 'cardkingdom': return 'Card Kingdom'
    case 'cardmarket': return 'Cardmarket'
    case 'manapool': return 'ManaPool'
    case 'cardhoarder': return 'Cardhoarder'
  }
}
