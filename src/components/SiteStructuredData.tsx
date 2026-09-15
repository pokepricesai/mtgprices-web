// Site-wide Organization + WebSite schema.
// Tells Google the site identity and canonical name for SERP rendering.

const SITE_URL = 'https://mtgprices.io'

export default function SiteStructuredData() {
  const graph = {
    '@context': 'https://schema.org',
    '@graph': [
      {
        '@type': 'Organization',
        '@id': `${SITE_URL}/#org`,
        name: 'MTGPrices',
        alternateName: 'MTGPrices.io',
        url: SITE_URL,
        logo: {
          '@type': 'ImageObject',
          url: `${SITE_URL}/logo.png`,
          width: 512,
          height: 512,
        },
        description:
          'MTGPrices — live Magic: The Gathering card prices, printings, historical charts and set catalogue. Powered by Scryfall + MTGJSON.',
      },
      {
        '@type': 'WebSite',
        '@id': `${SITE_URL}/#website`,
        url: SITE_URL,
        name: 'MTGPrices',
        publisher: { '@id': `${SITE_URL}/#org` },
        inLanguage: 'en-US',
      },
    ],
  }

  return (
    <script
      type="application/ld+json"
      dangerouslySetInnerHTML={{ __html: JSON.stringify(graph) }}
    />
  )
}
