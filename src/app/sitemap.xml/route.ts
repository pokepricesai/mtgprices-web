// Sitemap index. Sub-sitemaps for pages, sets and card shards.
// Uses <sitemapindex> per the sitemaps.org spec.
import { NextResponse } from 'next/server'
import { CARD_SITEMAP_SHARDS } from '@/lib/mtg/sitemap'

const BASE_URL = 'https://mtgprices.io'

export const revalidate = 3600  // 1h

export async function GET() {
  const now = new Date().toISOString()
  const sub: string[] = ['sitemap-pages.xml', 'sitemap-sets.xml']
  for (let i = 1; i <= CARD_SITEMAP_SHARDS; i++) sub.push(`sitemap-cards-${i}.xml`)

  const entries = sub
    .map(
      (name) =>
        `  <sitemap>\n    <loc>${BASE_URL}/${name}</loc>\n    <lastmod>${now}</lastmod>\n  </sitemap>`
    )
    .join('\n')

  const xml = `<?xml version="1.0" encoding="UTF-8"?>\n<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${entries}\n</sitemapindex>`

  return new NextResponse(xml, {
    headers: { 'Content-Type': 'application/xml' },
  })
}
