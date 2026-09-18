// src/lib/mtg/ebay-links.ts
// Contextual eBay Partner Network link builder for MTGPrices.
//
// This module is deliberately conservative:
//   * URLs are always plain eBay search URLs (no invented item IDs).
//   * Tracking parameters (campid, customid, mkevt, etc.) are ONLY
//     appended when BOTH `EBAY_EPN_CAMPAIGN_ID` and
//     `EBAY_AFFILIATE_ENABLED === 'true'` are set. If either is missing
//     the link is still rendered but as a plain search URL, so the
//     product still works pre-launch.
//   * Marketplace TLD is chosen from a small allowlist keyed by
//     ISO-3166 country. Anything unknown falls back to the configured
//     default (US).
//
// Disclosure: the caller is responsible for showing a short "This
// link is affiliate/sponsored" note next to the button in the UI.

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

// eBay MKCID/MKRID pairs per marketplace (public constants from the
// eBay Partner Network docs, safe to hardcode).
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

/** Choose a marketplace from an optional ISO country code. Anything
 *  outside the allowlist falls back to the configured default. */
export function marketplaceFor(country?: string | null): EbayMarketplace {
  if (!country) return DEFAULT_MARKETPLACE()
  const key = country.toUpperCase() as EbayMarketplace
  return HOST_BY_MARKETPLACE[key] ? key : DEFAULT_MARKETPLACE()
}

export type EbaySearchInput = {
  // Card facts. Everything is optional so callers can build progressive
  // searches (e.g. name only vs name+set+collector).
  cardName: string
  setName?: string | null
  setCode?: string | null
  collectorNumber?: string | null
  finish?: 'nonfoil' | 'foil' | 'etched' | null
  // Override the marketplace (typically derived from geo).
  marketplace?: EbayMarketplace
  // Free-form modifier appended to the query text (e.g. "cheap" or
  // "graded"). Kept short.
  modifier?: string
}

export type EbayLink = {
  href: string
  marketplace: EbayMarketplace
  affiliate: boolean          // true when tracking params were injected
  label: string               // suggested UI label (caller can override)
}

/** Build a query string that eBay's card catalogue tends to match well.
 *  Example inputs and outputs:
 *    name only                    →  "Lightning Bolt Magic the Gathering"
 *    name + set                   →  "Lightning Bolt Beta Magic the Gathering"
 *    name + set + collector       →  "Lightning Bolt Beta 161 Magic the Gathering"
 *    name + foil finish           →  "Lightning Bolt foil Magic the Gathering"
 */
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
 *  campaign ID is configured AND the master switch is on. */
export function buildEbaySearchLink(input: EbaySearchInput): EbayLink {
  const marketplace = input.marketplace ?? DEFAULT_MARKETPLACE()
  const host = HOST_BY_MARKETPLACE[marketplace]

  const url = new URL(`https://${host}/sch/i.html`)
  url.searchParams.set('_nkw', buildQuery(input))
  url.searchParams.set('_sacat', MTG_CATEGORY_ID)

  const campid = (process.env.EBAY_EPN_CAMPAIGN_ID ?? '').trim()
  const enabled = process.env.EBAY_AFFILIATE_ENABLED === 'true'
  const affiliate = Boolean(campid) && enabled

  if (affiliate) {
    const ids = MK_IDS[marketplace]
    // Standard EPN "clkid" pattern. Values here mirror the eBay-provided
    // tracking template; the campid is the value that attributes revenue.
    url.searchParams.set('mkevt', '1')
    url.searchParams.set('mkcid', ids.mkcid)
    url.searchParams.set('mkrid', ids.mkrid)
    url.searchParams.set('campid', campid)
    const custom = (process.env.EBAY_CUSTOM_ID ?? '').trim()
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

/** Convenience: is the account wired up for revenue tracking at all?
 *  Used by the UI to decide whether to show the small affiliate
 *  disclosure line. */
export function ebayAffiliateConfigured(): boolean {
  return Boolean(process.env.EBAY_EPN_CAMPAIGN_ID?.trim()) && process.env.EBAY_AFFILIATE_ENABLED === 'true'
}
