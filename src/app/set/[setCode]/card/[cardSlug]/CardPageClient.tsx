'use client'
// Client-side wrapper for the finish switcher + price display + chart.
// Data is pre-fetched server-side. This component owns UI state only.

import { useMemo, useState } from 'react'
import CardPriceChart, { type MtgChartSeries } from '@/components/mtg/CardPriceChart'

export type CurrentPriceRow = {
  printing_finish_id: string
  provider: string
  market: string
  currency: string
  price_type: string
  condition: string
  price: number
  observed_on: string
  ingestion_source: string
}

export type Finish = { id: string; finish: string }

type Props = {
  finishes: Finish[]
  defaultFinishId: string | null
  currentPricesByFinish: Record<string, CurrentPriceRow[]>
  chartSeries: (MtgChartSeries & { provider: string })[]
}

const PROVIDER_LABEL: Record<string, string> = {
  tcgplayer: 'TCGplayer',
  cardkingdom: 'Card Kingdom',
  cardmarket: 'Cardmarket',
  manapool: 'ManaPool',
  cardhoarder: 'Cardhoarder',
}

function fmtUSD(v: number | undefined | null): string {
  if (v == null || Number.isNaN(v)) return '—'
  return '$' + Number(v).toFixed(2)
}

function fmtCurrency(v: number, currency: string): string {
  if (currency === 'EUR') return '€' + v.toFixed(2)
  if (currency === 'USD') return '$' + v.toFixed(2)
  return v.toFixed(2) + ' ' + currency
}

export default function CardPageClient({
  finishes,
  defaultFinishId,
  currentPricesByFinish,
  chartSeries,
}: Props) {
  const [finishId, setFinishId] = useState<string | null>(defaultFinishId)

  const currentRows = finishId ? currentPricesByFinish[finishId] ?? [] : []

  // Segregate paper retail vs mtgo, and split by currency.
  const paperRetail = currentRows.filter(
    (r) => r.market === 'paper' && r.price_type === 'retail'
  )
  const paperBuylist = currentRows.filter(
    (r) => r.market === 'paper' && r.price_type === 'buylist'
  )
  const mtgo = currentRows.filter((r) => r.market === 'mtgo')

  return (
    <>
      {finishes.length > 0 && (
        <div style={{ marginTop: 12, display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          {finishes.map((f) => {
            const active = f.id === finishId
            return (
              <button
                key={f.id}
                type="button"
                onClick={() => setFinishId(f.id)}
                style={{
                  background: active ? 'var(--primary)' : 'var(--surface)',
                  color: active ? '#fff' : 'var(--text)',
                  border: `1px solid ${active ? 'var(--primary)' : 'var(--border)'}`,
                  borderRadius: 8,
                  padding: '6px 12px',
                  fontSize: 13,
                  fontWeight: 600,
                  cursor: 'pointer',
                  textTransform: 'capitalize',
                }}
              >
                {f.finish}
              </button>
            )
          })}
        </div>
      )}

      <div
        style={{
          marginTop: 14,
          padding: 14,
          background: 'var(--surface)',
          border: '1px solid var(--border)',
          borderRadius: 10,
        }}
      >
        <div className="label-mono">Current paper retail</div>
        {paperRetail.length === 0 ? (
          <div style={{ color: 'var(--text-muted)', fontSize: 13, marginTop: 6 }}>No paper retail prices.</div>
        ) : (
          <div style={{ marginTop: 8, display: 'grid', gap: 6 }}>
            {paperRetail.map((r, i) => (
              <div
                key={i}
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  fontSize: 13,
                  paddingBottom: 6,
                  borderBottom: i < paperRetail.length - 1 ? '1px solid var(--border)' : 'none',
                }}
              >
                <span style={{ color: 'var(--text-muted)' }}>{PROVIDER_LABEL[r.provider] ?? r.provider}</span>
                <span style={{ fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace', fontWeight: 700 }}>
                  {fmtCurrency(Number(r.price), r.currency)}
                </span>
              </div>
            ))}
          </div>
        )}

        {paperBuylist.length > 0 && (
          <>
            <div className="label-mono" style={{ marginTop: 12 }}>
              Buylist (dealers pay)
            </div>
            <div style={{ marginTop: 6, display: 'grid', gap: 6 }}>
              {paperBuylist.map((r, i) => (
                <div key={i} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, color: 'var(--text-muted)' }}>
                  <span>{PROVIDER_LABEL[r.provider] ?? r.provider}</span>
                  <span style={{ fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace' }}>
                    {fmtCurrency(Number(r.price), r.currency)}
                  </span>
                </div>
              ))}
            </div>
          </>
        )}

        {mtgo.length > 0 && (
          <>
            <div className="label-mono" style={{ marginTop: 12 }}>MTGO (Cardhoarder)</div>
            <div style={{ marginTop: 6, display: 'grid', gap: 6 }}>
              {mtgo.map((r, i) => (
                <div key={i} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, color: 'var(--text-muted)' }}>
                  <span>{r.price_type}</span>
                  <span style={{ fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace' }}>
                    {fmtCurrency(Number(r.price), r.currency)} tix
                  </span>
                </div>
              ))}
            </div>
          </>
        )}
      </div>

      {chartSeries.length > 0 && (
        <div style={{ marginTop: 20 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 8 }}>
            <div className="label-mono">90-day paper retail (USD)</div>
            <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>{chartSeries.length} provider{chartSeries.length === 1 ? '' : 's'}</div>
          </div>
          <CardPriceChart series={chartSeries} height={220} />
        </div>
      )}
    </>
  )
}
