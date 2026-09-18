// src/components/mtg/CollectionAnalytics.tsx
// Server component. Renders value-oriented analytics for a signed-in
// user's collection: total, per-set / per-colour / per-rarity /
// per-finish value tables, highest-value holdings and a list of cards
// currently missing a price on the selected basis.

import Link from 'next/link'
import type {
  CollectionAnalytics,
  CollectionAnalyticsBucket,
  CollectionAnalyticsHolding,
  CollectionMissingHolding,
} from '@/lib/mtg/collection'

type Props = { analytics: CollectionAnalytics }

export default function CollectionAnalyticsPanel({ analytics }: Props) {
  const sym = currencySymbol(analytics.basis.currency)

  return (
    <section aria-label="Collection analytics" style={{ display: 'grid', gap: 20 }}>
      <div style={{
        padding: 18,
        background: 'linear-gradient(180deg, rgba(232,169,75,0.06) 0%, rgba(232,169,75,0) 60%), var(--surface)',
        border: '1px solid var(--border)', borderRadius: 16,
        boxShadow: '0 3px 12px rgba(20,33,61,0.04)',
      }}>
        <div className="label-mono" style={{ color: 'var(--gold-600)' }}>Collection value</div>
        <div style={{ marginTop: 6, display: 'flex', flexWrap: 'wrap', alignItems: 'baseline', gap: 12 }}>
          <span style={{
            fontSize: 32, fontWeight: 800,
            fontFamily: 'ui-monospace, SFMono-Regular, monospace', color: 'var(--text-strong)',
          }}>{sym}{analytics.totalValue.toLocaleString(undefined, { maximumFractionDigits: 2 })}</span>
          <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>
            on {analytics.basis.label}
          </span>
        </div>
        <div style={{ marginTop: 6, fontSize: 12, color: 'var(--text-muted)' }}>
          {analytics.totalCards.toLocaleString()} cards, {analytics.totalWithPrice.toLocaleString()} priced,
          {' '}{analytics.totalMissingPrice.toLocaleString()} without a price on this basis.
        </div>
      </div>

      <div style={{
        display: 'grid', gap: 14,
        gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))',
      }}>
        <BucketTable title="Value by set" sym={sym} buckets={analytics.valueBySet} />
        <BucketTable title="Value by colour" sym={sym} buckets={analytics.valueByColour} />
        <BucketTable title="Value by rarity" sym={sym} buckets={analytics.valueByRarity} />
        <BucketTable title="Value by finish" sym={sym} buckets={analytics.valueByFinish} />
      </div>

      <div style={{
        display: 'grid', gap: 14,
        gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))',
      }}>
        <div style={{
          padding: 14, background: 'var(--surface)', border: '1px solid var(--border)',
          borderRadius: 14,
        }}>
          <div className="label-mono" style={{ marginBottom: 8, color: 'var(--gold-600)' }}>Highest-value holdings</div>
          {analytics.topHoldings.length === 0 ? (
            <div style={{ fontSize: 13, color: 'var(--text-muted)' }}>
              No priced holdings on this basis yet.
            </div>
          ) : (
            <ul style={{ listStyle: 'none', padding: 0, margin: 0, display: 'grid', gap: 6 }}>
              {analytics.topHoldings.map((h) => <HoldingRow key={h.printing_id + h.finish} h={h} sym={sym} />)}
            </ul>
          )}
        </div>

        <div style={{
          padding: 14, background: 'var(--surface)', border: '1px solid var(--border)',
          borderRadius: 14,
        }}>
          <div className="label-mono" style={{ marginBottom: 8, color: 'var(--red)' }}>Cards without a price</div>
          {analytics.missingPrices.length === 0 ? (
            <div style={{ fontSize: 13, color: 'var(--text-muted)' }}>
              Every card in your collection is priced on this basis.
            </div>
          ) : (
            <>
              <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 8 }}>
                These printings do not have a current observation on {analytics.basis.label}.
                Try switching your valuation basis on your account, or add a manual acquired price
                per copy.
              </div>
              <ul style={{ listStyle: 'none', padding: 0, margin: 0, display: 'grid', gap: 6 }}>
                {analytics.missingPrices.map((m) => <MissingRow key={m.printing_id + m.finish} m={m} />)}
              </ul>
            </>
          )}
        </div>
      </div>
    </section>
  )
}

function BucketTable({ title, buckets, sym }: {
  title: string
  buckets: CollectionAnalyticsBucket[]
  sym: string
}) {
  const total = buckets.reduce((acc, b) => acc + b.value, 0)
  return (
    <div style={{
      padding: 14, background: 'var(--surface)', border: '1px solid var(--border)',
      borderRadius: 14,
    }}>
      <div className="label-mono" style={{ marginBottom: 8 }}>{title}</div>
      {buckets.length === 0 ? (
        <div style={{ fontSize: 13, color: 'var(--text-muted)' }}>No data yet.</div>
      ) : (
        <ul style={{ listStyle: 'none', padding: 0, margin: 0, display: 'grid', gap: 6 }}>
          {buckets.map((b) => {
            const share = total > 0 ? b.value / total : 0
            return (
              <li key={b.key} style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, fontSize: 13 }}>
                  <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', color: 'var(--text)' }}>{b.label}</span>
                  <span style={{
                    fontFamily: 'ui-monospace, SFMono-Regular, monospace',
                    fontWeight: 700, color: 'var(--text-strong)',
                  }}>{sym}{b.value.toLocaleString(undefined, { maximumFractionDigits: 2 })}</span>
                </div>
                <div style={{ height: 4, background: 'var(--bg-light)', borderRadius: 999, overflow: 'hidden' }}>
                  <div style={{
                    width: `${Math.max(3, Math.round(share * 100))}%`, height: '100%',
                    background: 'linear-gradient(90deg, var(--gold-300), var(--gold-500))',
                  }} />
                </div>
                <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>
                  {b.quantity.toLocaleString()} cards · {Math.round(share * 100)}%
                </div>
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}

function HoldingRow({ h, sym }: { h: CollectionAnalyticsHolding; sym: string }) {
  return (
    <li>
      <Link href={h.card_href} style={{
        display: 'flex', gap: 10, alignItems: 'center',
        padding: '6px 8px', borderRadius: 8, background: 'var(--bg-light)',
        textDecoration: 'none', color: 'var(--text)',
      }}>
        {h.image_uri_small ? (
          /* eslint-disable-next-line @next/next/no-img-element */
          <img src={h.image_uri_small} alt="" style={{ width: 28, height: 40, borderRadius: 4, objectFit: 'cover' }} />
        ) : <span style={{ width: 28, height: 40, borderRadius: 4, background: 'var(--bg-strong)' }} />}
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--text-strong)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{h.name}</div>
          <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>{h.set_name}{h.collector_number ? ` #${h.collector_number}` : ''} · {h.quantity} × {h.finish}</div>
        </div>
        <div style={{ textAlign: 'right' }}>
          <div style={{ fontFamily: 'ui-monospace, SFMono-Regular, monospace', fontWeight: 700 }}>
            {sym}{h.line_value.toLocaleString(undefined, { maximumFractionDigits: 2 })}
          </div>
          <div style={{ fontSize: 11, color: 'var(--text-muted)', fontFamily: 'ui-monospace, SFMono-Regular, monospace' }}>
            {sym}{h.unit_price.toFixed(2)} each
          </div>
        </div>
      </Link>
    </li>
  )
}

function MissingRow({ m }: { m: CollectionMissingHolding }) {
  return (
    <li>
      <Link href={m.card_href} style={{
        display: 'flex', gap: 10, alignItems: 'center',
        padding: '6px 8px', borderRadius: 8, background: 'var(--bg-light)',
        textDecoration: 'none', color: 'var(--text)',
      }}>
        {m.image_uri_small ? (
          /* eslint-disable-next-line @next/next/no-img-element */
          <img src={m.image_uri_small} alt="" style={{ width: 24, height: 34, borderRadius: 4, objectFit: 'cover' }} />
        ) : <span style={{ width: 24, height: 34, borderRadius: 4, background: 'var(--bg-strong)' }} />}
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--text-strong)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{m.name}</div>
          <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>{m.set_code.toUpperCase()}{m.collector_number ? ` #${m.collector_number}` : ''} · {m.quantity} × {m.finish}</div>
        </div>
      </Link>
    </li>
  )
}

function currencySymbol(currency: 'USD' | 'EUR'): string {
  return currency === 'EUR' ? '€' : '$'
}
