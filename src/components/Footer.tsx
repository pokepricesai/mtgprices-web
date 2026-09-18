import Link from 'next/link'
import Image from 'next/image'

// Site footer. Uses the favicon monogram as a subtle brand mark, groups
// live routes by product area, and preserves the required Scryfall /
// MTGJSON / WotC attribution.

const cardsLinks = [
  { label: 'Search cards', href: '/cards/search' },
  { label: 'Browse sets',  href: '/browse' },
  { label: 'Card Finder',  href: '/card-finder' },
]

const decksLinks = [
  { label: 'My Decks',       href: '/decks' },
  { label: 'New deck',       href: '/decks/new' },
  { label: 'Test Your Deck', href: '/decks' },
]

const toolsLinks = [
  { label: 'Formats',           href: '/formats' },
  { label: 'My Collection',     href: '/collection' },
  { label: 'Import collection', href: '/collection/import' },
]

const companyLinks = [
  { label: 'Contact', href: '/contact' },
  { label: 'Privacy', href: '/privacy' },
  { label: 'Terms',   href: '/terms' },
]

export default function Footer() {
  return (
    <footer
      style={{
        background: 'linear-gradient(180deg, var(--surface) 0%, var(--bg-light) 100%)',
        borderTop: '1px solid var(--border-light)',
        padding: '48px 24px 32px',
        marginTop: 60,
        position: 'relative',
        overflow: 'hidden',
      }}
    >
      {/* Subtle gilt hairline at top */}
      <div
        aria-hidden
        style={{
          position: 'absolute', top: 0, left: 0, right: 0, height: 2,
          background: 'linear-gradient(90deg, transparent 0%, rgba(232,169,75,0.35) 20%, rgba(232,169,75,0.35) 80%, transparent 100%)',
        }}
      />

      <div style={{ maxWidth: 1180, margin: '0 auto', position: 'relative' }}>
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))',
            gap: 32,
            marginBottom: 36,
          }}
        >
          <div style={{ maxWidth: 300 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 14 }}>
              <Image
                src="/favicon.png"
                alt=""
                aria-hidden
                width={36}
                height={36}
                style={{ width: 36, height: 36, filter: 'drop-shadow(0 2px 4px rgba(20,33,61,0.12))' }}
              />
              <div style={{ display: 'flex', flexDirection: 'column' }}>
                <span style={{
                  fontFamily: "'Outfit', sans-serif",
                  fontWeight: 800, fontSize: 18, color: 'var(--text-strong)',
                  letterSpacing: '-0.02em', lineHeight: 1,
                }}>
                  MTGPrices<span style={{
                    color: 'var(--gold-500)', fontSize: 11, marginLeft: 4,
                    fontFamily: 'ui-monospace, SFMono-Regular, monospace',
                    letterSpacing: '0.15em',
                  }}>.io</span>
                </span>
                <span className="label-mono" style={{ marginTop: 4 }}>Prices · Decks · Rules</span>
              </div>
            </div>
            <p
              style={{
                color: 'var(--text-muted)',
                fontSize: 13,
                lineHeight: 1.6,
                margin: 0,
              }}
            >
              Live Magic: The Gathering card prices, printings and history — paired with a
              format-aware Deck Builder, Card Finder, Test Your Deck and Collection tools.
            </p>
          </div>

          <FooterColumn title="Cards"   links={cardsLinks} />
          <FooterColumn title="Decks"   links={decksLinks} />
          <FooterColumn title="Tools"   links={toolsLinks} />
          <FooterColumn title="Company" links={companyLinks} />
        </div>

        <div className="gilt-divider" aria-hidden />

        <div
          style={{
            paddingTop: 24, marginTop: 4,
            display: 'flex', justifyContent: 'space-between', alignItems: 'center',
            gap: 16, flexWrap: 'wrap',
          }}
        >
          <p
            style={{
              color: 'var(--text-muted)',
              fontSize: 11.5,
              margin: 0,
              maxWidth: 780,
              lineHeight: 1.65,
            }}
          >
            MTG, Magic: The Gathering and card images © Wizards of the Coast. This site is unofficial
            and not affiliated with, endorsed, sponsored, or specifically approved by Wizards of the
            Coast. Catalogue and imagery via Scryfall; card and price data via MTGJSON;
            retail price feeds attributed to their respective providers (TCGplayer, Card Kingdom,
            Cardmarket, ManaPool, Cardhoarder). Informational only — not financial advice.
          </p>
          <span style={{ color: 'var(--text-muted)', fontSize: 11 }}>
            © {new Date().getFullYear()} MTGPrices.io
          </span>
        </div>
      </div>
    </footer>
  )
}

function FooterColumn({ title, links }: { title: string; links: { label: string; href: string }[] }) {
  return (
    <div>
      <p
        style={{
          color: 'var(--gold-600)',
          fontSize: 11,
          marginBottom: 14,
          marginTop: 0,
          textTransform: 'uppercase',
          letterSpacing: '0.15em',
          fontWeight: 700,
        }}
      >
        {title}
      </p>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        {links.map((link) => (
          <Link
            key={link.label}
            href={link.href}
            style={{ color: 'var(--text)', textDecoration: 'none', fontSize: 13, fontWeight: 500 }}
          >
            {link.label}
          </Link>
        ))}
      </div>
    </div>
  )
}
