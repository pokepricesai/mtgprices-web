'use client'
import Link from 'next/link'
import Image from 'next/image'
import { useState, useEffect, useRef, useMemo } from 'react'
import { useRouter, usePathname } from 'next/navigation'
import { getSupabaseBrowserClient } from '@/lib/supabase/browser'
import Avatar from '@/components/mtg/Avatar'
import { DEFAULT_AVATAR_KEY, resolveAvatar } from '@/lib/mtg/avatars'

// Site navigation. Primary desktop bar exposes the surfaces users live
// in: Cards, Sets, Formats, Card Finder, Decks, Insights, Ask AI. A
// Tools dropdown holds secondary utilities. On narrower desktop widths
// (below ~1280) Formats + Card Finder move into a Tools dropdown.

type NavItem = { label: string; href: string }

const PRIMARY_LINKS_WIDE: NavItem[] = [
  { label: 'Cards',       href: '/cards/search' },
  { label: 'Sets',        href: '/browse' },
  { label: 'Formats',     href: '/formats' },
  { label: 'Card Finder', href: '/card-finder' },
  { label: 'Decks',       href: '/decks' },
  { label: 'Insights',    href: '/insights' },
  { label: 'Ask AI',      href: '/ai' },
]

const PRIMARY_LINKS_MEDIUM: NavItem[] = [
  { label: 'Cards',       href: '/cards/search' },
  { label: 'Sets',        href: '/browse' },
  { label: 'Decks',       href: '/decks' },
  { label: 'Insights',    href: '/insights' },
  { label: 'Ask AI',      href: '/ai' },
]

// Tools items. Formats + Card Finder are NOT here because they are
// already first-level nav items at wide widths, and appear in the
// medium-nav Tools variant separately (see MEDIUM_TOOLS_LINKS below).
const TOOLS_LINKS: NavItem[] = [
  { label: 'Deck Builder',     href: '/decks/new' },
  { label: 'Test Your Deck',   href: '/test-deck' },
  { label: 'Market Movers',    href: '/market' },
  { label: 'My Collection',    href: '/collection' },
]

// At medium widths, Formats and Card Finder drop out of the primary
// row and are pulled into Tools so nothing gets orphaned.
const MEDIUM_TOOLS_LINKS: NavItem[] = [
  { label: 'Formats',          href: '/formats' },
  { label: 'Card Finder',      href: '/card-finder' },
  ...TOOLS_LINKS,
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
      { label: 'Test Your Deck', href: '/test-deck' },
    ],
  },
  {
    title: 'AI + Insights',
    items: [
      { label: 'Ask MTGPrices AI', href: '/ai' },
      { label: 'Insights',         href: '/insights' },
      { label: 'Market Movers',    href: '/market' },
    ],
  },
  {
    title: 'Collect',
    items: [
      { label: 'My Collection',     href: '/collection' },
      { label: 'Import collection', href: '/collection/import' },
    ],
  },
]

type MiniProfile = {
  displayName: string
  avatarKey: string
  googleImage: string | null
  email: string
}

export default function Navbar() {
  const router = useRouter()
  const pathname = usePathname() ?? '/'
  const [menuOpen, setMenuOpen] = useState(false)
  const [userMenuOpen, setUserMenuOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [signedIn, setSignedIn] = useState<boolean | null>(null)
  const [profile, setProfile] = useState<MiniProfile | null>(null)
  const userMenuRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    setMenuOpen(false); setUserMenuOpen(false)
  }, [pathname])

  useEffect(() => {
    let cancelled = false
    async function fetchProfile(userId: string, email: string, meta: any) {
      const supabase = getSupabaseBrowserClient()
      const { data } = await supabase
        .from('mtg_user_profiles')
        .select('display_name, avatar_key')
        .eq('user_id', userId)
        .maybeSingle()
      if (cancelled) return
      const google = typeof meta?.avatar_url === 'string' ? meta.avatar_url
        : typeof meta?.picture === 'string' ? meta.picture : null
      const fallbackName = (meta?.full_name ?? meta?.name ?? email.split('@')[0] ?? '').toString().trim()
      setProfile({
        displayName: (data?.display_name ?? '').trim() || fallbackName,
        avatarKey: data?.avatar_key ?? DEFAULT_AVATAR_KEY,
        googleImage: google,
        email,
      })
    }
    ;(async () => {
      const supabase = getSupabaseBrowserClient()
      const { data } = await supabase.auth.getUser()
      const u = data.user
      if (cancelled) return
      setSignedIn(Boolean(u))
      if (u) fetchProfile(u.id, u.email ?? '', u.user_metadata ?? {})
      const { data: sub } = supabase.auth.onAuthStateChange((_e, session) => {
        if (cancelled) return
        const nu = session?.user ?? null
        setSignedIn(Boolean(nu))
        if (nu) fetchProfile(nu.id, nu.email ?? '', nu.user_metadata ?? {})
        else setProfile(null)
      })
      return () => sub.subscription.unsubscribe()
    })()
    return () => { cancelled = true }
  }, [])

  // Outside-click close for the user menu. The Tools dropdowns own
  // their own outside-close logic so their refs never collide across
  // the wide and medium variants (that collision used to swallow
  // dropdown Link clicks).
  useEffect(() => {
    function onDown(e: MouseEvent) {
      if (!userMenuRef.current) return
      if (!userMenuRef.current.contains(e.target as Node)) setUserMenuOpen(false)
    }
    if (userMenuOpen) {
      document.addEventListener('mousedown', onDown)
      return () => document.removeEventListener('mousedown', onDown)
    }
  }, [userMenuOpen])

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

  async function signOut() {
    const supabase = getSupabaseBrowserClient()
    await supabase.auth.signOut()
    setUserMenuOpen(false)
    router.push('/')
    router.refresh()
  }

  const nextParam = encodeURIComponent(pathname === '/login' ? '/' : pathname)
  const avatarDef = useMemo(() => resolveAvatar(profile?.avatarKey), [profile?.avatarKey])

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

      {/* Desktop nav (wide + medium variants). Each ToolsDropdown owns
          its own ref so the two DOM instances never share state. */}
      <div className="desktop-nav-wide" style={{ display: 'none', alignItems: 'center', gap: 2, flexShrink: 0 }}>
        {PRIMARY_LINKS_WIDE.map((item) => (
          <Link
            key={item.href}
            href={item.href}
            aria-current={isActive(item.href) ? 'page' : undefined}
            className={`nav-link${isActive(item.href) ? ' active' : ''}`}
          >{item.label}</Link>
        ))}
        <ToolsDropdown items={TOOLS_LINKS} />
      </div>
      <div className="desktop-nav-medium" style={{ display: 'none', alignItems: 'center', gap: 2, flexShrink: 0 }}>
        {PRIMARY_LINKS_MEDIUM.map((item) => (
          <Link
            key={item.href}
            href={item.href}
            aria-current={isActive(item.href) ? 'page' : undefined}
            className={`nav-link${isActive(item.href) ? ' active' : ''}`}
          >{item.label}</Link>
        ))}
        <ToolsDropdown items={MEDIUM_TOOLS_LINKS} />
      </div>

      {/* Search */}
      <form onSubmit={submitSearch} className="nav-search" style={{ flex: 1, maxWidth: 320, position: 'relative' }}>
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
        {signedIn ? (
          <div ref={userMenuRef} style={{ position: 'relative' }}>
            <button
              type="button"
              onClick={() => setUserMenuOpen((v) => !v)}
              aria-haspopup="menu"
              aria-expanded={userMenuOpen}
              aria-label="Open account menu"
              style={{
                display: 'inline-flex', alignItems: 'center', gap: 8,
                padding: '4px 10px 4px 4px', borderRadius: 999,
                background: userMenuOpen ? 'var(--bg-light)' : 'var(--surface)',
                border: '1px solid var(--border)',
                cursor: 'pointer', fontFamily: 'inherit',
              }}
            >
              <Avatar avatarKey={avatarDef.key} googleImageUrl={profile?.googleImage ?? null} size={30} ariaLabel="Your avatar" />
              <span className="nav-user-label" style={{
                fontSize: 13, fontWeight: 700, color: 'var(--text)', maxWidth: 140,
                overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                display: 'none',
              }}>
                {profile?.displayName || 'Account'}
              </span>
              <span aria-hidden style={{ fontSize: 10, color: 'var(--text-muted)', marginRight: 2 }}>▾</span>
            </button>
            {userMenuOpen && (
              <div
                role="menu"
                style={{
                  position: 'absolute', top: 'calc(100% + 8px)', right: 0,
                  minWidth: 240, background: 'var(--surface)',
                  border: '1px solid var(--border)', borderRadius: 12,
                  boxShadow: 'var(--shadow-md)', padding: 8, zIndex: 101,
                }}
              >
                <div style={{ padding: '10px 12px', borderBottom: '1px solid var(--border)', marginBottom: 6 }}>
                  <div style={{ fontSize: 13.5, fontWeight: 700, color: 'var(--text-strong)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {profile?.displayName || 'Signed in'}
                  </div>
                  {profile?.email && (
                    <div style={{ fontSize: 11.5, color: 'var(--text-muted)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {profile.email}
                    </div>
                  )}
                </div>
                {[
                  { label: 'My Collection', href: '/collection' },
                  { label: 'My Decks',      href: '/decks' },
                  { label: 'Account',       href: '/account' },
                  { label: 'Settings',      href: '/settings' },
                ].map((it) => (
                  <Link
                    key={it.href}
                    href={it.href}
                    role="menuitem"
                    onClick={() => setUserMenuOpen(false)}
                    style={{
                      display: 'block', padding: '9px 12px',
                      borderRadius: 8, fontSize: 14, fontWeight: 600,
                      fontFamily: 'inherit',
                      color: 'var(--text)', textDecoration: 'none',
                    }}
                  >{it.label}</Link>
                ))}
                <button
                  type="button"
                  onClick={signOut}
                  style={{
                    display: 'block', width: '100%', textAlign: 'left',
                    padding: '9px 12px', marginTop: 6,
                    borderRadius: 8, fontSize: 14, fontWeight: 600,
                    background: 'transparent', border: 'none', cursor: 'pointer',
                    color: 'var(--red)', fontFamily: 'inherit',
                    borderTop: '1px solid var(--border)',
                  }}
                >Sign out</button>
              </div>
            )}
          </div>
        ) : (
          <>
            <Link
              href={`/login?next=${nextParam}`}
              className="btn btn-sm btn-ghost"
              style={{ fontWeight: 700 }}
            >Sign in</Link>
            <Link
              href={`/login?next=${nextParam}&intent=signup`}
              className="btn btn-sm"
              style={{
                background: 'linear-gradient(135deg, var(--gold-300), var(--gold-400))',
                color: '#2A1A05', border: '1px solid var(--gold-400)',
                boxShadow: '0 2px 4px rgba(168,104,28,0.20), inset 0 1px 0 rgba(255,255,255,0.3)',
              }}
            >Create account</Link>
          </>
        )}
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

          {signedIn && profile ? (
            <div style={{
              display: 'flex', alignItems: 'center', gap: 12,
              padding: 12, marginBottom: 14,
              background: 'var(--bg-light)', borderRadius: 12,
              border: '1px solid var(--border)',
            }}>
              <Avatar avatarKey={avatarDef.key} googleImageUrl={profile.googleImage} size={44} />
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontWeight: 700, fontSize: 14, color: 'var(--text-strong)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {profile.displayName || 'Signed in'}
                </div>
                {profile.email && (
                  <div style={{ fontSize: 12, color: 'var(--text-muted)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {profile.email}
                  </div>
                )}
              </div>
            </div>
          ) : (
            <div style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
              <Link
                href={`/login?next=${nextParam}`}
                onClick={() => setMenuOpen(false)}
                className="btn btn-ghost"
                style={{ flex: 1 }}
              >Sign in</Link>
              <Link
                href={`/login?next=${nextParam}&intent=signup`}
                onClick={() => setMenuOpen(false)}
                className="btn"
                style={{
                  flex: 1,
                  background: 'linear-gradient(135deg, var(--gold-300), var(--gold-400))',
                  color: '#2A1A05', border: '1px solid var(--gold-400)',
                }}
              >Create account</Link>
            </div>
          )}

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

          {signedIn && (
            <>
              <div style={{ marginBottom: 12 }}>
                <div className="label-mono" style={{ marginBottom: 6, color: 'var(--gold-600)' }}>Account</div>
                <div style={{ display: 'grid', gap: 4 }}>
                  {[
                    { label: 'My Collection', href: '/collection' },
                    { label: 'My Decks',      href: '/decks' },
                    { label: 'Account',       href: '/account' },
                    { label: 'Settings',      href: '/settings' },
                  ].map((it) => (
                    <Link
                      key={it.href}
                      href={it.href}
                      onClick={() => setMenuOpen(false)}
                      style={{
                        color: 'var(--text)', textDecoration: 'none',
                        padding: '11px 6px', fontSize: 15, fontWeight: 600,
                        borderBottom: '1px solid var(--border)',
                      }}
                    >{it.label}</Link>
                  ))}
                </div>
              </div>
              <button
                type="button"
                onClick={() => { setMenuOpen(false); signOut() }}
                className="btn btn-ghost"
                style={{ width: '100%', marginTop: 4, color: 'var(--red)' }}
              >Sign out</button>
            </>
          )}
        </div>
      )}

      <style jsx>{`
        input::placeholder { color: var(--text-muted); }
        @media (min-width: 1280px) {
          .mobile-menu-btn { display: none !important; }
          .nav-search { display: block !important; }
          .desktop-nav-wide { display: flex !important; }
          .desktop-nav-medium { display: none !important; }
          .nav-account-cluster { display: flex !important; }
          .nav-user-label { display: inline !important; }
        }
        @media (min-width: 1080px) and (max-width: 1279px) {
          .mobile-menu-btn { display: none !important; }
          .nav-search { display: block !important; }
          .desktop-nav-wide { display: none !important; }
          .desktop-nav-medium { display: flex !important; }
          .nav-account-cluster { display: flex !important; }
        }
        @media (max-width: 1079px) {
          .desktop-nav-wide { display: none !important; }
          .desktop-nav-medium { display: none !important; }
          .nav-search { display: none !important; }
          .nav-account-cluster { display: none !important; }
          .mobile-menu-btn { display: inline-flex !important; }
        }
      `}</style>
    </nav>
  )
}

// Self-contained Tools dropdown. Each instance owns its own DOM ref
// and outside-close logic so wide-nav and medium-nav variants never
// clobber each other's ref (an earlier bug where sharing a parent ref
// across both variants swallowed the Link click on the visible one).
//
// Typography note: the trigger uses className="nav-link" only. We do
// NOT set the CSS `font` shorthand inline because that would reset
// font-family / size / weight / line-height back to inherit from the
// nav container, which is what made Tools visibly differ from the
// other primary links. Letting .nav-link fully control typography is
// the correct fix.
function ToolsDropdown({ items }: { items: NavItem[] }) {
  const [open, setOpen] = useState(false)
  const boxRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    function onDown(e: MouseEvent) {
      if (!boxRef.current) return
      if (!boxRef.current.contains(e.target as Node)) setOpen(false)
    }
    if (open) {
      document.addEventListener('mousedown', onDown)
      return () => document.removeEventListener('mousedown', onDown)
    }
  }, [open])

  return (
    <div ref={boxRef} style={{ position: 'relative' }}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="menu"
        aria-expanded={open}
        className={`nav-link${open ? ' active' : ''}`}
        style={{
          display: 'inline-flex', alignItems: 'center', gap: 6,
          background: 'transparent',
          border: 'none', cursor: 'pointer',
          color: open ? 'var(--gold-600)' : 'var(--text)',
        }}
      >
        Tools
        <span aria-hidden style={{ fontSize: 10, opacity: 0.7 }}>▾</span>
      </button>
      {open && (
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
          {items.map((it) => (
            <Link
              key={it.href}
              href={it.href}
              role="menuitem"
              onClick={() => setOpen(false)}
              style={{
                display: 'block', padding: '10px 12px',
                borderRadius: 8, fontSize: 14, fontWeight: 600,
                fontFamily: 'inherit',
                color: 'var(--text)', textDecoration: 'none',
              }}
            >{it.label}</Link>
          ))}
        </div>
      )}
    </div>
  )
}
