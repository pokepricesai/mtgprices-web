'use client'
import Link from 'next/link'
import { useState, useEffect } from 'react'
import { useRouter, usePathname } from 'next/navigation'

// Site navigation. Reflects the three-audience IA (Collect / Play /
// Community + eventual AI). Live routes only appear as real links.
// Future areas are shown as "soon" chips in the mobile menu so visitors
// can see where the product is heading without hitting dead links.

type NavItem = {
  label: string
  href?: string    // omit when coming-soon
  soon?: boolean
}
type NavGroup = { title: string; items: NavItem[] }

const NAV_GROUPS: NavGroup[] = [
  {
    title: 'Collect',
    items: [
      { label: 'Cards', href: '/cards/search' },
      { label: 'Sets', href: '/browse' },
      { label: 'Collection', soon: true },
    ],
  },
  {
    title: 'Play',
    items: [
      { label: 'Formats', href: '/formats' },
      { label: 'Deck Builder', soon: true },
      { label: 'Test Your Deck', soon: true },
    ],
  },
  {
    title: 'AI',
    items: [
      { label: 'MTG assistant', soon: true },
    ],
  },
  {
    title: 'Community',
    items: [
      { label: 'Events', soon: true },
      { label: 'Vendors', soon: true },
      { label: 'Creators', soon: true },
    ],
  },
]

const DESKTOP_LINKS: { label: string; href: string }[] = [
  { label: 'Cards', href: '/cards/search' },
  { label: 'Sets', href: '/browse' },
  { label: 'Formats', href: '/formats' },
]

export default function Navbar() {
  const router = useRouter()
  const pathname = usePathname()
  const [menuOpen, setMenuOpen] = useState(false)
  const [query, setQuery] = useState('')

  useEffect(() => { setMenuOpen(false) }, [pathname])

  function submitSearch(e: React.FormEvent) {
    e.preventDefault()
    const q = query.trim()
    if (!q) return
    router.push(`/cards/search?q=${encodeURIComponent(q)}`)
  }

  return (
    <nav
      style={{
        background: 'var(--surface)',
        borderBottom: '1px solid var(--border)',
        padding: '0 20px',
        height: 60,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        position: 'sticky',
        top: 0,
        zIndex: 100,
        gap: 14,
      }}
    >
      <Link
        href="/"
        style={{
          fontFamily: "'Outfit', sans-serif",
          fontWeight: 800,
          fontSize: 18,
          letterSpacing: '-0.02em',
          color: 'var(--text)',
          textDecoration: 'none',
          display: 'flex',
          alignItems: 'baseline',
          gap: 6,
        }}
      >
        <span>MTGPrices</span>
        <span
          style={{
            color: 'var(--accent)',
            fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
            fontSize: 10,
            fontWeight: 700,
            letterSpacing: '0.15em',
            textTransform: 'uppercase',
            transform: 'translateY(-2px)',
          }}
        >
          .io
        </span>
      </Link>

      {/* Desktop nav */}
      <div className="desktop-nav" style={{ display: 'flex', alignItems: 'center', gap: 4, flexShrink: 0 }}>
        {DESKTOP_LINKS.map((item) => {
          const active = pathname === item.href || pathname.startsWith(item.href + '/')
          return (
            <Link
              key={item.label}
              href={item.href}
              aria-current={active ? 'page' : undefined}
              style={{
                color: active ? 'var(--accent)' : 'var(--text)',
                textDecoration: 'none',
                fontSize: 13,
                fontWeight: 600,
                padding: '6px 12px',
                borderRadius: 8,
                letterSpacing: '0.02em',
              }}
            >
              {item.label}
            </Link>
          )
        })}
      </div>

      {/* Search */}
      <form onSubmit={submitSearch} className="nav-search" style={{ flex: 1, maxWidth: 380, position: 'relative' }}>
        <div style={{ position: 'relative' }}>
          <span
            style={{
              position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)',
              fontSize: 13, color: 'var(--text-muted)', pointerEvents: 'none',
            }}
            aria-hidden
          >⌕</span>
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search MTG cards…"
            aria-label="Search MTG cards"
            style={{
              width: '100%', padding: '9px 12px 9px 34px', borderRadius: 10,
              border: '1px solid var(--border)', background: 'var(--bg-light)',
              color: 'var(--text)', fontSize: 14, fontFamily: 'inherit',
              outline: 'none', boxSizing: 'border-box',
            }}
          />
        </div>
      </form>

      <button
        className="mobile-menu-btn"
        onClick={() => setMenuOpen((v) => !v)}
        aria-label={menuOpen ? 'Close menu' : 'Open menu'}
        aria-expanded={menuOpen}
        style={{
          background: 'transparent', border: '1px solid var(--border)', color: 'var(--text)',
          fontSize: 18, cursor: 'pointer', padding: '4px 10px', borderRadius: 8,
        }}
      >{menuOpen ? '✕' : '☰'}</button>

      {/* Mobile menu — grouped mega-list */}
      {menuOpen && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label="Site menu"
          style={{
            position: 'absolute', top: 60, left: 0, right: 0,
            background: 'var(--surface)', borderBottom: '1px solid var(--border)',
            padding: '16px 20px 24px', boxShadow: '0 8px 20px rgba(0,0,0,0.4)',
            zIndex: 99, maxHeight: 'calc(100vh - 60px)', overflowY: 'auto',
          }}
        >
          <form onSubmit={submitSearch} style={{ marginBottom: 16 }}>
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search MTG cards…"
              aria-label="Search MTG cards"
              style={{
                width: '100%', padding: '10px 12px', borderRadius: 10,
                border: '1px solid var(--border)', background: 'var(--bg-light)',
                color: 'var(--text)', fontSize: 14, outline: 'none', boxSizing: 'border-box',
              }}
            />
          </form>

          {NAV_GROUPS.map((g) => (
            <div key={g.title} style={{ marginBottom: 20 }}>
              <div className="label-mono" style={{ marginBottom: 6, color: 'var(--accent)' }}>{g.title}</div>
              <div style={{ display: 'grid', gap: 4 }}>
                {g.items.map((it) => it.href ? (
                  <Link
                    key={it.label}
                    href={it.href}
                    onClick={() => setMenuOpen(false)}
                    style={{
                      display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                      color: 'var(--text)', textDecoration: 'none',
                      padding: '10px 4px', fontSize: 15, fontWeight: 600,
                      borderBottom: '1px solid var(--border)',
                    }}
                  >{it.label}</Link>
                ) : (
                  <div key={it.label} style={{
                    display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                    padding: '10px 4px', fontSize: 15, fontWeight: 600,
                    color: 'var(--text-muted)', borderBottom: '1px solid var(--border)',
                  }}>
                    <span>{it.label}</span>
                    <span style={{
                      fontSize: 10, fontWeight: 700, padding: '2px 8px', borderRadius: 999,
                      background: 'rgba(124,92,231,0.15)', color: '#c8b8ff',
                      letterSpacing: 0.4, textTransform: 'uppercase',
                    }}>Soon</span>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}

      <style jsx>{`
        input::placeholder { color: var(--text-muted); }
        @media (min-width: 900px) {
          .mobile-menu-btn { display: none !important; }
          .nav-search { display: block !important; }
          .desktop-nav { display: flex !important; }
        }
        @media (max-width: 899px) {
          .desktop-nav { display: none !important; }
          .nav-search { display: none !important; }
          .mobile-menu-btn { display: inline-flex !important; }
        }
      `}</style>
    </nav>
  )
}
