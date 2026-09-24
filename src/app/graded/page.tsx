// src/app/graded/page.tsx
//
// Public graded-market discovery page. Slice 6.
//
// Content is 100% queried live - no mocked "$5,800 PSA 10" examples.
// If the underlying queries fail the sections silently omit rows;
// no fabricated placeholders.

import type { Metadata } from 'next'
import Link from 'next/link'
import { getGradedNetworkStats, getTopValueGradedPrintings, getTopPremiumPrintings, type GradedFeatureRow } from '@/lib/tcggraph/graded-stats'

const SITE_URL = 'https://mtgprices.io'
export const revalidate = 900   // 15 min - graded refresh cadence still allows this

export const metadata: Metadata = {
  title: 'MTG Graded Card Prices, PSA / BGS / CGC / SGC market values',
  description: 'Actual graded MTG market data for professionally slabbed cards across thousands of printings. Track PSA 10, BGS 10, CGC 10 and SGC 10 values alongside raw quotes for each exact printing.',
  alternates: { canonical: `${SITE_URL}/graded` },
  openGraph: { url: `${SITE_URL}/graded`, title: 'MTG Graded Card Prices' },
}

function fmtNumber(n: number): string { return new Intl.NumberFormat('en-US').format(n) }
function fmtPrice(price: number, currency: string): string {
  try { return new Intl.NumberFormat('en-US', { style: 'currency', currency, maximumFractionDigits: 2 }).format(price) }
  catch { return `${currency} ${price.toFixed(2)}` }
}

const GRADER_BADGE_CLASS: Record<string, string> = {
  PSA: 'grade-badge grade-badge--psa',
  BGS: 'grade-badge grade-badge--bgs',
  CGC: 'grade-badge grade-badge--cgc',
  SGC: 'grade-badge grade-badge--sgc',
  ANY: 'grade-badge grade-badge--any',
}

function GradedCard({ row }: { row: GradedFeatureRow }) {
  const badgeClass = GRADER_BADGE_CLASS[row.headline.grader] ?? 'grade-badge grade-badge--any'
  return (
    <Link href={row.cardHref} className="card-hover" style={{
      display: 'grid',
      gridTemplateColumns: '96px 1fr',
      gap: 14,
      padding: 12,
      background: 'rgba(255,255,255,0.03)',
      border: '1px solid rgba(255,255,255,0.08)',
      borderRadius: 12,
      color: 'inherit',
      textDecoration: 'none',
      alignItems: 'stretch',
    }}>
      <div style={{ aspectRatio: '5 / 7', background: 'rgba(0,0,0,0.35)', border: '1px solid rgba(232,169,75,0.20)', borderRadius: 8, overflow: 'hidden' }}>
        {row.imageUri ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={row.imageUri} alt={row.cardName} loading="lazy" style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} />
        ) : null}
      </div>
      <div style={{ display: 'grid', gap: 6, alignContent: 'space-between' }}>
        <div>
          <div className="label-mono" style={{ color: '#FFD98A', marginBottom: 2 }}>
            {row.setCode.toUpperCase()}{row.collectorNumber && (<> &middot; #{row.collectorNumber}</>)}
          </div>
          <div style={{ fontFamily: 'Outfit, system-ui, sans-serif', fontWeight: 700, fontSize: 15, lineHeight: 1.2, color: '#F6EED9' }}>
            {row.cardName}
          </div>
          {row.setName && <div style={{ fontSize: 11.5, color: '#A6ADBE' }}>{row.setName}</div>}
        </div>
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 2 }}>
            <span className={badgeClass}>{row.headline.grader}</span>
            <span style={{ fontSize: 11, color: '#A6ADBE' }}>Grade {row.headline.grade}</span>
          </div>
          <div style={{ fontFamily: 'Outfit, system-ui, sans-serif', fontWeight: 800, fontSize: 20, color: '#FFF6D9', letterSpacing: '-0.01em' }}>
            {fmtPrice(row.headline.price, row.headline.currency)}
          </div>
          {row.raw && row.premiumPercent != null && (
            <div style={{ fontSize: 11.5, color: '#A6ADBE', marginTop: 2 }}>
              vs raw {fmtPrice(row.raw.price, row.raw.currency)} · <span style={{ color: '#FFD98A', fontWeight: 700 }}>+{row.premiumPercent.toLocaleString()}%</span>
            </div>
          )}
        </div>
      </div>
    </Link>
  )
}

function Section({ title, subtitle, rows, empty }: { title: string; subtitle: string; rows: GradedFeatureRow[]; empty: string }) {
  return (
    <section style={{ marginBottom: 40 }}>
      <header style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', flexWrap: 'wrap', gap: 12, marginBottom: 14 }}>
        <div>
          <h2 style={{ margin: 0, fontFamily: 'Outfit, system-ui, sans-serif', fontSize: 19, color: '#F6EED9', letterSpacing: '-0.015em' }}>{title}</h2>
          <p style={{ margin: '2px 0 0', fontSize: 12.5, color: '#A6ADBE', maxWidth: 640, lineHeight: 1.55 }}>{subtitle}</p>
        </div>
      </header>
      {rows.length === 0 ? (
        <div style={{ padding: 20, background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.06)', borderRadius: 12, color: '#A6ADBE', fontSize: 13 }}>{empty}</div>
      ) : (
        <div style={{ display: 'grid', gap: 12, gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))' }}>
          {rows.map((r) => <GradedCard key={r.mtgPrintingId} row={r} />)}
        </div>
      )}
    </section>
  )
}

export default async function GradedPage() {
  const [stats, topValue, topPremium] = await Promise.all([
    getGradedNetworkStats(),
    getTopValueGradedPrintings(12),
    getTopPremiumPrintings(12),
  ])

  const jsonLd = {
    '@context': 'https://schema.org',
    '@type': 'CollectionPage',
    name: 'MTG Graded Card Prices',
    description: 'Actual graded MTG market data for professionally slabbed cards.',
    url: `${SITE_URL}/graded`,
  }

  return (
    <div style={{ background: 'linear-gradient(180deg, #0B1428 0%, #060C1B 100%)', minHeight: '100vh', color: '#ECE3C7', position: 'relative' }}>
      {/* Dark-theme MTG accent: gold arcane glyphs at low opacity + a
          soft WUBRG halo. Kept subtle enough not to fight the graded
          cards themselves. */}
      <div className="mtg-arcane-veil dark" aria-hidden style={{ position: 'absolute', inset: 0 }} />
      <div className="mtg-mana-crest dark" aria-hidden />
      <div style={{ maxWidth: 1180, margin: '0 auto', padding: '32px 24px 80px', position: 'relative' }}>
        <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }} />

        {/* Header */}
        <header style={{ marginBottom: 24 }}>
          <div className="label-mono" style={{ color: '#FFD98A' }}>MTG graded market</div>
          <h1 className="display" style={{ margin: '4px 0 10px', fontSize: 34, lineHeight: 1.05, color: '#FFF6D9' }}>
            Graded MTG card prices
          </h1>
          <p style={{ margin: 0, maxWidth: 720, color: '#C4C9D6', fontSize: 14, lineHeight: 1.6 }}>
            Actual PSA, BGS, CGC and SGC market data across thousands of MTG printings. Every value below comes
            from a specific physical printing, not a name-level average. Missing quotes stay missing.
          </p>
          {stats.reliable && stats.distinctSlabPrintings > 0 && (
            <div style={{ marginTop: 18, display: 'flex', flexWrap: 'wrap', gap: 10 }}>
              <span className="chip chip-gold">{fmtNumber(stats.distinctSlabPrintings)} slabbed printings tracked</span>
              {stats.distinctRawPrintings > 0 && (
                <span className="chip">{fmtNumber(stats.distinctRawPrintings)} raw quotes for comparison</span>
              )}
              <span className="chip chip-arcane">PSA · BGS · CGC · SGC</span>
            </div>
          )}
        </header>

        <div className="mtg-engraved" style={{ margin: '10px 0 28px', background: 'linear-gradient(to right, transparent 0%, rgba(232,169,75,0.30) 10%, rgba(232,169,75,0.55) 50%, rgba(232,169,75,0.30) 90%, transparent 100%)' }} />

        <Section
          title="Highest-value slabbed printings"
          subtitle="Recent PSA 10 (or highest-grade slab) market values for exact MTG printings. Click any card to see all raw and graded market data."
          rows={topValue}
          empty="No graded market data ranked yet - check back after the next scheduled refresh."
        />

        <Section
          title="Biggest raw-to-slab premiums"
          subtitle="Same-currency raw vs slab-10 comparisons, showing where grading has historically added the most market value for this exact printing."
          rows={topPremium}
          empty="No comparable raw-to-slab pairs available yet."
        />

        {/* Provider transparency footer */}
        <footer style={{ marginTop: 40, paddingTop: 20, borderTop: '1px solid rgba(255,255,255,0.10)', fontSize: 12, color: '#A6ADBE', display: 'grid', gap: 6 }}>
          <div>
            Additional graded market data: <strong style={{ color: '#F6EED9', fontWeight: 700 }}>TCGGraph</strong>. Existing raw-market
            data continues to come from MTGJSON, Scryfall, TCGplayer, Card Kingdom, Cardmarket, ManaPool and Cardhoarder.
          </div>
          <div>
            Grades correspond to the exact printing on the linked card page.
            Different printings of the same Oracle card have entirely independent graded markets.
          </div>
        </footer>
      </div>
    </div>
  )
}
