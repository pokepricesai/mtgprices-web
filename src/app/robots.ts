import { MetadataRoute } from 'next'
import { SITE_LAUNCHED, SITE_URL } from '@/lib/launch'

export default function robots(): MetadataRoute.Robots {
  // Pre-launch: keep the site crawlable so bots can *see* the noindex
  // directive on each page, but do not advertise the sitemap. A blanket
  // `Disallow: /` would suppress noindex from being crawled, which is
  // the opposite of what we want here.
  const rules: MetadataRoute.Robots['rules'] = {
    userAgent: '*',
    allow: '/',
    // /api — never meant for crawlers.
    // /login — public catalogue pages link here from the signed-out
    //   navbar; without this disallow, crawlers follow the link on
    //   every indexed page and probe /login thousands of times a
    //   day. The page is noindex at the <meta robots> level too, so
    //   crawlers have no SEO reason to spend crawl budget here.
    disallow: ['/api', '/login'],
  }
  const out: MetadataRoute.Robots = { rules }
  if (SITE_LAUNCHED) {
    out.sitemap = `${SITE_URL}/sitemap.xml`
  }
  return out
}
