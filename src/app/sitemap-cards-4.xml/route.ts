import { NextResponse } from 'next/server'
import { fetchCardShard, buildSitemapXml } from '@/lib/mtg/sitemap'

export const revalidate = 86400

export async function GET() {
  const entries = await fetchCardShard(4)
  return new NextResponse(buildSitemapXml(entries), {
    headers: { 'Content-Type': 'application/xml' },
  })
}
