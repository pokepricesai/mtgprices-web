// app/page.tsx — MTGPrices branded homepage.
// Communicates the two-audience product (Collect + Play) with a strong
// arcane brand hero, live product previews (Deck Intelligence + Market
// Pulse), and real data modules (latest set, top movers, formats).
// Every link resolves to a live route; anything not yet shipped is
// omitted rather than presented as a dead link.

import Link from 'next/link'
import Image from 'next/image'
import { listSets, type MtgSet } from '@/lib/mtg/sets'
import { getSupabaseServiceClient } from '@/lib/supabaseService'
import { getMarketMovers, type MoverCard } from '@/lib/mtg/movers'
import HomeSearch from '@/components/HomeSearch'
import { FORMATS } from '@/lib/mtg/formats.data'

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
  const [counts, recentSets, movers] = await Promise.all([
    getCatalogueCounts(),
    listSets({ limit: 6 }),
    getMarketMovers(4),
  ])

  const latestSet = recentSets[0] ?? null
  const primaryFormats = FORMATS
    .filter((f) => f.group === 'Primary' || f.group === 'Casual' || f.group === 'Eternal')
    .slice(0, 8)

  return (
    <>
      <Hero counts={counts} latestSet={latestSet} movers={movers} />
      <MarketPulseSection movers={movers} />
      <StartExploringSection />
      <PlayersAndCollectorsSection />
      <DeckLabSection />
      <FormatsSection formats={primaryFormats} />
      <RecentSetsSection sets={recentSets} />
      <FinalCtaSection />
    </>
  )
}

/* ═══════════════════════════════════════════════════════════════════════
   HERO
   ═══════════════════════════════════════════════════════════════════════ */

function Hero({
  counts, latestSet, movers,
}: {
  counts: { printings: number; oracles: number; sets: number; pricedFinishes: number }
  latestSet: MtgSet | null
  movers: Awaited<ReturnType<typeof getMarketMovers>>
}) {
  const heroPulse = movers?.active[0] ?? movers?.risers[0] ?? null

  return (
    <section className="arcane-band" style={{ padding: '60px 24px 72px', position: 'relative' }}>
      {/* Decorative starfield */}
      <div className="spark-field" aria-hidden />
      {/* Faint card silhouettes anchoring the corners */}
      <div aria-hidden style={{ position: 'absolute', top: 40, left: -60, color: '#F1E9D2', transform: 'rotate(-14deg)' }}>
        <span className="card-silhouette" style={{ position: 'relative' }} />
      </div>
      <div aria-hidden style={{ position: 'absolute', top: 90, left: 80, color: '#F1E9D2', transform: 'rotate(6deg)', opacity: 0.7 }}>
        <span className="card-silhouette" style={{ position: 'relative', width: 90, height: 130 }} />
      </div>
      <div aria-hidden style={{ position: 'absolute', bottom: -40, right: -50, color: '#F1E9D2', transform: 'rotate(12deg)' }}>
        <span className="card-silhouette" style={{ position: 'relative' }} />
      </div>

      <div style={{ maxWidth: 1180, margin: '0 auto', position: 'relative' }}>
        <div className="hero-grid" style={{ display: 'grid', gap: 36, alignItems: 'center' }}>
          {/* Left: brand + copy + search + chips */}
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 24 }}>
              <span className="chip chip-gold" style={{ background: 'rgba(232,169,75,0.14)', color: '#F5E4B4', borderColor: 'rgba(232,169,75,0.35)' }}>
                <span className="gem gem-gold" aria-hidden />
                Public preview · v1
              </span>
            </div>

            <h1
              className="display"
              style={{
                fontSize: 'clamp(38px, 5.4vw, 68px)',
                margin: 0,
                lineHeight: 1.02,
                fontWeight: 700,
                color: '#FBF3DE',
                letterSpacing: '-0.02em',
              }}
            >
              Know every card.
              <br />
              <span className="gold-text">Build better decks.</span>
            </h1>

            <p style={{
              color: '#C9D3E5', fontSize: 18, lineHeight: 1.55, marginTop: 22,
              maxWidth: 620,
            }}>
              Live pricing, printings and rules for {counts.oracles.toLocaleString()} Magic cards
              across {counts.sets.toLocaleString()} sets — paired with a format-aware Deck Builder,
              Card Finder and Test Your Deck. One place to find it, price it, build it, test it.
            </p>

            <div style={{ marginTop: 26, maxWidth: 680 }}>
              <HomeSearch placeholder="Search cards, sets, types, abilities…" />
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
                    fontSize: 13, fontWeight: 600, padding: '7px 14px',
                    borderRadius: 999,
                    background: 'rgba(255,255,255,0.06)',
                    color: '#F1E9D2',
                    border: '1px solid rgba(255,255,255,0.10)',
                    textDecoration: 'none',
                    transition: 'background 150ms ease, border-color 150ms ease',
                  }}
                >{q.label}</Link>
              ))}
            </div>

            {/* Trust chips */}
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, marginTop: 22 }}>
              <TrustChip label="Live pricing" />
              <TrustChip label={`${formatBig(counts.printings)}+ printings`} />
              <TrustChip label="Every format legality" />
              <TrustChip label="Deck Builder + Test" />
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
      fontSize: 11.5, fontWeight: 700, padding: '5px 11px', borderRadius: 999,
      color: '#F1E9D2',
      background: 'rgba(232,169,75,0.10)',
      border: '1px solid rgba(232,169,75,0.28)',
      letterSpacing: '0.02em',
    }}>{label}</span>
  )
}

function DeckIntelligenceCard() {
  const actions = [
    { label: 'Build from a brief',    href: '/decks/new', accent: 'gold' as const },
    { label: 'Find replacements',     href: '/decks',     accent: 'arcane' as const },
    { label: 'Analyse a deck',        href: '/decks',     accent: 'arcane' as const },
    { label: 'Cards for a strategy',  href: '/card-finder?mode=play', accent: 'gold' as const },
  ]
  return (
    <div
      style={{
        background: 'linear-gradient(180deg, rgba(255,253,246,0.98) 0%, rgba(251,243,222,0.94) 100%)',
        border: '1px solid rgba(232,169,75,0.35)',
        borderRadius: 18,
        padding: 20,
        color: 'var(--text)',
        position: 'relative',
        boxShadow: 'var(--shadow-md)',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span className="gem gem-gold" aria-hidden />
          <span className="label-mono" style={{ color: 'var(--gold-600)' }}>Deck Intelligence</span>
        </div>
        <span className="chip chip-gold" style={{ fontSize: 10.5 }}>Preview</span>
      </div>
      <h3 style={{ margin: 0, fontSize: 20, lineHeight: 1.25 }}>Take a list from idea to tested deck.</h3>
      <p style={{ marginTop: 8, color: 'var(--text-muted)', fontSize: 13.5, lineHeight: 1.5 }}>
        Format-aware Deck Builder, capability-based card search and a rules-aware Test Your
        Deck flow — grounded in the live database, no invented cards.
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
        background: 'linear-gradient(180deg, rgba(255,253,246,0.98) 0%, rgba(244,238,222,0.94) 100%)',
        border: '1px solid var(--border-strong)',
        borderRadius: 18,
        padding: 20,
        color: 'var(--text)',
        position: 'relative',
        boxShadow: 'var(--shadow-md)',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span className="gem" aria-hidden />
          <span className="label-mono" style={{ color: 'var(--primary-strong)' }}>Market Pulse</span>
        </div>
        <span className="chip chip-arcane" style={{ fontSize: 10.5 }}>USD · Paper · TCGplayer</span>
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
            <div className="label-mono" style={{ color: 'var(--gold-600)' }}>Most active · {mover.period_days}d</div>
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
          Movers appear once we have 3+ days of comparable observations.
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
        padding: 16, borderRadius: 14,
        background: 'linear-gradient(135deg, rgba(20,33,61,0.86) 0%, rgba(10,30,63,0.86) 100%)',
        border: '1px solid rgba(232,169,75,0.35)',
        color: '#F6EED9', textDecoration: 'none',
      }}
    >
      <div style={{
        width: 46, height: 46, borderRadius: 12,
        background: 'rgba(232,169,75,0.18)', border: '1px solid rgba(232,169,75,0.35)',
        display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
      }}>
        {set.icon_svg_uri ? (
          /* eslint-disable-next-line @next/next/no-img-element */
          <img src={set.icon_svg_uri} alt="" style={{ width: 24, height: 24, filter: 'brightness(0) invert(0.9) sepia(0.5) saturate(4) hue-rotate(0deg)' }} />
        ) : <span style={{ color: '#E8A94B', fontWeight: 800 }}>{set.code.toUpperCase()}</span>}
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div className="label-mono" style={{ color: '#E8A94B' }}>Latest set</div>
        <div style={{ fontWeight: 700, fontSize: 16, marginTop: 2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {set.name}
        </div>
        <div style={{ fontSize: 12, color: '#B7C6DE' }}>
          {set.released_at ?? '—'}
          {set.card_count ? ` · ${set.card_count.toLocaleString()} cards` : ''}
        </div>
      </div>
      <span aria-hidden style={{ fontSize: 20, color: '#E8A94B' }}>›</span>
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

/* ═══════════════════════════════════════════════════════════════════════
   MARKET PULSE (full section)
   ═══════════════════════════════════════════════════════════════════════ */

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
          title={<>This week in the market</>}
          subtitle={`Paper USD retail via ${movers.provider}. ${movers.windowDays}-day window. Only observations flagged clean are counted.`}
        />

        <div style={{ display: 'grid', gap: 16, gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', marginTop: 24 }}>
          {topRiser && <MoverTile kind="riser" mover={topRiser} />}
          {topFaller && <MoverTile kind="faller" mover={topFaller} />}
          {active.map((m) => (
            <MoverTile key={m.finish_id + 'a'} kind="active" mover={m} />
          ))}
        </div>

        <div style={{ marginTop: 20, fontSize: 12, color: 'var(--text-muted)' }}>
          Movers require ≥ 3 days of observations and a headline price ≥ $2 to reduce noise.
          Not financial advice.
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
        display: 'block', padding: 16, borderRadius: 14,
        background: 'var(--surface)', border: '1px solid var(--border)',
        textDecoration: 'none', color: 'var(--text)',
        position: 'relative', overflow: 'hidden',
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
            {mover.set_name}{mover.collector_number ? ` · #${mover.collector_number}` : ''}
            {mover.finish !== 'nonfoil' ? ` · ${mover.finish}` : ''}
          </div>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, marginTop: 8 }}>
            <span style={{ fontSize: 20, fontWeight: 800, fontFamily: 'ui-monospace, SFMono-Regular, monospace' }}>
              ${mover.latest_price.toFixed(2)}
            </span>
            <ChangeBadge pct={mover.pct_delta} />
          </div>
          <div style={{ color: 'var(--text-muted)', fontSize: 11, marginTop: 4 }}>
            from ${mover.start_price.toFixed(2)} · USD paper retail
          </div>
        </div>
      </div>
    </Link>
  )
}

/* ═══════════════════════════════════════════════════════════════════════
   START EXPLORING
   ═══════════════════════════════════════════════════════════════════════ */

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
    body: 'Search the full Scryfall + MTGJSON catalogue — Oracle text, printings, finishes, price history, format legality and rulings.',
    href: '/cards/search',
    cta: 'Search cards',
    accent: 'gold',
    icon: '✦',
  },
  {
    eyebrow: 'Card Finder',
    title: 'Find cards for your deck',
    body: 'Capability-based search — colour, mana value, format, price, keyword. Every result cites the constraint it satisfied.',
    href: '/card-finder',
    cta: 'Open Card Finder',
    accent: 'arcane',
    icon: '◆',
  },
  {
    eyebrow: 'Deck Builder',
    title: 'Build a deck',
    body: 'Manual, format-aware, commander-first. Colour identity, mana curve, capabilities and owned-vs-missing next to the list.',
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
    body: 'Import, quantities, finishes, valuation basis of your choice. Feeds directly into Deck Builder and the shopping list.',
    href: '/collection',
    cta: 'Open Collection',
    accent: 'dusk',
    icon: '◈',
  },
  {
    eyebrow: 'Formats',
    title: 'Explore formats',
    body: 'Standard, Modern, Pioneer, Commander, Legacy, Pauper — legality, ban / restricted lists, and format-specific card pools.',
    href: '/formats',
    cta: 'Browse formats',
    accent: 'arcane',
    icon: '▽',
  },
]

function StartExploringSection() {
  return (
    <section style={{ padding: '72px 24px', background: 'var(--bg)' }}>
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
  const accentToGlow: Record<ExploreCard['accent'], string> = {
    gold: 'linear-gradient(135deg, rgba(232,169,75,0.10), rgba(232,169,75,0) 65%)',
    arcane: 'linear-gradient(135deg, rgba(35,95,174,0.10), rgba(35,95,174,0) 65%)',
    ember: 'linear-gradient(135deg, rgba(232,90,44,0.10), rgba(232,90,44,0) 65%)',
    ivy: 'linear-gradient(135deg, rgba(42,132,89,0.10), rgba(42,132,89,0) 65%)',
    dusk: 'linear-gradient(135deg, rgba(74,58,85,0.12), rgba(74,58,85,0) 65%)',
  }
  return (
    <Link
      href={card.href}
      className="card-hover rune-tl"
      style={{
        position: 'relative',
        display: 'flex', flexDirection: 'column',
        padding: 22, borderRadius: 16, minHeight: 200,
        background: `${accentToGlow[card.accent]}, var(--surface)`,
        border: '1px solid var(--border)',
        color: 'var(--text)', textDecoration: 'none',
        overflow: 'hidden',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 }}>
        <span className={`chip ${accentToChip[card.accent]}`}>{card.eyebrow}</span>
        <span aria-hidden style={{
          fontSize: 22, opacity: 0.85,
          color: card.accent === 'gold' ? 'var(--gold-500)'
            : card.accent === 'arcane' ? 'var(--arcane-400)'
            : card.accent === 'ember' ? 'var(--ember-500)'
            : card.accent === 'ivy' ? 'var(--green)'
            : '#4A3A55',
        }}>{card.icon}</span>
      </div>
      <div style={{ fontSize: 22, fontWeight: 700, lineHeight: 1.15, color: 'var(--text-strong)' }}>
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

/* ═══════════════════════════════════════════════════════════════════════
   PLAYERS + COLLECTORS
   ═══════════════════════════════════════════════════════════════════════ */

function PlayersAndCollectorsSection() {
  return (
    <section style={{ padding: '72px 24px', background: 'var(--surface)' }}>
      <div style={{ maxWidth: 1180, margin: '0 auto' }}>
        <SectionHeader
          eyebrow="Built for both"
          title={<>For collectors <span style={{ color: 'var(--text-muted)', fontWeight: 500 }}>and</span> for players.</>}
          subtitle="Half of MTG is the object. Half is the game. MTGPrices is designed for both — the same catalogue powers your collection and your deck."
        />

        <div className="split-grid" style={{ display: 'grid', gap: 22, marginTop: 32 }}>
          <div style={{
            padding: 28, borderRadius: 20,
            background: 'linear-gradient(160deg, rgba(232,169,75,0.10) 0%, rgba(232,169,75,0) 55%), var(--bg-light)',
            border: '1px solid var(--accent-border)',
            position: 'relative', overflow: 'hidden',
          }} className="rune-br">
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 14 }}>
              <span className="gem gem-gold" aria-hidden />
              <span className="label-mono" style={{ color: 'var(--gold-600)' }}>For Collectors</span>
            </div>
            <h3 className="display" style={{ margin: 0, fontSize: 30, lineHeight: 1.1, color: 'var(--text-strong)' }}>
              Every printing, every finish, every history.
            </h3>
            <ul style={{ listStyle: 'none', padding: 0, margin: '20px 0 0', display: 'grid', gap: 10 }}>
              {[
                'Live paper + digital pricing from TCGplayer, Card Kingdom, Cardmarket, ManaPool and Cardhoarder',
                '90-day price history and per-printing charts',
                'Every English printing, every finish (nonfoil, foil, etched)',
                'Collection with currency-aware valuation and Reserved List badges',
                'Cheapest-printing lookup when you want the game piece, not the collector piece',
              ].map((line) => <FeatureLine key={line} text={line} kind="gold" />)}
            </ul>
            <div style={{ display: 'flex', gap: 10, marginTop: 24, flexWrap: 'wrap' }}>
              <Link href="/collection" className="btn btn-gold btn-sm">My Collection</Link>
              <Link href="/card-finder?mode=collecting" className="btn btn-ghost btn-sm">Find for collecting</Link>
            </div>
          </div>

          <div style={{
            padding: 28, borderRadius: 20,
            background: 'linear-gradient(160deg, rgba(35,95,174,0.10) 0%, rgba(35,95,174,0) 55%), var(--bg-light)',
            border: '1px solid var(--primary-border)',
            position: 'relative', overflow: 'hidden',
          }} className="rune-br">
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 14 }}>
              <span className="gem" aria-hidden />
              <span className="label-mono" style={{ color: 'var(--primary-strong)' }}>For Players</span>
            </div>
            <h3 className="display" style={{ margin: 0, fontSize: 30, lineHeight: 1.1, color: 'var(--text-strong)' }}>
              Deckbuilding grounded in real rules.
            </h3>
            <ul style={{ listStyle: 'none', padding: 0, margin: '20px 0 0', display: 'grid', gap: 10 }}>
              {[
                'Format-aware Deck Builder — Commander colour identity, curve, capability mix',
                'Card Finder searches by what a card does, not just its name',
                'Oracle text, rulings and legality on every card page',
                'Test Your Deck — opening hands, mulligans, draw odds, mana feasibility',
                'AI deck intelligence retrieval-grounded on the live database (no invented cards)',
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

/* ═══════════════════════════════════════════════════════════════════════
   DECK LAB
   ═══════════════════════════════════════════════════════════════════════ */

function DeckLabSection() {
  const steps = [
    { n: 'I',   title: 'Find',    body: 'Card Finder + capabilities. Search by what a card does.', href: '/card-finder?mode=play' },
    { n: 'II',  title: 'Build',   body: 'Format-aware Deck Builder. Curve, colour identity, capability breakdown.', href: '/decks/new' },
    { n: 'III', title: 'Analyse', body: 'Owned vs missing, deck value, capability gaps.', href: '/decks' },
    { n: 'IV',  title: 'Test',    body: 'Opening hands, mulligans, draw odds and mana feasibility.', href: '/decks' },
    { n: 'V',   title: 'Complete', body: 'Cheapest missing printings from real market prices.', href: '/collection' },
  ]
  return (
    <section className="arcane-band" style={{ padding: '80px 24px', position: 'relative' }}>
      <div className="spark-field" aria-hidden />
      <div style={{ maxWidth: 1180, margin: '0 auto', position: 'relative' }}>
        <div style={{ textAlign: 'center', maxWidth: 720, margin: '0 auto 40px' }}>
          <div className="label-mono" style={{ color: '#E8A94B', marginBottom: 10 }}>Deck Lab</div>
          <h2 className="display" style={{ margin: 0, fontSize: 'clamp(30px, 3.4vw, 44px)', color: '#FBF3DE', lineHeight: 1.1 }}>
            Take a deck from idea to tested list.
          </h2>
          <p style={{ marginTop: 12, color: '#C9D3E5', fontSize: 16, lineHeight: 1.55 }}>
            Every stage is a real product surface — not marketing. Follow the arc, or jump
            straight to any step.
          </p>
        </div>

        <div className="lab-grid" style={{ display: 'grid', gap: 14 }}>
          {steps.map((s, i) => (
            <Link
              key={s.n}
              href={s.href}
              className="card-hover"
              style={{
                position: 'relative',
                display: 'flex', flexDirection: 'column',
                padding: 22, borderRadius: 14,
                background: 'rgba(255,255,255,0.04)',
                border: '1px solid rgba(232,169,75,0.28)',
                color: '#F1E9D2', textDecoration: 'none',
                overflow: 'hidden', minHeight: 170,
              }}
            >
              <div className="display" style={{
                fontSize: 32, color: '#E8A94B', lineHeight: 1, marginBottom: 12,
                textShadow: '0 0 20px rgba(232,169,75,0.30)',
              }}>{s.n}</div>
              <div style={{ fontSize: 18, fontWeight: 700, color: '#FBF3DE' }}>{s.title}</div>
              <div style={{ marginTop: 8, fontSize: 13, lineHeight: 1.5, color: '#C9D3E5', flex: 1 }}>{s.body}</div>
              <div style={{ marginTop: 14, display: 'inline-flex', alignItems: 'center', gap: 8, fontSize: 12, fontWeight: 700, color: '#E8A94B' }}>
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
                    color: '#E8A94B', fontSize: 22, opacity: 0.55,
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

/* ═══════════════════════════════════════════════════════════════════════
   FORMATS
   ═══════════════════════════════════════════════════════════════════════ */

function FormatsSection({ formats }: { formats: typeof FORMATS }) {
  return (
    <section style={{ padding: '72px 24px', background: 'var(--bg)' }}>
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
                padding: 16, borderRadius: 12,
                background: 'var(--surface)', border: '1px solid var(--border)',
                textDecoration: 'none', color: 'var(--text)', minHeight: 110,
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
                <span className="gem" aria-hidden style={{
                  background: groupToGem(f.group),
                }} />
                <span className="label-mono" style={{ color: 'var(--text-muted)' }}>{f.group}</span>
              </div>
              <div style={{ fontSize: 16, fontWeight: 700, color: 'var(--text-strong)' }}>{f.label}</div>
              <div style={{ marginTop: 6, fontSize: 12, color: 'var(--text-muted)', lineHeight: 1.5 }}>{f.blurb}</div>
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

/* ═══════════════════════════════════════════════════════════════════════
   RECENT SETS
   ═══════════════════════════════════════════════════════════════════════ */

function RecentSetsSection({ sets }: { sets: MtgSet[] }) {
  if (!sets.length) return null
  return (
    <section style={{ padding: '72px 24px', background: 'var(--surface)' }}>
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
                display: 'block', background: 'var(--surface-raised)',
                border: '1px solid var(--border)', borderRadius: 14,
                padding: 18, textDecoration: 'none', color: 'var(--text)',
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
                {set.released_at ?? '—'}
                {set.card_count ? <> · {set.card_count.toLocaleString()} cards</> : null}
              </div>
            </Link>
          ))}
        </div>
      </div>
    </section>
  )
}

/* ═══════════════════════════════════════════════════════════════════════
   FINAL CTA
   ═══════════════════════════════════════════════════════════════════════ */

function FinalCtaSection() {
  return (
    <section style={{ padding: '80px 24px 100px' }}>
      <div
        className="rune-tl rune-br"
        style={{
          position: 'relative',
          maxWidth: 1180, margin: '0 auto',
          padding: '48px 32px', borderRadius: 24,
          background:
            'radial-gradient(80% 100% at 20% 20%, rgba(232,169,75,0.18), rgba(232,169,75,0) 60%),' +
            'radial-gradient(60% 90% at 90% 90%, rgba(35,95,174,0.18), rgba(35,95,174,0) 60%),' +
            'linear-gradient(180deg, var(--surface) 0%, var(--bg-light) 100%)',
          border: '1px solid var(--border-strong)',
          textAlign: 'center', overflow: 'hidden',
        }}
      >
        <div style={{ margin: '0 auto', maxWidth: 720 }}>
          <Image
            src="/favicon.png"
            alt=""
            aria-hidden
            width={72}
            height={72}
            style={{ width: 72, height: 72, margin: '0 auto 20px', display: 'block', filter: 'drop-shadow(0 6px 18px rgba(20,33,61,0.20))' }}
          />
          <h2 className="display" style={{ margin: 0, fontSize: 'clamp(28px, 3.4vw, 40px)', color: 'var(--text-strong)', lineHeight: 1.1 }}>
            One home for MTG pricing, decks and rules.
          </h2>
          <p style={{ marginTop: 14, color: 'var(--text-muted)', fontSize: 16, lineHeight: 1.55 }}>
            Free to browse — no login required. Sign in to keep decks, track a collection
            and personalise Deck Builder.
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

/* ═══════════════════════════════════════════════════════════════════════
   Shared bits
   ═══════════════════════════════════════════════════════════════════════ */

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
        <h2 className="display" style={{ margin: 0, fontSize: 'clamp(28px, 3.2vw, 40px)', color: 'var(--text-strong)', lineHeight: 1.1 }}>
          {title}
        </h2>
        {subtitle && (
          <p style={{ marginTop: 10, color: 'var(--text-muted)', fontSize: 15.5, lineHeight: 1.55, maxWidth: 640 }}>
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
