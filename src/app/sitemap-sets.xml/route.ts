// app/sitemap-sets.xml/route.ts, MTG set index.
import { NextResponse } from 'next/server'
import { listSets } from '@/lib/mtg/sets'

const BASE_URL = 'https://mtgprices.io'

export async function GET() {
  const sets = await listSets({ limit: 5000 })

  const now = new Date().toISOString()
  const urls = sets
    .map(
      (s) =>
        `  <url>\n    <loc>${BASE_URL}/set/${encodeURIComponent(s.code)}</loc>\n    <lastmod>${
          s.released_at ? new Date(s.released_at).toISOString() : now
        }</lastmod>\n    <changefreq>weekly</changefreq>\n    <priority>0.75</priority>\n  </url>`
    )
    .join('\n')

  const xml = `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls}\n</urlset>`

  return new NextResponse(xml, { headers: { 'Content-Type': 'application/xml' } })
}
