// app/sitemap-pages.xml/route.ts
//
// Hub pages, format detail pages and every insight article. Card and
// set URLs live in their own shards.
//
// Eligibility follows src/lib/seo.ts (isSitemapEligible). Search-
// result URLs (an unbounded parameter space) and private / auth routes
// are NOT included. Lastmod is deterministic per URL: for articles the
// frontmatter date, for formats and hub pages a build date derived
// once at module load so it stays stable within a deploy rather than
// changing on every request.

import { NextResponse } from 'next/server'
import { FORMATS } from '@/lib/mtg/formats.data'
import { listInsights } from '@/lib/insights'
import { SITE_ORIGIN, isSitemapEligible } from '@/lib/seo'

const BUILD_ISO = new Date().toISOString()

const STATIC_HUB_PAGES: { path: string; priority: string; changefreq: string }[] = [
  { path: '/',            priority: '1.0',  changefreq: 'daily'   },
  { path: '/browse',      priority: '0.9',  changefreq: 'daily'   },
  { path: '/market',      priority: '0.85', changefreq: 'daily'   },
  { path: '/formats',     priority: '0.85', changefreq: 'weekly'  },
  { path: '/card-finder', priority: '0.85', changefreq: 'weekly'  },
  { path: '/insights',    priority: '0.85', changefreq: 'weekly'  },
  { path: '/ai',          priority: '0.8',  changefreq: 'weekly'  },
  { path: '/contact',     priority: '0.3',  changefreq: 'monthly' },
  { path: '/privacy',     priority: '0.3',  changefreq: 'yearly'  },
  { path: '/terms',       priority: '0.3',  changefreq: 'yearly'  },
]

export async function GET() {
  type Item = { url: string; lastmod: string; changefreq: string; priority: string }
  const items: Item[] = []

  for (const p of STATIC_HUB_PAGES) {
    if (!isSitemapEligible(p.path)) continue
    items.push({
      url: `${SITE_ORIGIN}${p.path}`,
      lastmod: BUILD_ISO,
      changefreq: p.changefreq,
      priority: p.priority,
    })
  }

  for (const f of FORMATS) {
    const path = `/formats/${f.key}`
    if (!isSitemapEligible(path)) continue
    items.push({
      url: `${SITE_ORIGIN}${path}`,
      lastmod: BUILD_ISO,
      changefreq: 'weekly',
      priority: '0.7',
    })
  }

  for (const a of listInsights()) {
    const path = `/insights/${a.slug}`
    if (!isSitemapEligible(path)) continue
    const date = a.updatedAt ?? a.publishedAt
    items.push({
      url: `${SITE_ORIGIN}${path}`,
      lastmod: new Date(`${date}T00:00:00Z`).toISOString(),
      changefreq: 'monthly',
      priority: '0.75',
    })
  }

  const urls = items
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
