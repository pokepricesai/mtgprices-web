'use client'
import { useEffect, useMemo, useRef, useState } from 'react'
import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import { supabase, formatPct } from '@/lib/supabase'
import InlineChat from '@/components/InlineChat'
import { cleanCardName } from '@/lib/chat/cardContext'
import PriceChart, { type ChartSeries } from '@/components/PriceChart'
import GradeLadder, { type GradePrices } from '@/components/GradeLadder'
// Block 5A-W-46B — CardStructuredData + BreadcrumbSchema moved to the
// server component (page.tsx) so they appear in initial HTML. Do NOT
// re-import here; a duplicate BreadcrumbList in the same page would
// confuse Google's rich-result parser and could invalidate both.
import CardQuickActions from '@/components/CardQuickActions'
import EbayCardPriceActions from '@/components/affiliate/EbayCardPriceActions'
import EbayCardPrimaryAction from '@/components/affiliate/EbayCardPrimaryAction'
import JapaneseBadge from '@/components/JapaneseBadge'
import { resolveLanguage, displaySetName } from '@/lib/cardLanguage'
import FAQ from '@/components/FAQ'
import { getCardFaqItems } from '@/lib/faqs'
import { getSetAssets } from '@/lib/setAssets'
// Block 5A-W-50E — smart back for the set breadcrumb so the card
// page returns to the exact originating set URL (preserving sort
// and any future set-page query state).
// Block 5A-W-50E-FIX1 — validity check discards a stale origin
// marker on a non-click-through arrival, so back never navigates to
// an unrelated old set URL.
import { makeSmartBackHandler } from '@/lib/nav/smartBack'
import { validateOriginMarkerForArrival } from '@/lib/nav/destinationValidity'

// ─── Constants ────────────────────────────────────────────────────────────────

// Chart series available on the card page price history. Only Raw is visible
// by default; the rest are revealed as toggle pills under the chart so
// collectors can compare tiers without overwhelming the default view.
// Series with no data anywhere in the history are filtered out by PriceChart
// itself, so cards without (e.g.) ACE 10 sales just won't show that toggle.
const CARD_CHART_SERIES: ChartSeries[] = [
  { key: 'raw_usd',           label: 'Raw',             color: 'var(--primary)', defaultOn: true },
  { key: 'psa7_usd',          label: 'PSA 7',           color: '#94a3b8' },
  { key: 'psa8_usd',          label: 'PSA 8',           color: '#60a5fa' },
  { key: 'psa9_usd',          label: 'PSA 9',           color: '#3b82f6' },
  { key: 'psa10_usd',         label: 'PSA 10',          color: 'var(--accent)' },
  { key: 'cgc95_usd',         label: 'CGC 9.5',         color: '#a78bfa' },
  { key: 'cgc10_usd',         label: 'CGC 10',          color: '#8b5cf6' },
  { key: 'bgs10_usd',         label: 'BGS 10',          color: '#06b6d4' },
  { key: 'bgs10black_usd',    label: 'BGS 10 Black',    color: '#0f172a' },
  { key: 'cgc10pristine_usd', label: 'CGC 10 Pristine', color: '#a855f7' },
  { key: 'sgc10_usd',         label: 'SGC 10',          color: '#22c55e' },
  { key: 'tag10_usd',         label: 'TAG 10',          color: '#f59e0b' },
  { key: 'ace10_usd',         label: 'ACE 10',          color: '#ef4444' },
]

const NON_POKEMON_PREFIXES = [
  'energy', 'basic energy', 'special energy',
  'trainer', 'supporter', 'item', 'stadium', 'tool',
  'poké ball', 'pokeball', 'full heal', 'potion', 'revive',
  'professor', 'lillie', 'cynthia', 'marnie', 'hop', 'boss',
  'ultra ball', 'quick ball', 'level ball', 'nest ball',
  'great ball', 'master ball', 'timer ball',
]

const NON_POKEMON_SUFFIXES = [
  'energy', ' trainer', ' supporter', ' item', ' stadium',
]

// ─── Helpers ──────────────────────────────────────────────────────────────────

// Format card number for display: prefer "95/165" when set has multiple cards, else "#95"
function formatCardNumber(
  cardNumber: string | number | null | undefined,
  cardNumberDisplay: string | null | undefined,
  setPrintedTotal: string | number | null | undefined,
): string {
  const totalNum = setPrintedTotal ? Number(setPrintedTotal) : 0
  if (cardNumberDisplay && totalNum > 1) return cardNumberDisplay
  if (cardNumber) return `#${cardNumber}`
  return ''
}

function extractVariant(cardName: string): string | null {
  const match = cardName.match(/\[([^\]]+)\]/)
  return match ? match[1] : null
}

function extractSpeciesSlug(cardName: string): string | null {
  const lower = cardName.toLowerCase()
  for (const prefix of NON_POKEMON_PREFIXES) {
    if (lower.startsWith(prefix)) return null
  }
  for (const suffix of NON_POKEMON_SUFFIXES) {
    if (lower.endsWith(suffix)) return null
  }
  const cleaned = cardName
    .replace(/\s*#\d+.*$/, '')
    .replace(/\[.*?\]/g, '')
    .replace(/\b(ex|EX|V|VMAX|VSTAR|GX|Tag Team|Prime|LV\.X|Break|Legend|SP|FB|GL|C|4|δ)\b.*/g, '')
    .trim()
  if (!cleaned) return null
  const slug = cleaned.split(/\s+/)[0].toLowerCase().replace(/[^a-z0-9-]/g, '')
  if (slug.length < 3) return null
  return slug
}

// ─── Data quality ─────────────────────────────────────────────────────────────

type PctQuality = 'clean' | 'warn' | 'suppress'

const PERIOD_THRESHOLDS: Record<string, { warn: number; suppress: number }> = {
  '7d':   { warn: 50,       suppress: 200      },
  '30d':  { warn: 100,      suppress: 300      },
  '90d':  { warn: 200,      suppress: 500      },
  '180d': { warn: 300,      suppress: 700      },
  '1y':   { warn: 400,      suppress: 900      },
  '2y':   { warn: Infinity, suppress: Infinity },
  '5y':   { warn: Infinity, suppress: Infinity },
}

function pctQuality(pct: number | null, period = '30d'): PctQuality {
  if (pct == null) return 'clean'
  const abs = Math.abs(pct)
  const thresholds = PERIOD_THRESHOLDS[period] ?? PERIOD_THRESHOLDS['30d']
  if (abs > thresholds.suppress) return 'suppress'
  if (abs > thresholds.warn) return 'warn'
  return 'clean'
}

// ─── Fallback insight ─────────────────────────────────────────────────────────

function generateFallbackInsight(card: any, trend: any, metrics: any, psaPop: any): string | null {
  if (!card) return null
  const raw = metrics?.results?.[0] || metrics || {}
  const parts: string[] = []
  const rawUsd   = card.raw_usd   ? (card.raw_usd   / 100).toFixed(2) : null
  const psa10Usd = card.psa10_usd ? (card.psa10_usd / 100).toFixed(2) : null

  if (rawUsd) {
    if (psa10Usd) {
      const multiple = (card.psa10_usd / card.raw_usd).toFixed(1)
      parts.push(`${card.card_name} from ${card.set_name} currently trades at $${rawUsd} raw, with PSA 10 copies reaching $${psa10Usd} — a ${multiple}x grade premium.`)
    } else {
      parts.push(`${card.card_name} from ${card.set_name} currently trades at $${rawUsd} raw.`)
    }
  }

  const pct30d = trend?.raw_pct_30d
  const pct90d = trend?.raw_pct_90d
  const q30 = pctQuality(pct30d, '30d')
  const q90 = pctQuality(pct90d, '90d')

  if (pct30d != null && q30 === 'clean' && q90 === 'clean' && pct90d != null) {
    const dir30 = pct30d > 0 ? 'up' : 'down'
    const dir90 = pct90d > 0 ? 'up' : 'down'
    if (Math.sign(pct30d) === Math.sign(pct90d)) {
      parts.push(`The card has moved ${dir30} ${Math.abs(pct30d).toFixed(1)}% over the past 30 days and ${dir90} ${Math.abs(pct90d).toFixed(1)}% over 90 days, suggesting ${pct30d > 0 ? 'sustained buying interest' : 'continued softness'}.`)
    } else {
      parts.push(`Price is ${dir30} ${Math.abs(pct30d).toFixed(1)}% in the last 30 days, though the 90-day trend tells a different story at ${pct90d > 0 ? '+' : ''}${pct90d.toFixed(1)}% — worth watching for a clearer direction.`)
    }
  } else if (pct30d != null && q30 === 'clean') {
    const dir = pct30d > 0 ? 'gained' : 'lost'
    parts.push(`The card has ${dir} ${Math.abs(pct30d).toFixed(1)}% over the past 30 days.`)
  }

  if (psaPop && psaPop.total_graded > 0 && psaPop.gem_rate != null) {
    const gemRate = parseFloat(psaPop.gem_rate)
    const total = psaPop.total_graded.toLocaleString()
    if (gemRate < 5) {
      parts.push(`Only ${gemRate.toFixed(1)}% of ${total} graded copies have achieved PSA 10, making gem-quality examples genuinely scarce.`)
    } else if (gemRate > 40) {
      parts.push(`With ${gemRate.toFixed(1)}% of ${total} graded copies receiving PSA 10, gem examples are relatively plentiful — which moderates the grade premium.`)
    } else if (card.psa10_usd && card.raw_usd) {
      parts.push(`PSA population stands at ${total} graded with a ${gemRate.toFixed(1)}% gem rate.`)
    }
  }

  const drawdown = raw.drawdown_pct != null ? parseFloat(raw.drawdown_pct) : null
  if (drawdown != null && drawdown < -30 && parts.length < 3) {
    parts.push(`At ${drawdown.toFixed(0)}% below its all-time high, the card sits at a notable discount to peak — a potential entry point for patient collectors.`)
  } else if (drawdown != null && drawdown > -5 && parts.length < 3) {
    parts.push(`The card is trading near its all-time high.`)
  }

  if (parts.length === 0) return null
  return parts.slice(0, 3).join(' ')
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function TrendCell({ val, label }: { val: number | null; label: string }) {
  const quality = pctQuality(val, label)
  if (val == null || quality === 'suppress') {
    return (
      <div>
        <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 2, fontFamily: "'Figtree', sans-serif" }}>{label}</div>
        <div style={{ fontSize: 15, fontWeight: 700, color: 'var(--border)', fontFamily: "'Figtree', sans-serif" }}>—</div>
      </div>
    )
  }
  if (quality === 'warn') {
    return (
      <div title="Unusually large move — may reflect stale price anchor. Check sold listings.">
        <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 2, fontFamily: "'Figtree', sans-serif" }}>{label}</div>
        <div style={{ fontSize: 15, fontWeight: 700, color: '#e07b39', fontFamily: "'Figtree', sans-serif" }}>
          ⚠ {val > 0 ? '+' : ''}{val.toFixed(1)}%
        </div>
      </div>
    )
  }
  const f = formatPct(val)
  return (
    <div>
      <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 2, fontFamily: "'Figtree', sans-serif" }}>{label}</div>
      <div style={{ fontSize: 15, fontWeight: 700, color: f.color, fontFamily: "'Figtree', sans-serif" }}>{f.text}</div>
    </div>
  )
}

function HeroBanner({ trend, hasInsight }: { trend: any; hasInsight: boolean }) {
  if (!trend || hasInsight) return null
  const periods = [
    { label: '30d', val: trend.raw_pct_30d },
    { label: '7d',  val: trend.raw_pct_7d  },
    { label: '90d', val: trend.raw_pct_90d  },
  ]
  const main = periods.find(p => p.val != null)
  if (!main || main.val == null) return null
  const quality = pctQuality(main.val, main.label)
  if (quality === 'suppress') return null
  const isUp = main.val > 0
  const absPct = Math.abs(main.val)
  if (quality === 'warn') {
    return (
      <div style={{ background: 'rgba(224,123,57,0.08)', border: '1px solid rgba(224,123,57,0.25)', borderLeft: '3px solid #e07b39', borderRadius: 10, padding: '10px 14px', marginBottom: 16, fontSize: 13, lineHeight: 1.6, color: 'var(--text)', fontFamily: "'Figtree', sans-serif" }}>
        ⚠️ <strong>{isUp ? 'Up' : 'Down'} {absPct.toFixed(0)}% in {main.label}</strong> — unusually large move. This may reflect a stale price anchor rather than real market activity. Check recent sold listings before drawing conclusions.
      </div>
    )
  }
  return (
    <div style={{ background: isUp ? 'rgba(39,174,96,0.06)' : 'rgba(239,68,68,0.06)', border: `1px solid ${isUp ? 'rgba(39,174,96,0.2)' : 'rgba(239,68,68,0.2)'}`, borderLeft: `3px solid ${isUp ? 'var(--green)' : '#ef4444'}`, borderRadius: 10, padding: '10px 14px', marginBottom: 16, fontSize: 13, lineHeight: 1.6, color: 'var(--text)', fontFamily: "'Figtree', sans-serif" }}>
      <strong>{isUp ? 'Up' : 'Down'} {absPct.toFixed(1)}% in {main.label}</strong>
    </div>
  )
}

function SectionLabel({ children, style = {} }: { children: React.ReactNode; style?: React.CSSProperties }) {
  return (
    <div style={{ fontSize: 10, fontWeight: 800, textTransform: 'uppercase', letterSpacing: 1.8, color: 'var(--text-muted)', marginBottom: 14, fontFamily: "'Figtree', sans-serif", ...style }}>
      {children}
    </div>
  )
}

function Panel({ children, style = {} }: { children: React.ReactNode; style?: React.CSSProperties }) {
  return (
    <div style={{ background: 'var(--card)', borderRadius: 14, border: '1px solid var(--border)', padding: '18px 20px', marginTop: 20, ...style }}>
      {children}
    </div>
  )
}

function MeterBar({ value, color = 'var(--primary)' }: { value: number; color?: string }) {
  const pct = Math.min(100, Math.max(0, value))
  return (
    <div style={{ height: 6, background: 'var(--bg-light)', borderRadius: 99, overflow: 'hidden' }}>
      <div style={{ height: '100%', width: `${pct}%`, background: color, borderRadius: 99, transition: 'width 0.6s ease' }} />
    </div>
  )
}

function StatTile({ label, value, sub, highlight = false }: { label: string; value: string; sub?: string; highlight?: boolean }) {
  return (
    <div style={{ background: highlight ? 'rgba(26,95,173,0.06)' : 'var(--bg-light)', border: `1px solid ${highlight ? 'rgba(26,95,173,0.2)' : 'transparent'}`, borderRadius: 10, padding: '12px 14px' }}>
      <div style={{ fontSize: 18, fontWeight: 800, color: 'var(--text)', fontFamily: "'Figtree', sans-serif", lineHeight: 1, marginBottom: 4 }}>{value}</div>
      <div style={{ fontSize: 10, fontWeight: 700, color: 'var(--text-muted)', fontFamily: "'Figtree', sans-serif", textTransform: 'uppercase', letterSpacing: 1 }}>{label}</div>
      {sub && <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 3, fontFamily: "'Figtree', sans-serif" }}>{sub}</div>}
    </div>
  )
}

function VolumePill({ label }: { label: string }) {
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 11, fontWeight: 700, color: '#3b82f6', background: 'rgba(59,130,246,0.08)', border: '1px solid rgba(59,130,246,0.2)', borderRadius: 20, padding: '2px 10px', verticalAlign: 'middle', fontFamily: "'Figtree', sans-serif" }}>
      {label}
    </span>
  )
}

// Renders the main card image with an intentional 🃏 fallback whenever
// image_url is missing OR the browser fails to load the remote image
// (the 57A audit found 3,060 cards with broken image_url values —
// without onError, users saw the browser's broken-image icon instead
// of the fallback).
export function CardHeroImage({ src, alt }: { src?: string | null; alt: string }) {
  const [failed, setFailed] = useState(false)
  const showFallback = !src || failed
  if (showFallback) {
    return (
      <div style={{ width: 220, height: 308, background: 'var(--bg)', borderRadius: 12, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text-muted)', fontSize: 40, border: '1px solid var(--border)' }} aria-label={alt} role="img">🃏</div>
    )
  }
  return (
    <img
      src={src as string}
      alt={alt}
      fetchPriority="high"
      loading="eager"
      onError={() => setFailed(true)}
      style={{ width: 220, borderRadius: 12, boxShadow: '0 8px 32px rgba(0,0,0,0.15)' }}
    />
  )
}

// ─── Main ─────────────────────────────────────────────────────────────────────

// Block 5A-W-46C / W46C-FIX1 / W46D — CardPageClient props:
//   * initialCardData (W46D): the card row page.tsx already fetched
//     via getCard(). When supplied, the card state initialises from
//     this value AND the loading skeleton is bypassed. The client
//     SKIPS its duplicate get_card_detail_by_url_slug call so the
//     H1 + Quick Facts appear in initial HTML rather than after
//     hydration. `undefined` (or explicit null) preserves the pre-
//     W46D behaviour: render the loading skeleton and fetch the
//     card from the client — a safe fallback for any error path.
//   * initialTrendData (W46C-FIX1): the trend RPC row the server
//     page pre-fetched for the Quick Facts panel. When present, the
//     client SKIPS the duplicate get_card_trends_detail call.
//   * quickFactsSlot: a server-rendered ReactNode dropped in AFTER
//     the H1 hero section and BEFORE the price-history chart.
//   * seoIntroSlot (Block 5A-W-58H): an optional server-rendered
//     short paragraph, dropped in AFTER quickFactsSlot and BEFORE
//     the price-history chart. Populated for a small, hand-picked
//     set of high-opportunity card pages only; null for every other
//     card.
export type CardPageClientProps = {
  setName:     string
  cardUrlSlug: string
  initialCardData?:  unknown
  initialTrendData?: unknown
  quickFactsSlot?:   React.ReactNode
  seoIntroSlot?:     React.ReactNode
}

export default function CardPageClient({
  setName, cardUrlSlug, initialCardData, initialTrendData, quickFactsSlot, seoIntroSlot,
}: CardPageClientProps) {
  // W46D — treat any value !== undefined as "server supplied data".
  // A legitimate null from the server means "no card row exists" but
  // page.tsx handles that via notFound(); we only get here with a
  // real card, so null-here can be treated the same as undefined
  // (fall back to a client fetch). We use `undefined` as the "did
  // the server hand us anything?" marker so a future null becomes a
  // conscious change rather than an accidental one.
  // Block 5A-W-50E — router + pathname for the smart-back breadcrumb.
  const router = useRouter()
  const pathname = usePathname()
  // Block 5A-W-50E-FIX1 — validate the origin marker on mount so a
  // stale marker from an earlier visit cannot be reused after
  // unrelated navigation.
  useEffect(() => {
    validateOriginMarkerForArrival(pathname)
  }, [pathname])

  const serverProvidedCard = initialCardData !== undefined && initialCardData !== null
  const [card,         setCard]         = useState<any>(serverProvidedCard ? initialCardData : null)
  const [trend,        setTrend]        = useState<any>(initialTrendData ?? null)
  const [metrics,      setMetrics]      = useState<any>(null)
  const [priceHistory, setPriceHistory] = useState<any[]>([])
  const [insight,      setInsight]      = useState<string | null>(null)
  const [psaPop,       setPsaPop]       = useState<any | null>(null)
  const [volumeLabel,  setVolumeLabel]  = useState<string | null>(null)
  // W46D — skip the loading skeleton when the server supplied the card.
  // The visible hero (image + H1 + set name + hero banner + prices +
  // trend chips) is present in the initial HTML. Metrics / price
  // history / insight / volume / PSA population arrive in a follow-up
  // client fetch below, but their consumers render conditionally so
  // the page stays complete without them.
  const [loading,      setLoading]      = useState(!serverProvidedCard)

  useEffect(() => {
    async function loadCard() {
      // W46D — if the server handed us a card row, skip the duplicate
      // get_card_detail_by_url_slug RPC entirely. We still need the
      // *supplementary* RPCs (metrics, price history, insight, volume,
      // PSA population, and maybe trend) but the card-detail call is
      // the biggest / most-cached one, and getting rid of it is the
      // point of this block.
      let cardData: any = null
      if (serverProvidedCard) {
        cardData = initialCardData
      } else {
        const { data } = await supabase.rpc('get_card_detail_by_url_slug', {
          p_set_name: setName,
          p_card_url_slug: cardUrlSlug,
        })
        cardData = data
        if (!cardData) { setLoading(false); return }
        setCard(cardData)
      }

      const slug = cardData.card_slug

      // W46C-FIX1 — skip get_card_trends_detail when the server page
      // already handed us a trend row. This is the whole "one RPC call
      // per page load" guarantee: with server-fetched card + trend,
      // the client makes 4 parallel calls; without either, 5.
      const trendPromise = initialTrendData !== undefined
        ? Promise.resolve({ data: null })
        : supabase.rpc('get_card_trends_detail', { slug })

      // Block 5A-W-55A — build the PSA population query up-front so we
      // can fire it in parallel with the RPC/table batch below. It was
      // previously chained AFTER `Promise.all` completed, costing one
      // extra sequential round-trip for no reason.
      const baseName    = cardData.card_name.split('[')[0].split('#')[0].trim()
      const variant     = extractVariant(cardData.card_name)
      const setNameClean = cardData.set_name.replace(/^Pokemon /, '')

      let popQuery = supabase
        .from('psa_population')
        .select('card_name, variant, set_name, card_number, psa_7, psa_8, psa_9, psa_10, total_graded, gem_rate')
        .ilike('card_name', `%${baseName}%`)
        .ilike('set_name', `%${setNameClean}%`)
        .gt('total_graded', 0)

      if (variant) {
        popQuery = popQuery.ilike('variant', `%${variant}%`)
      } else if (cardData.card_number) {
        popQuery = popQuery.eq('card_number', String(cardData.card_number))
      }
      const popPromise = popQuery.order('total_graded', { ascending: false }).limit(1)

      const [trendRes, metricsRes, histRes, insightRes, volRes, popRes] = await Promise.all([
        trendPromise,
        supabase.rpc('get_card_metrics', { card_slug: cardData.card_slug }),
        supabase.rpc('get_card_price_history', { slug }),
        supabase.rpc('get_card_insight', { slug }),
        supabase.from('card_volume').select('volume_label, sales_30d').eq('card_slug', slug).eq('grade', 'Ungraded').maybeSingle(),
        popPromise,
      ])

      if (trendRes.data)   setTrend(trendRes.data)
      if (metricsRes.data) {
        const m = Array.isArray(metricsRes.data) ? metricsRes.data[0] : metricsRes.data
        setMetrics(m)
      }
      if (histRes.data)    setPriceHistory(histRes.data)
      if (insightRes.data) setInsight(insightRes.data)
      if (volRes.data?.volume_label) setVolumeLabel(volRes.data.volume_label)
      if (popRes.data && popRes.data.length > 0) setPsaPop(popRes.data[0])

      setLoading(false)
    }
    loadCard()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [setName, cardUrlSlug])

  if (loading) return (
    <div style={{ maxWidth: 960, margin: '0 auto', padding: '60px 24px' }}>
      <div style={{ display: 'flex', gap: 32, flexWrap: 'wrap' }}>
        <div className="skeleton" style={{ width: 220, height: 308, borderRadius: 10 }} />
        <div style={{ flex: 1, minWidth: 280 }}>
          <div className="skeleton" style={{ height: 32, width: '60%', marginBottom: 12 }} />
          <div className="skeleton" style={{ height: 18, width: '40%', marginBottom: 24 }} />
          <div className="skeleton" style={{ height: 160, borderRadius: 12 }} />
        </div>
      </div>
    </div>
  )

  if (!card) return (
    <div style={{ maxWidth: 800, margin: '0 auto', padding: '60px 24px', textAlign: 'center' }}>
      <h1 style={{ fontFamily: "'Outfit', serif", fontSize: 28, marginBottom: 12 }}>Card not found</h1>
      <p style={{ color: 'var(--text-muted)' }}>This card doesn&apos;t exist in our database.</p>
      <Link href="/browse" style={{ color: 'var(--accent)', textDecoration: 'none', fontWeight: 600 }}>Browse sets →</Link>
    </div>
  )

  // ── Derived values ────────────────────────────────────────────────────────

  const raw = metrics?.results?.[0] || metrics || {}

  // Formatted card number for display: "95/165" or "#95"
  const cardNumberFormatted = formatCardNumber(card.card_number, card.card_number_display, card.set_printed_total)

  // Cents → USD dollars for the GradeLadder. Null stays null.
  const c2d = (cents: number | null | undefined): number | null =>
    cents == null ? null : cents / 100

  const gradeLadderPrices: GradePrices = {
    raw_usd:           c2d(card.raw_usd),
    psa7_usd:          c2d(card.psa7_usd),
    psa8_usd:          c2d(card.psa8_usd),
    psa9_usd:          c2d(card.psa9_usd),
    psa10_usd:         c2d(card.psa10_usd),
    cgc95_usd:         c2d(card.cgc95_usd),
    grade1_usd:        c2d(card.grade1_usd),
    grade2_usd:        c2d(card.grade2_usd),
    grade3_usd:        c2d(card.grade3_usd),
    grade4_usd:        c2d(card.grade4_usd),
    grade5_usd:        c2d(card.grade5_usd),
    grade6_usd:        c2d(card.grade6_usd),
    tag10_usd:         c2d(card.tag10_usd),
    ace10_usd:         c2d(card.ace10_usd),
    sgc10_usd:         c2d(card.sgc10_usd),
    cgc10_usd:         c2d(card.cgc10_usd),
    bgs10_usd:         c2d(card.bgs10_usd),
    bgs10black_usd:    c2d(card.bgs10black_usd),
    cgc10pristine_usd: c2d(card.cgc10pristine_usd),
  }

  const hasAnyTrend = trend && (
    trend.raw_pct_7d !== null || trend.raw_pct_30d !== null ||
    trend.raw_pct_90d !== null || trend.raw_pct_180d !== null || trend.raw_pct_365d !== null
  )

  const trendPeriods = hasAnyTrend ? [
    { label: '7d',   val: trend.raw_pct_7d   },
    { label: '30d',  val: trend.raw_pct_30d  },
    { label: '90d',  val: trend.raw_pct_90d  },
    { label: '180d', val: trend.raw_pct_180d },
    { label: '1y',   val: trend.raw_pct_365d },
    { label: '2y',   val: trend.raw_pct_2y   },
    { label: '5y',   val: trend.raw_pct_5y   },
  ] : []

  const psa10Multiple = card.psa10_usd && card.raw_usd ? card.psa10_usd / card.raw_usd : null
  const psa9Multiple  = card.psa9_usd  && card.raw_usd ? card.psa9_usd  / card.raw_usd : null

  const gradingCostCents  = 2500
  const gradingProfitCents = card.raw_usd && card.psa10_usd
    ? card.psa10_usd - card.raw_usd - gradingCostCents
    : null

  const hasLongTermData = trend && (trend.raw_365d_ago != null || trend.raw_pct_365d != null)
  const drawdown = raw.drawdown_pct != null && hasLongTermData ? parseFloat(raw.drawdown_pct) : null
  const athUsd   = drawdown != null && card.raw_usd
    ? Math.round((card.raw_usd / 100) / (1 + drawdown / 100))
    : null

  const salesMonthly  = raw.sales_30d ?? raw.volume_30d ?? null
  const liquidityLabel = volumeLabel
    ? volumeLabel.includes('per day') ? 'High — very active market'
    : volumeLabel.includes('per week') ? 'High — sells regularly'
    : volumeLabel.includes('per month') ? 'Moderate — steady market'
    : 'Low — patient seller needed'
    : salesMonthly == null ? null
    : salesMonthly >= 8  ? 'High — sells regularly'
    : salesMonthly >= 3  ? 'Moderate — steady market'
    : 'Low — patient seller needed'

  const gemRate = psaPop?.gem_rate ? parseFloat(psaPop.gem_rate) : null

  const expectedValueCents: number | null = card.raw_usd && card.psa10_usd && gemRate != null
    ? (() => {
        const p10  = gemRate / 100
        const p9   = (1 - p10) * 0.6
        const p9val = card.psa9_usd ?? Math.round(card.psa10_usd * 0.25)
        const expectedReturn = (p10 * card.psa10_usd) + (p9 * p9val) + ((1 - p10 - p9) * card.raw_usd * 0.8)
        return Math.round(expectedReturn - card.raw_usd - gradingCostCents)
      })()
    : null

  const isLotteryCard = psa10Multiple != null && psa10Multiple > 15
  const totalGraded   = psaPop?.total_graded ?? null
  const psa10Count    = psaPop?.psa_10 ?? null

  const gradeMultiples = [
    { label: 'PSA 9',  value: card.psa9_usd,  multiple: psa9Multiple  },
    { label: 'PSA 10', value: card.psa10_usd, multiple: psa10Multiple },
  ].filter(g => g.value && g.multiple)

  // Prefill message uses formatted number for natural reading: "Bulbasaur 95/165" or "Bulbasaur #95"
  const numberForMessage = cardNumberFormatted ? ` ${cardNumberFormatted}` : ''
  const prefillMessage = `I'm looking at ${card.card_name}${numberForMessage} from ${card.set_name}`


  const { logoUrl, symbolUrl } = getSetAssets(card.set_name)
  // Prefer the DB-backed primary species slug (set by the backfill against
  // pokemon_species and exposed via get_card_detail_by_url_slug). Falls back
  // to the legacy heuristic for cards that haven't been backfilled or for
  // species the matcher missed (Energy / Trainer / "Nidoran" without gender).
  const speciesSlug = card.primary_pokemon_slug || extractSpeciesSlug(card.card_name)
  const displayInsight = insight || generateFallbackInsight(card, trend, metrics, psaPop)

  // ── Collector Intel tiles ─────────────────────────────────────────────────

  const tiles: { label: string; value: string; sub?: string; highlight?: boolean; color?: string }[] = []

  if (psa10Multiple != null) tiles.push({
    label: 'Raw → PSA 10', value: `${psa10Multiple.toFixed(1)}x`,
    sub: psa10Multiple < 2 ? 'Great grade value' : psa10Multiple > 10 ? 'High-risk grade' : 'Grade multiplier',
    highlight: psa10Multiple < 2,
  })
  if (psa9Multiple != null) tiles.push({
    label: 'Raw → PSA 9', value: `${psa9Multiple.toFixed(1)}x`, sub: 'Grade multiplier',
  })
  if (gemRate != null) tiles.push({
    label: 'Gem Rate (PSA 10)', value: `${gemRate.toFixed(1)}%`,
    sub: gemRate < 5 ? 'Hard to gem — scarce' : gemRate > 40 ? 'Common gem — high supply' : 'Average difficulty',
    highlight: gemRate < 5,
  })
  if (psaPop?.total_graded) tiles.push({
    label: 'Total PSA Graded', value: psaPop.total_graded.toLocaleString(),
    sub: psaPop.psa_10 ? `${psaPop.psa_10.toLocaleString()} PSA 10s` : undefined,
  })
  if (drawdown != null) tiles.push({
    label: 'vs All-Time High',
    value: drawdown >= -2 ? 'At Peak' : `${drawdown.toFixed(0)}%`,
    sub: drawdown >= -2 ? `Current ~$${card.raw_usd ? Math.round(card.raw_usd / 100) : '—'}` : athUsd ? `ATH ~$${athUsd}` : 'from peak',
    highlight: drawdown < -30,
  })
  if (volumeLabel) {
    tiles.push({
      label: 'Market Activity', value: volumeLabel,
      sub: liquidityLabel ?? undefined,
    })
  } else if (salesMonthly != null) {
    tiles.push({
      label: 'Market Activity', value: `~${salesMonthly}/mo`,
      sub: liquidityLabel ?? undefined,
    })
  }
  const pct30dQuality = pctQuality(trend?.raw_pct_30d, '30d')
  if (trend?.raw_pct_30d != null && pct30dQuality === 'clean') tiles.push({
    label: '30d Price Move',
    value: `${trend.raw_pct_30d > 0 ? '+' : ''}${trend.raw_pct_30d.toFixed(1)}%`,
    sub: trend.raw_pct_30d > 0 ? 'Rising' : 'Falling',
    color: trend.raw_pct_30d > 0 ? 'var(--green)' : '#ef4444',
  })
  if (trend?.raw_pct_7d != null && pctQuality(trend.raw_pct_7d, '7d') !== 'suppress') {
    const swing7d = Math.abs(trend.raw_pct_7d)
    tiles.push({
      label: 'Price Stability',
      value: swing7d < 5 ? 'Steady' : swing7d < 15 ? 'Moderate' : 'Volatile',
      sub: `${swing7d.toFixed(1)}% swing this week`,
    })
  }
  if (expectedValueCents != null) tiles.push({
    label: 'Expected Grade Value',
    value: `${expectedValueCents > 0 ? '+' : ''}$${(expectedValueCents / 100).toFixed(0)}`,
    sub: gemRate != null ? `at ${gemRate.toFixed(1)}% gem rate` : 'probability-weighted',
    highlight: expectedValueCents > 0,
  })

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <div style={{ maxWidth: 960, margin: '0 auto', padding: '36px 24px' }}>
      {/* Block 5A-W-46B — CardStructuredData + BreadcrumbSchema now
          emitted by the parent server component (page.tsx) so they
          appear in the first-crawl HTML. Do NOT re-emit here. */}

      {/* Breadcrumb */}
      <div style={{ marginBottom: 20, display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
        {/* Block 5A-W-50E — smart back. If we have a valid origin
            marker pointing at the set page we arrived from (including
            its exact sort query), consume it and go there via
            router.back(); otherwise fall back to the canonical set
            URL. Ordinary Ctrl+click / new-tab still hits the href. */}
        <Link href={`/set/${encodeURIComponent(card.set_name)}`}
          onClick={makeSmartBackHandler(
            { push: (url: string) => router.push(url), replace: (url: string) => router.replace(url) },
            {
              currentPathname: pathname,
              fallbackUrl: `/set/${encodeURIComponent(card.set_name)}`,
              expectOriginPath: `/set/${encodeURIComponent(card.set_name)}`,
            },
          )}
          style={{ display: 'inline-flex', alignItems: 'center', gap: 8, textDecoration: 'none', color: 'var(--text)', fontSize: 13, fontFamily: "'Figtree', sans-serif", fontWeight: 600, padding: '7px 14px 7px 10px', background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 20, transition: 'all 0.15s' }}
          onMouseEnter={e => { const el = e.currentTarget as HTMLAnchorElement; el.style.borderColor = 'var(--primary)'; el.style.color = 'var(--primary)' }}
          onMouseLeave={e => { const el = e.currentTarget as HTMLAnchorElement; el.style.borderColor = 'var(--border)'; el.style.color = 'var(--text)' }}
        >
          <span style={{ fontSize: 11, opacity: 0.5 }}>←</span>
          {logoUrl ? <img src={logoUrl} alt={displaySetName(card.set_name, card.language as any)} style={{ height: 20, width: 'auto', objectFit: 'contain', maxWidth: 90 }} loading="lazy" /> : null}
          {symbolUrl && <img src={symbolUrl} alt="" style={{ width: 16, height: 16, objectFit: 'contain' }} loading="lazy" />}
          {/* Block 5A-W-48C — visible set label strips "Japanese " prefix.
              The href above still uses the internal set_name identity. */}
          <span>{displaySetName(card.set_name, card.language as any)}</span>
        </Link>
        {speciesSlug && (
          <Link href={`/pokemon/${speciesSlug}`}
            style={{ display: 'inline-flex', alignItems: 'center', gap: 6, textDecoration: 'none', color: 'var(--text)', fontSize: 13, fontFamily: "'Figtree', sans-serif", fontWeight: 600, padding: '7px 14px', background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 20, transition: 'all 0.15s' }}
            onMouseEnter={e => { const el = e.currentTarget as HTMLAnchorElement; el.style.borderColor = 'var(--primary)'; el.style.color = 'var(--primary)' }}
            onMouseLeave={e => { const el = e.currentTarget as HTMLAnchorElement; el.style.borderColor = 'var(--border)'; el.style.color = 'var(--text)' }}
          >
            <span style={{ fontSize: 12 }}>🃏</span>
            All {speciesSlug.charAt(0).toUpperCase() + speciesSlug.slice(1)} cards
          </Link>
        )}
      </div>

      <div style={{ margin: '0 0 28px' }}>
        <InlineChat
          cardContext={{
            // Block 5A-W-52A.2 — unambiguous identifiers. The
            // card-detail RPC does not project cards.id, so
            // cardRecordId is null. priceChartingProductId
            // (cards.card_slug) is globally unique and safer than
            // URL slug lookup, so we always populate it. The edge
            // function's priority order is:
            //   1. cardRecordId → cards.id
            //   2. priceChartingProductId → cards.card_slug
            //   3. cardUrlSlug + setName + language (single-row guard)
            //   4. setName + cardNumber + language + variant
            cardRecordId: null,
            cardUrlSlug: card.card_url_slug ?? String(card.card_slug),
            priceChartingProductId: String(card.card_slug),
            cardName: cleanCardName(String(card.card_name ?? '')),
            setName: String(card.set_name ?? ''),
            cardNumber: card.card_number ? String(card.card_number) : null,
            cardNumberDisplay: card.card_number_display ?? null,
            language: (card.language === 'jp' ? 'jp' : 'en'),
            variant: null,
          }}
          cardName={String(card.card_name ?? '')}
          prefillMessage={prefillMessage}
        />
      </div>

      {/* Hero: image + core data */}
      <div style={{ display: 'flex', gap: 28, flexWrap: 'wrap', alignItems: 'flex-start' }}>
        <div style={{ flex: '0 0 auto' }}>
          <CardHeroImage
            src={card.image_url}
            alt={`${card.card_name} Pokémon card from ${card.set_name}`}
          />
        </div>

        <div style={{ flex: 1, minWidth: 280 }}>
          {/* Block 5A-W-48B — Japanese pill rendered above the H1.
              resolveLanguage prefers card.language (once the RPC has
              been updated) and falls back to the set_name prefix
              convention otherwise. Renders NOTHING for English. */}
          {(() => {
            const cardLang = resolveLanguage(card.language as any, card.set_name)
            return (
              <>
                <JapaneseBadge language={cardLang} size="md" style={{ marginBottom: 6 }} />
                <h1 style={{ fontFamily: "'Outfit', serif", fontSize: 26, margin: '0 0 4px', color: 'var(--text)', letterSpacing: '-0.3px' }}>
                  {card.card_name.replace(/\s*#\d+\w*\s*$/, '').trim()}{cardNumberFormatted ? ` ${cardNumberFormatted}` : ''}
                </h1>
                <p style={{ color: 'var(--text-muted)', fontSize: 14, margin: '0 0 14px', fontFamily: "'Figtree', sans-serif" }}>
                  {/* Block 5A-W-48C — clean visible label; internal
                      identity + href unaffected. */}
                  {displaySetName(card.set_name, cardLang)}
                  {cardLang === 'jp' && (
                    <span style={{ marginLeft: 8, fontSize: 12, fontWeight: 700, color: 'var(--primary)' }}>
                      · Language: Japanese
                    </span>
                  )}
                </p>
              </>
            )
          })()}

          <CardQuickActions card={card} />

          <HeroBanner trend={trend} hasInsight={!!displayInsight} />

          {displayInsight && (
            <div style={{ background: 'var(--card)', border: '1px solid var(--border)', borderLeft: '3px solid var(--primary)', borderRadius: 10, padding: '12px 14px', marginBottom: 16, fontSize: 13, lineHeight: 1.7, color: 'var(--text)', fontFamily: "'Figtree', sans-serif" }}>
              {displayInsight}
              {volumeLabel && (
                <div style={{ marginTop: 8 }}>
                  <VolumePill label={volumeLabel} />
                </div>
              )}
            </div>
          )}

          <div style={{ background: 'var(--card)', borderRadius: 12, border: '1px solid var(--border)', padding: '14px 16px', marginBottom: 14 }}>
            <SectionLabel>Current Prices (USD)</SectionLabel>
            <GradeLadder prices={gradeLadderPrices} mode={card.is_sealed ? 'sealed' : 'card'} />
            {/* Block 5A-W-39B — one prominent marketplace-localised
                "Find this card on eBay" CTA, sitting between the price
                ladder and the compact grade-specific chips below. */}
            <EbayCardPrimaryAction
              cardName={card.card_name}
              setName={card.set_name}
              cardNumber={card.card_number_display ?? card.card_number ?? null}
              cardSlug={(card.card_url_slug || card.card_slug || '').toString().replace(/^pc-/, '') || null}
              setSlug={card.set_name}
              isSealed={!!card.is_sealed}
              language={resolveLanguage(card.language as any, card.set_name)}
            />
            <EbayCardPriceActions
              cardName={card.card_name}
              setName={card.set_name}
              cardNumber={card.card_number_display ?? card.card_number ?? null}
              cardSlug={(card.card_url_slug || card.card_slug || '').toString().replace(/^pc-/, '') || null}
              setSlug={card.set_name}
              isSealed={!!card.is_sealed}
              rawPriceCents={card.raw_usd ?? null}
              psa9PriceCents={card.psa9_usd ?? null}
              psa10PriceCents={card.psa10_usd ?? null}
            />
          </div>

          {trendPeriods.length > 0 && (
            <div style={{ background: 'var(--card)', borderRadius: 12, border: '1px solid var(--border)', padding: '14px 16px' }}>
              <SectionLabel>Raw Price Trend</SectionLabel>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 16 }}>
                {trendPeriods.map(t => <TrendCell key={t.label} val={t.val} label={t.label} />)}
              </div>
              {trendPeriods.some(t => pctQuality(t.val, t.label) === 'suppress') && (
                <p style={{ fontSize: 11, color: 'var(--text-muted)', margin: '10px 0 0', fontFamily: "'Figtree', sans-serif", lineHeight: 1.5 }}>
                  — Some periods are hidden because the price movement was too large to be reliable. Check recent eBay sold listings for the real picture.
                </p>
              )}
              {trendPeriods.some(t => pctQuality(t.val, t.label) === 'warn') && !trendPeriods.some(t => pctQuality(t.val, t.label) === 'suppress') && (
                <p style={{ fontSize: 11, color: '#e07b39', margin: '10px 0 0', fontFamily: "'Figtree', sans-serif", lineHeight: 1.5 }}>
                  ⚠ Large moves shown in amber — verify against recent sold listings before drawing conclusions.
                </p>
              )}
            </div>
          )}
        </div>
      </div>

      {/* W46C-FIX1 — server-rendered "Quick price facts" slot lands
          here, after the H1 hero (image + title + set + price ladder +
          trend chips) and before the detailed client-side chart. The
          slot is null on non-indexable pages so we don't pad thin
          cards with an empty panel. */}
      {quickFactsSlot}

      {/* Block 5A-W-58H — small SEO intro paragraph, rendered server-
          side by page.tsx for the ten hand-picked hero cards only.
          Null for every other card. Placement respects the block-
          brief flow: H1 → core price information → short hero
          SEO/value context, so prices stay above the fold. */}
      {seoIntroSlot}

      {/* Price History Chart */}
      {priceHistory.length > 1 && (
        <Panel style={{ paddingBottom: 24 }}>
          <SectionLabel>Price History</SectionLabel>
          <PriceChart
            data={priceHistory}
            series={CARD_CHART_SERIES}
            height={280}
            ranges
            note="New graded tiers (BGS, CGC, SGC, ACE, TAG) just started tracking — limited history will fill in over the coming weeks."
          />
        </Panel>
      )}

      {/* Collector Intel */}
      {tiles.length > 0 && (
        <Panel>
          <SectionLabel>Collector Intel</SectionLabel>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(140px, 1fr))', gap: 10, marginBottom: 8 }}>
            {tiles.map((t, i) => (
              <div key={i} style={{ background: t.highlight ? 'rgba(26,95,173,0.06)' : 'var(--bg-light)', border: `1px solid ${t.highlight ? 'rgba(26,95,173,0.2)' : 'transparent'}`, borderRadius: 10, padding: '12px 14px' }}>
                <div style={{ fontSize: 16, fontWeight: 800, lineHeight: 1, marginBottom: 4, fontFamily: "'Figtree', sans-serif", color: t.color ?? 'var(--text)' }}>{t.value}</div>
                <div style={{ fontSize: 10, fontWeight: 700, color: 'var(--text-muted)', fontFamily: "'Figtree', sans-serif", textTransform: 'uppercase', letterSpacing: 1 }}>{t.label}</div>
                {t.sub && <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 3, fontFamily: "'Figtree', sans-serif" }}>{t.sub}</div>}
              </div>
            ))}
          </div>
          <p style={{ fontSize: 11, color: 'var(--text-muted)', margin: '14px 0 0', fontFamily: "'Figtree', sans-serif", lineHeight: 1.5 }}>
            Calculated from price history, PSA population data, and market trends. Not financial advice.
          </p>
        </Panel>
      )}

      {/* Grading Calculator */}
      {card.raw_usd && card.psa10_usd && (
        <Panel>
          <SectionLabel>Grading Calculator</SectionLabel>
          <p style={{ fontSize: 13, color: 'var(--text-muted)', margin: '0 0 16px', fontFamily: "'Figtree', sans-serif", lineHeight: 1.5 }}>
            Based on PSA Standard tier (~$25 USD). Assumes a perfect PSA 10 result — actual outcome depends on card condition.
          </p>

          {isLotteryCard && (
            <div style={{ marginBottom: 16, padding: '10px 14px', background: 'rgba(224,123,57,0.08)', border: '1px solid rgba(224,123,57,0.25)', borderRadius: 10, fontSize: 13, fontFamily: "'Figtree', sans-serif", color: 'var(--text)', lineHeight: 1.6 }}>
              ⚠️ <strong>High-variance grade.</strong> PSA 10 is {psa10Multiple?.toFixed(0)}x the raw price{gemRate != null ? ` but only ${gemRate.toFixed(1)}% of copies gem` : ''}. The expected value accounts for the realistic probability.
            </div>
          )}

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(140px, 1fr))', gap: 10, marginBottom: 18 }}>
            <StatTile label="Buy Raw"             value={`$${(card.raw_usd / 100).toFixed(0)}`} />
            <StatTile label="Grading Fee"          value="~$25" sub="PSA Standard" />
            <StatTile label="PSA 10 Value"         value={`$${(card.psa10_usd / 100).toFixed(0)}`} />
            <StatTile label="Best Case (PSA 10)"   value={gradingProfitCents != null ? `${gradingProfitCents > 0 ? '+' : ''}$${(gradingProfitCents / 100).toFixed(0)}` : '—'} sub="if you pull a 10" />
            {expectedValueCents != null && (
              <StatTile label="Expected Value" value={`${expectedValueCents > 0 ? '+' : ''}$${(expectedValueCents / 100).toFixed(0)}`} sub={gemRate != null ? `at ${gemRate.toFixed(1)}% gem rate` : 'probability-weighted'} highlight={expectedValueCents > 0} />
            )}
          </div>

          {gradeMultiples.length > 0 && (
            <div>
              <SectionLabel>Grade Multiples vs Raw</SectionLabel>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                {gradeMultiples.map(g => (
                  <div key={g.label}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 5 }}>
                      <span style={{ fontSize: 13, fontFamily: "'Figtree', sans-serif", color: 'var(--text)', fontWeight: 600 }}>
                        {g.label}<span style={{ fontWeight: 400, color: 'var(--text-muted)', marginLeft: 6 }}>${(g.value / 100).toFixed(0)}</span>
                      </span>
                      <span style={{ fontSize: 13, fontWeight: 700, fontFamily: "'Figtree', sans-serif", color: 'var(--text-muted)' }}>{g.multiple?.toFixed(1)}x raw</span>
                    </div>
                    <MeterBar value={Math.min((g.multiple! / 6) * 100, 100)} color={g.multiple! < 2 ? 'var(--green)' : g.multiple! < 4 ? '#f59e0b' : 'var(--primary)'} />
                  </div>
                ))}
              </div>
            </div>
          )}

          {gemRate != null && totalGraded != null && (
            <div style={{ marginTop: 16, padding: '12px 14px', background: gemRate < 10 ? 'rgba(39,174,96,0.06)' : 'var(--bg-light)', border: `1px solid ${gemRate < 10 ? 'rgba(39,174,96,0.2)' : 'var(--border)'}`, borderRadius: 10, fontSize: 13, fontFamily: "'Figtree', sans-serif", color: 'var(--text)', lineHeight: 1.6 }}>
              <strong>{gemRate.toFixed(1)}% gem rate</strong> — {psa10Count?.toLocaleString()} PSA 10s out of {totalGraded?.toLocaleString()} graded.
              {' '}{gemRate < 10 ? 'Hard card to grade — scarcity keeps the PSA 10 premium justified.' : gemRate > 40 ? 'PSA 10s are relatively common — strong supply.' : 'Average difficulty to gem.'}
            </div>
          )}
        </Panel>
      )}

      {/* PSA Population */}
      {psaPop && (
        <Panel>
          <SectionLabel>PSA Population{psaPop.variant && psaPop.variant !== 'Standard' ? ` — ${psaPop.variant}` : ''}</SectionLabel>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: 10, marginBottom: 16 }}>
            {[
              { label: 'PSA 7',  value: psaPop.psa_7         },
              { label: 'PSA 8',  value: psaPop.psa_8         },
              { label: 'PSA 9',  value: psaPop.psa_9         },
              { label: 'PSA 10', value: psaPop.psa_10        },
              { label: 'Total',  value: psaPop.total_graded  },
            ].map(stat => (
              <div key={stat.label} style={{ background: 'var(--bg-light)', borderRadius: 10, padding: '12px 14px' }}>
                <div style={{ fontSize: 18, fontWeight: 700, color: 'var(--text)', fontFamily: "'Figtree', sans-serif", lineHeight: 1 }}>{stat.value?.toLocaleString() ?? '—'}</div>
                <div style={{ fontSize: 10, color: 'var(--text-muted)', marginTop: 4, fontFamily: "'Figtree', sans-serif", textTransform: 'uppercase', letterSpacing: 1, fontWeight: 700 }}>{stat.label}</div>
              </div>
            ))}
          </div>

          {psaPop.total_graded > 0 && (
            <div style={{ marginBottom: 14 }}>
              <div style={{ display: 'flex', height: 8, borderRadius: 99, overflow: 'hidden', gap: 1, marginBottom: 8 }}>
                {[
                  { count: psaPop.psa_7,  color: '#94a3b8' },
                  { count: psaPop.psa_8,  color: '#60a5fa' },
                  { count: psaPop.psa_9,  color: '#34d399' },
                  { count: psaPop.psa_10, color: '#22c55e' },
                ].map((seg, i) => {
                  const pct = (seg.count / psaPop.total_graded) * 100
                  if (pct < 1) return null
                  return <div key={i} style={{ flex: `0 0 ${pct}%`, background: seg.color, height: '100%' }} />
                })}
              </div>
              <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap' }}>
                {[
                  { label: 'PSA 7',  color: '#94a3b8', count: psaPop.psa_7  },
                  { label: 'PSA 8',  color: '#60a5fa', count: psaPop.psa_8  },
                  { label: 'PSA 9',  color: '#34d399', count: psaPop.psa_9  },
                  { label: 'PSA 10', color: '#22c55e', count: psaPop.psa_10 },
                ].map((item, i) => (
                  <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                    <div style={{ width: 8, height: 8, borderRadius: 2, background: item.color }} />
                    <span style={{ fontSize: 11, color: 'var(--text-muted)', fontFamily: "'Figtree', sans-serif" }}>
                      {item.label} ({((item.count / psaPop.total_graded) * 100).toFixed(0)}%)
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {gemRate != null && (
            <div style={{ fontSize: 13, fontFamily: "'Figtree', sans-serif", color: 'var(--text-muted)' }}>
              Gem rate:{' '}
              <strong style={{ color: gemRate < 5 ? 'var(--green)' : gemRate >= 20 ? 'var(--text)' : '#f59e0b' }}>
                {gemRate.toFixed(1)}%
              </strong>
              {' '}of all graded copies received PSA 10.
            </div>
          )}
        </Panel>
      )}

      {/* Explore more: same species */}
      {speciesSlug && <ExploreMoreSpecies speciesSlug={speciesSlug} currentUrlSlug={cardUrlSlug} setName={card.set_name} />}

      {/* Explore more: same set */}
      <ExploreMoreSet setName={card.set_name} currentUrlSlug={cardUrlSlug} />

      {/* FAQ — visible content + FAQPage schema */}
      <FAQ items={getCardFaqItems({
        card,
        gemRate,
        psa10Multiple: psa10Multiple ?? undefined,
        gradingProfitCents: gradingProfitCents ?? undefined,
      })} />
    </div>
  )
}

// ── Lazy-fetch helper (Block 5A-W-55A) ────────────────────────────────────────
// Delays a below-the-fold fetch until its sentinel element approaches the
// viewport. The Explore-More sections previously fetched immediately on
// mount even though they sit hundreds of pixels below the price ladder,
// competing with the useful RPCs that feed the hero + chart.
function useVisibleOnce(rootMargin = '600px'): [React.MutableRefObject<HTMLDivElement | null>, boolean] {
  const ref = useRef<HTMLDivElement | null>(null)
  const [visible, setVisible] = useState(false)
  useEffect(() => {
    if (visible) return
    if (typeof window === 'undefined' || typeof IntersectionObserver === 'undefined') {
      // Fallback: no IO → fire immediately (matches pre-55A behaviour).
      setVisible(true)
      return
    }
    const el = ref.current
    if (!el) return
    const io = new IntersectionObserver((entries) => {
      for (const entry of entries) {
        if (entry.isIntersecting) {
          setVisible(true)
          io.disconnect()
          break
        }
      }
    }, { rootMargin })
    io.observe(el)
    return () => io.disconnect()
  }, [visible, rootMargin])
  return [ref, visible]
}

// ── Explore More: same species ────────────────────────────────────────────────

function ExploreMoreSpecies({ speciesSlug, currentUrlSlug, setName }: { speciesSlug: string; currentUrlSlug: string; setName: string }) {
  const [cards, setCards] = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  const [sentinelRef, visible] = useVisibleOnce()

  useEffect(() => {
    if (!visible) return
    const displayName = speciesSlug.charAt(0).toUpperCase() + speciesSlug.slice(1)
    const namePatterns = [
      `card_name.eq.${displayName}`,
      `card_name.ilike.${displayName} %`,
      `card_name.ilike.${displayName}[%`,
      `card_name.ilike.% ${displayName}`,
      `card_name.ilike.% ${displayName} %`,
    ].join(',')

    supabase.from('cards').select('card_name, set_name, card_url_slug, image_url, card_number, card_number_display, set_printed_total')
      .or(namePatterns).eq('is_sealed', false).neq('card_url_slug', currentUrlSlug)
      .order('set_name').limit(24)
      .then(({ data }) => { if (data) setCards(data); setLoading(false) })
  }, [visible, speciesSlug, currentUrlSlug])

  // Always render the sentinel so IntersectionObserver has an element to
  // observe; render an empty box until we're near the viewport.
  if (!visible || loading) {
    return <div ref={sentinelRef} aria-hidden style={{ minHeight: 1 }} />
  }
  if (cards.length === 0) return <div ref={sentinelRef} aria-hidden style={{ minHeight: 1 }} />
  const label = speciesSlug.charAt(0).toUpperCase() + speciesSlug.slice(1)

  return (
    <div style={{ background: 'var(--card)', borderRadius: 14, border: '1px solid var(--border)', padding: '18px 20px', marginTop: 20 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16, flexWrap: 'wrap', gap: 8 }}>
        <div style={{ fontSize: 16, fontWeight: 800, color: 'var(--text)', fontFamily: "'Outfit', sans-serif" }}>More {label} Cards</div>
        <Link href={`/pokemon/${speciesSlug}`} style={{ fontSize: 13, fontWeight: 600, color: 'var(--primary)', fontFamily: "'Figtree', sans-serif", textDecoration: 'none' }}>All {label} cards →</Link>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(110px, 1fr))', gap: 8 }}>
        {cards.slice(0, 20).map((c, i) => (
          <Link key={i} href={`/set/${encodeURIComponent(c.set_name)}/card/${c.card_url_slug}`} style={{ textDecoration: 'none' }}>
            <div style={{ background: 'var(--bg-light)', border: '1px solid var(--border)', borderRadius: 10, padding: '10px 8px', textAlign: 'center', transition: 'border-color 0.15s, transform 0.15s' }}
              onMouseEnter={e => { const el = e.currentTarget as HTMLDivElement; el.style.borderColor = 'var(--primary)'; el.style.transform = 'translateY(-2px)' }}
              onMouseLeave={e => { const el = e.currentTarget as HTMLDivElement; el.style.borderColor = 'var(--border)'; el.style.transform = 'translateY(0)' }}
            >
              {c.image_url
                ? <img src={c.image_url} alt={c.card_name} style={{ width: 72, height: 100, objectFit: 'contain', display: 'block', margin: '0 auto 6px', borderRadius: 4 }} loading="lazy" onError={e => { (e.currentTarget as HTMLImageElement).style.display = 'none' }} />
                : <div style={{ width: 72, height: 100, background: 'var(--border)', borderRadius: 4, margin: '0 auto 6px', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 20 }}>🃏</div>}
              <div style={{ fontSize: 10, fontWeight: 700, color: 'var(--text)', fontFamily: "'Figtree', sans-serif", lineHeight: 1.3, marginBottom: 2 }}>{c.card_name}</div>
              <div style={{ fontSize: 9, color: 'var(--text-muted)', fontFamily: "'Figtree', sans-serif", whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{c.set_name}</div>
            </div>
          </Link>
        ))}
      </div>
    </div>
  )
}

// ── Explore More: same set ────────────────────────────────────────────────────

function ExploreMoreSet({ setName, currentUrlSlug }: { setName: string; currentUrlSlug: string }) {
  const [cards, setCards] = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  const [sentinelRef, visible] = useVisibleOnce()

  useEffect(() => {
    if (!visible) return
    supabase.from('cards').select('card_name, set_name, card_url_slug, image_url, card_number, card_number_display, set_printed_total')
      .eq('set_name', setName).eq('is_sealed', false).neq('card_url_slug', currentUrlSlug)
      .order('card_number').limit(24)
      .then(({ data }) => { if (data) setCards(data); setLoading(false) })
  }, [visible, setName, currentUrlSlug])

  if (!visible || loading) {
    return <div ref={sentinelRef} aria-hidden style={{ minHeight: 1 }} />
  }
  if (cards.length === 0) return <div ref={sentinelRef} aria-hidden style={{ minHeight: 1 }} />

  return (
    <div style={{ background: 'var(--card)', borderRadius: 14, border: '1px solid var(--border)', padding: '18px 20px', marginTop: 20 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16, flexWrap: 'wrap', gap: 8 }}>
        <div style={{ fontSize: 16, fontWeight: 800, color: 'var(--text)', fontFamily: "'Outfit', sans-serif" }}>More from {setName}</div>
        <Link href={`/set/${encodeURIComponent(setName)}`} style={{ fontSize: 13, fontWeight: 600, color: 'var(--primary)', fontFamily: "'Figtree', sans-serif", textDecoration: 'none' }}>View full set →</Link>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(110px, 1fr))', gap: 8 }}>
        {cards.slice(0, 20).map((c, i) => {
          const numLabel = formatCardNumber(c.card_number, c.card_number_display, c.set_printed_total)
          return (
            <Link key={i} href={`/set/${encodeURIComponent(c.set_name)}/card/${c.card_url_slug}`} style={{ textDecoration: 'none' }}>
              <div style={{ background: 'var(--bg-light)', border: '1px solid var(--border)', borderRadius: 10, padding: '10px 8px', textAlign: 'center', transition: 'border-color 0.15s, transform 0.15s' }}
                onMouseEnter={e => { const el = e.currentTarget as HTMLDivElement; el.style.borderColor = 'var(--primary)'; el.style.transform = 'translateY(-2px)' }}
                onMouseLeave={e => { const el = e.currentTarget as HTMLDivElement; el.style.borderColor = 'var(--border)'; el.style.transform = 'translateY(0)' }}
              >
                {c.image_url
                  ? <img src={c.image_url} alt={c.card_name} style={{ width: 72, height: 100, objectFit: 'contain', display: 'block', margin: '0 auto 6px', borderRadius: 4 }} loading="lazy" onError={e => { (e.currentTarget as HTMLImageElement).style.display = 'none' }} />
                  : <div style={{ width: 72, height: 100, background: 'var(--border)', borderRadius: 4, margin: '0 auto 6px', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 20 }}>🃏</div>}
                <div style={{ fontSize: 10, fontWeight: 700, color: 'var(--text)', fontFamily: "'Figtree', sans-serif", lineHeight: 1.3, marginBottom: 2 }}>{c.card_name}</div>
                {numLabel && <div style={{ fontSize: 9, color: 'var(--text-muted)', fontFamily: "'Figtree', sans-serif" }}>{numLabel}</div>}
              </div>
            </Link>
          )
        })}
      </div>
    </div>
  )
}