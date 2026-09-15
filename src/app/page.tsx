// app/page.tsx — MTGPrices homepage.
import Link from 'next/link'
import { listSets } from '@/lib/mtg/sets'
import { getSupabaseServiceClient } from '@/lib/supabaseService'

export const revalidate = 300

async function getCatalogueCounts() {
  const s = getSupabaseServiceClient()
  const [printings, sets, priced] = await Promise.all([
    s.from('mtg_printings').select('id', { count: 'exact', head: true }),
    s.from('mtg_sets').select('id', { count: 'exact', head: true }),
    s.from('mtg_current_prices').select('printing_finish_id', { count: 'exact', head: true }),
  ])
  return {
    printings: printings.count ?? 0,
    sets: sets.count ?? 0,
    pricedFinishes: priced.count ?? 0,
  }
}

export default async function HomePage() {
  const [counts, recentSets] = await Promise.all([
    getCatalogueCounts(),
    listSets({ limit: 12 }),
  ])

  return (
    <div style={{ maxWidth: 1100, margin: '0 auto', padding: '48px 24px 64px' }}>
      <section style={{ padding: '32px 0 48px', borderBottom: '1px solid var(--border)' }}>
        <div style={{ maxWidth: 720 }}>
          <div className="label-mono" style={{ marginBottom: 14 }}>MTGPrices.io · Public beta</div>
          <h1 style={{ fontSize: 'clamp(36px, 5vw, 56px)', margin: 0, lineHeight: 1.05, fontWeight: 800 }}>
            Live prices for every <span style={{ color: 'var(--accent)' }}>Magic</span> printing.
          </h1>
          <p style={{ color: 'var(--text-muted)', fontSize: 17, lineHeight: 1.55, marginTop: 18, maxWidth: 640 }}>
            {counts.pricedFinishes.toLocaleString()} priced finishes across {counts.printings.toLocaleString()} printings
            in {counts.sets.toLocaleString()} sets. Historical charts, printings, legality and rulings — all in one
            place. Free, no login required.
          </p>
          <div style={{ display: 'flex', gap: 12, marginTop: 26, flexWrap: 'wrap' }}>
            <Link
              href="/cards/search"
              style={{
                background: 'var(--primary)', color: '#fff', padding: '11px 22px',
                borderRadius: 10, fontWeight: 700, fontSize: 15, textDecoration: 'none',
              }}
            >
              Search cards
            </Link>
            <Link
              href="/browse"
              style={{
                background: 'transparent', color: 'var(--text)',
                border: '1px solid var(--border)', padding: '10px 22px',
                borderRadius: 10, fontWeight: 600, fontSize: 15, textDecoration: 'none',
              }}
            >
              Browse sets
            </Link>
          </div>
        </div>
      </section>

      <section style={{ paddingTop: 40 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 18 }}>
          <h2 style={{ margin: 0, fontSize: 22 }}>Latest sets</h2>
          <Link href="/browse" style={{ color: 'var(--text-muted)', fontSize: 13 }}>All sets →</Link>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', gap: 14 }}>
          {recentSets.map((set) => (
            <Link
              key={set.id}
              href={`/set/${set.code}`}
              className="card-hover"
              style={{
                display: 'block', background: 'var(--surface)',
                border: '1px solid var(--border)', borderRadius: 12,
                padding: '16px 16px 14px', textDecoration: 'none', color: 'var(--text)',
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                {set.icon_svg_uri ? (
                  <img src={set.icon_svg_uri} alt="" aria-hidden style={{ width: 22, height: 22, filter: 'invert(85%)' }} />
                ) : (
                  <span style={{ width: 22, height: 22, borderRadius: 6, background: 'var(--bg-light)', border: '1px solid var(--border)' }} />
                )}
                <div className="label-mono">{set.code}</div>
              </div>
              <div style={{ fontSize: 15, fontWeight: 700, marginTop: 10, lineHeight: 1.25 }}>{set.name}</div>
              <div style={{ color: 'var(--text-muted)', fontSize: 12, marginTop: 6 }}>
                {set.released_at ?? '—'}
                {set.card_count ? <> · {set.card_count.toLocaleString()} cards</> : null}
              </div>
            </Link>
          ))}
        </div>
      </section>
    </div>
  )
}
