'use client'
import Link from 'next/link'
import { useState, useEffect } from 'react'
import { useRouter, usePathname } from 'next/navigation'

// Minimal V1 nav. Dark, quiet, no auth chrome.
// Search field posts to /cards/search; card lookup is server-side there.

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
      <div
        className="desktop-nav"
        style={{ display: 'flex', alignItems: 'center', gap: 4, flexShrink: 0 }}
      >
        {[
          { label: 'Browse', href: '/browse' },
          { label: 'Search', href: '/cards/search' },
        ].map((item) => (
          <Link
            key={item.label}
            href={item.href}
            style={{
              color: 'var(--text)',
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
        ))}
      </div>

      {/* Search */}
      <form onSubmit={submitSearch} className="nav-search" style={{ flex: 1, maxWidth: 380, position: 'relative' }}>
        <div style={{ position: 'relative' }}>
          <span
            style={{
              position: 'absolute',
              left: 12,
              top: '50%',
              transform: 'translateY(-50%)',
              fontSize: 13,
              color: 'var(--text-muted)',
              pointerEvents: 'none',
            }}
            aria-hidden
          >
            ⌕
          </span>
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search MTG cards…"
            style={{
              width: '100%',
              padding: '9px 12px 9px 34px',
              borderRadius: 10,
              border: '1px solid var(--border)',
              background: 'var(--bg-light)',
              color: 'var(--text)',
              fontSize: 14,
              fontFamily: 'inherit',
              outline: 'none',
              boxSizing: 'border-box',
            }}
          />
        </div>
      </form>

      <button
        className="mobile-menu-btn"
        onClick={() => setMenuOpen((v) => !v)}
        aria-label="Menu"
        style={{
          background: 'transparent',
          border: '1px solid var(--border)',
          color: 'var(--text)',
          fontSize: 18,
          cursor: 'pointer',
          padding: '4px 10px',
          borderRadius: 8,
        }}
      >
        {menuOpen ? '✕' : '☰'}
      </button>

      {/* Mobile menu */}
      {menuOpen && (
        <div
          style={{
            position: 'absolute',
            top: 60,
            left: 0,
            right: 0,
            background: 'var(--surface)',
            borderBottom: '1px solid var(--border)',
            padding: '16px 20px 20px',
            boxShadow: '0 8px 20px rgba(0,0,0,0.4)',
            zIndex: 99,
          }}
        >
          {[
            { label: 'Browse sets', href: '/browse' },
            { label: 'Search cards', href: '/cards/search' },
          ].map((item) => (
            <Link
              key={item.href}
              href={item.href}
              onClick={() => setMenuOpen(false)}
              style={{
                display: 'block',
                color: 'var(--text)',
                textDecoration: 'none',
                padding: '12px 0',
                fontSize: 15,
                fontWeight: 600,
                borderBottom: '1px solid var(--border)',
              }}
            >
              {item.label}
            </Link>
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
