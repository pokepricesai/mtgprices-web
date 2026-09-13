// app/set/[slug]/card/[cardSlug]/page.tsx
import type { Metadata } from 'next'
import { cache } from 'react'
import { createClient } from '@supabase/supabase-js'
import { notFound } from 'next/navigation'
import CardPageClient from './CardPageClient'
import RecentSalesSection from '@/components/recentSales/RecentSalesSection'
import { loadRecentSalesGroupedForCardIfEnabled } from '@/lib/recentSales/cardQueries'
import { isCardIndexable } from '@/lib/seo-indexability/cardIndexability'
import { getCardSeoOverride } from '@/lib/seo/cardSeoOverrides'
import { displaySetName, resolveLanguage } from '@/lib/cardLanguage'
// Block 5A-W-46B (with W46B-FIX1) — server-emit BreadcrumbSchema only.
//   * BreadcrumbSchema moved up from CardPageClient (which fetched
//     `card` via useEffect and therefore shipped an empty initial HTML
//     — no BreadcrumbList visible to the first-pass crawl). Rendering
//     here guarantees the BreadcrumbList appears in the server-rendered
//     HTML that Google + Bing index against.
//   * CardStructuredData (WebPage + Dataset graph) is INTENTIONALLY
//     NOT server-rendered here. Server-rendering it would materially
//     increase the Dataset-schema blast radius from ~0 to ~29k
//     individual card pages. A single card price snapshot has not
//     been established as a genuine Dataset under our intended schema
//     model, so the Dataset emission is deferred to a dedicated
//     structured-data review block. The client-side render in
//     CardPageClient was already removed to avoid duplicate schema;
//     do NOT re-add it here or there.
import BreadcrumbSchema from '@/components/BreadcrumbSchema'
// Block 5A-W-46C — server-rendered Quick Facts panel + trend fetch.
// Reuses the existing get_card_trends_detail RPC (no new RPC). Rendered
// only when the card is indexable per the W35 gate.
import CardPriceQuickFacts from '@/components/seo/CardPriceQuickFacts'

// ISR: regenerate every 24h. Prices refresh nightly, so this aligns with data cadence.
// Dramatically reduces crawl-budget consumption across 40k+ card pages.
export const revalidate = 86400

const supabaseServer = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
)

// Block 5A-W-46D (with W46D-FIX1) — DISCRIMINATED card loader.
// generateMetadata() and the page handler both call getCard() with the
// same (setName, cardSlug); React.cache() de-dupes them into ONE
// backend RPC per request. The result distinguishes three outcomes so
// a transient RPC failure never gets converted into a permanent 404:
//
//   * status: 'ok'         — real card row is available
//   * status: 'not-found'  — the query succeeded but no row matched
//                            (the caller calls notFound() → 404)
//   * status: 'error'      — the RPC returned an error OR the fetch
//                            threw. The caller MUST NOT call
//                            notFound(); render CardPageClient with
//                            initialCardData=undefined so the client
//                            fallback fires exactly once. Metadata
//                            should be a safe fallback with
//                            robots noindex,follow so a transient
//                            failure never leaks a fake title / prices.
//
// The pre-FIX1 loader collapsed 'not-found' and 'error' into a single
// null return, so a temporary Supabase blip during metadata could 404
// a real card permanently for that ISR window. Never null-conflate
// again — both branches should be deliberate.
export type CardRow = {
  card_slug:            string
  card_url_slug?:       string | null
  card_name:            string
  set_name:             string
  card_number?:         string | number | null
  card_number_display?: string | null
  set_printed_total?:   number | null
  image_url?:           string | null
  raw_usd?:             number | null
  psa9_usd?:            number | null
  psa10_usd?:           number | null
  is_sealed?:           boolean | null
  /** Block 5A-W-48B — 'en' | 'jp'. Populated by get_card_detail_by_url_slug
   *  once the foundation migration is applied. Old clients treat a
   *  missing value as 'en' so the passthrough is backwards-compatible. */
  language?:            string | null
  // Every other tier field the RPC returns — kept as a permissive
  // index signature so the pure indexability helper can inspect them.
  [key: string]: unknown
}

export type GetCardResult =
  | { status: 'ok';        card: CardRow }
  | { status: 'not-found' }
  | { status: 'error' }

const getCard = cache(async (setName: string, cardSlug: string): Promise<GetCardResult> => {
  try {
    const { data, error } = await supabaseServer.rpc('get_card_detail_by_url_slug', {
      p_set_name: setName,
      p_card_url_slug: cardSlug,
    })
    if (error) return { status: 'error' }
    if (!data) return { status: 'not-found' }
    return { status: 'ok', card: data as CardRow }
  } catch {
    return { status: 'error' }
  }
})

// Block 5A-W-46C (with W46C-FIX1) — server-side trend fetch. Returns
// a DISCRIMINATED result so the render layer can distinguish:
//   * server succeeded (with data or with a legitimate empty row) →
//     pass the data / null as initialTrendData; the client SKIPS its
//     duplicate get_card_trends_detail call.
//   * server failed (RPC error or exception) → pass `undefined` as
//     initialTrendData; the client falls back to ONE
//     get_card_trends_detail call so a transient server error never
//     permanently suppresses the chart / hero banner trend chips.
type TrendRow = { raw_pct_7d?: number | null; raw_pct_30d?: number | null; updated_at?: string | null }
type TrendResult =
  | { ok: true;  data: TrendRow | null }
  | { ok: false }

const getTrend = cache(async (bareCardSlug: string | null | undefined): Promise<TrendResult> => {
  // No slug isn't an error — a card with a missing bare slug has
  // no trend by definition. Treat as success + null so the client
  // does NOT unnecessarily retry.
  if (!bareCardSlug) return { ok: true, data: null }
  try {
    const { data, error } = await supabaseServer.rpc('get_card_trends_detail', { slug: bareCardSlug })
    if (error) return { ok: false }
    return { ok: true, data: (data ?? null) as TrendRow | null }
  } catch {
    return { ok: false }
  }
})

function fmt(cents: number): string {
  const v = cents / 100
  return v >= 1000 ? `$${(v / 1000).toFixed(1)}k` : `$${v.toFixed(0)}`
}

export async function generateMetadata({ params }: { params: Promise<{ slug: string; cardSlug: string }> }): Promise<Metadata> {
  const { slug, cardSlug } = await params
  const setName = decodeURIComponent(slug)

  const result = await getCard(setName, cardSlug)

  // W46D-FIX1 — genuine "no row" ⇒ true 404. The old behaviour returned
  // a "Card Not Found" 200 OK, letting Google index a half-empty page.
  if (result.status === 'not-found') notFound()

  // W46D-FIX1 — RPC error / exception ⇒ SAFE FALLBACK metadata. Do NOT
  // call notFound(): that would cache a 404 in the ISR bucket and mask
  // a transient failure. Do NOT invent a card title or prices. Emit
  // robots noindex,follow so this failed-render slot never enters the
  // search index, but the canonical stays on the same route so the
  // next successful revalidation restores full metadata cleanly.
  if (result.status === 'error') {
    const canonical = `https://www.pokeprices.io/set/${slug}/card/${cardSlug}`
    return {
      title:       'Pokémon Card Price Guide — PokePrices',
      description: 'Track raw, PSA 9 and PSA 10 Pokémon card prices, grading data and recent sales.',
      alternates:  { canonical },
      robots:      { index: false, follow: true },
    }
  }

  // result.status === 'ok' ⇒ full metadata using the real card row.
  const card = result.card

  // Strip trailing " #NN" from card_name (DB stores "Pikachu #55")
  // Regex handles "Pikachu #55", "Pikachu [1st Edition] #55", and trailing suffixes
  const name = card.card_name.replace(/\s*#\d+\w*\s*$/, '').trim()

  // Number suffix: prefer "95/165" when set has multiple cards, else "#95"
  let num = ''
  if (card.card_number_display && card.set_printed_total && card.set_printed_total > 1) {
    num = ` ${card.card_number_display}`
  } else if (card.card_number) {
    num = ` #${card.card_number}`
  }

  const rawUsd   = card.raw_usd   ? card.raw_usd   / 100 : null
  const psa9Usd  = card.psa9_usd  ? card.psa9_usd  / 100 : null
  const psa10Usd = card.psa10_usd ? card.psa10_usd / 100 : null
  const multiple = rawUsd && psa10Usd ? psa10Usd / rawUsd : null
  const canonical = `https://www.pokeprices.io/set/${slug}/card/${cardSlug}`
  const year = new Date().getFullYear()

  // Grading variant: PSA 10 is 3x+ raw — grading angle beats raw price angle
  const useGradingVariant = multiple != null && multiple >= 3

  // Block 5A-W-48C — visible set label strips the leading "Japanese "
  // for Japanese sets so the title reads "Battle Partners" rather
  // than "Japanese Battle Partners". `jpMarker` restates the market
  // in the title so search-result snippets still make it clear this
  // is a Japanese printing (per the block-brief metadata pattern
  // "Battle Partners Japanese Pokémon Card Prices | PokePrices").
  // Internal set_name, canonical URL, and RPC arguments retain the
  // "Japanese " prefix — none of them are touched here.
  const cardLang = resolveLanguage((card as any).language, card.set_name)
  const setLabel = displaySetName(card.set_name, cardLang)
  const jpMarker = cardLang === 'jp' ? ' Japanese' : ''
  const descSetPhrase = cardLang === 'jp' ? `${setLabel} (Japanese)` : setLabel

  let title: string
  let description: string

  if (useGradingVariant && rawUsd && psa10Usd) {
    title = `${name}${num}${jpMarker} Price: ${fmt(card.psa10_usd!)} PSA 10 vs ${fmt(card.raw_usd!)} Raw — Worth Grading? (${year})`
    description = `Is ${name}${num} worth grading? PSA 10 ${fmt(card.psa10_usd!)} is ${multiple!.toFixed(1)}× the raw price of ${fmt(card.raw_usd!)}. ${descSetPhrase} price guide — gem rate, grading spread, PSA population and recent sold listings.`
  } else if (rawUsd && psa10Usd) {
    title = `${name}${num}${jpMarker} Price & Value: ${fmt(card.raw_usd!)} Raw, ${fmt(card.psa10_usd!)} PSA 10 (${year}) — ${setLabel}`
    description = `How much is ${name}${num} worth? ${descSetPhrase} price guide — ${fmt(card.raw_usd!)} raw${psa9Usd ? `, ${fmt(card.psa9_usd!)} PSA 9` : ''}, ${fmt(card.psa10_usd!)} PSA 10. Price trend, grading spread, PSA population and recent sold listings.`
  } else if (psa10Usd) {
    title = `${name}${num}${jpMarker} PSA 10 Price & Value: ${fmt(card.psa10_usd!)} (${year}) — ${setLabel}`
    description = `${name}${num} PSA 10 value: ${fmt(card.psa10_usd!)}. ${descSetPhrase} price guide — price trend, PSA population, gem rate and recent sold listings. Updated daily.`
  } else if (rawUsd) {
    title = `${name}${num}${jpMarker} Price: ${fmt(card.raw_usd!)} Raw (${year}) — ${setLabel}`
    description = `How much is ${name}${num} worth? ${descSetPhrase} price guide — currently ${fmt(card.raw_usd!)} raw. Price trend, grading data, PSA population and recent sold listings. Updated daily.`
  } else {
    title = `${name}${num}${jpMarker} Pokémon Card Price Guide (${year}) — ${setLabel}`
    description = `Track ${name}${num} from ${descSetPhrase}: raw, PSA 9 and PSA 10 prices, grading spreads, PSA population and recent sold listings. Price guide updated daily.`
  }

  // Block 5A-W-58H — controlled SEO overrides on a small set of
  // hand-picked cards, informed by real Search Console query data.
  // Fields are individually optional; when an override omits a
  // field, the generated value stays. Nothing else about the page
  // is touched — canonical, OG image, robots gate, structured data,
  // H1, layout and price blocks all continue to derive from the
  // real card row. openGraph.title / twitter.title interpolate the
  // same locals below, so the override propagates to social
  // metadata without a second SEO surface.
  const override = getCardSeoOverride(cardSlug, card.set_name)
  if (override?.title)       title       = override.title
  if (override?.description) description = override.description

  // Block 5A-W-35 — thin-card gate. Card rows with no market signal
  // on any grade tier get robots: { index: false, follow: true } so
  // Google stops evaluating them for the index, but users landing
  // from direct links / referrers still see the page (and if a price
  // ever appears, the card becomes indexable again on the next crawl
  // — no 410-then-recover dance).
  //
  // Scope note: this gate is price-signal based on the 20 tier fields
  // returned by get_card_detail_by_url_slug (raw_usd + PSA 1..10 +
  // half-grades + gem-mint from other graders). It does NOT consult
  // recent_sales — that path is only loaded below the metadata call
  // and is not mirrored in the sitemap query. Route + sitemap read
  // the same DB-level price signal.
  //
  // We chose noindex over notFound() because ~940 URLs would be
  // affected in one deploy. A 404 mass-drop is harder to reverse and
  // costs external referrers; noindex is the low-blast-radius option.
  const indexable = isCardIndexable(card)

  return {
    title,
    description,
    openGraph: {
      title,
      description,
      images: card.image_url ? [{ url: card.image_url, width: 245, height: 342, alt: name }] : [],
      url: canonical,
      siteName: 'PokePrices',
      type: 'website',
    },
    twitter: {
      card: 'summary_large_image',
      title,
      description,
      images: card.image_url ? [card.image_url] : [],
    },
    alternates: { canonical },
    robots: indexable ? undefined : { index: false, follow: true },
  }
}

export default async function CardPage({ params }: { params: Promise<{ slug: string; cardSlug: string }> }) {
  const { slug, cardSlug } = await params
  const setName = decodeURIComponent(slug)
  const result = await getCard(setName, cardSlug)

  // W46D-FIX1 — genuine not-found ⇒ 404. RPC error ⇒ fall through to
  // rendering CardPageClient with initialCardData=undefined so the
  // client fallback fetch fires exactly once. We deliberately do NOT
  // call notFound() on the error branch: masking a Supabase blip as
  // a 404 would cause Google to drop a valid card URL.
  if (result.status === 'not-found') notFound()

  const card: CardRow | null = result.status === 'ok' ? result.card : null

  // Block 5A-W-46C — the Quick Facts panel is server-rendered ONLY on
  // pages the W35 gate deems indexable (isCardIndexable). Thin cards
  // stay unadorned; we do not manufacture content on pages Google
  // has decided to skip.
  //
  // W46D-FIX1 — on the error branch (card === null) we cannot run the
  // indexability gate or the trend fetch. The Quick Facts panel is
  // suppressed entirely; the client renders its full page after the
  // fallback RPC succeeds.
  const indexable = card ? isCardIndexable(card) : false
  const trendResult: TrendResult = card && indexable
    ? await getTrend(String(card.card_slug ?? ''))
    : { ok: true, data: null }
  // W46C-FIX1 — `undefined` on server error signals the client to make
  // one fallback RPC call. Success (including a legitimate null row)
  // is passed through so the client SKIPS its duplicate call.
  //
  // W46D-FIX1 — when the card server fetch itself failed, force
  // initialTrendData=undefined so the client's fallback covers both
  // card AND trend RPCs consistently.
  const initialTrendData: TrendRow | null | undefined =
    card == null ? undefined :
    trendResult.ok ? trendResult.data : undefined
  const trendForPanel: TrendRow | null = trendResult.ok ? trendResult.data : null
  const setHref = card ? `/set/${encodeURIComponent(String(card.set_name ?? ''))}` : null

  // Recent verified sales — grouped by grade. Fail-closed: the loader
  // returns an empty group set when RECENT_SALES_FREE_PREVIEW_ENABLED
  // is not the literal "true", so the DB is not consulted while the
  // flag is off. The section renders nothing when total is zero.
  //
  // W46D-FIX1 — skip this loader on the error branch; the client
  // fallback will re-render the whole page after it has real data.
  const recentSalesData = card
    ? await loadRecentSalesGroupedForCardIfEnabled(String(card.card_slug ?? ''))
    : null

  // Grade-aware affiliate link in the recent-sales section needs the
  // card's display metadata. Mirrors the shape EbayCardPriceActions
  // uses higher up the page; strips the pc- prefix from card_slug to
  // match the existing convention.
  const recentSalesCard = card ? {
    cardName:   String(card.card_name ?? ''),
    setName:    String(card.set_name ?? ''),
    cardNumber: (card.card_number_display ?? card.card_number ?? null) as string | null,
    cardSlug:   String(card.card_slug ?? '').replace(/^pc-/, '') || null,
    isSealed:   !!card.is_sealed,
  } : null

  // Block 5A-W-58H — server-rendered SEO intro paragraph for the ten
  // hand-picked cards. Only fires when the same override the metadata
  // reads returned an `intro` string. Rendered by CardPageClient in
  // the slot immediately after the Current Prices panel and Quick
  // Facts, before the Price History chart — so prices stay above the
  // fold and the intro provides context without pushing anything
  // meaningful down. Null for every other card.
  const seoOverride = card ? getCardSeoOverride(cardSlug, card.set_name) : null
  const seoIntroSlot = seoOverride?.intro ? (
    <p
      data-testid="card-seo-intro"
      style={{
        fontSize:   14,
        lineHeight: 1.6,
        color:      'var(--text-muted)',
        margin:     '0 0 20px',
        maxWidth:   680,
        fontFamily: "'Figtree', sans-serif",
      }}
    >
      {seoOverride.intro}
    </p>
  ) : null

  return (
    <>
      {/* Block 5A-W-46B (with W46B-FIX1) — server-emitted BreadcrumbList.
          Uses the `card` row we already fetched, so Google's first crawl
          sees the BreadcrumbList in initial HTML rather than a shell
          that hydrates it later.

          W46D-FIX1 — on the error branch we cannot build an accurate
          breadcrumb (no verified set_name / card_name), so we omit it.
          The client fallback will render the full page including
          any dynamic UI once the card row is available. */}
      {card && (
        <BreadcrumbSchema items={[
          { name: 'Sets',         url: '/browse' },
          { name: card.set_name,  url: `/set/${encodeURIComponent(card.set_name)}` },
          { name: card.card_name },
        ]} />
      )}
      {/* Block 5A-W-46C (with W46C-FIX1 + W46D + W46D-FIX1) — the
          "Quick price facts" panel is passed as a server-rendered
          slot INTO CardPageClient. CardPageClient drops it in AFTER
          its H1 hero and BEFORE the detailed price-history chart.
          Being a server-rendered node passed as a prop, the panel
          arrives in the initial HTML on the success path.

          When the card is not W35-indexable, the slot is null so we
          do not add empty content to thin pages.

          W46D-FIX1 — when the server card fetch itself failed, we
          pass initialCardData=undefined and a null slot; the client
          then handles the fallback fetch + render. */}
      <CardPageClient
        setName={setName}
        cardUrlSlug={cardSlug}
        initialCardData={card ?? undefined}
        initialTrendData={initialTrendData}
        quickFactsSlot={card && indexable ? (
          <CardPriceQuickFacts
            card={card}
            trend={trendForPanel}
            setHref={setHref}
            pokemonHref={null}
            pokemonName={null}
          />
        ) : null}
        seoIntroSlot={seoIntroSlot}
      />
      {recentSalesCard && (
        <RecentSalesSection data={recentSalesData} card={recentSalesCard} />
      )}
    </>
  )
}