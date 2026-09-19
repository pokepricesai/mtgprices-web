// app/sitemap-pages.xml/route.ts
import { NextResponse } from 'next/server'
import { FORMATS } from '@/lib/mtg/formats.data'

const BASE_URL = 'https://mtgprices.io'

export async function GET() {
  const now = new Date().toISOString()

  const formatPages = FORMATS.map((f) => ({
    url: `${BASE_URL}/formats/${f.key}`,
    priority: '0.7',
    changefreq: 'weekly',
  }))

  const pages = [
    { url: BASE_URL,                    priority: '1.0', changefreq: 'daily'   },
    { url: `${BASE_URL}/browse`,        priority: '0.9', changefreq: 'daily'   },
    { url: `${BASE_URL}/cards/search`,  priority: '0.9', changefreq: 'daily'   },
    { url: `${BASE_URL}/card-finder`,   priority: '0.85', changefreq: 'weekly' },
    { url: `${BASE_URL}/market`,        priority: '0.85', changefreq: 'daily'  },
    { url: `${BASE_URL}/formats`,       priority: '0.85', changefreq: 'weekly' },
    { url: `${BASE_URL}/contact`,       priority: '0.3', changefreq: 'monthly' },
    { url: `${BASE_URL}/privacy`,       priority: '0.3', changefreq: 'yearly'  },
    { url: `${BASE_URL}/terms`,         priority: '0.3', changefreq: 'yearly'  },
    ...formatPages,
  ]

  const urls = pages
    .map(
      (p) =>
        '  <url>\n    <loc>' + p.url + '</loc>\n    <lastmod>' + now + '</lastmod>\n    <changefreq>' + p.changefreq + '</changefreq>\n    <priority>' + p.priority + '</priority>\n  </url>'
    )
    .join('\n')

  const xml =
    '<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n' +
    urls +
    '\n</urlset>'

  return new NextResponse(xml, { headers: { 'Content-Type': 'application/xml' } })
}
