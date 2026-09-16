// src/lib/mtg/public-deck.ts
//
// Deliberate public projection of a deck for /decks/public/[slug].
//
// The public payload is a STRICT WHITELIST — every field is chosen and
// added by hand. NEVER dump DeckContext directly. Fields explicitly
// excluded:
//   - user_id, owner email, auth data
//   - private notes (description IS included; per-card `notes` on
//     mtg_deck_cards is NOT)
//   - the owner's collection contents (`owned` on DeckCardContext)
//   - the owner's acquired prices / private price info
//   - AI usage rows
//   - user preferences
//
// Public price data is deliberately included: we use PUBLIC market
// prices (cheapest current retail at the deck's declared basis) so
// visitors get a sense of deck cost. That is derived from
// mtg_current_prices which is public catalogue data, not the owner's
// collection.

import 'server-only'
import { getSupabaseServiceClient } from '@/lib/supabaseService'
import type { FormatKey } from './formats.data'
import type { CardCapability } from './capabilities'
import type { DeckZone, ValidationResult, DeckCardForValidation } from './deck-rules'
import { validateDeck, typeBreakdown, manaCurve, capabilityBreakdown, unionColorIdentity } from './deck-rules'
import { getFormatRule } from './format-rules'
import { VALUATION_BASES, findBasis, type ValuationBasis } from './valuation.data'

export type PublicDeckCard = {
  oracle_card_id: string
  name: string
  quantity: number
  zone: DeckZone
  mana_cost: string | null
  mana_value: number | null
  type_line: string | null
  colors: string[]
  color_identity: string[]
  capabilities: CardCapability[]
  keywords: string[]
  layout: string | null
  preferredPrinting: {
    set_code: string
    collector_number: string | null
    finish: string
    image_uri_small: string | null
  } | null
  /** PUBLIC price only — cheapest current retail at the deck's basis.
   *  Explicitly does NOT include ownership or "acquired at" prices. */
  publicPrice: {
    price: number
    currency: string
    provider: string
    finish: string
  } | null
}

export type PublicDeckPayload = {
  deck: {
    id: string
    name: string
    format: FormatKey
    description: string | null
    slug: string | null
    createdAt: string
    updatedAt: string
    // No user_id. No owner email. No is_public (implicit — this
    // payload only exists for public decks).
  }
  commanders: PublicDeckCard[]
  main: PublicDeckCard[]
  sideboard: PublicDeckCard[]
  companion: PublicDeckCard[]
  maybeboard: PublicDeckCard[]
  totals: {
    main: number
    sideboard: number
    commander: number
    companion: number
    maybeboard: number
  }
  curve: number[]
  colorIdentity: string[]
  typeBreakdown: Record<string, number>
  capabilityBreakdown: Partial<Record<CardCapability, number>>
  pricing: {
    basis: {
      key: string
      label: string
      provider: string
      currency: string
      price_type: string
      market: string
    }
    /** Sum of publicPrice.price * quantity across all cards that have
     *  a price at the deck's basis. */
    deckValue: number
    /** Count of card entries with no price at basis. */
    entriesWithoutPrice: number
  }
  validation: ValidationResult
}

/** Load a public deck by slug. Returns null when not found OR when the
 *  deck is not public (indistinguishable — 404 either way from the
 *  route). This function uses the SERVICE-ROLE client so it works
 *  without a user session, but it verifies `is_public = true` server-
 *  side so a private deck cannot slip through. */
export async function loadPublicDeckBySlug(slug: string): Promise<PublicDeckPayload | null> {
  const s = getSupabaseServiceClient()
  const { data: deckRow } = await s
    .from('mtg_decks')
    .select('id, name, format, description, slug, is_public, budget_currency, created_at, updated_at')
    .eq('slug', slug)
    .eq('is_public', true)
    .maybeSingle()
  if (!deckRow) return null
  const deck = deckRow as any

  const { data: cardsRaw } = await s
    .from('mtg_deck_cards')
    .select('oracle_card_id, quantity, zone, printing_finish_id')
    .eq('deck_id', deck.id)
  const cards = (cardsRaw ?? []) as any[]
  if (cards.length === 0) {
    return emptyPayload(deck)
  }

  const oracleIds = Array.from(new Set(cards.map((c) => c.oracle_card_id)))
  const finishIds = Array.from(new Set(cards.map((c) => c.printing_finish_id).filter(Boolean) as string[]))

  const [{ data: oracles }, { data: legalities }] = await Promise.all([
    s.from('mtg_oracle_cards')
      .select('id, name, mana_cost, mana_value, type_line, colors, color_identity, keywords, capabilities, layout, oracle_text')
      .in('id', oracleIds),
    s.from('mtg_oracle_legalities')
      .select('oracle_card_id, legality')
      .in('oracle_card_id', oracleIds)
      .eq('format', deck.format),
  ])
  const oracleById = new Map<string, any>()
  for (const o of (oracles ?? []) as any[]) oracleById.set(o.id, o)
  const legalByOracle = new Map<string, string>()
  for (const l of (legalities ?? []) as any[]) legalByOracle.set(l.oracle_card_id, l.legality)

  // Freshest printing per oracle for the public thumbnail.
  const IN_CHUNK = 60
  const printingRows: any[] = []
  for (let i = 0; i < oracleIds.length; i += IN_CHUNK) {
    const chunk = oracleIds.slice(i, i + IN_CHUNK)
    const { data } = await s.from('mtg_printings')
      .select('id, oracle_card_id, set_code, collector_number, image_uri_small, released_at')
      .in('oracle_card_id', chunk)
      .eq('lang', 'en')
      .eq('digital', false)
      .order('released_at', { ascending: false, nullsFirst: false })
    for (const p of (data ?? []) as any[]) printingRows.push(p)
  }
  const printingByOracle = new Map<string, any>()
  for (const p of printingRows) if (!printingByOracle.has(p.oracle_card_id)) printingByOracle.set(p.oracle_card_id, p)

  // For preferred_finish resolution, look up the finish row.
  const finishByFinishId = new Map<string, any>()
  if (finishIds.length > 0) {
    const { data: finishes } = await s.from('mtg_printing_finishes')
      .select('id, printing_id, finish')
      .in('id', finishIds)
    const printingIdsFromFinishes = Array.from(new Set((finishes ?? []).map((f: any) => f.printing_id)))
    const { data: printings2 } = printingIdsFromFinishes.length > 0
      ? await s.from('mtg_printings')
          .select('id, set_code, collector_number, image_uri_small')
          .in('id', printingIdsFromFinishes)
      : { data: [] as any[] }
    const printingById = new Map<string, any>()
    for (const p of (printings2 ?? []) as any[]) printingById.set(p.id, p)
    for (const f of (finishes ?? []) as any[]) {
      const p = printingById.get(f.printing_id)
      if (p) finishByFinishId.set(f.id, {
        finish: f.finish,
        set_code: p.set_code,
        collector_number: p.collector_number,
        image_uri_small: p.image_uri_small,
      })
    }
  }

  // Basis for public price. Use the deck's declared budget currency to
  // pick a matching basis; else default to VALUATION_BASES[0].
  const basis = pickPublicBasis(deck.budget_currency)

  // Batch-fetch cheapest current price per oracle at the basis.
  const publicPriceByOracle = await batchCheapestPublicPrice(oracleIds, basis)

  const cardCtx: PublicDeckCard[] = cards.map((c) => {
    const o = oracleById.get(c.oracle_card_id) ?? {}
    const pf = c.printing_finish_id ? finishByFinishId.get(c.printing_finish_id) : null
    const fresh = printingByOracle.get(c.oracle_card_id)
    return {
      oracle_card_id: c.oracle_card_id,
      name: o.name ?? '(unknown)',
      quantity: c.quantity,
      zone: c.zone as DeckZone,
      mana_cost: o.mana_cost ?? null,
      mana_value: o.mana_value ?? null,
      type_line: o.type_line ?? null,
      colors: o.colors ?? [],
      color_identity: o.color_identity ?? [],
      capabilities: o.capabilities ?? [],
      keywords: o.keywords ?? [],
      layout: o.layout ?? null,
      preferredPrinting: pf ? {
        set_code: pf.set_code,
        collector_number: pf.collector_number,
        finish: pf.finish,
        image_uri_small: pf.image_uri_small ?? null,
      } : (fresh ? {
        set_code: fresh.set_code,
        collector_number: fresh.collector_number,
        finish: 'nonfoil',
        image_uri_small: fresh.image_uri_small ?? null,
      } : null),
      publicPrice: publicPriceByOracle.get(c.oracle_card_id) ?? null,
    }
  })

  const commanders = cardCtx.filter((c) => c.zone === 'commander')
  const main = cardCtx.filter((c) => c.zone === 'main')
  const sideboard = cardCtx.filter((c) => c.zone === 'sideboard')
  const companion = cardCtx.filter((c) => c.zone === 'companion')
  const maybeboard = cardCtx.filter((c) => c.zone === 'maybeboard')

  const validationCards: DeckCardForValidation[] = cardCtx.map((c) => ({
    oracle_card_id: c.oracle_card_id,
    name: c.name,
    quantity: c.quantity,
    zone: c.zone,
    type_line: c.type_line,
    color_identity: c.color_identity,
    keywords: c.keywords,
    oracle_text: (oracleById.get(c.oracle_card_id) ?? {}).oracle_text ?? null,
    legality: legalByOracle.get(c.oracle_card_id) ?? null,
  }))
  const validation = validateDeck({ format: deck.format as FormatKey, cards: validationCards })

  const rule = getFormatRule(deck.format)
  const colorIdentity = rule?.enforceColorIdentity && commanders.length > 0
    ? unionColorIdentity(commanders)
    : unionColorIdentity(main)

  const deckValue = main.concat(commanders, sideboard, companion, maybeboard)
    .reduce((n, c) => n + (c.publicPrice ? c.publicPrice.price * c.quantity : 0), 0)
  const entriesWithoutPrice = cardCtx.filter((c) => !c.publicPrice).length

  return {
    deck: {
      id: deck.id,
      name: deck.name,
      format: deck.format as FormatKey,
      description: deck.description ?? null,
      slug: deck.slug ?? null,
      createdAt: deck.created_at,
      updatedAt: deck.updated_at,
    },
    commanders, main, sideboard, companion, maybeboard,
    totals: {
      main: main.length,
      sideboard: sideboard.length,
      commander: commanders.length,
      companion: companion.length,
      maybeboard: maybeboard.length,
    },
    curve: manaCurve(main.map((c) => ({
      oracle_card_id: c.oracle_card_id, name: c.name, quantity: c.quantity, zone: c.zone,
      type_line: c.type_line, color_identity: c.color_identity, keywords: c.keywords,
      oracle_text: null, legality: 'legal', mana_value: c.mana_value,
    }))),
    colorIdentity,
    typeBreakdown: typeBreakdown(main.map((c) => ({
      oracle_card_id: c.oracle_card_id, name: c.name, quantity: c.quantity, zone: c.zone,
      type_line: c.type_line, color_identity: c.color_identity, keywords: c.keywords,
      oracle_text: null, legality: 'legal',
    }))),
    capabilityBreakdown: capabilityBreakdown(main.map((c) => ({
      oracle_card_id: c.oracle_card_id, name: c.name, quantity: c.quantity, zone: c.zone,
      type_line: c.type_line, color_identity: c.color_identity, keywords: c.keywords,
      oracle_text: null, legality: 'legal', capabilities: c.capabilities,
    }))),
    pricing: {
      basis: {
        key: basis.key,
        label: basis.label,
        provider: basis.provider,
        currency: basis.currency,
        price_type: basis.price_type,
        market: basis.market,
      },
      deckValue,
      entriesWithoutPrice,
    },
    validation,
  }
}

// ── Helpers ────────────────────────────────────────────────────────

function pickPublicBasis(preferredCurrency: string | null): ValuationBasis {
  if (preferredCurrency === 'EUR') {
    const eur = VALUATION_BASES.find((b) => b.currency === 'EUR' && b.market === 'paper' && b.price_type === 'retail')
    if (eur) return eur
  }
  const usd = VALUATION_BASES.find((b) => b.currency === 'USD' && b.market === 'paper' && b.price_type === 'retail' && b.provider === 'tcgplayer')
  return usd ?? VALUATION_BASES[0]
}
void findBasis

const IN_CHUNK_PRICE = 100

async function batchCheapestPublicPrice(
  oracleIds: string[],
  basis: ValuationBasis,
): Promise<Map<string, PublicDeckCard['publicPrice']>> {
  const out = new Map<string, PublicDeckCard['publicPrice']>()
  if (oracleIds.length === 0) return out
  const s = getSupabaseServiceClient()

  // Printings → finishes → prices at basis. All using service role
  // (public catalogue data, no user scoping needed).
  const printingIds: string[] = []
  const printingToOracle = new Map<string, string>()
  for (let i = 0; i < oracleIds.length; i += IN_CHUNK_PRICE) {
    const chunk = oracleIds.slice(i, i + IN_CHUNK_PRICE)
    const { data } = await s.from('mtg_printings')
      .select('id, oracle_card_id')
      .in('oracle_card_id', chunk)
      .eq('lang', 'en')
      .eq('digital', false)
    for (const p of (data ?? []) as any[]) {
      printingIds.push(p.id)
      printingToOracle.set(p.id, p.oracle_card_id)
    }
  }
  if (printingIds.length === 0) return out

  const finishToOracle = new Map<string, { oracle: string; finish: string }>()
  for (let i = 0; i < printingIds.length; i += IN_CHUNK_PRICE) {
    const chunk = printingIds.slice(i, i + IN_CHUNK_PRICE)
    const { data } = await s.from('mtg_printing_finishes').select('id, printing_id, finish').in('printing_id', chunk)
    for (const f of (data ?? []) as any[]) {
      const oracle = printingToOracle.get(f.printing_id)
      if (oracle) finishToOracle.set(f.id, { oracle, finish: f.finish })
    }
  }
  const finishIds = Array.from(finishToOracle.keys())
  if (finishIds.length === 0) return out

  for (let i = 0; i < finishIds.length; i += IN_CHUNK_PRICE) {
    const chunk = finishIds.slice(i, i + IN_CHUNK_PRICE)
    const { data } = await s.from('mtg_current_prices')
      .select('printing_finish_id, provider, price, currency, price_type, market')
      .in('printing_finish_id', chunk)
      .eq('provider', basis.provider)
      .eq('currency', basis.currency)
      .eq('price_type', basis.price_type)
      .eq('market', basis.market)
    for (const p of (data ?? []) as any[]) {
      const meta = finishToOracle.get(p.printing_finish_id)
      if (!meta) continue
      const price = Number(p.price)
      const cur = out.get(meta.oracle)
      if (!cur || price < cur.price) {
        out.set(meta.oracle, {
          price, currency: p.currency, provider: p.provider, finish: meta.finish,
        })
      }
    }
  }
  return out
}

function emptyPayload(deck: any): PublicDeckPayload {
  const basis = pickPublicBasis(deck.budget_currency)
  return {
    deck: {
      id: deck.id, name: deck.name, format: deck.format,
      description: deck.description ?? null, slug: deck.slug ?? null,
      createdAt: deck.created_at, updatedAt: deck.updated_at,
    },
    commanders: [], main: [], sideboard: [], companion: [], maybeboard: [],
    totals: { main: 0, sideboard: 0, commander: 0, companion: 0, maybeboard: 0 },
    curve: [0, 0, 0, 0, 0, 0, 0, 0], colorIdentity: [],
    typeBreakdown: {}, capabilityBreakdown: {},
    pricing: {
      basis: {
        key: basis.key, label: basis.label, provider: basis.provider,
        currency: basis.currency, price_type: basis.price_type, market: basis.market,
      },
      deckValue: 0, entriesWithoutPrice: 0,
    },
    validation: { ok: true, issues: [], warnings: [] },
  }
}
