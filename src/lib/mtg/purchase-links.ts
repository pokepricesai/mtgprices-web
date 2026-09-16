// src/lib/mtg/purchase-links.ts
//
// Deterministic purchase-URL generator with strict separation of:
//   1. URL construction — only from verified data (Scryfall printing
//      UUIDs; TCGplayer product IDs; Cardmarket product IDs).
//   2. Affiliate decoration — provider-specific functions that ONLY
//      apply verified tracking parameters. Nothing runs by default,
//      even if an environment variable is set. A partner ID alone
//      is not evidence of a verified programme.
//
// Rules:
//   * Never guess a URL. If we can't construct it from stored data,
//     the provider is not included in the result.
//   * Never fabricate affiliate parameters. A decorator activates
//     only when both (a) the programme's syntax is verified and (b)
//     the partner ID env var is set.
//
// Provider status:
//
//   * Scryfall — Every printing has a scryfall_id on mtg_printings.
//                Public URL: https://scryfall.com/card/{scryfall_id}
//                Not a marketplace — included as a reference link.
//                No affiliate programme.
//
//   * TCGplayer — Needs a TCGplayer product_id in mtg_external_identifiers
//                 (provider='tcgplayer', identifier_type='product_id').
//                 Product URL: https://www.tcgplayer.com/product/{product_id}
//                 Affiliate: unverified. Decorator returns the URL
//                 unchanged until Luke provides confirmed Partnerize
//                 documentation.
//
//   * Cardmarket — Needs a Cardmarket product_id in mtg_external_identifiers
//                  (provider='cardmarket', identifier_type='product_id').
//                  Product-ID redirect URL:
//                    https://www.cardmarket.com/Magic/Products?idProduct=<id>
//                  Affiliate: unverified. Decorator returns the URL
//                  unchanged until Luke provides confirmed programme
//                  documentation.
//
//   * Card Kingdom, Manapool, Cardhoarder — No stored product IDs.
//                                           No verified URL scheme.
//                                           Omitted.
//
// See src/lib/mtg/purchase-links.md for the audit + credentials
// required.

import 'server-only'
import { getSupabaseServiceClient } from '@/lib/supabaseService'

export type PurchaseLink = {
  provider: string
  label: string
  url: string
  affiliate: boolean
  scope: 'printing' | 'oracle'
  scryfall_id?: string
  printing_id?: string
}

// ── URL builders (verified schemes only) ───────────────────────────

/** Scryfall public card URL. Every stored scryfall_id resolves. */
function scryfallUrl(scryfallId: string): string {
  return `https://scryfall.com/card/${encodeURIComponent(scryfallId)}`
}

/** TCGplayer product-page URL. Requires a numeric-ish product_id. */
function tcgplayerUrl(productId: string): string {
  return `https://www.tcgplayer.com/product/${encodeURIComponent(productId)}`
}

/** Cardmarket product-ID redirect. Documented pattern uses the
 *  idProduct query parameter — Cardmarket resolves it to the
 *  canonical product page server-side. Do not use the /en/Magic/
 *  Products/Singles/{id} path — that requires the URL-name slug and
 *  is not stored. */
function cardmarketUrl(productId: string): string {
  return `https://www.cardmarket.com/Magic/Products?idProduct=${encodeURIComponent(productId)}`
}

// ── Affiliate decorators (per-provider, verified only) ──────────────
//
// A decorator receives the raw URL and returns either the same URL
// (no verified tracking) or a decorated URL with tracking. It sets
// PurchaseLink.affiliate=true ONLY when it actually adds a tracking
// parameter. Environment-variable presence alone is not sufficient
// — the code path must be explicitly enabled here after Luke has
// confirmed the programme's tracking syntax.

type Decorator = (url: string) => { url: string; affiliate: boolean }

/** TCGplayer — Partnerize. Not enabled: the specific tracking-parameter
 *  name and semantics have not been verified from official Partnerize
 *  documentation for MTGPrices's account. When enabled this function
 *  will read TCGPLAYER_PARTNER_ID and append the confirmed parameter. */
const decorateTcgplayer: Decorator = (url) => {
  // Intentional no-op. The tracking parameter name and semantics for
  // Partnerize/TCGplayer are unverified for MTGPrices's account, so
  // we do not append anything. Enable only after Luke confirms.
  return { url, affiliate: false }
}

/** Cardmarket — affiliate programme (if any) not verified. Same
 *  no-op stance as TCGplayer. When enabled this will read
 *  CARDMARKET_PARTNER_ID and append the confirmed parameter. */
const decorateCardmarket: Decorator = (url) => {
  // Intentional no-op. Cardmarket has not confirmed a query-parameter
  // affiliate scheme in publicly documented form. Never append any
  // tracking parameter unless the programme's own docs mandate it.
  return { url, affiliate: false }
}

const NOOP_DECORATOR: Decorator = (url) => ({ url, affiliate: false })

// ── Main API ────────────────────────────────────────────────────────

/** For each Oracle, resolve the deterministic set of purchase links.
 *  Batches DB queries. Returns Map<oracle_card_id, links>. */
export async function buildPurchaseLinksForOracle(oracleIds: string[]): Promise<Map<string, PurchaseLink[]>> {
  const out = new Map<string, PurchaseLink[]>()
  if (oracleIds.length === 0) return out
  const s = getSupabaseServiceClient()

  // Freshest English printing per oracle — gives us the Scryfall URL
  // and lets us prefer its identifier row when there's a choice.
  const IN_CHUNK = 60
  const printingRows: any[] = []
  for (let i = 0; i < oracleIds.length; i += IN_CHUNK) {
    const chunk = oracleIds.slice(i, i + IN_CHUNK)
    const { data } = await s.from('mtg_printings')
      .select('id, oracle_card_id, set_code, collector_number, scryfall_id, released_at')
      .in('oracle_card_id', chunk)
      .eq('lang', 'en')
      .eq('digital', false)
      .order('released_at', { ascending: false, nullsFirst: false })
    for (const p of (data ?? []) as any[]) printingRows.push(p)
  }
  const freshestByOracle = new Map<string, any>()
  const allPrintingIds: string[] = []
  const oracleByPrintingId = new Map<string, string>()
  for (const p of printingRows) {
    if (!freshestByOracle.has(p.oracle_card_id)) freshestByOracle.set(p.oracle_card_id, p)
    allPrintingIds.push(p.id)
    oracleByPrintingId.set(p.id, p.oracle_card_id)
  }

  // External identifiers for every printing. We look for specific
  // (provider, identifier_type) combinations only — never every row.
  const identRows: any[] = []
  for (let i = 0; i < allPrintingIds.length; i += IN_CHUNK) {
    const chunk = allPrintingIds.slice(i, i + IN_CHUNK)
    const { data } = await s.from('mtg_external_identifiers')
      .select('printing_id, provider, identifier_type, identifier_value')
      .in('printing_id', chunk)
      .in('provider', ['tcgplayer', 'cardmarket'])
    for (const r of (data ?? []) as any[]) identRows.push(r)
  }
  // Index by (oracle, provider) preferring the freshest printing's row.
  const identByOracleProvider = new Map<string, Map<string, { value: string; printing_id: string; identifier_type: string }>>()
  for (const r of identRows) {
    const oracle = oracleByPrintingId.get(r.printing_id)
    if (!oracle) continue
    // Only accept rows whose identifier_type is 'product_id'. Anything
    // else (e.g. mtgjson UUIDs mis-provisioned under a marketplace
    // provider) would be a data bug, not a real product reference.
    if (r.identifier_type !== 'product_id') continue
    const bucket = identByOracleProvider.get(oracle) ?? new Map()
    const freshest = freshestByOracle.get(oracle)
    const isFreshest = freshest?.id === r.printing_id
    if (!bucket.has(r.provider) || isFreshest) {
      bucket.set(r.provider, {
        value: r.identifier_value,
        printing_id: r.printing_id,
        identifier_type: r.identifier_type,
      })
    }
    identByOracleProvider.set(oracle, bucket)
  }

  for (const oracleId of oracleIds) {
    const links: PurchaseLink[] = []
    const freshest = freshestByOracle.get(oracleId)
    const idents = identByOracleProvider.get(oracleId) ?? new Map()

    // ── Scryfall (always available for indexed printings). ──
    if (freshest?.scryfall_id) {
      const base = scryfallUrl(freshest.scryfall_id)
      const decorated = NOOP_DECORATOR(base)  // no affiliate on Scryfall
      links.push({
        provider: 'scryfall', label: 'Scryfall',
        url: decorated.url, affiliate: decorated.affiliate,
        scope: 'printing', scryfall_id: freshest.scryfall_id, printing_id: freshest.id,
      })
    }

    // ── TCGplayer (only when a product_id identifier exists). ──
    const tcg = idents.get('tcgplayer')
    if (tcg) {
      const base = tcgplayerUrl(tcg.value)
      const decorated = decorateTcgplayer(base)
      links.push({
        provider: 'tcgplayer', label: 'TCGplayer',
        url: decorated.url, affiliate: decorated.affiliate,
        scope: 'printing', printing_id: tcg.printing_id,
      })
    }

    // ── Cardmarket (only when a product_id identifier exists). ──
    const cm = idents.get('cardmarket')
    if (cm) {
      const base = cardmarketUrl(cm.value)
      const decorated = decorateCardmarket(base)
      links.push({
        provider: 'cardmarket', label: 'Cardmarket',
        url: decorated.url, affiliate: decorated.affiliate,
        scope: 'printing', printing_id: cm.printing_id,
      })
    }

    out.set(oracleId, links)
  }
  return out
}
