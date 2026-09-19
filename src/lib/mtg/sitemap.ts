// src/lib/mtg/sitemap.ts
// Server-only helpers for building the card sitemap shards.

import 'server-only'
import { getSupabaseServiceClient } from '@/lib/supabaseService'
import { buildCardSlug } from '@/lib/mtg/cards'

/** Total number of card-sitemap shards. 5 shards × ~22K URLs each
 *  keeps us far under Google's 50K per-sitemap cap. */
export const CARD_SITEMAP_SHARDS = 5

/** Approx. URLs per shard. Chosen so 5 shards cover the current
 *  ~106K non-digital English printings with headroom for growth. */
export const SHARD_SIZE = 22_000

/** Pull one shard's worth of card rows from mtg_printings.
 *  Deterministic order (id ASC) so a printing is always in the same
 *  shard as long as it exists, good for search-engine polling. */
export async function fetchCardShard(shard: number): Promise<
  { setCode: string; collector: string; name: string; released_at: string | null }[]
> {
  if (shard < 1 || shard > CARD_SITEMAP_SHARDS) return []
  const supabase = getSupabaseServiceClient()

  const offset = (shard - 1) * SHARD_SIZE
  const end = offset + SHARD_SIZE - 1

  // PostgREST default max page = 1000 rows. Page inside the shard.
  const pageSize = 1000
  const out: { setCode: string; collector: string; name: string; released_at: string | null }[] = []
  for (let start = offset; start <= end; start += pageSize) {
    const pageEnd = Math.min(start + pageSize - 1, end)
    const { data, error } = await supabase
      .from('mtg_printings')
      .select('id, set_code, collector_number, name, released_at')
      .eq('lang', 'en')
      .eq('digital', false)
      .not('collector_number', 'is', null)
      .order('id', { ascending: true })
      .range(start, pageEnd)
    if (error) {
      console.error(`fetchCardShard(${shard}) page ${start}-${pageEnd} error:`, error)
      break
    }
    if (!data || data.length === 0) break
    for (const r of data) {
      if (!r.set_code || !r.collector_number) continue
      out.push({
        setCode: String(r.set_code).toLowerCase(),
        collector: String(r.collector_number),
        name: String(r.name ?? ''),
        released_at: r.released_at ?? null,
      })
    }
    if (data.length < pageSize) break  // last page for this shard
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
      const slug = buildCardSlug(e.collector, e.name)
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
