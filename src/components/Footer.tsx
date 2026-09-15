import Link from 'next/link'

// Minimal V1 footer. Legal + basic wayfinding.

const exploreLinks = [
  { label: 'Browse sets', href: '/browse' },
  { label: 'Search cards', href: '/cards/search' },
]

const companyLinks = [
  { label: 'Contact', href: '/contact' },
  { label: 'Privacy', href: '/privacy' },
  { label: 'Terms', href: '/terms' },
]

export default function Footer() {
  return (
    <footer
      style={{
        background: 'var(--surface)',
        borderTop: '1px solid var(--border)',
        padding: '40px 24px 28px',
        marginTop: 60,
      }}
    >
      <div style={{ maxWidth: 1100, margin: '0 auto' }}>
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
            gap: 32,
            marginBottom: 32,
          }}
        >
          <div>
            <div
              style={{
                fontFamily: "'Outfit', sans-serif",
                fontWeight: 800,
                fontSize: 18,
                color: 'var(--text)',
                marginBottom: 10,
              }}
            >
              MTGPrices<span style={{ color: 'var(--accent)', fontSize: 11, marginLeft: 4 }}>.io</span>
            </div>
            <p
              style={{
                color: 'var(--text-muted)',
                fontSize: 12,
                lineHeight: 1.6,
                margin: 0,
                maxWidth: 260,
              }}
            >
              Live Magic: The Gathering card prices, printings, historical charts and set catalogue.
              Powered by Scryfall + MTGJSON.
            </p>
          </div>

          <FooterColumn title="Explore" links={exploreLinks} />
          <FooterColumn title="Company" links={companyLinks} />
        </div>

        <div
          style={{
            borderTop: '1px solid var(--border)',
            paddingTop: 20,
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            gap: 16,
            flexWrap: 'wrap',
          }}
        >
          <p
            style={{
              color: 'var(--text-muted)',
              fontSize: 11,
              margin: 0,
              maxWidth: 640,
              lineHeight: 1.6,
            }}
          >
            MTG, Magic: The Gathering and card images © Wizards of the Coast. This site is unofficial
            and not endorsed by Wizards of the Coast. Catalogue data via Scryfall; price data via
            MTGJSON. Informational only — not financial advice.
          </p>
          <span style={{ color: 'var(--text-muted)', fontSize: 11 }}>
            © {new Date().getFullYear()} MTGPrices
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
          color: 'var(--text-muted)',
          fontSize: 11,
          marginBottom: 12,
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
