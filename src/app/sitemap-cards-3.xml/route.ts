import { NextResponse } from 'next/server'
import { fetchCardShard, buildSitemapXml } from '@/lib/mtg/sitemap'

export const revalidate = 86400
const CACHE_CONTROL = 'public, max-age=0, s-maxage=86400, stale-while-revalidate=604800, must-revalidate'

export async function GET() {
  const entries = await fetchCardShard(3)
  return new NextResponse(buildSitemapXml(entries), {
    headers: {
      'Content-Type': 'application/xml',
      'Cache-Control': CACHE_CONTROL,
    },
  })
}
