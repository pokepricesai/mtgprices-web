// src/components/mtg/CardMarketOverview.tsx
// Server component. Renders the top-of-card market summary block:
// current price, 7 / 30 / 90 day deltas, 90 day high and low, priced
// printings count, a link out to eBay for this printing, and a short
// list of deterministic price insights.
//
// Every number is basis-locked (see card-market.ts). The component
// never mixes currencies or providers.

import type { CardMarketSummary, WindowStat } from '@/lib/mtg/card-market.types'
import { buildEbaySearchLink } from '@/lib/mtg/ebay-links'

type Props = {
  summary: CardMarketSummary
  cardName: string
  setName?: string | null
  setCode?: string | null
  collectorNumber?: string | null
}

export default function CardMarketOverview({ summary, cardName, setName, setCode, collectorNumber }: Props) {
  const sym = summary.currencySymbol

  if (summary.currentPrice === null) {
    return (
      <div style={{
        padding: 16, background: 'var(--surface)', border: '1px solid var(--border)',
        borderRadius: 14, color: 'var(--text-muted)', fontSize: 13.5, lineHeight: 1.55,
      }}>
        No priced observations on the {providerLabel(summary.basis.provider)} {summary.basis.currency} {summary.basis.priceType} basis
        for this card yet. Try switching your valuation basis on your account, or check other printings below.
      </div>
    )
  }

  const primaryFinish = summary.currentFinish ?? 'nonfoil'
  const finishLabel = primaryFinish === 'nonfoil' ? 'nonfoil' : primaryFinish
  const ebay = buildEbaySearchLink({
    cardName, setName: setName ?? null, setCode: setCode ?? null,
    collectorNumber: collectorNumber ?? null,
    finish: (primaryFinish === 'foil' || primaryFinish === 'etched') ? primaryFinish : 'nonfoil',
  })

  return (
    <section
      aria-label="Market overview"
      style={{
        padding: 18,
        background: 'linear-gradient(180deg, rgba(232,169,75,0.06) 0%, rgba(232,169,75,0) 60%), var(--surface)',
        border: '1px solid var(--border)',
        borderRadius: 16,
        boxShadow: '0 4px 14px rgba(20,33,61,0.04)',
      }}
    >
      <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'flex-end', justifyContent: 'space-between', gap: 12 }}>
        <div>
          <div className="label-mono" style={{ color: 'var(--gold-600)' }}>Market overview</div>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, marginTop: 6 }}>
            <span style={{ fontSize: 36, fontWeight: 800, letterSpacing: '-0.01em', fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace' }}>
              {sym}{summary.currentPrice.toFixed(2)}
            </span>
            <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>
              {providerLabel(summary.basis.provider)}, {summary.basis.currency}, {summary.basis.priceType}, {finishLabel}
            </span>
          </div>
          {summary.currentObservedOn && (
            <div style={{ fontSize: 11.5, color: 'var(--text-muted)', marginTop: 4 }}>
              Latest observation: {summary.currentObservedOn}
            </div>
          )}
        </div>

        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <DeltaChip label="7d"  stat={summary.d7} />
          <DeltaChip label="30d" stat={summary.d30} />
          <DeltaChip label="90d" stat={summary.d90} />
        </div>
      </div>

      <div style={{
        marginTop: 16, display: 'grid', gap: 10,
        gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))',
      }}>
        <MiniStat label="90d high" value={summary.d90.high !== null ? `${sym}${summary.d90.high.toFixed(2)}` : '-'} />
        <MiniStat label="90d low" value={summary.d90.low !== null ? `${sym}${summary.d90.low.toFixed(2)}` : '-'} />
        <MiniStat
          label="Paper printings priced"
          value={String(summary.pricedPrintings.length)}
          sub={summary.currentRank ? `Currently ${ordinal(summary.currentRank)}` : undefined}
        />
        <MiniStat
          label="Cheapest paper printing"
          value={summary.cheapest ? `${sym}${summary.cheapest.price.toFixed(2)}` : '-'}
          sub={summary.cheapest ? `${summary.cheapest.set_name}` : undefined}
        />
      </div>

      {summary.insights.length > 0 && (
        <ul style={{ marginTop: 16, padding: 0, listStyle: 'none', display: 'grid', gap: 8 }}>
          {summary.insights.map((line, i) => (
            <li key={i} style={{ display: 'flex', gap: 10, alignItems: 'flex-start', fontSize: 13.5, lineHeight: 1.55 }}>
              <span aria-hidden className="gem gem-gold" style={{ marginTop: 6, flexShrink: 0 }} />
              <span>{line}</span>
            </li>
          ))}
        </ul>
      )}

      <div style={{ marginTop: 16, display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center' }}>
        <a
          href={ebay.href}
          rel="sponsored nofollow noopener"
          target="_blank"
          className="btn btn-gold btn-sm"
        >
          {ebay.label}
        </a>
        {ebay.affiliate && (
          <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>
            Affiliate link. MTGPrices may earn a commission on qualifying purchases.
          </span>
        )}
      </div>
    </section>
  )
}

function DeltaChip({ label, stat }: { label: string; stat: WindowStat }) {
  if (stat.pct_delta === null) {
    return (
      <span style={{
        display: 'inline-flex', flexDirection: 'column', alignItems: 'flex-end',
        padding: '6px 10px', borderRadius: 10,
        background: 'var(--bg-light)', border: '1px solid var(--border)',
        color: 'var(--text-muted)',
      }}>
        <span className="label-mono" style={{ fontSize: 10 }}>{label}</span>
        <span style={{ fontSize: 13, fontWeight: 700 }}>-</span>
      </span>
    )
  }
  const up = stat.pct_delta >= 0
  return (
    <span style={{
      display: 'inline-flex', flexDirection: 'column', alignItems: 'flex-end',
      padding: '6px 10px', borderRadius: 10,
      background: up ? 'var(--green-soft)' : 'var(--red-soft)',
      border: `1px solid ${up ? 'rgba(42,132,89,0.30)' : 'rgba(180,58,62,0.30)'}`,
      color: up ? 'var(--green)' : 'var(--red)',
    }}>
      <span className="label-mono" style={{ fontSize: 10, color: 'inherit', opacity: 0.85 }}>{label}</span>
      <span style={{
        fontSize: 13, fontWeight: 800,
        fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
      }}>
        {up ? '▲' : '▼'} {Math.abs(stat.pct_delta * 100).toFixed(1)}%
      </span>
    </span>
  )
}

function MiniStat({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div style={{
      padding: '10px 12px', borderRadius: 10,
      background: 'var(--bg-light)', border: '1px solid var(--border)',
    }}>
      <div className="label-mono" style={{ marginBottom: 2 }}>{label}</div>
      <div style={{ fontSize: 15, fontWeight: 800, color: 'var(--text-strong)', fontFamily: 'ui-monospace, SFMono-Regular, monospace' }}>{value}</div>
      {sub && <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 2 }}>{sub}</div>}
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
function ordinal(n: number): string {
  const j = n % 10, k = n % 100
  if (k >= 11 && k <= 13) return `${n}th`
  if (j === 1) return `${n}st`
  if (j === 2) return `${n}nd`
  if (j === 3) return `${n}rd`
  return `${n}th`
}
