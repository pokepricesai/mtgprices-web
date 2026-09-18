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
  return `${collectorNumber}-${slugifyCardName(cardName)}`
}
