// src/components/mtg/GradedPricesPanel.tsx
//
// Public graded-price surface for an EXACT MTG printing. Server
// component. Consumes the TCGGraph read-model bundle for a single
// mtg_printings.id and renders ONLY when at least one slabbed quote
// exists. Never renders "$0", never invents a price.
//
// Slice 6. The dark island treatment is intentional - the graded
// module is materially different from the market/rules modules
// above so collectors can find it at a glance.

import Link from 'next/link'
import type { TcgPrintingBundle } from '@/lib/tcggraph/read-model'
import { buildGradedView, type GradedCell } from '@/lib/mtg/graded-view'
import EbayLinkButton from '@/components/mtg/EbayLinkButton'

type Props = {
  bundle: TcgPrintingBundle | null
  setCode: string
  collectorNumber: string | null
  finish: string | null
  //  Card name is only needed for the "View graded listings" eBay CTA
  //  at the bottom of the panel. It defaults to a generic label so
  //  existing callers can omit it.
  cardName?: string
}

const GRADER_BADGE_CLASS: Record<string, string> = {
  PSA: 'grade-badge grade-badge--psa',
  BGS: 'grade-badge grade-badge--bgs',
  CGC: 'grade-badge grade-badge--cgc',
  SGC: 'grade-badge grade-badge--sgc',
  Any: 'grade-badge grade-badge--any',
}

function formatPrice(price: number, currency: string): string {
  //  Never silently converts currencies - just formats.
  try {
    return new Intl.NumberFormat('en-US', { style: 'currency', currency, maximumFractionDigits: 2 }).format(price)
  } catch {
    return `${currency} ${price.toFixed(2)}`
  }
}

function daysAgo(iso: string | null, now = Date.now()): string | null {
  if (!iso) return null
  const t = Date.parse(iso)
  if (!Number.isFinite(t)) return null
  const diff = Math.max(0, Math.round((now - t) / 86_400_000))
  if (diff === 0) return 'today'
  if (diff === 1) return 'yesterday'
  if (diff < 30) return `${diff}d ago`
  if (diff < 60) return '1mo ago'
  return `${Math.round(diff / 30)}mo ago`
}

function Fingerprint({ setCode, collectorNumber, finish }: { setCode: string; collectorNumber: string | null; finish: string | null }) {
  return (
    <span className="mtg-fingerprint" aria-label="This exact printing">
      <span>{setCode.toUpperCase()}</span>
      {collectorNumber && <><span className="sep">/</span><span>#{collectorNumber}</span></>}
      {finish && <><span className="sep">/</span><span>{finish.replace(/_/g, ' ')}</span></>}
    </span>
  )
}

function Cell({ c, hero }: { c: GradedCell; hero?: boolean }) {
  const badge = GRADER_BADGE_CLASS[c.grader] ?? 'grade-badge grade-badge--any'
  return (
    <div className={`mtg-graded-cell${hero ? ' hero' : ''}`}>
      <div className="grader-line">
        <span className={badge} aria-label={`${c.grader} grader`}>{c.grader}</span>
        <span>Grade {c.grade}</span>
      </div>
      <div className="price">{formatPrice(c.price, c.currency)}</div>
      <div className="meta">
        {c.currency}
        {c.updatedAt && (<> &middot; updated {daysAgo(c.updatedAt)}</>)}
      </div>
    </div>
  )
}

export default function GradedPricesPanel({ bundle, setCode, collectorNumber, finish, cardName }: Props) {
  const view = buildGradedView(bundle)
  //  No graded data? Render nothing at all. The user's Slice-6 rule.
  if (!view.hasSlabbedData) return null

  const lastUpdate = view.lastSlabUpdate
  const helpText = 'Graded prices are market estimates for professionally graded copies of this exact printing where sufficient market data is available.'

  return (
    <section className="mtg-graded-panel" aria-label="Graded card prices">
      <header style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 16, flexWrap: 'wrap', marginBottom: 12 }}>
        <div>
          <div className="label-mono">Graded market</div>
          <h2 style={{ margin: '4px 0 6px', fontSize: 19, lineHeight: 1.2, fontFamily: 'Outfit, system-ui, sans-serif', fontWeight: 700, letterSpacing: '-0.015em' }}>
            Graded card prices
          </h2>
          <p style={{ margin: 0, fontSize: 12, color: 'var(--graded-fg-muted, #A6ADBE)', maxWidth: 520, lineHeight: 1.55 }} title={helpText}>
            {helpText}
          </p>
        </div>
        <Fingerprint setCode={setCode} collectorNumber={collectorNumber} finish={finish} />
      </header>

      <div className="mtg-engraved" style={{ margin: '8px 0 16px' }} />

      {/*  Slab-10 hero row.  */}
      {view.slabTen.length > 0 && (
        <div style={{ display: 'grid', gap: 10, gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', marginBottom: 12 }}>
          {view.slabTen.map((c) => (
            <Cell key={`${c.grader}-${c.grade}-${c.currency}`} c={c} hero />
          ))}
        </div>
      )}

      {/*  Any-grader fallback row.  */}
      {view.anyGraded.length > 0 && (
        <>
          <div className="label-mono" style={{ marginBottom: 6, marginTop: view.slabTen.length > 0 ? 10 : 0 }}>Additional graded market</div>
          <div style={{ display: 'grid', gap: 10, gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', marginBottom: 12 }}>
            {view.anyGraded.map((c) => (
              <Cell key={`${c.grader}-${c.grade}-${c.currency}`} c={c} />
            ))}
          </div>
        </>
      )}

      {/*  Other unusual combos.  */}
      {view.other.length > 0 && (
        <>
          <div className="label-mono" style={{ marginBottom: 6, marginTop: 10 }}>Other grader quotes</div>
          <div style={{ display: 'grid', gap: 10, gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', marginBottom: 12 }}>
            {view.other.map((c) => (
              <Cell key={`${c.grader}-${c.grade}-${c.currency}`} c={c} />
            ))}
          </div>
        </>
      )}

      {/*  Raw vs graded.  */}
      {view.premium && (
        <>
          <div className="mtg-engraved" style={{ margin: '14px 0' }} />
          <div className="mtg-graded-compare" role="group" aria-label="Raw vs graded comparison">
            <div className="side">
              <div className="label">Raw market</div>
              <div className="value">{formatPrice(view.premium.raw.price, view.premium.raw.currency)}</div>
            </div>
            <div className="arrow" aria-hidden="true">→</div>
            <div className="side" style={{ textAlign: 'right' }}>
              <div className="label">{view.premium.slab.grader} {view.premium.slab.grade}</div>
              <div className="value" style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'flex-end', gap: 8 }}>
                <span>{formatPrice(view.premium.slab.price, view.premium.slab.currency)}</span>
                <span className="premium">{view.premium.percentDisplay}</span>
              </div>
            </div>
          </div>
        </>
      )}

      {/*  CTA: shop graded copies on eBay. Only rendered when we have a
           real card name to search for. Uses the existing eBay affiliate
           link builder so nothing bypasses the disclosure surface. */}
      {cardName && (
        <div style={{ marginTop: 16, display: 'flex', flexWrap: 'wrap', gap: 10, alignItems: 'center' }}>
          <EbayLinkButton
            variant="gold"
            cardName={`${cardName} PSA`}
            setName={null}
            setCode={setCode}
            collectorNumber={collectorNumber}
            finish={(finish === 'foil' || finish === 'etched') ? finish : 'nonfoil'}
            source="mtg-graded-panel"
            hideDisclosure
          />
          <span style={{ fontSize: 11, color: 'var(--graded-fg-muted, #A6ADBE)' }}>
            Affiliate link, MTGPrices may earn a commission on qualifying purchases.
          </span>
        </div>
      )}

      <footer style={{ marginTop: 14, fontSize: 11.5, color: 'var(--graded-fg-muted, #A6ADBE)', display: 'flex', flexWrap: 'wrap', gap: 12, justifyContent: 'space-between' }}>
        <span>
          Additional graded market data: TCGGraph.
          {lastUpdate && (<> &middot; last update {daysAgo(lastUpdate)}</>)}
        </span>
        <Link href="/graded" style={{ color: 'var(--gold-300)' }}>
          Explore graded market ›
        </Link>
      </footer>
    </section>
  )
}
