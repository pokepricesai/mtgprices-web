// src/components/mtg/SetMarketOverview.tsx
// Server component. Compact set-level market panel that sits above the
// printings grid on a set page. Renders total value, priced coverage,
// top movers within the set, and top most-valuable cards. Methodology
// is printed on the panel so the number is never mysterious.
//
// Panel grid: 2 columns x 2 rows on desktop/tablet, 1 column on
// mobile. The previous minmax(260px, 1fr) produced 4 narrow columns
// on desktop, which forced aggressive ellipsis on card names and
// pushed prices into a stacked layout that visually collided with
// neighbours. minmax(360px, 1fr) gives each panel enough width to
// render the row cleanly: thumbnail, flexible name column, right-
// aligned numeric block.

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

      <details style={{ marginTop: 12, fontSize: 12, color: 'var(--text-muted)' }}>
        <summary style={{ cursor: 'pointer', fontWeight: 600 }}>Methodology</summary>
        <p style={{ margin: '6px 0 0', lineHeight: 1.55 }}>{market.methodology}</p>
      </details>

      <div style={{
        marginTop: 20, display: 'grid', gap: 14,
        // 2 columns at >=720 px inner width, 1 column below. 340 lets
        // the numeric block stay unwrapped even with a 5-digit price
        // (e.g. $1,678.75) beside a long card name.
        gridTemplateColumns: 'repeat(auto-fit, minmax(340px, 1fr))',
      }}>
        {market.mostValuable.length > 0 && (
          <Panel title="Most valuable">
            {market.mostValuable.map((t) => (
              <ValueRow key={t.printing_id + t.finish_id} tile={t} currencySymbol={sym} />
            ))}
          </Panel>
        )}
        {market.risers.length > 0 && (
          <Panel title="Top risers (30D)">
            {market.risers.map((t) => (
              <MoverRow key={t.printing_id + t.finish_id} tile={t} currencySymbol={sym} kind="up" />
            ))}
          </Panel>
        )}
        {market.fallers.length > 0 && (
          <Panel title="Top fallers (30D)">
            {market.fallers.map((t) => (
              <MoverRow key={t.printing_id + t.finish_id} tile={t} currencySymbol={sym} kind="down" />
            ))}
          </Panel>
        )}
        {market.cheapest.length > 0 && market.mostValuable.length > 0 && (
          <Panel title="Cheapest">
            {market.cheapest.map((t) => (
              <ValueRow key={t.printing_id + t.finish_id} tile={t} currencySymbol={sym} />
            ))}
          </Panel>
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

// Uniform panel wrapper. All four market panels share this so
// padding, radius, background and heading stay consistent even if
// their inner row types differ.
function Panel({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div style={{
      padding: 14, borderRadius: 12,
      border: '1px solid var(--border)', background: 'var(--bg-light)',
      // minWidth: 0 lets the panel shrink below its content's intrinsic
      // width when the grid slot is narrow. Without this, a long card
      // name can force the panel wider than its column and overflow
      // into the neighbouring panel.
      minWidth: 0,
    }}>
      <div className="label-mono" style={{ marginBottom: 10 }}>{title}</div>
      <div style={{ display: 'grid', gap: 8 }}>{children}</div>
    </div>
  )
}

// Single card row used by every panel. Three-region layout:
//   thumbnail (fixed) | flexible info | numeric block (fixed, right-aligned)
//
// The middle region has flex: 1 1 auto AND minWidth: 0 so the ellipsis
// on the card name kicks in properly. The numeric region has
// flexShrink: 0 and whiteSpace: nowrap so a 5-digit price never
// wraps into the info column.
function CardRow({
  href,
  imageUri,
  name,
  meta,
  right,
}: {
  href: string
  imageUri: string | null
  name: string
  meta: string
  right: React.ReactNode
}) {
  return (
    <Link href={href} style={{
      display: 'flex', gap: 12, alignItems: 'center',
      textDecoration: 'none', color: 'var(--text)',
      padding: '8px 10px', borderRadius: 10,
      background: 'var(--surface)', border: '1px solid var(--border)',
      minWidth: 0, width: '100%',
    }}>
      {imageUri ? (
        /* eslint-disable-next-line @next/next/no-img-element */
        <img src={imageUri} alt="" style={{
          width: 32, height: 44, borderRadius: 4, objectFit: 'cover',
          flexShrink: 0,
        }} />
      ) : (
        <span style={{
          width: 32, height: 44, borderRadius: 4, background: 'var(--bg-strong)',
          flexShrink: 0,
        }} />
      )}
      <div style={{ flex: '1 1 auto', minWidth: 0 }}>
        <div style={{
          fontSize: 13, fontWeight: 700, color: 'var(--text-strong)',
          overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
        }}>{name}</div>
        <div style={{ fontSize: 11, color: 'var(--text-muted)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{meta}</div>
      </div>
      <div style={{
        flexShrink: 0, whiteSpace: 'nowrap', textAlign: 'right',
        display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 2,
      }}>{right}</div>
    </Link>
  )
}

function ValueRow({ tile, currencySymbol }: { tile: SetValueTile; currencySymbol: string }) {
  return (
    <CardRow
      href={tile.card_href}
      imageUri={tile.image_uri_small}
      name={tile.name}
      meta={`#${tile.collector_number ?? '-'}`}
      right={
        <span style={{
          fontFamily: 'ui-monospace, SFMono-Regular, monospace',
          fontWeight: 800, color: 'var(--text-strong)',
        }}>
          {currencySymbol}{tile.price.toFixed(2)}
        </span>
      }
    />
  )
}

function MoverRow({ tile, currencySymbol, kind }: { tile: SetMoverTile; currencySymbol: string; kind: 'up' | 'down' }) {
  return (
    <CardRow
      href={tile.card_href}
      imageUri={tile.image_uri_small}
      name={tile.name}
      meta={`#${tile.collector_number ?? '-'} · ${tile.period_days}d`}
      right={
        <>
          <span style={{
            fontFamily: 'ui-monospace, SFMono-Regular, monospace',
            fontWeight: 800, color: 'var(--text-strong)',
          }}>
            {currencySymbol}{tile.price.toFixed(2)}
          </span>
          <span style={{
            fontSize: 11, fontWeight: 700,
            color: kind === 'up' ? 'var(--green)' : 'var(--red)',
            fontFamily: 'ui-monospace, SFMono-Regular, monospace',
          }}>
            {kind === 'up' ? '▲' : '▼'} {Math.abs(tile.pct_delta * 100).toFixed(1)}%
          </span>
        </>
      }
    />
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
