// app/sitemap-pages.xml/route.ts
import { NextResponse } from 'next/server'
import { FORMATS } from '@/lib/mtg/formats.data'
import { listInsights } from '@/lib/insights'

const BASE_URL = 'https://mtgprices.io'

export async function GET() {
  const now = new Date().toISOString()

  const formatPages = FORMATS.map((f) => ({
    url: `${BASE_URL}/formats/${f.key}`,
    lastmod: now,
    priority: '0.7',
    changefreq: 'weekly',
  }))

  const insightPages = listInsights().map((a) => {
    const lastmod = new Date(`${a.updatedAt ?? a.publishedAt}T00:00:00Z`).toISOString()
    return {
      url: `${BASE_URL}/insights/${a.slug}`,
      lastmod,
      priority: '0.75',
      changefreq: 'monthly',
    }
  })

  const pages = [
    { url: BASE_URL,                    lastmod: now, priority: '1.0', changefreq: 'daily'   },
    { url: `${BASE_URL}/browse`,        lastmod: now, priority: '0.9', changefreq: 'daily'   },
    { url: `${BASE_URL}/cards/search`,  lastmod: now, priority: '0.9', changefreq: 'daily'   },
    { url: `${BASE_URL}/card-finder`,   lastmod: now, priority: '0.85', changefreq: 'weekly' },
    { url: `${BASE_URL}/market`,        lastmod: now, priority: '0.85', changefreq: 'daily'  },
    { url: `${BASE_URL}/formats`,       lastmod: now, priority: '0.85', changefreq: 'weekly' },
    { url: `${BASE_URL}/insights`,      lastmod: now, priority: '0.85', changefreq: 'weekly' },
    { url: `${BASE_URL}/ai`,            lastmod: now, priority: '0.8',  changefreq: 'weekly' },
    { url: `${BASE_URL}/contact`,       lastmod: now, priority: '0.3',  changefreq: 'monthly' },
    { url: `${BASE_URL}/privacy`,       lastmod: now, priority: '0.3',  changefreq: 'yearly'  },
    { url: `${BASE_URL}/terms`,         lastmod: now, priority: '0.3',  changefreq: 'yearly'  },
    ...formatPages,
    ...insightPages,
  ]

  const urls = pages
    .map(
      (p) =>
        '  <url>\n    <loc>' + p.url + '</loc>\n    <lastmod>' + p.lastmod + '</lastmod>\n    <changefreq>' + p.changefreq + '</changefreq>\n    <priority>' + p.priority + '</priority>\n  </url>'
    )
    .join('\n')

  const xml =
    '<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n' +
    urls +
    '\n</urlset>'

  return new NextResponse(xml, { headers: { 'Content-Type': 'application/xml' } })
}
