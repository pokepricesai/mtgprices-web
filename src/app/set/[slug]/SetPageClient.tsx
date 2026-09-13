'use client'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import Link from 'next/link'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import { supabase, formatPrice } from '@/lib/supabase'
import InlineChat from '@/components/InlineChat'
import PriceChart from '@/components/PriceChart'
import { getSetAssets } from '@/lib/setAssets'
import SetStructuredData from '@/components/SetStructuredData'
import JapaneseBadge from '@/components/JapaneseBadge'
import { resolveLanguage, displaySetName } from '@/lib/cardLanguage'
// Block 5A-W-46B — BreadcrumbSchema moved to the parent server
// component (page.tsx) so it appears in initial HTML. Do NOT re-import
// here; a duplicate BreadcrumbList would invalidate the rich result.
import FAQ from '@/components/FAQ'
import { EbayInlineLink } from '@/components/EbayLiveListings'
import { buildCardEbayQuery, getEbayUkUrl, getEbayUsUrl } from '@/lib/ebayAffiliate'
import { getSetFaqItems } from '@/lib/faqs'
// Block 5A-W-50B — quick Watch + Portfolio actions inside every set-
// page card tile. Two per-set bulk queries provide membership state,
// so no per-tile watchlist/portfolio SELECT happens even for a set
// with 500+ cards.
import SetCardTileActions, { type TileCard } from '@/components/SetCardTileActions'
import AuthPromptModal, { type AuthPromptContext } from '@/components/AuthPromptModal'
import { CardPortfolioAddModal } from '@/components/CardQuickActions'
import { loadSetMembership, EMPTY_MEMBERSHIP, normaliseSlug, type SetMembership } from '@/lib/setPageMembership'
import { useUserPlan } from '@/lib/account/useUserPlan'
import { peekIntendedAction, consumeIntendedAction } from '@/lib/intendedAction'
import { performWatchlistAdd } from '@/lib/watchlistOps'
import { trackEvent } from '@/lib/analytics'
// Block 5A-W-58D.1 — retry helper for the primary set-cards RPC. See
// loadSetCards.ts for the retry + isLive semantics.
import { fetchPrimarySetCardsWithRetry } from './loadSetCards'
// Block 5A-W-50C — per-set portfolio completion bar in the header.
import SetCompletionProgress from '@/components/SetCompletionProgress'
// Block 5A-W-50E — URL-backed sort + scroll restoration + smart back.
import { parseSetUrl, serializeSetUrl, SET_DEFAULTS, type SetSort } from '@/lib/nav/setUrlState'
import { normaliseRouteKey } from '@/lib/nav/routeKey'
import { setOriginMarker } from '@/lib/nav/originMarker'
import { markPendingOutbound } from '@/lib/nav/pendingOutbound'
import { validateOriginMarkerForArrival } from '@/lib/nav/destinationValidity'
import { makeSmartBackHandler } from '@/lib/nav/smartBack'
import {
  saveScrollForRoute,
  useRouteScrollRestoration,
  type RouteAnchor,
} from '@/lib/nav/useRouteScrollRestoration'

interface Card {
  card_slug: string
  card_name: string
  card_number: string
  set_name: string
  raw_usd: number | null
  psa9_usd: number | null
  psa10_usd: number | null
  image_url: string | null
  card_url_slug: string | null
  is_sealed: boolean
}

interface TrendCard {
  card_slug: string
  card_name: string
  card_url_slug: string | null
  raw_usd: number
  raw_pct_30d: number | null
  image_url: string | null
  volume_label?: string | null
}

interface PopStats {
  total_graded: number
  gem_rate: number
  total_psa10: number
}

// Block 5A-W-50E — reuse the URL-state helper's SortOption type so
// the parser, serializer and view share one canonical list. The five
// values are unchanged from the pre-block set page.
type SortOption = SetSort

const statValue: React.CSSProperties = {
  fontSize: 20, fontWeight: 700, color: 'var(--text)',
  fontFamily: "'Figtree', sans-serif", lineHeight: 1,
}
const statLabel: React.CSSProperties = {
  fontSize: 11, color: 'var(--text-muted)', fontFamily: "'Figtree', sans-serif",
  textTransform: 'uppercase', letterSpacing: 1, fontWeight: 600, marginTop: 2,
}

function formatSetAge(releaseDate: string): string {
  const release = new Date(releaseDate)
  const now = new Date()
  let years = now.getFullYear() - release.getFullYear()
  let months = now.getMonth() - release.getMonth()
  if (months < 0) { years--; months += 12 }
  if (years === 0) return months <= 1 ? 'New' : `${months}mo old`
  if (months === 0) return `${years}y old`
  return `${years}y ${months}mo old`
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ fontSize: 10, fontWeight: 800, textTransform: 'uppercase', letterSpacing: 1.8, color: 'var(--text-muted)', marginBottom: 12, fontFamily: "'Figtree', sans-serif" }}>
      {children}
    </div>
  )
}

function Panel({ children, style = {} }: { children: React.ReactNode; style?: React.CSSProperties }) {
  return (
    <div style={{ background: 'var(--card)', borderRadius: 14, border: '1px solid var(--border)', padding: '18px 20px', ...style }}>
      {children}
    </div>
  )
}

function MoverRow({ card, setName, positive }: { card: TrendCard; setName: string; positive: boolean }) {
  const href = card.card_url_slug ? `/set/${encodeURIComponent(setName)}/card/${card.card_url_slug}` : '#'
  const ebayQuery = buildCardEbayQuery(card.card_name, setName, null)
  const ebayCustomId = `mover-${(card.card_slug || '').toString().replace(/^pc-/, '') || card.card_url_slug || ''}`
  return (
    <div
      style={{ padding: '6px 8px', borderRadius: 8, transition: 'background 0.15s' }}
      onMouseEnter={e => { (e.currentTarget as HTMLDivElement).style.background = 'var(--bg-light)' }}
      onMouseLeave={e => { (e.currentTarget as HTMLDivElement).style.background = 'transparent' }}
    >
      <Link href={href} style={{ display: 'flex', alignItems: 'center', gap: 10, textDecoration: 'none' }}>
        {card.image_url
          ? <img src={card.image_url} alt={card.card_name} style={{ width: 26, height: 36, objectFit: 'contain', borderRadius: 3, flexShrink: 0 }} />
          : <div style={{ width: 26, height: 36, background: 'var(--bg)', borderRadius: 3, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 13, flexShrink: 0, color: 'var(--border)' }}>🃏</div>}
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--text)', fontFamily: "'Figtree', sans-serif", whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{card.card_name}</div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <span style={{ fontSize: 11, color: 'var(--text-muted)', fontFamily: "'Figtree', sans-serif" }}>${card.raw_usd.toFixed(2)}</span>
            {card.volume_label && (
              <span style={{ fontSize: 10, color: '#3b82f6', fontWeight: 600, fontFamily: "'Figtree', sans-serif" }}>{card.volume_label}</span>
            )}
          </div>
        </div>
        {card.raw_pct_30d != null && (
          <span style={{ fontSize: 12, fontWeight: 800, flexShrink: 0, color: positive ? 'var(--green)' : '#ef4444', fontFamily: "'Figtree', sans-serif" }}>
            {card.raw_pct_30d > 0 ? '+' : ''}{card.raw_pct_30d.toFixed(1)}%
          </span>
        )}
      </Link>
      <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 2 }}>
        <EbayInlineLink
          searchQuery={ebayQuery}
          customId={ebayCustomId}
          placement="set_mover_row"
          intent="raw"
          cardSlug={(card.card_slug || '').toString().replace(/^pc-/, '')}
          setSlug={setName}
          sourceComponent="set_page_mover_row"
        />
      </div>
    </div>
  )
}

// Block 5A-W-50B — CardGrid now renders each tile as a wrapping
// <div> instead of a wrapping <Link>. This is required so the two
// action <button>s can live inside the same visual card without
// violating HTML nesting rules (buttons cannot appear inside an <a>).
// The clickable card body — image + name + prices — remains a Link;
// only the tiny action row at the bottom sits outside it. Clicking
// the image or the name still navigates to the card page exactly as
// before; the row of two buttons is the only new interactive surface.
type TileActionProps = React.ComponentProps<typeof SetCardTileActions>
function CardGrid({
  cards, setName, buildTileActionProps, gridRef, onTileClick,
}: {
  cards: Card[]
  setName: string
  buildTileActionProps?: (c: Card) => TileActionProps | null
  // Block 5A-W-50E — optional forwarded ref + tile-click callback so
  // the parent can attach scroll-anchor lookup and origin markers.
  gridRef?: React.RefObject<HTMLDivElement | null>
  onTileClick?: (c: Card) => void
}) {
  return (
    <div ref={gridRef} style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))', gap: 12 }}>
      {cards.map(c => {
        const actionProps = buildTileActionProps ? buildTileActionProps(c) : null
        const handleLinkClick = (e: React.MouseEvent) => {
          if (e.button !== 0) return
          if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return
          onTileClick?.(c)
        }
        return (
          <div
            key={c.card_slug}
            data-card-slug={c.card_slug}
            className="card-hover holo-shimmer"
            style={{ background: 'var(--card)', borderRadius: 12, border: '1px solid var(--border)', padding: 14, color: 'var(--text)', display: 'flex', flexDirection: 'column', alignItems: 'center' }}
          >
            <Link
              href={`/set/${encodeURIComponent(c.set_name)}/card/${c.card_url_slug}`}
              onClick={handleLinkClick}
              style={{ textDecoration: 'none', color: 'inherit', display: 'flex', flexDirection: 'column', alignItems: 'center', width: '100%' }}
              aria-label={`Open ${c.card_name}`}
            >
              {c.image_url
                ? <img src={c.image_url} alt={c.card_name} style={{ width: 110, height: 154, objectFit: 'contain', marginBottom: 8, borderRadius: 6 }} loading="lazy" />
                : <div style={{ width: 110, height: 154, background: 'var(--bg)', borderRadius: 6, marginBottom: 8, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 28, color: 'var(--border)' }}>{c.is_sealed ? '📦' : '🃏'}</div>}
              <div style={{ fontWeight: 600, fontSize: 13, textAlign: 'center', marginBottom: 3, lineHeight: 1.3, fontFamily: "'Figtree', sans-serif", display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>
                {c.card_name}
              </div>
              <div style={{ fontSize: 13, color: 'var(--text-muted)', fontFamily: "'Figtree', sans-serif" }}>
                {c.is_sealed ? 'Sealed' : 'Raw'}: {formatPrice(c.raw_usd)}
              </div>
              {!c.is_sealed && c.psa10_usd && c.psa10_usd > 0 && (
                <div style={{ fontSize: 12, color: 'var(--accent-hover)', fontWeight: 500, fontFamily: "'Figtree', sans-serif" }}>
                  PSA 10: {formatPrice(c.psa10_usd)}
                </div>
              )}
            </Link>
            {actionProps && <SetCardTileActions {...actionProps} />}
          </div>
        )
      })}
    </div>
  )
}

function SealedSection({
  sealedCards, setName, buildTileActionProps, onTileClick,
}: {
  sealedCards: Card[]
  setName: string
  buildTileActionProps?: (c: Card) => React.ComponentProps<typeof SetCardTileActions> | null
  onTileClick?: (c: Card) => void
}) {
  if (sealedCards.length === 0) return null
  return (
    <div id="sealed" style={{ marginTop: 32 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 16 }}>
        <div style={{ flex: 1, height: 1, background: 'var(--border)' }} />
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, color: 'var(--text-muted)', fontSize: 12, fontFamily: "'Figtree', sans-serif", fontWeight: 700, letterSpacing: 0.5 }}>
          <span>📦</span><span>Sealed Product ({sealedCards.length})</span>
        </div>
        <div style={{ flex: 1, height: 1, background: 'var(--border)' }} />
      </div>
      <p style={{ fontSize: 12, color: 'var(--text-muted)', fontFamily: "'Figtree', sans-serif", marginBottom: 14, lineHeight: 1.6, background: 'var(--bg-light)', borderRadius: 8, padding: '10px 14px' }}>
        Sealed product prices track market value of unopened product — not individual cards.
      </p>
      <CardGrid cards={sealedCards} setName={setName} buildTileActionProps={buildTileActionProps} onTileClick={onTileClick} />
    </div>
  )
}

function SetHeader({ setName, releaseDate, language, onBackClick }: { setName: string; releaseDate: string | null; language?: string | null; onBackClick?: (e: React.MouseEvent) => void }) {
  const { logoUrl, symbolUrl, eraUrl, eraDisplay } = getSetAssets(setName)

  return (
    <div style={{ marginBottom: 20 }}>
      <Link
        href="/browse"
        onClick={onBackClick}
        style={{
          display: 'inline-flex', alignItems: 'center', gap: 6,
          color: 'var(--text)', fontSize: 13, textDecoration: 'none',
          marginBottom: 12, fontFamily: "'Figtree', sans-serif", fontWeight: 600,
          padding: '6px 14px 6px 10px',
          background: 'var(--card)', border: '1px solid var(--border)',
          borderRadius: 20, transition: 'all 0.15s',
        }}
        onMouseEnter={e => { const el = e.currentTarget as HTMLAnchorElement; el.style.borderColor = 'var(--primary)'; el.style.color = 'var(--primary)' }}
        onMouseLeave={e => { const el = e.currentTarget as HTMLAnchorElement; el.style.borderColor = 'var(--border)'; el.style.color = 'var(--text)' }}
      >
        <span style={{ fontSize: 11, opacity: 0.5 }}>←</span> Browse all sets
      </Link>

      {eraUrl && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
          <img src={eraUrl} alt={eraDisplay ?? ''} style={{ height: 22, width: 'auto', objectFit: 'contain' }} loading="lazy" />
          {eraDisplay && (
            <span style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-muted)', fontFamily: "'Figtree', sans-serif", whiteSpace: 'nowrap' }}>
              {eraDisplay}
            </span>
          )}
        </div>
      )}

      <div style={{ display: 'flex', alignItems: 'center', gap: 14, flexWrap: 'wrap' }}>
        {logoUrl && <img src={logoUrl} alt={displaySetName(setName, language)} style={{ height: 56, width: 'auto', objectFit: 'contain', maxWidth: 240 }} loading="eager" />}
        {symbolUrl && <img src={symbolUrl} alt="" style={{ width: 28, height: 28, objectFit: 'contain' }} loading="lazy" />}
        {/* Block 5A-W-48C — visible H1 strips leading "Japanese ".
            Internal setName + canonical still use the Japanese-
            prefixed identifier; only the visible label is cleaned. */}
        <h1 style={{ fontFamily: "'Outfit', sans-serif", fontSize: logoUrl ? 26 : 34, fontWeight: 700, margin: 0, color: 'var(--text)', letterSpacing: '-0.5px', lineHeight: 1.2 }}>
          {displaySetName(setName, language)}
        </h1>
        {/* Block 5A-W-48B — pill flags Japanese sets. Renders nothing
            for English so English sets are unchanged visually. */}
        <JapaneseBadge language={language} size="md" />
      </div>

      {releaseDate && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 10, flexWrap: 'wrap' }}>
          <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-muted)', fontFamily: "'Figtree', sans-serif" }}>
            Released {new Date(releaseDate).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' })}
          </span>
          <span style={{
            fontSize: 11, fontWeight: 700, color: 'var(--text-muted)',
            background: 'var(--bg-light)', border: '1px solid var(--border)',
            borderRadius: 20, padding: '2px 10px', fontFamily: "'Figtree', sans-serif",
          }}>
            {formatSetAge(releaseDate)}
          </span>
        </div>
      )}
    </div>
  )
}

export default function SetPageClient({ slug }: { slug: string }) {
  const setName = decodeURIComponent(slug)
  // Block 5A-W-50E — URL sort state. Initialised from the current URL
  // so a bookmarked /set/Foo?sort=name_asc lands with the right sort.
  // Malformed values silently fall back to the pre-block default.
  const searchParams = useSearchParams()
  const router = useRouter()
  const pathname = usePathname()
  const initialUrlSort = useMemo(
    () => parseSetUrl(new URLSearchParams(searchParams.toString())).sort,
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  )
  const [cards, setCards] = useState<Card[]>([])
  const [loading, setLoading] = useState(true)
  const [sort, setSort] = useState<SortOption>(initialUrlSort)
  const [releaseDate, setReleaseDate] = useState<string | null>(null)
  const [insight, setInsight] = useState<string | null>(null)
  const [priceHistory, setPriceHistory] = useState<any[]>([])
  const [popStats, setPopStats] = useState<PopStats | null>(null)
  const [topMovers, setTopMovers] = useState<TrendCard[]>([])
  const [topFallers, setTopFallers] = useState<TrendCard[]>([])
  const [topSealedMovers, setTopSealedMovers] = useState<TrendCard[]>([])
  const [error, setError] = useState(false)
  // Block 5A-W-48B — read set_metadata.language so the header pill
  // renders "Japanese" for JP sets. Missing / 'en' → nothing renders.
  const [setLanguage, setSetLanguage] = useState<string | null>(null)

  // ── Block 5A-W-50B — user, plan and per-set membership state for
  //    the tile actions. Two paginated queries per set-load;
  //    anonymous users skip both.
  const [user, setUser] = useState<{ id: string } | null>(null)
  const { plan } = useUserPlan(user?.id ?? null)
  const [membership, setMembership] = useState<SetMembership>(EMPTY_MEMBERSHIP)
  const [authPromptOpen, setAuthPromptOpen] = useState<AuthPromptContext | null>(null)
  const [portfolioModalCard, setPortfolioModalCard] = useState<{ card: TileCard; bareSlug: string } | null>(null)

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      setUser(session?.user ? { id: session.user.id } : null)
    })
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_, session) => {
      setUser(session?.user ? { id: session.user.id } : null)
    })
    return () => subscription.unsubscribe()
  }, [])

  useEffect(() => {
    if (!user?.id || !setName) { setMembership(EMPTY_MEMBERSHIP); return }
    let live = true
    loadSetMembership(supabase, user.id, setName).then(m => {
      if (live) setMembership(m)
    })
    return () => { live = false }
  }, [user?.id, setName])

  // Block 5A-W-50B-FIX1 — intent replay on the set page.
  //
  // If the user clicked Watch or Portfolio while logged out, we
  // stored the intent + redirected them to /dashboard/login with
  // returnTo=<this set page>. On return we peek the stored intent
  // and only consume it if origin_set_name matches THIS set. An
  // intent from another set is left alone so it can replay when the
  // user visits the matching set. Every acted-on intent is cleared,
  // whether the replay succeeds or fails, so nothing lingers.
  useEffect(() => {
    if (!user?.id || !setName) return
    const peeked = peekIntendedAction()
    if (!peeked) return
    const payload = peeked.payload as any
    const originSet: string | undefined = payload?.origin_set_name
    // Only act on set-page intents (must carry origin_set_name and
    // match the current set). Older card-page intents without the
    // origin field are handled by CardQuickActions on the card page.
    if (!originSet || originSet !== setName) return
    // Consume — clears whether we act or fail.
    consumeIntendedAction()

    if (peeked.type === 'watchlist_add') {
      ;(async () => {
        trackEvent('watchlist_add_attempt', {
          card_slug:        payload.card_slug,
          set_slug:         setName,
          source_component: 'set_tile_replay',
        })
        const id = await performWatchlistAdd(supabase, user.id, {
          card_slug:   payload.card_slug,
          card_name:   payload.card_name,
          set_name:    payload.set_name,
          image_url:   payload.image_url ?? null,
          card_number: payload.card_number ?? null,
          raw_usd:     payload.raw_usd    ?? null,
          psa10_usd:   payload.psa10_usd  ?? null,
        })
        if (id) {
          trackEvent('watchlist_add_success', {
            card_slug:        payload.card_slug,
            set_slug:         setName,
            source_component: 'set_tile_replay',
          })
          // Refresh membership so the tile flips to Watching.
          loadSetMembership(supabase, user.id, setName).then(setMembership)
        }
      })()
    } else if (peeked.type === 'portfolio_open') {
      // Open the existing portfolio modal with the intent card.
      const tileCard: TileCard = {
        card_slug:     payload.card_slug,
        card_name:     payload.card_name,
        card_number:   payload.card_number ?? null,
        set_name:      payload.set_name,
        raw_usd:       payload.raw_usd    ?? null,
        psa10_usd:     payload.psa10_usd  ?? null,
        image_url:     payload.image_url  ?? null,
        card_url_slug: payload.card_slug,
        is_sealed:     false,
      }
      setPortfolioModalCard({ card: tileCard, bareSlug: payload.card_slug })
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id, setName])

  const buildTileActionProps = (c: Card) => {
    // Block 5A-W-50B-FIX1 — sealed products (booster boxes, ETBs,
    // tins) don't have a matching holding_type in the portfolio
    // schema (HOLDING_TYPES covers raw + graded only), so we hide
    // the tile actions on sealed tiles. Sealed tiles keep their
    // normal navigation to the individual card page.
    if (c.is_sealed) return null
    const bareSlug = normaliseSlug(c.card_slug)
    return {
      card: {
        card_slug:     c.card_slug,
        card_name:     c.card_name,
        card_number:   c.card_number ?? null,
        set_name:      c.set_name,
        raw_usd:       c.raw_usd,
        psa10_usd:     c.psa10_usd,
        image_url:     c.image_url,
        card_url_slug: c.card_url_slug,
        is_sealed:     c.is_sealed,
      } as TileCard,
      bareSlug,
      user,
      plan,
      isWatched:     membership.watched.has(bareSlug),
      isInPortfolio: membership.inPortfolio.has(bareSlug),
      onWatchedChanged: (slug: string, watched: boolean) => {
        setMembership(prev => {
          const next = new Set(prev.watched)
          if (watched) next.add(slug); else next.delete(slug)
          return { ...prev, watched: next }
        })
      },
      onOpenAuthPrompt: (ctx: AuthPromptContext) => setAuthPromptOpen(ctx),
      onOpenPortfolio:  (card: TileCard, bareSlug: string) => {
        setPortfolioModalCard({ card, bareSlug })
      },
    }
  }

  useEffect(() => {
    // Block 5A-W-58D.1 — cancellation guard for the primary loader. If
    // setName / sort changes while a fetch is in flight, `live` flips
    // false and every downstream setState is gated so a stale response
    // cannot overwrite the fresh effect's result — the root cause of
    // the intermittent blank-until-refresh symptom.
    let live = true
    const isLive = () => live

    async function loadData() {
      setLoading(true); setError(false)

      // Attempt primary RPC with exactly one retry after ~500ms.
      const primary = await fetchPrimarySetCardsWithRetry(
        async (n, s) => {
          const { data, error } = await supabase.rpc('get_set_cards_sortable', { set_text: n, sort_col: s })
          return { data, error }
        },
        setName,
        sort,
        isLive,
      )
      if (!live) return
      if (primary.status === 'aborted') return
      if (primary.status === 'failed') {
        setError(true)
        setLoading(false)
        return
      }

      const normalised = (primary.data as any[]).map((c: any) => ({
        ...c,
        is_sealed: c.is_sealed === true || c.is_sealed === 'true',
      }))
      if (!live) return
      setCards(normalised)
      const dateCard = normalised.find((c: any) => c.set_release_date)
      if (dateCard?.set_release_date) setReleaseDate(dateCard.set_release_date)

      // Block 5A-W-58D.2 — after the primary set-cards RPC returns, the
      // remaining loader work is a set of INDEPENDENT queries. Prior to
      // 58D.2 they ran serially, which added ~200-350ms of avoidable
      // wall-clock. They are now fired in one Promise.allSettled group
      // so a single slow query (or a single failure) can no longer
      // block the others. `live` is re-checked once all have settled
      // and before every state write, preserving the 58D.1 cancellation
      // guarantees.
      //
      // Each state update below is derived from exactly one settled
      // result: a failure in psa_set_totals cannot hide movers, a
      // failure in card_trends cannot suppress set_insight, and so on.
      // Fallback fires only when neither this fetch's rows nor the
      // component's existing state already carry a set_release_date.
      // Matches the pre-58D.2 conditional exactly (no extra query on
      // sort changes when the date is already known).
      const needsReleaseFallback = !dateCard?.set_release_date && !releaseDate
      const [
        releaseFallbackRes,
        metaLangRes,
        insightRes,
        histRes,
        popRes,
        trendRes,
      ] = await Promise.allSettled([
        // Release-date fallback — only fires when the release date
        // is unknown after the primary RPC and no earlier render set it.
        needsReleaseFallback
          ? supabase
              .from('cards').select('set_release_date')
              .eq('set_name', setName).not('set_release_date', 'is', null)
              .limit(1).single()
          : Promise.resolve({ data: null, error: null } as any),
        // set_metadata.language — pre-migration deploys may error; the
        // consumer below tolerates a rejected promise as "unknown".
        supabase.from('set_metadata').select('language').eq('set_name', setName).maybeSingle(),
        supabase.rpc('get_set_insight', { set_text: setName }),
        supabase.rpc('get_set_price_history', { set_text: setName }),
        supabase
          .from('psa_set_totals').select('*')
          .or(`set_name.eq.Pokemon ${setName},set_name.ilike.%${setName}%`)
          .order('snapshot_date', { ascending: false }).limit(1),
        supabase
          .from('card_trends').select('card_name, card_slug, current_raw, raw_pct_30d')
          .eq('set_name', setName).not('raw_pct_30d', 'is', null).gt('current_raw', 500)
          .order('raw_pct_30d', { ascending: false }).limit(200),
      ])
      if (!live) return

      // ── release-date fallback ────────────────────────────────────────
      if (releaseFallbackRes.status === 'fulfilled') {
        const rdData = (releaseFallbackRes.value as any)?.data
        if (rdData?.set_release_date) setReleaseDate(rdData.set_release_date)
      }

      // ── set_metadata.language ────────────────────────────────────────
      if (metaLangRes.status === 'fulfilled') {
        const metaLangData = (metaLangRes.value as any)?.data
        if (metaLangData && (metaLangData as any).language) {
          setSetLanguage(((metaLangData as any).language ?? 'en').toString())
        }
      }

      // ── set insight ──────────────────────────────────────────────────
      if (insightRes.status === 'fulfilled') {
        const insightData = (insightRes.value as any)?.data
        if (insightData) setInsight(insightData)
      }

      // ── price history ────────────────────────────────────────────────
      if (histRes.status === 'fulfilled') {
        const histData = (histRes.value as any)?.data
        if (histData) setPriceHistory(histData.map((d: any) => ({ ...d, value_usd: d.value_usd ? d.value_usd * 100 : null })))
      }

      // ── PSA population totals ────────────────────────────────────────
      if (popRes.status === 'fulfilled') {
        const popData = (popRes.value as any)?.data
        if (popData && popData.length > 0) {
          const pop = popData[0]
          setPopStats({ total_graded: pop.total_graded || 0, gem_rate: pop.gem_rate || 0, total_psa10: pop.total_psa_10 || 0 })
        }
      }

      // ── movers (card_trends + enrichment) ────────────────────────────
      // card_trends returns the shortlist; the two enrichment queries
      // (cards.in / card_volume.in) still need those slugs so this
      // remains a two-step chain — but the two enrichment queries fire
      // in parallel and only after the primary parallel group.
      if (trendRes.status === 'fulfilled') {
        const trendData = (trendRes.value as any)?.data
        if (trendData && trendData.length > 0) {
          const slugs = trendData.map((t: any) => t.card_slug)

          const [imgRes, volRes] = await Promise.all([
            supabase.from('cards').select('card_slug, image_url, card_url_slug, is_sealed').in('card_slug', slugs),
            supabase.from('card_volume').select('card_slug, sales_30d, volume_label').in('card_slug', slugs).eq('grade', 'Ungraded'),
          ])
          if (!live) return

          const imgMap: Record<string, any> = {}
          ;(imgRes.data || []).forEach((c: any) => { imgMap[c.card_slug] = c })

          const volMap: Record<string, any> = {}
          ;(volRes.data || []).forEach((v: any) => { volMap[v.card_slug] = v })

          const allEnriched = trendData
            .filter((t: any) => {
              // Must have at least 1 sale per month
              const vol = volMap[t.card_slug]
              return vol && vol.sales_30d >= 1
            })
            .map((t: any) => ({
              card_slug: t.card_slug,
              card_name: t.card_name,
              card_url_slug: imgMap[t.card_slug]?.card_url_slug ?? null,
              raw_usd: t.current_raw / 100,
              raw_pct_30d: t.raw_pct_30d,
              image_url: imgMap[t.card_slug]?.image_url ?? null,
              is_sealed: imgMap[t.card_slug]?.is_sealed === true || imgMap[t.card_slug]?.is_sealed === 'true',
              volume_label: volMap[t.card_slug]?.volume_label ?? null,
            }))

          const isReliable = (t: any) => Math.abs(t.raw_pct_30d ?? 0) <= 300
          const cardEnriched = allEnriched.filter((t: any) => !t.is_sealed)
          const sealedEnriched = allEnriched.filter((t: any) => t.is_sealed)

          setTopMovers(cardEnriched.filter((t: any) => (t.raw_pct_30d ?? 0) > 0 && isReliable(t)).slice(0, 5))
          setTopFallers(
            cardEnriched
              .filter((t: any) => (t.raw_pct_30d ?? 0) < 0 && isReliable(t))
              .sort((a: any, b: any) => (a.raw_pct_30d ?? 0) - (b.raw_pct_30d ?? 0))
              .slice(0, 5)
          )
          setTopSealedMovers(sealedEnriched.filter((t: any) => (t.raw_pct_30d ?? 0) > 0 && isReliable(t)).slice(0, 5))
        }
      }

      if (!live) return
      setLoading(false)
    }
    loadData()
    return () => { live = false }
  }, [setName, sort])

  // Block 5A-W-50E — sync state -> URL for sort. Only the sort key is
  // touched; unrelated params are preserved. Default is omitted.
  useEffect(() => {
    const next = serializeSetUrl({ sort }, new URLSearchParams(searchParams.toString()))
    const nextStr = next.toString()
    const currentStr = searchParams.toString()
    if (nextStr === currentStr) return
    const target = pathname + (nextStr ? `?${nextStr}` : '')
    router.replace(target, { scroll: false })
  }, [sort, pathname, router, searchParams])

  // Block 5A-W-50E — sync URL -> state. Handles browser Back / Forward
  // where popstate updates searchParams before our React state.
  useEffect(() => {
    const parsed = parseSetUrl(new URLSearchParams(searchParams.toString())).sort
    if (parsed !== sort) setSort(parsed)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams])

  // Block 5A-W-50E — sort chip click is a deliberate view reset.
  const handleSortClick = useCallback((next: SortOption) => {
    setSort(next)
    if (typeof window !== 'undefined' && window.scrollY > 0) window.scrollTo(0, 0)
  }, [])

  // Block 5A-W-50E — scroll restoration on the set page. routeKey
  // includes only the meaningful sort param so different sort views
  // save & restore to independent slots. Different sets already have
  // different pathnames.
  const routeKey = useMemo(
    () => normaliseRouteKey(pathname, {
      sort: sort === SET_DEFAULTS.sort ? undefined : sort,
    }),
    [pathname, sort],
  )
  const cardGridRef = useRef<HTMLDivElement | null>(null)
  const findCardAnchor = useCallback((a: RouteAnchor): Element | null => {
    if (a.kind !== 'card' || !cardGridRef.current) return null
    const container = cardGridRef.current
    const safe = typeof CSS !== 'undefined' && typeof CSS.escape === 'function'
      ? CSS.escape(a.id)
      : null
    if (safe) return container.querySelector(`[data-card-slug="${safe}"]`)
    const nodes = container.querySelectorAll('[data-card-slug]')
    for (let i = 0; i < nodes.length; i++) {
      if ((nodes[i] as HTMLElement).getAttribute('data-card-slug') === a.id) return nodes[i]
    }
    return null
  }, [])
  const getCardAnchor = useCallback((): RouteAnchor | null => {
    if (!cardGridRef.current) return null
    const nodes = cardGridRef.current.querySelectorAll('[data-card-slug]')
    for (let i = 0; i < nodes.length; i++) {
      const el = nodes[i] as HTMLElement
      const rect = el.getBoundingClientRect()
      if (rect.top >= 0) {
        const id = el.getAttribute('data-card-slug')
        if (id) return { kind: 'card', id }
      }
    }
    return null
  }, [])
  const scrollReady = !loading && cards.length > 0
  useRouteScrollRestoration({ ready: scrollReady, routeKey, getAnchor: getCardAnchor, findAnchor: findCardAnchor })

  // Block 5A-W-50E — outbound card-tile navigation writes an origin
  // marker keyed by the card URL and flushes scroll for the set
  // routeKey. Modifier-key clicks (Cmd/Ctrl+click, middle-click) are
  // skipped upstream in CardGrid so new-tab flows don't overwrite the
  // marker.
  //
  // Block 5A-W-50E-FIX1 — also writes a pendingOutbound token so the
  // card page's mount validity check preserves the marker.
  const handleTileClick = useCallback((c: Card) => {
    if (!c.card_url_slug) return
    const currentUrl = pathname + (searchParams.toString() ? `?${searchParams.toString()}` : '')
    const destUrl = `/set/${encodeURIComponent(c.set_name)}/card/${c.card_url_slug}`
    saveScrollForRoute(routeKey, getCardAnchor, findCardAnchor)
    setOriginMarker({ fromUrl: currentUrl, destinationUrl: destUrl, expects: 'card' })
    markPendingOutbound(destUrl)
  }, [pathname, searchParams, routeKey, getCardAnchor, findCardAnchor])

  // Block 5A-W-50E-FIX1 — validate the origin marker on mount. When
  // we are here because of an outbound click (marker + pending) or a
  // browser Back (history-return marker), the origin marker is
  // preserved. Otherwise (deep-link, external referrer, unrelated
  // internal link) it is cleared so the visible back button falls
  // back to /browse instead of navigating to a stale browse URL.
  useEffect(() => {
    validateOriginMarkerForArrival(pathname)
  }, [pathname])

  // Block 5A-W-50E — smart back for the SetHeader "Browse all sets"
  // link. Falls back to /browse for direct visits.
  //
  // Block 5A-W-50E-FIX1 — router.back() is no longer used from here.
  // We navigate deterministically to marker.fromUrl via router.replace
  // so a stale marker cannot land the user on an unrelated page.
  const handleBrowseBack = useMemo(
    () => makeSmartBackHandler(
      { push: (url: string) => router.push(url), replace: (url: string) => router.replace(url) },
      { currentPathname: pathname, fallbackUrl: '/browse', expectOriginPath: '/browse' },
    ),
    [router, pathname],
  )

  const regularCards = cards.filter(c => !c.is_sealed)
  const sealedCards = cards.filter(c => c.is_sealed)
  const cardsWithPrice = regularCards.filter(c => c.raw_usd && c.raw_usd > 0)
  const totalSetValue = cardsWithPrice.reduce((sum, c) => sum + (c.raw_usd || 0), 0)
  const avgCardValue = cardsWithPrice.length > 0 ? totalSetValue / cardsWithPrice.length : 0
  const cardsWithPsa10 = regularCards.filter(c => c.psa10_usd && c.psa10_usd > 0)
  const hasPop = !!(popStats && popStats.total_graded > 0)
  const hasMovers = topMovers.length > 0 || topFallers.length > 0 || topSealedMovers.length > 0

  return (
    <div style={{ maxWidth: 960, margin: '0 auto', padding: '36px 24px' }}>
      {/* Block 5A-W-46B — BreadcrumbSchema now emitted by page.tsx
          (server). SetStructuredData stays here until the set card
          list is fetched server-side too — do NOT swap that helper
          up without matching the fetch move. */}
      <SetStructuredData setName={setName} slug={encodeURIComponent(setName)} cards={regularCards} releaseDate={releaseDate} />
      {/* Block 5A-W-48B — resolveLanguage falls back to the "Japanese "
          name-prefix convention if set_metadata.language isn't yet
          returned (e.g. RPC fetch failed, or the migration isn't
          applied yet). This guarantees the JP badge appears for any
          Japanese pilot set imported by the seeder. */}
      <SetHeader setName={setName} releaseDate={releaseDate}
        language={resolveLanguage(setLanguage, setName)}
        onBackClick={handleBrowseBack} />

      {/* Block 5A-W-50C — portfolio completion sits directly under the
          set header. Same numerator + denominator as the browse tile.
          Only renders for authenticated users who own >=1 card from
          this set. Denominator = regularCards.length (non-sealed
          singles), matching the SetPageClient card grid. Membership
          is already loaded by W50B — no additional query. */}
      {user && membership.inPortfolio.size > 0 && !loading && regularCards.length > 0 && (
        <div style={{ margin: '-8px 0 20px' }}>
          <SetCompletionProgress
            ownedDistinct={membership.inPortfolio.size}
            totalEligible={regularCards.length}
            variant="full"
            setName={displaySetName(setName, resolveLanguage(setLanguage, setName))}
          />
        </div>
      )}

      {/* ── Section jump links + eBay listing chips ── */}
      <SetHeroLinks
        setName={setName}
        cardsCount={loading ? null : regularCards.length}
        sealedCount={loading ? 0 : sealedCards.length}
      />

      {/* ── Chat ── */}
      <div style={{ marginBottom: 20 }}>
        <InlineChat
          setContext={{
            // Block 5A-W-52A — set page identity is structural too. No
            // card_context because there is no active card yet.
            setName: setName,
            language: resolveLanguage(setLanguage, setName) === 'jp' ? 'jp' : 'en',
          }}
          suggestedPrompts={[
            `What are the most valuable cards in ${setName}?`,
            `Is ${setName} worth investing in right now?`,
            `Which ${setName} cards are trending up?`,
            `What's the grading outlook for ${setName}?`,
          ]}
        />
      </div>

      {/* ── Set overview stats ── */}
      {!loading && cardsWithPrice.length > 0 && (
        <Panel style={{ marginBottom: 14 }}>
          <SectionLabel>Set Overview</SectionLabel>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(120px, 1fr))', gap: 10 }}>
            {[
              { val: regularCards.length.toString(), label: 'Total Cards' },
              { val: `$${(totalSetValue / 100).toFixed(0)}`, label: 'Complete Set Value' },
              { val: `$${(avgCardValue / 100).toFixed(2)}`, label: 'Avg Card (Raw)' },
              { val: cardsWithPsa10.length.toString(), label: 'Cards w/ PSA 10 Data' },
              ...(sealedCards.length > 0 ? [{ val: sealedCards.length.toString(), label: 'Sealed Products' }] : []),
              ...(hasPop && popStats ? [
                { val: popStats.total_graded.toLocaleString(), label: 'Total PSA Graded' },
                { val: `${popStats.gem_rate.toFixed(1)}%`, label: 'Set Gem Rate', color: popStats.gem_rate < 5 ? 'var(--green)' : undefined },
              ] : []),
            ].map(({ val, label, color }: any) => (
              <div key={label} style={{ background: 'var(--bg-light)', borderRadius: 10, padding: '10px 12px' }}>
                <div style={{ ...statValue, color: color ?? 'var(--text)' }}>{val}</div>
                <div style={statLabel}>{label}</div>
              </div>
            ))}
          </div>
        </Panel>
      )}

      {/* ── Set insight ── */}
      {insight && (
        <div style={{ background: 'var(--card)', border: '1px solid var(--border)', borderLeft: '3px solid var(--primary)', borderRadius: 12, padding: '14px 18px', marginBottom: 14 }}>
          <div style={{ fontSize: 10, fontWeight: 800, textTransform: 'uppercase', letterSpacing: 1.8, color: 'var(--primary)', marginBottom: 7, fontFamily: "'Figtree', sans-serif" }}>Set Insight</div>
          <p style={{ fontSize: 13, lineHeight: 1.6, color: 'var(--text)', margin: 0, fontFamily: "'Figtree', sans-serif" }}>{insight}</p>
        </div>
      )}

      {/* ── Movers ── */}
      {hasMovers && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))', gap: 12, marginBottom: 14 }}>
          {topMovers.length > 0 && (
            <Panel>
              <SectionLabel>📈 Top Risers — Cards (30d)</SectionLabel>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                {topMovers.map((card, i) => <MoverRow key={i} card={card} setName={setName} positive />)}
              </div>
            </Panel>
          )}
          {topFallers.length > 0 && (
            <Panel>
              <SectionLabel>📉 Top Fallers — Cards (30d)</SectionLabel>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                {topFallers.map((card, i) => <MoverRow key={i} card={card} setName={setName} positive={false} />)}
              </div>
            </Panel>
          )}
          {topSealedMovers.length > 0 && (
            <Panel>
              <SectionLabel>📦 Top Risers — Sealed (30d)</SectionLabel>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                {topSealedMovers.map((card, i) => <MoverRow key={i} card={card} setName={setName} positive />)}
              </div>
            </Panel>
          )}
        </div>
      )}

      {/* ── PSA Population ── */}
      {hasPop && popStats && !insight && (
        <Panel style={{ marginBottom: 14 }}>
          <SectionLabel>PSA Population</SectionLabel>
          <div style={{ display: 'flex', gap: 24 }}>
            <div><div style={statValue}>{popStats.total_graded.toLocaleString()}</div><div style={statLabel}>Total Graded</div></div>
            <div><div style={statValue}>{popStats.total_psa10.toLocaleString()}</div><div style={statLabel}>PSA 10s</div></div>
            <div>
              <div style={{ ...statValue, color: popStats.gem_rate < 5 ? 'var(--green)' : 'var(--text)' }}>{popStats.gem_rate.toFixed(1)}%</div>
              <div style={statLabel}>Gem Rate</div>
            </div>
          </div>
        </Panel>
      )}

      {/* ── Price Chart ── */}
      {priceHistory.length > 1 && (
        <div style={{ background: 'var(--card)', borderRadius: 14, border: '1px solid var(--border)', padding: '20px 20px 32px', marginBottom: 16 }}>
          <SectionLabel>Set Price History</SectionLabel>
          <PriceChart data={priceHistory} series={[{ key: 'value_usd', color: 'var(--accent)', label: 'Total Set Value', defaultOn: true }]} height={220} />
        </div>
      )}

      {/* ── Sort + card count ── */}
      <div id="cards" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12, flexWrap: 'wrap', gap: 8 }}>
        <p style={{ color: 'var(--text-muted)', fontSize: 13, margin: 0, fontFamily: "'Figtree', sans-serif" }}>
          {regularCards.length} cards
          {sealedCards.length > 0 && <span style={{ marginLeft: 6, opacity: 0.6 }}>· <a href="#sealed" style={{ color: 'var(--text-muted)', textDecoration: 'none' }}>{sealedCards.length} sealed ↓</a></span>}
        </p>
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          {(([
            ['raw_desc',   'Highest Raw'],
            ['raw_asc',    'Lowest Raw'],
            ['psa10_desc', 'Highest PSA 10'],
            ['name_asc',   'Name A-Z'],
            ['number_asc', 'Card #'],
          ] as [SortOption, string][]).map(([val, label]) => (
            <button key={val} className={`sort-btn ${sort === val ? 'active' : ''}`} onClick={() => handleSortClick(val)} style={{ fontFamily: "'Figtree', sans-serif" }}>{label}</button>
          )))}
        </div>
      </div>

      {/* ── Card grid ── */}
      {loading ? (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))', gap: 12 }}>
          {Array.from({ length: 12 }).map((_, i) => <div key={i} className="skeleton" style={{ height: 240, borderRadius: 12 }} />)}
        </div>
      ) : error ? (
        <div style={{ background: 'var(--card)', borderRadius: 14, border: '1px solid var(--border)', padding: '40px 24px', textAlign: 'center' }}>
          <p style={{ color: 'var(--text-muted)', fontSize: 14, fontFamily: "'Figtree', sans-serif" }}>Could not load cards for this set. Try refreshing the page.</p>
        </div>
      ) : (
        <>
          <CardGrid cards={regularCards} setName={setName} buildTileActionProps={buildTileActionProps} gridRef={cardGridRef} onTileClick={handleTileClick} />
          <SealedSection sealedCards={sealedCards} setName={setName} buildTileActionProps={buildTileActionProps} onTileClick={handleTileClick} />
        </>
      )}

      {/* FAQ — visible content + FAQPage schema */}
      {!loading && regularCards.length > 0 && (
        <FAQ items={getSetFaqItems({
          setName,
          cards: regularCards,
          releaseDate,
          totalSetValueCents: totalSetValue,
          cardsTracked: regularCards.length,
        })} />
      )}

      {/* Block 5A-W-50B — shared modal state for the tile actions. */}
      <AuthPromptModal
        open={authPromptOpen !== null}
        context={authPromptOpen ?? 'watchlist'}
        returnTo={typeof window !== 'undefined' ? window.location.pathname + window.location.search : '/'}
        onClose={() => setAuthPromptOpen(null)}
      />
      {portfolioModalCard && user && (
        <CardPortfolioAddModal
          card={{
            card_slug:     portfolioModalCard.card.card_slug,
            card_name:     portfolioModalCard.card.card_name,
            set_name:      portfolioModalCard.card.set_name,
            card_url_slug: portfolioModalCard.card.card_url_slug,
            image_url:     portfolioModalCard.card.image_url,
            card_number:   portfolioModalCard.card.card_number,
            raw_usd:       portfolioModalCard.card.raw_usd,
            psa10_usd:     portfolioModalCard.card.psa10_usd,
          }}
          cardSlug={portfolioModalCard.bareSlug}
          user={user}
          onClose={() => {
            setPortfolioModalCard(null)
            // Refresh membership so the tile flips to "Owned" after
            // a successful add. Avoids per-tile queries by refreshing
            // just the two-query bulk load.
            if (user?.id) loadSetMembership(supabase, user.id, setName).then(setMembership)
          }}
        />
      )}
    </div>
  )
}

// Block 5A-W-58G — set-page hero eBay chips wrapper.
// Extracted so a single IntersectionObserver can fire ONE
// affiliate_link_view for the whole block, and each anchor can fire
// its own affiliate_click carrying the correct marketplace. Visible
// UI is byte-identical to the pre-58G inline anchors.
function SetHeroLinks({
  setName,
  cardsCount,
  sealedCount,
}: {
  setName:     string
  cardsCount:  number | null
  sealedCount: number
}) {
  const boxRef = useRef<HTMLDivElement | null>(null)
  const firedRef = useRef(false)
  useEffect(() => {
    if (firedRef.current) return
    if (typeof window === 'undefined' || typeof IntersectionObserver === 'undefined') return
    const el = boxRef.current
    if (!el) return
    const io = new IntersectionObserver((entries) => {
      for (const entry of entries) {
        if (entry.isIntersecting && !firedRef.current) {
          firedRef.current = true
          trackEvent('affiliate_link_view', {
            placement:          'set_page_hero',
            intent:             'set_search',
            set_slug:           setName,
            custom_tracking_id: `set-${setName}`,
            source_component:   'set_page_hero_block',
          })
          io.disconnect()
          break
        }
      }
    }, { threshold: 0.5 })
    io.observe(el)
    return () => io.disconnect()
  }, [setName])

  function onEbayClick(marketplace: 'UK' | 'US') {
    trackEvent('affiliate_click', {
      placement:          'set_page_hero',
      intent:             'set_search',
      marketplace,
      set_slug:           setName,
      custom_tracking_id: `set-${setName}`,
      source_component:   'set_page_hero_block',
    })
  }

  const chip: React.CSSProperties = { display: 'inline-flex', alignItems: 'center', gap: 6, background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 20, padding: '5px 14px', textDecoration: 'none', fontSize: 12, fontFamily: "'Figtree', sans-serif", fontWeight: 600, transition: 'border-color 0.15s, color 0.15s' }

  return (
    <div ref={boxRef} style={{ display: 'flex', gap: 8, marginBottom: 20, flexWrap: 'wrap' }}>
      <a href="#cards" style={{ ...chip, color: 'var(--text)' }}
        onMouseEnter={e => { (e.currentTarget as HTMLAnchorElement).style.borderColor = 'var(--primary)' }}
        onMouseLeave={e => { (e.currentTarget as HTMLAnchorElement).style.borderColor = 'var(--border)' }}>
        🃏 Cards {cardsCount != null && cardsCount > 0 && <span style={{ color: 'var(--text-muted)', fontWeight: 400 }}>({cardsCount})</span>}
      </a>
      {sealedCount > 0 && (
        <a href="#sealed" style={{ ...chip, color: 'var(--text)' }}
          onMouseEnter={e => { (e.currentTarget as HTMLAnchorElement).style.borderColor = 'var(--primary)' }}
          onMouseLeave={e => { (e.currentTarget as HTMLAnchorElement).style.borderColor = 'var(--border)' }}>
          📦 Sealed Product <span style={{ color: 'var(--text-muted)', fontWeight: 400 }}>({sealedCount})</span>
        </a>
      )}
      <a href={getEbayUkUrl(setName, `set-${setName}`)} target="_blank" rel="sponsored noopener noreferrer"
        onClick={() => onEbayClick('UK')}
        style={{ ...chip, color: 'var(--text-muted)' }}
        onMouseEnter={e => { const el = e.currentTarget as HTMLAnchorElement; el.style.borderColor = 'var(--primary)'; el.style.color = 'var(--text)' }}
        onMouseLeave={e => { const el = e.currentTarget as HTMLAnchorElement; el.style.borderColor = 'var(--border)'; el.style.color = 'var(--text-muted)' }}>
        🇬🇧 UK Listings
      </a>
      <a href={getEbayUsUrl(setName, `set-${setName}`)} target="_blank" rel="sponsored noopener noreferrer"
        onClick={() => onEbayClick('US')}
        style={{ ...chip, color: 'var(--text-muted)' }}
        onMouseEnter={e => { const el = e.currentTarget as HTMLAnchorElement; el.style.borderColor = 'var(--primary)'; el.style.color = 'var(--text)' }}
        onMouseLeave={e => { const el = e.currentTarget as HTMLAnchorElement; el.style.borderColor = 'var(--border)'; el.style.color = 'var(--text-muted)' }}>
        🇺🇸 US Listings
      </a>
    </div>
  )
}