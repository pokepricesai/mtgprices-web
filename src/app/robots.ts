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
    disallow: ['/api'],
  }
  const out: MetadataRoute.Robots = { rules }
  if (SITE_LAUNCHED) {
    out.sitemap = `${SITE_URL}/sitemap.xml`
  }
  return out
}
