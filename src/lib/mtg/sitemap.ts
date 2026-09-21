// src/lib/mtg/sitemap.ts
// Server-only helpers for building the card sitemap shards.

import 'server-only'
import { getSupabaseServiceClient } from '@/lib/supabaseService'
import { slugifyCardName } from '@/lib/mtg/slug'

/** Total number of card-sitemap shards. 5 shards × ~22K URLs each
 *  keeps us far under Google's 50K per-sitemap cap. */
export const CARD_SITEMAP_SHARDS = 5

/** Approx. URLs per shard. Chosen so 5 shards cover the current
 *  ~106K non-digital English printings with headroom for growth. */
export const SHARD_SIZE = 22_000

/** Pull one shard's worth of card rows from mtg_printings.
 *  Deterministic order (id ASC) so a printing is always in the same
 *  shard as long as it exists, which keeps crawlers happy.
 *
 *  Uses the mtg_sitemap_card_shard RPC (one HTTP round-trip, returns
 *  jsonb to sidestep Postgrest's max-rows cap). The previous
 *  implementation paginated with .range() in 1000-row chunks, taking
 *  22 sequential HTTP calls per shard. Shard 5 sometimes took ~5 s to
 *  fetch, which combined with cold-ISR regen was pushing Googlebot's
 *  patience close to the Vercel function timeout - Search Console
 *  reported "Couldn't fetch" for shard 3 in the wild. Single RPC:
 *  each shard now returns in ~0.5-1.5 s.
 */
export async function fetchCardShard(shard: number): Promise<
  { setCode: string; collector: string; name: string; released_at: string | null }[]
> {
  if (shard < 1 || shard > CARD_SITEMAP_SHARDS) return []
  const supabase = getSupabaseServiceClient()

  const { data, error } = await supabase.rpc('mtg_sitemap_card_shard', {
    p_shard: shard,
    p_shard_size: SHARD_SIZE,
  })
  if (error) {
    console.error(`fetchCardShard(${shard}) RPC error:`, error.message)
    return []
  }
  const rows = (Array.isArray(data) ? data : []) as Array<{
    set_code: string | null
    collector_number: string | null
    name: string | null
    released_at: string | null
  }>
  const out: { setCode: string; collector: string; name: string; released_at: string | null }[] = []
  for (const r of rows) {
    if (!r.set_code || !r.collector_number) continue
    out.push({
      setCode: String(r.set_code).toLowerCase(),
      collector: String(r.collector_number),
      name: String(r.name ?? ''),
      released_at: r.released_at ?? null,
    })
  }
  return out
}

// Card-shard lastmod is derived from released_at when available and
// falls back to a per-build ISO otherwise (many printings have a real
// release date). BUILD_ISO stays stable within a deploy so crawlers do
// not see every URL "changed" on every request.
const BUILD_ISO = new Date().toISOString()

export function buildSitemapXml(entries: { setCode: string; collector: string; name: string; released_at: string | null }[]): string {
  const items = entries
    .map((e) => {
      // Collector numbers can contain non-ASCII characters (e.g. "★"
      // for star-foil variants), which are not valid raw in a <loc>
      // per the sitemap protocol and RFC 3986. Percent-encode the
      // collector portion so crawlers see a well-formed URL. The
      // route handler decodes it back before slug parsing.
      const slug = `${encodeURIComponent(e.collector)}-${slugifyCardName(e.name)}`
      const loc = `https://mtgprices.io/set/${e.setCode}/card/${slug}`
      const lastmod = e.released_at
        ? new Date(`${e.released_at}T00:00:00Z`).toISOString()
        : BUILD_ISO
      return `  <url>\n    <loc>${xmlEscape(loc)}</loc>\n    <lastmod>${lastmod}</lastmod>\n    <changefreq>weekly</changefreq>\n    <priority>0.6</priority>\n  </url>`
    })
    .join('\n')
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${items}\n</urlset>`
}


function xmlEscape(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;')
}
