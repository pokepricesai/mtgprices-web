// src/lib/mtg/slug.ts
// Pure slug helpers. NO server-only import, client components use these
// to build /card URLs. Server code re-exports them from cards.ts.

/** Convert "Massacre Girl, Known Killer" → "massacre-girl-known-killer". */
export function slugifyCardName(name: string): string {
  return name
    .toLowerCase()
    .replace(/[’']/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
}

/** URL slug format: "{collector_number}-{card-name-slug}".
 *
 *  Both segments may contain "-" (e.g. "The List" collector numbers like
 *  MKC-297), so a naive split on the first "-" is wrong. Instead we
 *  return every plausible split point and let the caller disambiguate
 *  against real collector numbers in the database. */
export function candidateCardSlugSplits(slug: string): { collectorNumber: string; nameSlug: string }[] {
  if (!slug) return []
  const parts = slug.split('-')
  if (parts.length === 0) return []
  const out: { collectorNumber: string; nameSlug: string }[] = []
  for (let cut = parts.length - 1; cut >= 1; cut--) {
    out.push({
      collectorNumber: parts.slice(0, cut).join('-'),
      nameSlug: parts.slice(cut).join('-'),
    })
  }
  return out
}

export function parseCardSlug(slug: string): { collectorNumber: string; nameSlug: string } | null {
  const splits = candidateCardSlugSplits(slug)
  return splits[splits.length - 1] ?? null
}

export function buildCardSlug(collectorNumber: string, cardName: string): string {
  // Percent-encode the collector segment because Secret Lair (and a
  // handful of other promo lines) use non-ASCII markers ("★" for
  // star-foil variants) that Vercel's router rejects when raw. The
  // trailing name-slug is already ASCII-safe from slugifyCardName.
  // parseCardSlug decodes the collector back through Next.js's URL
  // pipeline, so DB comparisons remain against the un-encoded value.
  return `${encodeURIComponent(collectorNumber)}-${slugifyCardName(cardName)}`
}

/** Build the URL path to a card page. Percent-encodes the collector
 *  number because Secret Lair and other promo printings use non-ASCII
 *  markers ("★" for star-foil variants) that must be encoded in the
 *  URL path per RFC 3986 — otherwise Vercel's router returns 404 on
 *  the raw star. buildCardSlug returns the un-encoded pair so callers
 *  that need the internal representation (sitemap indexing, slug
 *  parsing) continue to work; buildCardHref is what UI code should
 *  emit into href / Link. */
export function buildCardHref(setCode: string, collectorNumber: string | null, cardName: string): string {
  if (!collectorNumber) {
    return `/set/${setCode}/card/${slugifyCardName(cardName)}`
  }
  return `/set/${setCode}/card/${encodeURIComponent(collectorNumber)}-${slugifyCardName(cardName)}`
}
