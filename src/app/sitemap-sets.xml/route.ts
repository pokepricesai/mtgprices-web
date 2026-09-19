// app/sitemap-sets.xml/route.ts, MTG set sitemap.
//
// Eligible = English paper sets from listSets() (which already
// filters digital = false). If a set has no released_at we fall back
// to the build timestamp rather than "now on every request" so the
// signal stays deterministic within a deploy.

import { NextResponse } from 'next/server'
import { listSets } from '@/lib/mtg/sets'
import { SITE_ORIGIN } from '@/lib/seo'

const BUILD_ISO = new Date().toISOString()

export async function GET() {
  const sets = await listSets({ limit: 5000 })

  const urls = sets
    .map((s) => {
      const lastmod = s.released_at
        ? new Date(`${s.released_at}T00:00:00Z`).toISOString()
        : BUILD_ISO
      return `  <url>\n    <loc>${SITE_ORIGIN}/set/${encodeURIComponent(s.code)}</loc>\n    <lastmod>${lastmod}</lastmod>\n    <changefreq>weekly</changefreq>\n    <priority>0.75</priority>\n  </url>`
    })
    .join('\n')

  const xml = `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls}\n</urlset>`

  return new NextResponse(xml, { headers: { 'Content-Type': 'application/xml' } })
}
