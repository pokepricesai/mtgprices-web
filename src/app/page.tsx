// app/page.tsx. MTGPrices branded homepage.
// Communicates the two-audience product (Collect + Play) with a light,
// browseable hero, live product previews (Deck Intelligence + Market
// Pulse) and real data modules (latest set, top movers, formats).
// Every link resolves to a live route; anything not yet shipped is
// omitted rather than presented as a dead link.

import Link from 'next/link'
import Image from 'next/image'
import { listSets, countPublicSets, type MtgSet } from '@/lib/mtg/sets'
import { getSupabaseServiceClient } from '@/lib/supabaseService'
import { getMarketMovers, type MoverCard } from '@/lib/mtg/movers'
import HomeSearch from '@/components/HomeSearch'
import { FORMATS } from '@/lib/mtg/formats.data'
import { latestInsights, type InsightMeta } from '@/lib/insights'

export const revalidate = 300

async function getCatalogueCounts() {
  const s = getSupabaseServiceClient()
  const [printings, oracles, publicSets, priced] = await Promise.all([
    s.from('mtg_printings').select('id', { count: 'exact', head: true }).eq('digital', false).eq('lang', 'en'),
    s.from('mtg_oracle_cards').select('id', { count: 'exact', head: true }),
    // Match /browse and sitemap-sets.xml: only the browsable / public-
    // type sets. Reporting the raw mtg_sets total here would tell the
    // visitor "N sets" while /browse and the sitemap disagree.
    countPublicSets(),
    s.from('mtg_current_prices').select('printing_finish_id', { count: 'exact', head: true }),
  ])
  return {
    printings: printings.count ?? 0,
    oracles: oracles.count ?? 0,
    sets: publicSets,
    pricedFinishes: priced.count ?? 0,
  }
}

export default async function HomePage() {
  // Homepage "Latest set" and "Recently released" must ONLY show sets
  // whose released_at is today or earlier. A future-dated Scryfall
  // entry (spoiler-only, preview) must never be described as already
  // launched. The filter is at the query layer so tests pinning the
  // helper (releasedBy) protect this behaviour independently of the
  // page.
  const today = new Date().toISOString().slice(0, 10)
  const [counts, recentSets, movers] = await Promise.all([
    getCatalogueCounts(),
    listSets({ limit: 6, releasedBy: today }),
    getMarketMovers({ windowDays: 30, topN: 4 }),
  ])

  const latestSet = recentSets[0] ?? null
  const primaryFormats = FORMATS
    .filter((f) => f.group === 'Primary' || f.group === 'Casual' || f.group === 'Eternal')
    .slice(0, 8)
  const insights = latestInsights(3)

  return (
    <>
      <Hero counts={counts} latestSet={latestSet} movers={movers} />
      <MarketPulseSection movers={movers} />
      <StartExploringSection />
      <PlayersAndCollectorsSection />
      <DeckLabSection />
      <InsightsSection items={insights} />
      <FormatsSection formats={primaryFormats} />
      <RecentSetsSection sets={recentSets} />
      <FinalCtaSection />
    </>
  )
}

function InsightsSection({ items }: { items: InsightMeta[] }) {
  if (items.length === 0) return null
  return (
    <section style={{ padding: '76px 24px', background: 'var(--bg)' }}>
      <div style={{ maxWidth: 1180, margin: '0 auto' }}>
        <SectionHeader
          eyebrow="Insights"
          title={<>Latest from the MTGPrices editorial.</>}
          subtitle="Weekly writing on the Magic market, collecting, deckbuilding, sets and formats."
          rightLink={{ href: '/insights', label: 'All insights →' }}
        />
        <div style={{
          display: 'grid', gap: 16, marginTop: 24,
          gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))',
        }}>
          {items.map((a) => (
            <Link
              key={a.slug}
              href={`/insights/${a.slug}`}
              className="card-hover card-hover-gold"
              style={{
                display: 'flex', flexDirection: 'column', gap: 8,
                padding: 20, borderRadius: 16,
                background: 'var(--surface)', border: '1px solid var(--border)',
                textDecoration: 'none', color: 'var(--text)',
                boxShadow: '0 4px 14px rgba(20,33,61,0.04)',
              }}
            >
              <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                <span className="chip chip-arcane" style={{ fontSize: 11 }}>{a.category}</span>
                <span style={{ fontSize: 11.5, color: 'var(--text-muted)' }}>
                  {new Date(a.publishedAt + 'T00:00:00Z').toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' })} · {a.readingTimeMin} min
                </span>
              </div>
              <div style={{ fontSize: 17, fontWeight: 700, color: 'var(--text-strong)', lineHeight: 1.3 }}>
                {a.title}
              </div>
              {a.description && (
                <p style={{ margin: 0, fontSize: 13.5, color: 'var(--text-muted)', lineHeight: 1.55 }}>
                  {a.description}
                </p>
              )}
            </Link>
          ))}
        </div>
      </div>
    </section>
  )
}

/* ═════════════════════════════════════════════════════════════════════
   HERO
   ═════════════════════════════════════════════════════════════════════ */

function Hero({
  counts, latestSet, movers,
}: {
  counts: { printings: number; oracles: number; sets: number; pricedFinishes: number }
  latestSet: MtgSet | null
  movers: Awaited<ReturnType<typeof getMarketMovers>>
}) {
  const heroPulse = movers?.active[0] ?? movers?.risers[0] ?? null

  return (
    <section className="hero-shell" style={{ padding: '56px 24px 68px', position: 'relative' }}>
      <div className="spark-field" aria-hidden />

      <div style={{ maxWidth: 1180, margin: '0 auto', position: 'relative' }}>
        <div className="hero-grid" style={{ display: 'grid', gap: 40, alignItems: 'center' }}>
          {/* Left: brand mark + copy + search + chips */}
          <div>
            {/* Hero logo. Deliberately larger than the navbar lockup so
                the brand carries strongly into the page. Sized via the
                .hero-logo helper so mobile and desktop scale together
                and the aspect ratio is preserved via CSS `height: auto`. */}
            <Image
              src="/logo.png"
              alt="MTGPrices"
              width={600}
              height={180}
              priority
              className="hero-logo"
              style={{ display: 'block', height: 'auto', marginBottom: 22 }}
            />
            <h1
              className="display"
              style={{
                fontSize: 'clamp(38px, 5.4vw, 64px)',
                margin: 0,
                lineHeight: 1.04,
                fontWeight: 700,
                color: 'var(--text-strong)',
                letterSpacing: '-0.02em',
              }}
            >
              Know every card. Build better decks.
            </h1>

            <p style={{
              color: 'var(--text-muted)', fontSize: 17.5, lineHeight: 1.6, marginTop: 20,
              maxWidth: 620,
            }}>
              Live pricing, printings and rules for {counts.oracles.toLocaleString()} Magic cards
              across {counts.sets.toLocaleString()} sets. One place to find a card, price it,
              build with it and test the list.
            </p>

            <div style={{ marginTop: 26, maxWidth: 680 }}>
              <HomeSearch placeholder="Search cards, sets, types, abilities" />
            </div>

            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginTop: 16 }}>
              {[
                { label: 'Browse cards',   href: '/cards/search' },
                { label: 'Card Finder',    href: '/card-finder' },
                { label: 'Build a deck',   href: '/decks/new' },
                { label: 'Test a deck',    href: '/decks' },
                { label: 'Market movers',  href: '#market' },
              ].map((q) => (
                <Link
                  key={q.label}
                  href={q.href}
                  style={{
                    fontSize: 13, fontWeight: 600, padding: '8px 14px',
                    borderRadius: 999,
                    background: 'var(--surface)',
                    color: 'var(--text)',
                    border: '1px solid var(--border)',
                    textDecoration: 'none',
                    transition: 'background 150ms ease, border-color 150ms ease, color 150ms ease',
                  }}
                >{q.label}</Link>
              ))}
            </div>

            {/* Trust chips */}
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, marginTop: 22 }}>
              <TrustChip label="Live pricing" />
              <TrustChip label={`${formatBig(counts.printings)}+ printings`} />
              <TrustChip label="Every format legality" />
              <TrustChip label="Deck Builder and Test" />
              <TrustChip label="No login to browse" />
            </div>
          </div>

          {/* Right: product previews */}
          <div style={{ display: 'grid', gap: 16 }}>
            <DeckIntelligenceCard />
            <MarketPulseCard mover={heroPulse} counts={counts} />
            {latestSet && <LatestSetCard set={latestSet} />}
          </div>
        </div>
      </div>

      <style>{`
        @media (min-width: 960px) {
          .hero-grid { grid-template-columns: minmax(0, 1.05fr) minmax(340px, 0.95fr); gap: 48px; }
        }
      `}</style>
    </section>
  )
}

function TrustChip({ label }: { label: string }) {
  return (
    <span style={{
      fontSize: 12, fontWeight: 600, padding: '5px 11px', borderRadius: 999,
      color: 'var(--text)',
      background: 'var(--surface)',
      border: '1px solid var(--border)',
      letterSpacing: '0.02em',
    }}>{label}</span>
  )
}

function DeckIntelligenceCard() {
  const actions = [
    { label: 'Ask about a card',      href: '/ai',                        accent: 'gold' as const },
    { label: 'Cards for a strategy',  href: '/ai',                        accent: 'gold' as const },
    { label: 'Analyse a deck',        href: '/decks',                     accent: 'arcane' as const },
    { label: 'Build a deck',          href: '/decks/new',                 accent: 'arcane' as const },
  ]
  return (
    <div
      style={{
        background: 'var(--surface)',
        border: '1px solid var(--border)',
        borderRadius: 18,
        padding: 22,
        color: 'var(--text)',
        boxShadow: '0 8px 24px rgba(20,33,61,0.06), 0 1px 3px rgba(20,33,61,0.04)',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span className="gem gem-gold" aria-hidden />
          <span className="label-mono" style={{ color: 'var(--gold-600)' }}>MTGPrices AI</span>
        </div>
        <Link href="/ai" className="chip chip-gold" style={{ fontSize: 10.5, textDecoration: 'none' }}>
          Ask AI →
        </Link>
      </div>
      <h3 style={{ margin: 0, fontSize: 20, lineHeight: 1.25 }}>Ask about cards, prices and decks.</h3>
      <p style={{ marginTop: 8, color: 'var(--text-muted)', fontSize: 13.5, lineHeight: 1.55 }}>
        Grounded in the live MTGPrices catalogue. Format aware Deck Builder, capability based
        card search and a rules aware Test Your Deck flow. No invented cards.
      </p>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginTop: 14 }}>
        {actions.map((a) => (
          <Link
            key={a.label}
            href={a.href}
            style={{
              display: 'flex', alignItems: 'center', gap: 8,
              padding: '10px 12px', borderRadius: 10,
              background: a.accent === 'gold' ? 'var(--accent-soft)' : 'var(--primary-soft)',
              color: a.accent === 'gold' ? 'var(--gold-600)' : 'var(--primary-strong)',
              border: `1px solid ${a.accent === 'gold' ? 'var(--accent-border)' : 'var(--primary-border)'}`,
              fontSize: 13, fontWeight: 700, textDecoration: 'none',
            }}
          >
            <span aria-hidden style={{ fontSize: 14 }}>{a.accent === 'gold' ? '✦' : '◆'}</span>
            {a.label}
          </Link>
        ))}
      </div>
    </div>
  )
}

function MarketPulseCard({
  mover, counts,
}: {
  mover: MoverCard | null
  counts: { pricedFinishes: number; printings: number }
}) {
  return (
    <div
      style={{
        background: 'var(--surface)',
        border: '1px solid var(--border)',
        borderRadius: 18,
        padding: 22,
        color: 'var(--text)',
        boxShadow: '0 8px 24px rgba(20,33,61,0.06), 0 1px 3px rgba(20,33,61,0.04)',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span className="gem" aria-hidden />
          <span className="label-mono" style={{ color: 'var(--primary-strong)' }}>Market Pulse</span>
        </div>
        <span className="chip chip-arcane" style={{ fontSize: 10.5 }}>USD paper, TCGplayer</span>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 14 }}>
        <MiniStat label="Printings" value={formatBig(counts.printings)} />
        <MiniStat label="Priced finishes" value={formatBig(counts.pricedFinishes)} />
      </div>
      {mover ? (
        <Link
          href={mover.card_href}
          style={{
            display: 'flex', alignItems: 'center', gap: 12,
            padding: '12px 12px', borderRadius: 12,
            background: 'var(--bg-light)', border: '1px solid var(--border)',
            textDecoration: 'none', color: 'var(--text)',
          }}
        >
          {mover.image_uri_small ? (
            /* eslint-disable-next-line @next/next/no-img-element */
            <img src={mover.image_uri_small} alt="" style={{ width: 40, height: 56, borderRadius: 4, objectFit: 'cover' }} />
          ) : <span style={{ width: 40, height: 56, borderRadius: 4, background: 'var(--bg-strong)' }} />}
          <div style={{ flex: 1, minWidth: 0 }}>
            <div className="label-mono" style={{ color: 'var(--gold-600)' }}>Most active over {mover.period_days}d</div>
            <div style={{ fontWeight: 700, fontSize: 14, marginTop: 2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {mover.name}
            </div>
            <div style={{ color: 'var(--text-muted)', fontSize: 12 }}>{mover.set_name}</div>
          </div>
          <div style={{ textAlign: 'right', flexShrink: 0 }}>
            <div style={{ fontWeight: 800, fontSize: 15, fontFamily: 'ui-monospace, SFMono-Regular, monospace' }}>
              ${mover.latest_price.toFixed(2)}
            </div>
            <ChangeBadge pct={mover.pct_delta} />
          </div>
        </Link>
      ) : (
        <div style={{ padding: '12px 14px', borderRadius: 12, background: 'var(--bg-light)', border: '1px solid var(--border)', color: 'var(--text-muted)', fontSize: 13 }}>
          No qualifying movers on the TCGplayer USD paper retail basis right now.
        </div>
      )}
    </div>
  )
}

function LatestSetCard({ set }: { set: MtgSet }) {
  return (
    <Link
      href={`/set/${set.code}`}
      className="card-hover card-hover-gold"
      style={{
        display: 'flex', alignItems: 'center', gap: 14,
        padding: 18, borderRadius: 16,
        background: 'var(--surface)',
        border: '1px solid var(--border)',
        color: 'var(--text)', textDecoration: 'none',
        boxShadow: '0 6px 18px rgba(20,33,61,0.05), 0 1px 2px rgba(20,33,61,0.03)',
      }}
    >
      <div style={{
        width: 46, height: 46, borderRadius: 12,
        background: 'var(--accent-soft)', border: '1px solid var(--accent-border)',
        display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
        color: 'var(--gold-600)',
      }}>
        {set.icon_svg_uri ? (
          /* eslint-disable-next-line @next/next/no-img-element */
          <img src={set.icon_svg_uri} alt="" style={{ width: 24, height: 24 }} />
        ) : <span style={{ fontWeight: 800 }}>{set.code.toUpperCase()}</span>}
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div className="label-mono" style={{ color: 'var(--gold-600)' }}>Latest set</div>
        <div style={{ fontWeight: 700, fontSize: 16, marginTop: 2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', color: 'var(--text-strong)' }}>
          {set.name}
        </div>
        <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>
          {set.released_at ?? 'Release date unknown'}
          {set.card_count ? `, ${set.card_count.toLocaleString()} cards` : ''}
        </div>
      </div>
      <span aria-hidden style={{ fontSize: 20, color: 'var(--gold-500)' }}>›</span>
    </Link>
  )
}

function MiniStat({ label, value }: { label: string; value: string }) {
  return (
    <div style={{
      padding: '10px 12px', borderRadius: 10,
      background: 'var(--bg-light)', border: '1px solid var(--border)',
    }}>
      <div className="label-mono" style={{ marginBottom: 2 }}>{label}</div>
      <div style={{
        fontSize: 18, fontWeight: 800,
        fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
        color: 'var(--text-strong)',
      }}>{value}</div>
    </div>
  )
}

function ChangeBadge({ pct }: { pct: number }) {
  const up = pct >= 0
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center', gap: 4,
      fontSize: 12, fontWeight: 700,
      color: up ? 'var(--green)' : 'var(--red)',
      background: up ? 'var(--green-soft)' : 'var(--red-soft)',
      padding: '2px 8px', borderRadius: 999,
      fontFamily: 'ui-monospace, SFMono-Regular, monospace',
    }}>
      {up ? '▲' : '▼'} {(pct * 100).toFixed(1)}%
    </span>
  )
}

/* ═════════════════════════════════════════════════════════════════════
   MARKET PULSE (full section)
   ═════════════════════════════════════════════════════════════════════ */

function MarketPulseSection({ movers }: { movers: Awaited<ReturnType<typeof getMarketMovers>> }) {
  if (!movers) return null
  const topRiser = movers.risers[0]
  const topFaller = movers.fallers[0]
  const active = movers.active.slice(0, 3)

  return (
    <section id="market" className="ivory-band" style={{ padding: '64px 24px' }}>
      <div style={{ maxWidth: 1180, margin: '0 auto' }}>
        <SectionHeader
          eyebrow="Market pulse"
          title={<>{movers.windowDays} days in the MTG market.</>}
          subtitle={`Paper USD retail via ${movers.provider}. Only observations flagged clean are counted. Full movers with 7d, 30d and 90d windows on the Market page.`}
          rightLink={{ href: '/market', label: 'All movers →' }}
        />

        <div style={{ display: 'grid', gap: 16, gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', marginTop: 24 }}>
          {topRiser && <MoverTile kind="riser" mover={topRiser} />}
          {topFaller && <MoverTile kind="faller" mover={topFaller} />}
          {active.map((m) => (
            <MoverTile key={m.finish_id + 'a'} kind="active" mover={m} />
          ))}
        </div>

        <div style={{ marginTop: 20, fontSize: 12, color: 'var(--text-muted)' }}>
          Movers require at least three days of observations and a headline price of $2 or more to
          reduce noise. Not financial advice.
        </div>
      </div>
    </section>
  )
}

function MoverTile({ kind, mover }: { kind: 'riser' | 'faller' | 'active'; mover: MoverCard }) {
  const chipCls = kind === 'riser' ? 'chip-ivy' : kind === 'faller' ? 'chip-ember' : 'chip-arcane'
  const label = kind === 'riser' ? 'Top riser' : kind === 'faller' ? 'Top faller' : 'Most active'
  return (
    <Link
      href={mover.card_href}
      className="card-hover card-hover-gold"
      style={{
        display: 'block', padding: 18, borderRadius: 16,
        background: 'var(--surface)', border: '1px solid var(--border)',
        textDecoration: 'none', color: 'var(--text)',
        position: 'relative', overflow: 'hidden',
        boxShadow: '0 4px 14px rgba(20,33,61,0.04)',
      }}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 12 }}>
        <span className={`chip ${chipCls}`}>{label}</span>
        <span className="label-mono">{mover.period_days}d</span>
      </div>
      <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
        {mover.image_uri_small ? (
          /* eslint-disable-next-line @next/next/no-img-element */
          <img src={mover.image_uri_small} alt="" style={{ width: 56, height: 78, borderRadius: 6, objectFit: 'cover', boxShadow: 'var(--shadow-sm)' }} />
        ) : <span style={{ width: 56, height: 78, borderRadius: 6, background: 'var(--bg-strong)' }} />}
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontWeight: 700, fontSize: 15, lineHeight: 1.2 }}>{mover.name}</div>
          <div style={{ color: 'var(--text-muted)', fontSize: 12, marginTop: 2 }}>
            {mover.set_name}{mover.collector_number ? `, #${mover.collector_number}` : ''}
            {mover.finish !== 'nonfoil' ? `, ${mover.finish}` : ''}
          </div>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, marginTop: 8 }}>
            <span style={{ fontSize: 20, fontWeight: 800, fontFamily: 'ui-monospace, SFMono-Regular, monospace' }}>
              ${mover.latest_price.toFixed(2)}
            </span>
            <ChangeBadge pct={mover.pct_delta} />
          </div>
          <div style={{ color: 'var(--text-muted)', fontSize: 11, marginTop: 4 }}>
            from ${mover.start_price.toFixed(2)}. USD paper retail.
          </div>
        </div>
      </div>
    </Link>
  )
}

/* ═════════════════════════════════════════════════════════════════════
   START EXPLORING
   ═════════════════════════════════════════════════════════════════════ */

type ExploreCard = {
  eyebrow: string
  title: string
  body: string
  href: string
  cta: string
  accent: 'gold' | 'arcane' | 'ember' | 'ivy' | 'dusk'
  icon: string
}

const EXPLORE: ExploreCard[] = [
  {
    eyebrow: 'Cards & Sets',
    title: 'Explore every printing',
    body: 'Search the full Scryfall and MTGJSON catalogue. Oracle text, printings, finishes, price history, format legality and rulings.',
    href: '/cards/search',
    cta: 'Search cards',
    accent: 'gold',
    icon: '✦',
  },
  {
    eyebrow: 'Card Finder',
    title: 'Find cards for your deck',
    body: 'Capability based search across colour, mana value, format, price and keyword. Every result cites the constraint it satisfied.',
    href: '/card-finder',
    cta: 'Open Card Finder',
    accent: 'arcane',
    icon: '◆',
  },
  {
    eyebrow: 'Deck Builder',
    title: 'Build a deck',
    body: 'Manual, format aware, commander first. Colour identity, mana curve, capabilities and owned vs missing next to the list.',
    href: '/decks/new',
    cta: 'Start a deck',
    accent: 'ember',
    icon: '△',
  },
  {
    eyebrow: 'Test Your Deck',
    title: 'Test before you sleeve up',
    body: 'Opening hands, mulligan analysis, draw odds and mana feasibility. Understand a list before it hits the table.',
    href: '/decks',
    cta: 'Choose a deck to test',
    accent: 'ivy',
    icon: '✧',
  },
  {
    eyebrow: 'Collection',
    title: 'Track what you own',
    body: 'Import, quantities, finishes and the valuation basis of your choice. Feeds directly into Deck Builder and the shopping list.',
    href: '/collection',
    cta: 'Open Collection',
    accent: 'dusk',
    icon: '◈',
  },
  {
    eyebrow: 'Formats',
    title: 'Explore formats',
    body: 'Standard, Modern, Pioneer, Commander, Legacy, Pauper. Legality, ban or restricted lists and format specific card pools.',
    href: '/formats',
    cta: 'Browse formats',
    accent: 'arcane',
    icon: '▽',
  },
]

function StartExploringSection() {
  return (
    <section style={{ padding: '76px 24px', background: 'var(--surface)' }}>
      <div style={{ maxWidth: 1180, margin: '0 auto' }}>
        <SectionHeader
          eyebrow="Start exploring"
          title={<>Pick a path into the catalogue.</>}
          subtitle="Every entry point below is live. Nothing here is a placeholder."
        />
        <div style={{
          display: 'grid', gap: 18, marginTop: 28,
          gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))',
        }}>
          {EXPLORE.map((c) => (
            <ExploreCardTile key={c.title} card={c} />
          ))}
        </div>
      </div>
    </section>
  )
}

function ExploreCardTile({ card }: { card: ExploreCard }) {
  const accentToChip: Record<ExploreCard['accent'], string> = {
    gold: 'chip-gold',
    arcane: 'chip-arcane',
    ember: 'chip-ember',
    ivy: 'chip-ivy',
    dusk: 'chip-dusk',
  }
  const accentIconColor: Record<ExploreCard['accent'], string> = {
    gold: 'var(--gold-500)',
    arcane: 'var(--arcane-400)',
    ember: 'var(--ember-500)',
    ivy: 'var(--green)',
    dusk: '#4A3A55',
  }
  return (
    <Link
      href={card.href}
      className="card-hover card-hover-gold"
      style={{
        position: 'relative',
        display: 'flex', flexDirection: 'column',
        padding: 24, borderRadius: 18, minHeight: 210,
        background: 'var(--surface)',
        border: '1px solid var(--border)',
        color: 'var(--text)', textDecoration: 'none',
        overflow: 'hidden',
        boxShadow: '0 4px 14px rgba(20,33,61,0.04)',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 }}>
        <span className={`chip ${accentToChip[card.accent]}`}>{card.eyebrow}</span>
        <span aria-hidden style={{
          fontSize: 22, opacity: 0.85,
          color: accentIconColor[card.accent],
        }}>{card.icon}</span>
      </div>
      <div style={{ fontSize: 22, fontWeight: 700, lineHeight: 1.2, color: 'var(--text-strong)' }}>
        {card.title}
      </div>
      <p style={{ marginTop: 10, color: 'var(--text-muted)', fontSize: 14, lineHeight: 1.55, flex: 1 }}>
        {card.body}
      </p>
      <div style={{ marginTop: 14, display: 'inline-flex', alignItems: 'center', gap: 8, fontWeight: 700, fontSize: 13.5, color: 'var(--primary-strong)' }}>
        {card.cta} <span aria-hidden>→</span>
      </div>
    </Link>
  )
}

/* ═════════════════════════════════════════════════════════════════════
   PLAYERS + COLLECTORS
   ═════════════════════════════════════════════════════════════════════ */

function PlayersAndCollectorsSection() {
  return (
    <section style={{ padding: '76px 24px', background: 'var(--bg)' }}>
      <div style={{ maxWidth: 1180, margin: '0 auto' }}>
        <SectionHeader
          eyebrow="Built for both"
          title={<>For collectors <span style={{ color: 'var(--text-muted)', fontWeight: 500 }}>and</span> for players.</>}
          subtitle="Half of MTG is the object. Half is the game. MTGPrices is built for both, and the same catalogue powers your collection and your deck."
        />

        <div className="split-grid" style={{ display: 'grid', gap: 22, marginTop: 32 }}>
          <div style={{
            padding: 30, borderRadius: 22,
            background: 'var(--surface)',
            border: '1px solid var(--border)',
            position: 'relative', overflow: 'hidden',
            boxShadow: '0 6px 18px rgba(20,33,61,0.05)',
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 14 }}>
              <span className="gem gem-gold" aria-hidden />
              <span className="label-mono" style={{ color: 'var(--gold-600)' }}>For Collectors</span>
            </div>
            <h3 className="display" style={{ margin: 0, fontSize: 30, lineHeight: 1.15, color: 'var(--text-strong)' }}>
              Every printing, every finish, every history.
            </h3>
            <ul style={{ listStyle: 'none', padding: 0, margin: '20px 0 0', display: 'grid', gap: 10 }}>
              {[
                'Live paper and digital pricing from TCGplayer, Card Kingdom, Cardmarket, ManaPool and Cardhoarder',
                '90 day price history and per printing charts',
                'Every English printing, every finish (nonfoil, foil, etched)',
                'Collection with currency aware valuation and Reserved List badges',
                'Cheapest printing lookup when you want the game piece, not the collector piece',
              ].map((line) => <FeatureLine key={line} text={line} kind="gold" />)}
            </ul>
            <div style={{ display: 'flex', gap: 10, marginTop: 24, flexWrap: 'wrap' }}>
              <Link href="/collection" className="btn btn-gold btn-sm">My Collection</Link>
              <Link href="/card-finder?mode=collecting" className="btn btn-ghost btn-sm">Find for collecting</Link>
            </div>
          </div>

          <div style={{
            padding: 30, borderRadius: 22,
            background: 'var(--surface)',
            border: '1px solid var(--border)',
            position: 'relative', overflow: 'hidden',
            boxShadow: '0 6px 18px rgba(20,33,61,0.05)',
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 14 }}>
              <span className="gem" aria-hidden />
              <span className="label-mono" style={{ color: 'var(--primary-strong)' }}>For Players</span>
            </div>
            <h3 className="display" style={{ margin: 0, fontSize: 30, lineHeight: 1.15, color: 'var(--text-strong)' }}>
              Deckbuilding grounded in real rules.
            </h3>
            <ul style={{ listStyle: 'none', padding: 0, margin: '20px 0 0', display: 'grid', gap: 10 }}>
              {[
                'Format aware Deck Builder with Commander colour identity, curve and capability mix',
                'Card Finder searches by what a card does, not just its name',
                'Oracle text, rulings and legality on every card page',
                'Test Your Deck with opening hands, mulligans, draw odds and mana feasibility',
                'AI deck intelligence retrieval grounded on the live database, no invented cards',
              ].map((line) => <FeatureLine key={line} text={line} kind="arcane" />)}
            </ul>
            <div style={{ display: 'flex', gap: 10, marginTop: 24, flexWrap: 'wrap' }}>
              <Link href="/decks" className="btn btn-primary btn-sm">My Decks</Link>
              <Link href="/card-finder?mode=play" className="btn btn-ghost btn-sm">Find for play</Link>
            </div>
          </div>
        </div>
      </div>
      <style>{`
        @media (min-width: 900px) { .split-grid { grid-template-columns: 1fr 1fr; } }
      `}</style>
    </section>
  )
}

function FeatureLine({ text, kind }: { text: string; kind: 'gold' | 'arcane' }) {
  return (
    <li style={{ display: 'flex', gap: 10, alignItems: 'flex-start', fontSize: 14, lineHeight: 1.5, color: 'var(--text)' }}>
      <span
        aria-hidden
        className={kind === 'gold' ? 'gem gem-gold' : 'gem'}
        style={{ marginTop: 6, flexShrink: 0 }}
      />
      <span>{text}</span>
    </li>
  )
}

/* ═════════════════════════════════════════════════════════════════════
   DECK LAB
   ═════════════════════════════════════════════════════════════════════ */

function DeckLabSection() {
  const steps = [
    { n: 'I',   title: 'Find',    body: 'Card Finder plus capabilities. Search by what a card does.', href: '/card-finder?mode=play' },
    { n: 'II',  title: 'Build',   body: 'Format aware Deck Builder. Curve, colour identity, capability breakdown.', href: '/decks/new' },
    { n: 'III', title: 'Analyse', body: 'Owned vs missing, deck value, capability gaps.', href: '/decks' },
    { n: 'IV',  title: 'Test',    body: 'Opening hands, mulligans, draw odds and mana feasibility.', href: '/decks' },
    { n: 'V',   title: 'Complete', body: 'Cheapest missing printings from real market prices.', href: '/collection' },
  ]
  return (
    <section className="feature-shell" style={{ padding: '80px 24px', position: 'relative' }}>
      <div className="spark-field" aria-hidden />
      <div style={{ maxWidth: 1180, margin: '0 auto', position: 'relative' }}>
        <div style={{ textAlign: 'center', maxWidth: 720, margin: '0 auto 40px' }}>
          <div className="label-mono" style={{ color: 'var(--gold-600)', marginBottom: 10 }}>Deck Lab</div>
          <h2 className="display" style={{ margin: 0, fontSize: 'clamp(30px, 3.4vw, 44px)', color: 'var(--text-strong)', lineHeight: 1.15 }}>
            Take a deck from idea to tested list.
          </h2>
          <p style={{ marginTop: 12, color: 'var(--text-muted)', fontSize: 16, lineHeight: 1.6 }}>
            Every stage is a real product surface, not marketing. Follow the arc, or jump straight
            to any step.
          </p>
        </div>

        <div className="lab-grid" style={{ display: 'grid', gap: 14 }}>
          {steps.map((s, i) => (
            <Link
              key={s.n}
              href={s.href}
              className="card-hover card-hover-gold"
              style={{
                position: 'relative',
                display: 'flex', flexDirection: 'column',
                padding: 24, borderRadius: 16,
                background: 'var(--surface)',
                border: '1px solid var(--border)',
                color: 'var(--text)', textDecoration: 'none',
                overflow: 'hidden', minHeight: 180,
                boxShadow: '0 4px 14px rgba(20,33,61,0.04)',
              }}
            >
              <div className="display" style={{
                fontSize: 34, color: 'var(--gold-500)', lineHeight: 1, marginBottom: 12,
              }}>{s.n}</div>
              <div style={{ fontSize: 18, fontWeight: 700, color: 'var(--text-strong)' }}>{s.title}</div>
              <div style={{ marginTop: 8, fontSize: 13.5, lineHeight: 1.55, color: 'var(--text-muted)', flex: 1 }}>{s.body}</div>
              <div style={{ marginTop: 14, display: 'inline-flex', alignItems: 'center', gap: 8, fontSize: 12.5, fontWeight: 700, color: 'var(--gold-600)' }}>
                Open <span aria-hidden>›</span>
              </div>
              {i < steps.length - 1 && (
                <div
                  aria-hidden
                  className="lab-arrow"
                  style={{
                    position: 'absolute',
                    right: -14, top: '50%', transform: 'translateY(-50%)',
                    width: 28, height: 28,
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    color: 'var(--gold-400)', fontSize: 22, opacity: 0.7,
                  }}
                >›</div>
              )}
            </Link>
          ))}
        </div>
      </div>
      <style>{`
        .lab-grid { grid-template-columns: 1fr; }
        @media (min-width: 720px) {
          .lab-grid { grid-template-columns: repeat(2, 1fr); }
        }
        @media (min-width: 1080px) {
          .lab-grid { grid-template-columns: repeat(5, 1fr); }
        }
        @media (max-width: 1079px) {
          .lab-arrow { display: none !important; }
        }
      `}</style>
    </section>
  )
}

/* ═════════════════════════════════════════════════════════════════════
   FORMATS
   ═════════════════════════════════════════════════════════════════════ */

function FormatsSection({ formats }: { formats: typeof FORMATS }) {
  return (
    <section style={{ padding: '76px 24px', background: 'var(--surface)' }}>
      <div style={{ maxWidth: 1180, margin: '0 auto' }}>
        <SectionHeader
          eyebrow="Formats"
          title={<>Every legality, every ban list.</>}
          subtitle="Standard through Legacy, Commander through Pauper. Format pages surface legality, bans and card pools."
          rightLink={{ href: '/formats', label: 'All formats →' }}
        />
        <div style={{
          display: 'grid', gap: 12, marginTop: 24,
          gridTemplateColumns: 'repeat(auto-fill, minmax(210px, 1fr))',
        }}>
          {formats.map((f) => (
            <Link
              key={f.key}
              href={`/formats/${f.key}`}
              className="card-hover card-hover-gold"
              style={{
                display: 'flex', flexDirection: 'column',
                padding: 18, borderRadius: 14,
                background: 'var(--surface)', border: '1px solid var(--border)',
                textDecoration: 'none', color: 'var(--text)', minHeight: 120,
                boxShadow: '0 3px 10px rgba(20,33,61,0.03)',
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
                <span className="gem" aria-hidden style={{
                  background: groupToGem(f.group),
                }} />
                <span className="label-mono" style={{ color: 'var(--text-muted)' }}>{f.group}</span>
              </div>
              <div style={{ fontSize: 16, fontWeight: 700, color: 'var(--text-strong)' }}>{f.label}</div>
              <div style={{ marginTop: 6, fontSize: 12.5, color: 'var(--text-muted)', lineHeight: 1.5 }}>{f.blurb}</div>
            </Link>
          ))}
        </div>
      </div>
    </section>
  )
}

function groupToGem(group: string): string {
  switch (group) {
    case 'Primary': return 'linear-gradient(135deg, var(--arcane-200), var(--arcane-500))'
    case 'Eternal': return 'linear-gradient(135deg, #C7B394, var(--gold-500))'
    case 'Casual':  return 'linear-gradient(135deg, #F9B79A, var(--ember-500))'
    case 'Digital': return 'linear-gradient(135deg, #B8E1C6, var(--green))'
    default:        return 'linear-gradient(135deg, #D6C8A6, #7A6947)'
  }
}

/* ═════════════════════════════════════════════════════════════════════
   RECENT SETS
   ═════════════════════════════════════════════════════════════════════ */

function RecentSetsSection({ sets }: { sets: MtgSet[] }) {
  if (!sets.length) return null
  return (
    <section style={{ padding: '76px 24px', background: 'var(--bg)' }}>
      <div style={{ maxWidth: 1180, margin: '0 auto' }}>
        <SectionHeader
          eyebrow="Sets"
          title={<>Recently released.</>}
          subtitle="Full set catalogue with printings, prices and cards."
          rightLink={{ href: '/browse', label: 'All sets →' }}
        />
        <div style={{
          display: 'grid', gap: 14, marginTop: 24,
          gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))',
        }}>
          {sets.map((set) => (
            <Link
              key={set.id}
              href={`/set/${set.code}`}
              className="card-hover card-hover-gold"
              style={{
                display: 'block', background: 'var(--surface)',
                border: '1px solid var(--border)', borderRadius: 16,
                padding: 20, textDecoration: 'none', color: 'var(--text)',
                boxShadow: '0 4px 14px rgba(20,33,61,0.04)',
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                {set.icon_svg_uri ? (
                  /* eslint-disable-next-line @next/next/no-img-element */
                  <img src={set.icon_svg_uri} alt="" aria-hidden style={{ width: 26, height: 26, opacity: 0.85 }} />
                ) : (
                  <span style={{ width: 26, height: 26, borderRadius: 6, background: 'var(--bg-light)', border: '1px solid var(--border)' }} />
                )}
                <div className="label-mono">{set.code}</div>
              </div>
              <div style={{ fontSize: 15, fontWeight: 700, marginTop: 12, lineHeight: 1.25, color: 'var(--text-strong)' }}>{set.name}</div>
              <div style={{ color: 'var(--text-muted)', fontSize: 12, marginTop: 6 }}>
                {set.released_at ?? 'Release date unknown'}
                {set.card_count ? <>, {set.card_count.toLocaleString()} cards</> : null}
              </div>
            </Link>
          ))}
        </div>
      </div>
    </section>
  )
}

/* ═════════════════════════════════════════════════════════════════════
   FINAL CTA
   ═════════════════════════════════════════════════════════════════════ */

function FinalCtaSection() {
  return (
    <section style={{ padding: '80px 24px 100px', background: 'var(--surface)' }}>
      <div
        style={{
          position: 'relative',
          maxWidth: 1180, margin: '0 auto',
          padding: '52px 32px', borderRadius: 24,
          background:
            'radial-gradient(80% 100% at 20% 20%, rgba(232,169,75,0.14), rgba(232,169,75,0) 60%),' +
            'radial-gradient(60% 90% at 90% 90%, rgba(35,95,174,0.12), rgba(35,95,174,0) 60%),' +
            'linear-gradient(180deg, #FEFAEE 0%, var(--bg-light) 100%)',
          border: '1px solid var(--border)',
          textAlign: 'center', overflow: 'hidden',
        }}
      >
        <div style={{ margin: '0 auto', maxWidth: 720 }}>
          <Image
            src="/favicon.png"
            alt=""
            aria-hidden
            width={64}
            height={64}
            style={{ width: 64, height: 64, margin: '0 auto 20px', display: 'block', filter: 'drop-shadow(0 6px 18px rgba(20,33,61,0.18))' }}
          />
          <h2 className="display" style={{ margin: 0, fontSize: 'clamp(28px, 3.4vw, 40px)', color: 'var(--text-strong)', lineHeight: 1.15 }}>
            One home for MTG pricing, decks and rules.
          </h2>
          <p style={{ marginTop: 14, color: 'var(--text-muted)', fontSize: 16, lineHeight: 1.6 }}>
            Free to browse, no login required. Sign in to keep decks, track a collection and
            personalise Deck Builder.
          </p>
          <div style={{ display: 'flex', gap: 12, justifyContent: 'center', marginTop: 22, flexWrap: 'wrap' }}>
            <Link href="/cards/search" className="btn btn-gold btn-lg">Browse cards</Link>
            <Link href="/decks/new" className="btn btn-primary btn-lg">Build a deck</Link>
          </div>
        </div>
      </div>
    </section>
  )
}

/* ═════════════════════════════════════════════════════════════════════
   Shared bits
   ═════════════════════════════════════════════════════════════════════ */

function SectionHeader({
  eyebrow, title, subtitle, rightLink,
}: {
  eyebrow?: string
  title: React.ReactNode
  subtitle?: string
  rightLink?: { href: string; label: string }
}) {
  return (
    <div style={{
      display: 'flex', gap: 20, alignItems: 'flex-end',
      flexWrap: 'wrap', justifyContent: 'space-between',
    }}>
      <div style={{ maxWidth: 720 }}>
        {eyebrow && (
          <div className="label-mono" style={{ marginBottom: 10, color: 'var(--gold-600)' }}>
            <span className="gem gem-gold" aria-hidden style={{ marginRight: 8, transform: 'translateY(1px) rotate(45deg)' }} />
            {eyebrow}
          </div>
        )}
        <h2 className="display" style={{ margin: 0, fontSize: 'clamp(28px, 3.2vw, 40px)', color: 'var(--text-strong)', lineHeight: 1.15 }}>
          {title}
        </h2>
        {subtitle && (
          <p style={{ marginTop: 10, color: 'var(--text-muted)', fontSize: 15.5, lineHeight: 1.6, maxWidth: 640 }}>
            {subtitle}
          </p>
        )}
      </div>
      {rightLink && (
        <Link href={rightLink.href} style={{
          fontSize: 13.5, fontWeight: 700, color: 'var(--primary-strong)',
          padding: '8px 12px', borderRadius: 8,
          background: 'var(--primary-soft)', border: '1px solid var(--primary-border)',
        }}>{rightLink.label}</Link>
      )}
    </div>
  )
}

function formatBig(n: number): string {
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(n >= 10_000_000 ? 0 : 1) + 'M'
  if (n >= 1_000)     return (n / 1_000).toFixed(n >= 10_000 ? 0 : 1) + 'k'
  return n.toLocaleString()
}
