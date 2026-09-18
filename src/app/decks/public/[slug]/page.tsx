// app/decks/public/[slug]/page.tsx
//
// Public deck page. No login required. 404s on private/nonexistent
// decks. Every field is a PublicDeckPayload projection, the owner's
// collection, acquired prices, per-card notes, and user_id never
// appear.
//
// SITE_LAUNCHED=false still forces noindex, so this route is safely
// accessible in pre-launch without SEO indexing.

import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { loadPublicDeckBySlug } from '@/lib/mtg/public-deck'
import PublicDeckClient from './PublicDeckClient'
import { getFormatRule } from '@/lib/mtg/format-rules'

// Privacy over caching. A page rendered while a deck was public
// must NOT survive when the owner flips it to private. Next.js ISR
// caches the rendered response by URL; database `is_public=true`
// filtering happens at data-fetch time, so a stale cached page would
// still serve to anon after the deck went private. Force a live
// render on every request.
//
// If we ever want to cache these, the flip must invalidate, via
// revalidatePath('/decks/public/[slug]', 'page') inside the PATCH
// handler. Deferred until traffic justifies the extra complexity.
export const dynamic = 'force-dynamic'
export const revalidate = 0
export const fetchCache = 'force-no-store'

type Params = { slug: string }

export async function generateMetadata({ params }: { params: Promise<Params> }): Promise<Metadata> {
  const { slug } = await params
  const payload = await loadPublicDeckBySlug(slug)
  if (!payload) {
    return { title: 'Deck not found. MTGPrices', robots: { index: false, follow: false } }
  }
  const commanderName = payload.commanders[0]?.name
  const rule = getFormatRule(payload.deck.format)
  const formatLabel = rule?.label ?? payload.deck.format
  const title = commanderName
    ? `${payload.deck.name}. ${commanderName} ${formatLabel}. MTGPrices`
    : `${payload.deck.name}. ${formatLabel}. MTGPrices`
  const description = commanderName
    ? `${formatLabel} deck built around ${commanderName}. ${payload.totals.main} main-deck cards.`
    : `${formatLabel} deck. ${payload.totals.main} main-deck cards.`
  const canonical = `https://mtgprices.io/decks/public/${slug}`
  return {
    title,
    description,
    // SITE_LAUNCHED=false → noindex site-wide. This route is safe to
    // ship without SEO submission because the meta below forces
    // noindex even if a crawler ignores robots.txt.
    robots: { index: false, follow: false },
    alternates: { canonical },
    openGraph: {
      title, description, url: canonical, type: 'article', siteName: 'MTGPrices',
    },
    twitter: { card: 'summary', title, description },
  }
}

export default async function PublicDeckPage({ params }: { params: Promise<Params> }) {
  const { slug } = await params
  const payload = await loadPublicDeckBySlug(slug)
  if (!payload) notFound()
  return <PublicDeckClient payload={payload} />
}
