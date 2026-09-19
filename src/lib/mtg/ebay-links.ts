// src/lib/mtg/ebay-links.ts
// Contextual eBay Partner Network link builder for MTGPrices.
//
// Two important properties:
//   * Tracking is per marketplace. Each supported eBay TLD gets its own
//     EBAY_EPN_CAMPAIGN_ID_<COUNTRY> env var. If a resolved marketplace
//     has no configured campaign, tracking is NOT injected: the link
//     stays a plain search URL and .affiliate stays false. Reusing a US
//     campaign on ebay.co.uk would silently break attribution, so we
//     refuse to guess.
//   * Everything else is inputs to the caller. Card facts, source label
//     (used as EPN customid), marketplace override.
//
// The link is always a valid eBay search URL scoped to the MTG
// category, whether or not tracking is present.

export type EbayMarketplace = 'US' | 'GB' | 'DE' | 'FR' | 'IT' | 'ES' | 'AU' | 'CA'

const HOST_BY_MARKETPLACE: Record<EbayMarketplace, string> = {
  US: 'www.ebay.com',
  GB: 'www.ebay.co.uk',
  DE: 'www.ebay.de',
  FR: 'www.ebay.fr',
  IT: 'www.ebay.it',
  ES: 'www.ebay.es',
  AU: 'www.ebay.com.au',
  CA: 'www.ebay.ca',
}

// Public EPN MKCID/MKRID pairs per marketplace. These are constants
// published by eBay Partner Network and are safe to hardcode.
const MK_IDS: Record<EbayMarketplace, { mkcid: string; mkrid: string }> = {
  US: { mkcid: '1', mkrid: '711-53200-19255-0' },
  GB: { mkcid: '1', mkrid: '710-53481-19255-0' },
  DE: { mkcid: '1', mkrid: '707-53477-19255-0' },
  FR: { mkcid: '1', mkrid: '709-53476-19255-0' },
  IT: { mkcid: '1', mkrid: '724-53478-19255-0' },
  ES: { mkcid: '1', mkrid: '1185-53479-19255-0' },
  AU: { mkcid: '1', mkrid: '705-53470-19255-0' },
  CA: { mkcid: '1', mkrid: '706-53473-19255-0' },
}

// MTG-specific eBay category. 38292 == "Collectible Card Games >
// Magic: The Gathering". Scoping searches to this category means the
// visitor lands in the right catalogue slice on eBay.
const MTG_CATEGORY_ID = '38292'

const DEFAULT_MARKETPLACE = (): EbayMarketplace => {
  const raw = (process.env.EBAY_DEFAULT_MARKETPLACE ?? 'US').toUpperCase()
  return (raw in HOST_BY_MARKETPLACE ? raw : 'US') as EbayMarketplace
}

/** Choose a marketplace from an optional ISO 3166 alpha-2 country
 *  code. Anything outside the allowlist falls back to the configured
 *  default. */
export function marketplaceFor(country?: string | null): EbayMarketplace {
  if (!country) return DEFAULT_MARKETPLACE()
  const key = country.toUpperCase() as EbayMarketplace
  return HOST_BY_MARKETPLACE[key] ? key : DEFAULT_MARKETPLACE()
}

/** Look up the EPN campaign ID configured for the given marketplace.
 *  Environment naming: EBAY_EPN_CAMPAIGN_ID_<CODE>. Returns null when
 *  no campaign is configured for that marketplace so the caller can
 *  render a plain link with no tracking. */
export function epnCampaignFor(marketplace: EbayMarketplace): string | null {
  const key = `EBAY_EPN_CAMPAIGN_ID_${marketplace}`
  const val = (process.env[key] ?? '').trim()
  return val ? val : null
}

/** True when the master switch is on. Individual marketplaces still
 *  need their own campaign id. Used by the UI to decide the affiliate
 *  disclosure. */
export function ebayAffiliateEnabled(): boolean {
  return process.env.EBAY_AFFILIATE_ENABLED === 'true'
}

// Optional, source-based customid values. Callers pass a `source`
// string. If the string looks like one of the well-known IDs we let it
// through; otherwise we sanitise it (a-z, 0-9, dash, up to 40 chars).
// customid is passed through to eBay analytics as an arbitrary token,
// so we prefer short and stable values.
function sanitiseCustomId(raw: string | null | undefined): string | null {
  if (!raw) return null
  const cleaned = raw.trim().toLowerCase().replace(/[^a-z0-9-]/g, '-').slice(0, 40)
  return cleaned.length > 0 ? cleaned : null
}

export type EbaySearchInput = {
  // Card facts.
  cardName: string
  setName?: string | null
  setCode?: string | null
  collectorNumber?: string | null
  finish?: 'nonfoil' | 'foil' | 'etched' | null
  // Override the marketplace (typically derived from geo).
  marketplace?: EbayMarketplace
  // Free-form modifier appended to the query text (e.g. "cheap").
  modifier?: string
  // Origin label for EPN analytics. Recommended values:
  //   'card-overview'         from CardMarketOverview
  //   'printing-comparison'   from the PrintingComparison table row
  //   'deck-shopping'         from the deck shopping list
  //   'collection'            from the collection page
  // Anything else is sanitised down to [a-z0-9-].
  source?: string | null
}

export type EbayLink = {
  href: string
  marketplace: EbayMarketplace
  affiliate: boolean          // true when tracking params were attached
  label: string               // suggested UI label
}

function buildQuery(i: EbaySearchInput): string {
  const parts: string[] = [i.cardName]
  if (i.setName) parts.push(i.setName)
  if (i.collectorNumber) parts.push(String(i.collectorNumber))
  if (i.finish === 'foil') parts.push('foil')
  if (i.finish === 'etched') parts.push('etched foil')
  if (i.modifier) parts.push(i.modifier)
  parts.push('Magic the Gathering')
  return parts.join(' ')
}

/** Compose the final URL. Tracking params only appear when the
 *  resolved marketplace has its own campaign id configured AND the
 *  master switch is on. */
export function buildEbaySearchLink(input: EbaySearchInput): EbayLink {
  const marketplace = input.marketplace ?? DEFAULT_MARKETPLACE()
  const host = HOST_BY_MARKETPLACE[marketplace]

  const url = new URL(`https://${host}/sch/i.html`)
  url.searchParams.set('_nkw', buildQuery(input))
  url.searchParams.set('_sacat', MTG_CATEGORY_ID)

  const campid = epnCampaignFor(marketplace)
  const enabled = ebayAffiliateEnabled()
  const affiliate = Boolean(campid) && enabled

  if (affiliate && campid) {
    const ids = MK_IDS[marketplace]
    // Standard EPN "clkid" pattern. Values here mirror the eBay-provided
    // tracking template. The campid is what attributes revenue.
    url.searchParams.set('mkevt', '1')
    url.searchParams.set('mkcid', ids.mkcid)
    url.searchParams.set('mkrid', ids.mkrid)
    url.searchParams.set('campid', campid)
    // customid: prefer the caller-provided source, fall back to a
    // configured global value if present.
    const custom = sanitiseCustomId(input.source) ?? sanitiseCustomId(process.env.EBAY_CUSTOM_ID ?? '')
    if (custom) url.searchParams.set('customid', custom)
    // Match hint helps eBay attribute session → click → conversion.
    url.searchParams.set('toolid', '10001')
  }

  return {
    href: url.toString(),
    marketplace,
    affiliate,
    label: defaultLabel(input),
  }
}

function defaultLabel(i: EbaySearchInput): string {
  if (i.finish === 'foil') return `Find foil copies on eBay`
  if (i.finish === 'etched') return `Find etched copies on eBay`
  if (i.setName && i.collectorNumber) return `Find this printing on eBay`
  if (i.setName) return `Find ${i.setName} copies on eBay`
  return `Search this card on eBay`
}
