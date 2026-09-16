// app/page.tsx — MTGPrices homepage.
// Communicates the two-audience product (Collect + Play) while only
// linking to surfaces that actually work today. Future areas appear as
// deliberate "coming soon" tiles rather than dead links.

import Link from 'next/link'
import { listSets } from '@/lib/mtg/sets'
import { getSupabaseServiceClient } from '@/lib/supabaseService'
import HomeSearch from '@/components/HomeSearch'
import { FORMATS } from '@/lib/mtg/formats'

export const revalidate = 300

async function getCatalogueCounts() {
  const s = getSupabaseServiceClient()
  const [printings, oracles, sets, priced] = await Promise.all([
    s.from('mtg_printings').select('id', { count: 'exact', head: true }).eq('digital', false).eq('lang', 'en'),
    s.from('mtg_oracle_cards').select('id', { count: 'exact', head: true }),
    s.from('mtg_sets').select('id', { count: 'exact', head: true }).eq('digital', false),
    s.from('mtg_current_prices').select('printing_finish_id', { count: 'exact', head: true }),
  ])
  return {
    printings: printings.count ?? 0,
    oracles: oracles.count ?? 0,
    sets: sets.count ?? 0,
    pricedFinishes: priced.count ?? 0,
  }
}

export default async function HomePage() {
  const [counts, recentSets] = await Promise.all([
    getCatalogueCounts(),
    listSets({ limit: 8 }),
  ])

  const primaryFormats = FORMATS.filter((f) => f.group === 'Primary' || f.group === 'Casual').slice(0, 8)

  return (
    <div style={{ maxWidth: 1180, margin: '0 auto', padding: '40px 24px 80px' }}>
      {/* Hero */}
      <section style={{ paddingBottom: 40, borderBottom: '1px solid var(--border)' }}>
        <div style={{ maxWidth: 760 }}>
          <div className="label-mono" style={{ marginBottom: 14 }}>MTGPrices.io · Public preview</div>
          <h1 style={{ fontSize: 'clamp(36px, 5vw, 56px)', margin: 0, lineHeight: 1.05, fontWeight: 800 }}>
            The home for <span style={{ color: 'var(--accent)' }}>Magic</span> — prices,
            printings and what every card actually does.
          </h1>
          <p style={{ color: 'var(--text-muted)', fontSize: 17, lineHeight: 1.55, marginTop: 18, maxWidth: 680 }}>
            Live market data for {counts.printings.toLocaleString()} English printings across {counts.sets.toLocaleString()} sets,
            paired with the full Scryfall catalogue: {counts.oracles.toLocaleString()} unique cards, every rule,
            legality and ruling.
          </p>
        </div>

        <div style={{ marginTop: 26, maxWidth: 720 }}>
          <HomeSearch placeholder="Search a card — e.g. Lightning Bolt, Sheoldred, Ragavan…" />
          <div style={{ marginTop: 10, fontSize: 12, color: 'var(--text-muted)' }}>
            Or jump straight to
            {' '}<Link href="/browse" style={{ color: 'var(--accent)' }}>every set</Link>
            {' · '}<Link href="/formats" style={{ color: 'var(--accent)' }}>formats</Link>
          </div>
        </div>
      </section>

      {/* Two audiences */}
      <section style={{ paddingTop: 44 }}>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: 20 }}>
          <AudienceCard
            title="Collect"
            tagline="For collectors and buyers"
            body="Live prices from TCGplayer, Card Kingdom, Cardmarket, ManaPool and Cardhoarder. Every printing, every finish, price history and set catalogue in one place."
            actions={[
              { label: 'Search cards', href: '/cards/search' },
              { label: 'Browse sets', href: '/browse' },
            ]}
            soon={['Collection tracking', 'Deck value', 'Market movement dashboards']}
          />
          <AudienceCard
            title="Play"
            tagline="For deck builders and players"
            body="Full Oracle text, keywords, factual card capabilities, format legality across Standard through Vintage and everything in between. The rules and rulings behind every card."
            actions={[
              { label: 'Explore formats', href: '/formats' },
              { label: 'Card search', href: '/cards/search' },
            ]}
            soon={['Deck Builder', 'AI deck assistant', 'Test Your Deck']}
          />
        </div>
      </section>

      {/* Stats */}
      <section style={{ paddingTop: 48 }}>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 12 }}>
          <StatTile label="Unique cards"  value={counts.oracles.toLocaleString()} />
          <StatTile label="Printings"     value={counts.printings.toLocaleString()} />
          <StatTile label="Sets"          value={counts.sets.toLocaleString()} />
          <StatTile label="Priced finishes" value={counts.pricedFinishes.toLocaleString()} />
        </div>
      </section>

      {/* Recent sets */}
      <section style={{ paddingTop: 48 }}>
        <SectionHeader title="Recent sets" href="/browse" hrefLabel="All sets →" />
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', gap: 14 }}>
          {recentSets.map((set) => (
            <Link
              key={set.id}
              href={`/set/${set.code}`}
              className="card-hover"
              style={{
                display: 'block', background: 'var(--surface)',
                border: '1px solid var(--border)', borderRadius: 12,
                padding: '16px', textDecoration: 'none', color: 'var(--text)',
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                {set.icon_svg_uri ? (
                  // eslint-disable-next-line @next/next/no-img-element
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

      {/* Formats */}
      <section style={{ paddingTop: 48 }}>
        <SectionHeader title="Popular formats" href="/formats" hrefLabel="All formats →" />
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: 10 }}>
          {primaryFormats.map((f) => (
            <Link
              key={f.key}
              href={`/formats/${f.key}`}
              className="card-hover"
              style={{
                display: 'block', background: 'var(--surface)',
                border: '1px solid var(--border)', borderRadius: 10,
                padding: 14, textDecoration: 'none', color: 'var(--text)',
              }}
            >
              <div style={{ fontSize: 15, fontWeight: 700 }}>{f.label}</div>
              <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 4, lineHeight: 1.4 }}>{f.blurb}</div>
            </Link>
          ))}
        </div>
      </section>

      {/* Roadmap teaser */}
      <section style={{ paddingTop: 52 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 12 }}>
          <h2 style={{ margin: 0, fontSize: 22 }}>What's next</h2>
          <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>Roadmap</span>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: 12 }}>
          <SoonTile title="Accounts &amp; Collection" body="Track every card you own — exact printing, finish, quantity. Feeds into Deck Builder + deck value." />
          <SoonTile title="Deck Builder" body="Manual, format-aware, commander-first. Build from your collection, see owned vs missing, deck value and cheapest replacement printings." />
          <SoonTile title="AI assistant" body="Retrieval-grounded over the live DB. Never invents cards, rules, legality or prices." />
          <SoonTile title="Community" body="Events, vendors and creators — LGSs, tournaments, card shows and MTG content makers." />
        </div>
      </section>
    </div>
  )
}

function StatTile({ label, value }: { label: string; value: string }) {
  return (
    <div style={{
      padding: '18px 16px', background: 'var(--surface)',
      border: '1px solid var(--border)', borderRadius: 12,
    }}>
      <div className="label-mono" style={{ marginBottom: 6 }}>{label}</div>
      <div style={{
        fontSize: 26, fontWeight: 800,
        fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
      }}>{value}</div>
    </div>
  )
}

function AudienceCard({
  title, tagline, body, actions, soon,
}: {
  title: string
  tagline: string
  body: string
  actions: { label: string; href: string }[]
  soon: string[]
}) {
  return (
    <div style={{
      padding: 24, background: 'var(--surface)',
      border: '1px solid var(--border)', borderRadius: 14,
    }}>
      <div className="label-mono" style={{ color: 'var(--accent)', marginBottom: 8 }}>{tagline}</div>
      <h2 style={{ margin: 0, fontSize: 26 }}>{title}</h2>
      <p style={{ color: 'var(--text-muted)', fontSize: 14, lineHeight: 1.55, marginTop: 10 }}>{body}</p>
      <div style={{ display: 'flex', gap: 8, marginTop: 16, flexWrap: 'wrap' }}>
        {actions.map((a, i) => (
          <Link
            key={a.href}
            href={a.href}
            style={{
              background: i === 0 ? 'var(--primary)' : 'transparent',
              color: i === 0 ? '#fff' : 'var(--text)',
              border: i === 0 ? '1px solid var(--primary)' : '1px solid var(--border)',
              padding: '9px 16px', borderRadius: 10, fontWeight: 600,
              fontSize: 13, textDecoration: 'none',
            }}
          >{a.label}</Link>
        ))}
      </div>
      {soon.length > 0 && (
        <div style={{ marginTop: 18 }}>
          <div className="label-mono" style={{ marginBottom: 8 }}>Coming</div>
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            {soon.map((s) => (
              <span key={s} style={{
                fontSize: 11, fontWeight: 600, padding: '3px 10px', borderRadius: 999,
                background: 'rgba(124,92,231,0.15)', color: '#c8b8ff',
                border: '1px solid rgba(124,92,231,0.25)',
              }}>{s}</span>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

function SectionHeader({ title, href, hrefLabel }: { title: string; href?: string; hrefLabel?: string }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 18 }}>
      <h2 style={{ margin: 0, fontSize: 22 }}>{title}</h2>
      {href && <Link href={href} style={{ color: 'var(--text-muted)', fontSize: 13 }}>{hrefLabel ?? 'View all →'}</Link>}
    </div>
  )
}

function SoonTile({ title, body }: { title: string; body: string }) {
  return (
    <div style={{
      padding: 18, background: 'var(--surface)',
      border: '1px dashed var(--border)', borderRadius: 12,
    }}>
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 6 }}>
        <span style={{
          fontSize: 10, fontWeight: 700, padding: '2px 8px', borderRadius: 999,
          background: 'rgba(124,92,231,0.15)', color: '#c8b8ff',
          letterSpacing: 0.4, textTransform: 'uppercase',
        }}>Soon</span>
      </div>
      <div style={{ fontSize: 15, fontWeight: 700 }} dangerouslySetInnerHTML={{ __html: title }} />
      <div style={{ fontSize: 13, color: 'var(--text-muted)', marginTop: 6, lineHeight: 1.5 }}>{body}</div>
    </div>
  )
}
