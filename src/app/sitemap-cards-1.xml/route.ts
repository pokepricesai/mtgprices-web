import { NextResponse } from 'next/server'
import { fetchCardShard, buildSitemapXml } from '@/lib/mtg/sitemap'

// 24h ISR at Vercel + a stale-while-revalidate at the CDN edge so
// Googlebot never blocks on a cold regen. `s-maxage=86400` matches
// the ISR window; `stale-while-revalidate=604800` lets the edge
// return an up-to-a-week-old copy while a fresh one regenerates in
// the background.
export const revalidate = 86400
const CACHE_CONTROL = 'public, max-age=0, s-maxage=86400, stale-while-revalidate=604800, must-revalidate'

export async function GET() {
  const entries = await fetchCardShard(1)
  return new NextResponse(buildSitemapXml(entries), {
    headers: {
      'Content-Type': 'application/xml',
      'Cache-Control': CACHE_CONTROL,
    },
  })
}
