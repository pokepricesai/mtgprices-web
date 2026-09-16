// src/lib/mtg/purchase-links.ts
//
// Deterministic purchase-URL generator.
//
// Rules:
//   1. NEVER guess a URL. If we can't construct it from stored data,
//      the provider is not included in the result.
//   2. Affiliate/referral tags come from environment variables ONLY.
//      Never hard-coded. Never fabricated.
//   3. Currencies stay separated at the caller — this module just
//      returns URLs and does NOT sort or compare prices.
//
// Providers considered:
//
//   * Scryfall — Every printing has a scryfall_id on mtg_printings.
//                Public URL: https://scryfall.com/card/{scryfall_id}
//                Not a marketplace — we include it for reference only
//                when a marketplace URL is unavailable. Scryfall does
//                not run an affiliate programme.
//
//   * TCGplayer — Needs a TCGplayer product_id in mtg_external_identifiers.
//                 URL: https://www.tcgplayer.com/product/{product_id}
//                 Referral: TCGplayer's affiliate programme is run
//                 through Partnerize/Impact; if a partner ID is set
//                 in env we append ?partner=... (verified format).
//                 Without a partner ID we emit the bare product URL.
//
//   * Cardmarket — Needs a Cardmarket product_id in mtg_external_identifiers.
//                  URL: https://www.cardmarket.com/en/Magic/Products/Singles/{product_id}
//                  Referral: unverified as of ship — no ref param
//                  emitted until Luke confirms the affiliate scheme.
//
//   * Card Kingdom — We do NOT currently have Card Kingdom product IDs
//                    in mtg_external_identifiers. No reliable URL
//                    construction — omit until identifiers are ingested.
//
//   * Manapool, Cardhoarder — Same story. Omit until identifiers are
//                             ingested.
//
// See docs at src/lib/mtg/purchase-links.md (audit report).

import 'server-only'
import { getSupabaseServiceClient } from '@/lib/supabaseService'

export type PurchaseLink = {
  provider: string
  label: string
  url: string
  affiliate: boolean
  /** Which finish/printing does this link point at? For links
   *  constructed from a specific mtg_external_identifiers row, this
   *  identifies the target so the UI can hide/show it based on the
   *  chosen printing. */
  scope: 'printing' | 'oracle'
  scryfall_id?: string
  printing_id?: string
}

/** Optional affiliate config from environment. Never hard-coded IDs. */
function tcgplayerPartner(): string | null {
  const v = process.env.TCGPLAYER_PARTNER_ID
  return v && v.trim().length > 0 ? v.trim() : null
}
function cardmarketPartner(): string | null {
  const v = process.env.CARDMARKET_PARTNER_ID
  return v && v.trim().length > 0 ? v.trim() : null
}

/** For each Oracle, resolve the best deterministic set of purchase
 *  links. Batches DB queries. Returns Map<oracle_card_id, links>. */
export async function buildPurchaseLinksForOracle(oracleIds: string[]): Promise<Map<string, PurchaseLink[]>> {
  const out = new Map<string, PurchaseLink[]>()
  if (oracleIds.length === 0) return out
  const s = getSupabaseServiceClient()

  // Freshest English printing per oracle — gives Scryfall URL and set/cn
  // that we'll pass through to providers if needed.
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

  // External identifiers (TCGplayer, Cardmarket, …) for every printing.
  const identRows: any[] = []
  for (let i = 0; i < allPrintingIds.length; i += IN_CHUNK) {
    const chunk = allPrintingIds.slice(i, i + IN_CHUNK)
    const { data } = await s.from('mtg_external_identifiers')
      .select('printing_id, provider, identifier_type, identifier_value')
      .in('printing_id', chunk)
    for (const r of (data ?? []) as any[]) identRows.push(r)
  }
  const identByOracleProvider = new Map<string, Map<string, { identifier_type: string; value: string; printing_id: string }>>()
  for (const r of identRows) {
    const oracle = oracleByPrintingId.get(r.printing_id)
    if (!oracle) continue
    const bucket = identByOracleProvider.get(oracle) ?? new Map()
    // Prefer the freshest printing's identifier when there's a choice.
    const freshest = freshestByOracle.get(oracle)
    const isFreshest = freshest?.id === r.printing_id
    if (!bucket.has(r.provider) || isFreshest) {
      bucket.set(r.provider, {
        identifier_type: r.identifier_type,
        value: r.identifier_value,
        printing_id: r.printing_id,
      })
    }
    identByOracleProvider.set(oracle, bucket)
  }

  const tcgPartner = tcgplayerPartner()
  const cmPartner = cardmarketPartner()

  for (const oracleId of oracleIds) {
    const links: PurchaseLink[] = []
    const freshest = freshestByOracle.get(oracleId)
    const idents = identByOracleProvider.get(oracleId) ?? new Map()

    // Scryfall — reference (not a marketplace). Only included when a
    // scryfall_id exists. Never affiliate.
    if (freshest?.scryfall_id) {
      links.push({
        provider: 'scryfall',
        label: 'Scryfall',
        url: `https://scryfall.com/card/${freshest.scryfall_id}`,
        affiliate: false,
        scope: 'printing',
        scryfall_id: freshest.scryfall_id,
        printing_id: freshest.id,
      })
    }

    // TCGplayer — product URL. Needs identifier.
    const tcg = idents.get('tcgplayer')
    if (tcg) {
      let url = `https://www.tcgplayer.com/product/${encodeURIComponent(tcg.value)}`
      if (tcgPartner) url += `?partner=${encodeURIComponent(tcgPartner)}`
      links.push({
        provider: 'tcgplayer',
        label: 'TCGplayer',
        url,
        affiliate: Boolean(tcgPartner),
        scope: 'printing',
        printing_id: tcg.printing_id,
      })
    }

    // Cardmarket — product URL. Needs identifier.
    const cm = idents.get('cardmarket')
    if (cm) {
      let url = `https://www.cardmarket.com/en/Magic/Products/Singles/${encodeURIComponent(cm.value)}`
      if (cmPartner) url += `?utm_source=${encodeURIComponent(cmPartner)}`
      links.push({
        provider: 'cardmarket',
        label: 'Cardmarket',
        url,
        affiliate: Boolean(cmPartner),
        scope: 'printing',
        printing_id: cm.printing_id,
      })
    }

    out.set(oracleId, links)
  }
  return out
}
