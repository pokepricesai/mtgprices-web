'use client'
import Link from 'next/link'
import Image from 'next/image'
import { useState, useEffect, useRef } from 'react'
import { useRouter, usePathname } from 'next/navigation'
import { getSupabaseBrowserClient } from '@/lib/supabase/browser'

// Site navigation. Primary bar exposes the six product surfaces users
// live in most: Cards, Sets, Formats, Card Finder, Decks, plus a Tools
// dropdown that also holds the newer/less-frequent tools (Test Deck,
// Collection). The right-hand cluster is search + account.
//
// Test Deck lives inside Tools because the workflow is Deck → open →
// Test, so we haven't wanted a dead top-level link. If it becomes a
// primary entry, promote it.

type NavItem = { label: string; href: string; soon?: boolean }

const PRIMARY_LINKS: NavItem[] = [
  { label: 'Cards',       href: '/cards/search' },
  { label: 'Sets',        href: '/browse' },
  { label: 'Formats',     href: '/formats' },
  { label: 'Card Finder', href: '/card-finder' },
  { label: 'Decks',       href: '/decks' },
]

const TOOLS_LINKS: NavItem[] = [
  { label: 'Card Finder',      href: '/card-finder' },
  { label: 'Deck Builder',     href: '/decks/new' },
  { label: 'Test Your Deck',   href: '/decks' },
  { label: 'Market Movers',    href: '/market' },
  { label: 'My Collection',    href: '/collection' },
]

const MOBILE_GROUPS: { title: string; items: NavItem[] }[] = [
  {
    title: 'Cards & Sets',
    items: [
      { label: 'Search cards', href: '/cards/search' },
      { label: 'Browse sets',  href: '/browse' },
      { label: 'Card Finder',  href: '/card-finder' },
      { label: 'Formats',      href: '/formats' },
    ],
  },
  {
    title: 'Decks',
    items: [
      { label: 'My Decks',       href: '/decks' },
      { label: 'New deck',       href: '/decks/new' },
      { label: 'Test Your Deck', href: '/decks' },
    ],
  },
  {
    title: 'Collect',
    items: [
      { label: 'My Collection',    href: '/collection' },
      { label: 'Import collection', href: '/collection/import' },
    ],
  },
]

export default function Navbar() {
  const router = useRouter()
  const pathname = usePathname() ?? '/'
  const [menuOpen, setMenuOpen] = useState(false)
  const [toolsOpen, setToolsOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [signedIn, setSignedIn] = useState<boolean | null>(null)
  const toolsRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => { setMenuOpen(false); setToolsOpen(false) }, [pathname])

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      const supabase = getSupabaseBrowserClient()
      const { data } = await supabase.auth.getUser()
      if (!cancelled) setSignedIn(Boolean(data.user))
      const { data: sub } = supabase.auth.onAuthStateChange((_e, session) => {
        if (!cancelled) setSignedIn(Boolean(session?.user))
      })
      return () => sub.subscription.unsubscribe()
    })()
    return () => { cancelled = true }
  }, [])

  useEffect(() => {
    function onDown(e: MouseEvent) {
      if (!toolsRef.current) return
      if (!toolsRef.current.contains(e.target as Node)) setToolsOpen(false)
    }
    if (toolsOpen) {
      document.addEventListener('mousedown', onDown)
      return () => document.removeEventListener('mousedown', onDown)
    }
  }, [toolsOpen])

  function submitSearch(e: React.FormEvent) {
    e.preventDefault()
    const q = query.trim()
    if (!q) return
    router.push(`/cards/search?q=${encodeURIComponent(q)}`)
  }

  function isActive(href: string) {
    if (href === '/') return pathname === '/'
    return pathname === href || pathname.startsWith(href + '/') || pathname.startsWith(href + '?')
  }

  return (
    <nav
      style={{
        background: 'rgba(255,255,255,0.94)',
        backdropFilter: 'saturate(1.1) blur(8px)',
        WebkitBackdropFilter: 'saturate(1.1) blur(8px)',
        borderBottom: '1px solid var(--border)',
        padding: '0 24px',
        height: 68,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        position: 'sticky',
        top: 0,
        zIndex: 100,
        gap: 16,
      }}
    >
      {/* Logo lockup */}
      <Link
        href="/"
        aria-label="MTGPrices home"
        style={{
          display: 'flex', alignItems: 'center', gap: 10,
          textDecoration: 'none', flexShrink: 0,
          height: 48,
        }}
      >
        <Image
          src="/logo.png"
          alt="MTGPrices"
          width={200}
          height={60}
          priority
          style={{ height: 44, width: 'auto' }}
        />
      </Link>

      {/* Desktop nav */}
      <div className="desktop-nav" style={{ display: 'flex', alignItems: 'center', gap: 2, flexShrink: 0 }}>
        {PRIMARY_LINKS.map((item) => (
          <Link
            key={item.href}
            href={item.href}
            aria-current={isActive(item.href) ? 'page' : undefined}
            className={`nav-link${isActive(item.href) ? ' active' : ''}`}
          >
            {item.label}
          </Link>
        ))}

        {/* Tools dropdown */}
        <div ref={toolsRef} style={{ position: 'relative' }}>
          <button
            type="button"
            onClick={() => setToolsOpen((v) => !v)}
            aria-haspopup="menu"
            aria-expanded={toolsOpen}
            className={`nav-link${toolsOpen ? ' active' : ''}`}
            style={{
              display: 'inline-flex', alignItems: 'center', gap: 6,
              background: 'transparent',
              border: 'none', cursor: 'pointer', font: 'inherit',
              color: toolsOpen ? 'var(--gold-600)' : 'var(--text)',
            }}
          >
            Tools
            <span aria-hidden style={{ fontSize: 10, opacity: 0.7 }}>▾</span>
          </button>
          {toolsOpen && (
            <div
              role="menu"
              style={{
                position: 'absolute', top: 'calc(100% + 6px)', left: 0,
                minWidth: 220, background: 'var(--surface)',
                border: '1px solid var(--border)', borderRadius: 12,
                boxShadow: 'var(--shadow-md)', padding: 6,
                zIndex: 101,
              }}
            >
              {TOOLS_LINKS.map((it) => (
                <Link
                  key={it.href}
                  href={it.href}
                  role="menuitem"
                  onClick={() => setToolsOpen(false)}
                  style={{
                    display: 'block', padding: '10px 12px',
                    borderRadius: 8, fontSize: 14, fontWeight: 600,
                    fontFamily: 'inherit',
                    color: 'var(--text)', textDecoration: 'none',
                  }}
                  onMouseEnter={(e) => {
                    (e.currentTarget as HTMLElement).style.background = 'var(--accent-soft)'
                    ;(e.currentTarget as HTMLElement).style.color = 'var(--gold-600)'
                  }}
                  onMouseLeave={(e) => {
                    (e.currentTarget as HTMLElement).style.background = 'transparent'
                    ;(e.currentTarget as HTMLElement).style.color = 'var(--text)'
                  }}
                >{it.label}</Link>
              ))}
            </div>
          )}
        </div>
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
            placeholder="Search cards, sets, types…"
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

      {/* Account cluster */}
      <div className="nav-account-cluster" style={{ display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 }}>
        <Link
          href="/collection"
          className={`nav-link${isActive('/collection') ? ' active' : ''}`}
          aria-label="Collection"
          style={{ padding: '10px 12px' }}
        >Collection</Link>
        <Link
          href={signedIn ? '/account' : `/login?next=${encodeURIComponent(pathname)}`}
          className="btn btn-sm"
          style={{
            background: signedIn ? 'var(--surface)' : 'linear-gradient(135deg, var(--gold-300), var(--gold-400))',
            color: signedIn ? 'var(--text)' : '#2A1A05',
            border: signedIn ? '1px solid var(--border-strong)' : '1px solid var(--gold-400)',
            boxShadow: signedIn ? 'none' : '0 2px 4px rgba(168,104,28,0.20), inset 0 1px 0 rgba(255,255,255,0.3)',
          }}
        >{signedIn ? 'Account' : 'Sign in'}</Link>
      </div>

      <button
        className="mobile-menu-btn"
        onClick={() => setMenuOpen((v) => !v)}
        aria-label={menuOpen ? 'Close menu' : 'Open menu'}
        aria-expanded={menuOpen}
        style={{
          background: 'transparent', border: '1px solid var(--border)', color: 'var(--text)',
          fontSize: 18, cursor: 'pointer', padding: '6px 12px', borderRadius: 8,
          lineHeight: 1,
        }}
      >{menuOpen ? '✕' : '☰'}</button>

      {/* Mobile menu */}
      {menuOpen && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label="Site menu"
          style={{
            position: 'absolute', top: 68, left: 0, right: 0,
            background: 'var(--surface)', borderBottom: '1px solid var(--border)',
            padding: '16px 20px 24px', boxShadow: 'var(--shadow-lg)',
            zIndex: 99, maxHeight: 'calc(100vh - 68px)', overflowY: 'auto',
          }}
        >
          <form onSubmit={submitSearch} style={{ marginBottom: 14 }}>
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search cards, sets, types…"
              aria-label="Search MTG cards"
              style={{
                width: '100%', padding: '11px 12px', borderRadius: 10,
                border: '1px solid var(--border)', background: 'var(--bg-light)',
                color: 'var(--text)', fontSize: 15, outline: 'none', boxSizing: 'border-box',
              }}
            />
          </form>

          <div style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
            <Link
              href={signedIn ? '/account' : `/login?next=${encodeURIComponent(pathname)}`}
              onClick={() => setMenuOpen(false)}
              className="btn btn-primary"
              style={{ flex: 1 }}
            >{signedIn ? 'Account' : 'Sign in'}</Link>
            <Link
              href="/collection"
              onClick={() => setMenuOpen(false)}
              className="btn btn-ghost"
              style={{ flex: 1 }}
            >Collection</Link>
          </div>

          {MOBILE_GROUPS.map((g) => (
            <div key={g.title} style={{ marginBottom: 20 }}>
              <div className="label-mono" style={{ marginBottom: 6, color: 'var(--gold-600)' }}>{g.title}</div>
              <div style={{ display: 'grid', gap: 4 }}>
                {g.items.map((it) => (
                  <Link
                    key={it.label}
                    href={it.href}
                    onClick={() => setMenuOpen(false)}
                    style={{
                      display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                      color: 'var(--text)', textDecoration: 'none',
                      padding: '11px 6px', fontSize: 15, fontWeight: 600,
                      borderBottom: '1px solid var(--border)',
                    }}
                  >{it.label}</Link>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}

      <style jsx>{`
        input::placeholder { color: var(--text-muted); }
        @media (min-width: 1080px) {
          .mobile-menu-btn { display: none !important; }
          .nav-search { display: block !important; }
          .desktop-nav { display: flex !important; }
          .nav-account-cluster { display: flex !important; }
        }
        @media (max-width: 1079px) {
          .desktop-nav { display: none !important; }
          .nav-search { display: none !important; }
          .nav-account-cluster { display: none !important; }
          .mobile-menu-btn { display: inline-flex !important; }
        }
      `}</style>
    </nav>
  )
}
