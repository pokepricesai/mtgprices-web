// src/lib/mtg/tcgplayerAffiliate.ts
// TCGplayer affiliate URL builder for MTGPrices.
//
// CN-05 Sprint 5. Port of the PokePrices resolver pattern. Uses the
// verified Impact share-link deep-link mechanism — appending
// `?u={encoded_destination}&sharedid={subid}` to the base partner
// URL preserves the destination and attaches `irclickid` server-side
// on the redirect. No TCGplayer API access required.
//
// Base link (user-confirmed, approved for all 5 sites):
//   https://partner.tcgplayer.com/k4EaNV
//
// Two destination modes:
//   * exact-product — numeric `productId` from a verified
//     mtg_external_identifiers row (provider='tcgplayer',
//     identifier_type='product_id'). Label: "View on TCGplayer".
//   * search        — productId is null / missing. Falls back to the
//     magic search URL with cardName + collectorNumber. Label:
//     "Find on TCGplayer" so users understand it's a search.
//
// Note: as of 2026-09-17, mtg_external_identifiers has 0 rows for
// provider='tcgplayer' (per src/lib/mtg/purchase-links.md). All calls
// resolve to search until Stage 1D backfills IDs. The component
// callers remain unchanged after a backfill.

const PARTNER_BASE = 'https://partner.tcgplayer.com/k4EaNV'

export interface MtgTcgplayerLinkInput {
  cardName: string
  /** Optional set code — appended to the search query for specificity. */
  setCode?: string | null
  /** Optional collector number — appended to search query. */
  collectorNumber?: string | null
  /** Verified TCGplayer product ID. If omitted / non-numeric, falls
   *  back to a magic search URL. */
  productId?: string | number | null
  /** Impact SubID (sharedid). Capped at 70 chars by Impact. */
  subid?: string
}

export interface TcgplayerLink {
  href: string
  isExact: boolean
  label: string
}

function toProductUrl(id: string | number): string {
  return `https://www.tcgplayer.com/product/${encodeURIComponent(String(id))}`
}

function toSearchUrl(query: string): string {
  return `https://www.tcgplayer.com/search/magic/product?q=${encodeURIComponent(query)}`
}

function wrap(destination: string, subid: string | undefined): string {
  const u = new URL(PARTNER_BASE)
  u.searchParams.set('u', destination)
  if (subid) {
    const trimmed = subid.length > 70 ? subid.slice(0, 70) : subid
    u.searchParams.set('sharedid', trimmed)
  }
  return u.toString()
}

export function buildMtgTcgplayerLink(input: MtgTcgplayerLinkInput): TcgplayerLink {
  const idStr = input.productId == null ? '' : String(input.productId).trim()
  const hasExact = idStr.length > 0 && /^[0-9]+$/.test(idStr)
  if (hasExact) {
    return {
      href: wrap(toProductUrl(idStr), input.subid),
      isExact: true,
      label: 'View on TCGplayer',
    }
  }

  const name = (input.cardName ?? '').trim()
  const setCode = (input.setCode ?? '').trim().toUpperCase()
  const num = (input.collectorNumber ?? '').trim()
  // "{Name} ({SETCODE}) {collectorNumber}" — matches TCGplayer's
  // natural search token order and narrows across printings.
  const parts = [name, setCode ? `(${setCode})` : '', num]
    .map((p) => p.trim())
    .filter((p) => p.length > 0)
  const query = parts.join(' ')
  if (query.length === 0) {
    return {
      href: wrap(toSearchUrl('magic the gathering'), input.subid),
      isExact: false,
      label: 'Browse on TCGplayer',
    }
  }
  return {
    href: wrap(toSearchUrl(query), input.subid),
    isExact: false,
    label: 'Find on TCGplayer',
  }
}
